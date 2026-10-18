import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Entirely local HTTP tests: no .env, real credentials or production requests.
Deno.test("Pi library and brew handover over HTTP", async (t) => {
  const nativeServe = Deno.serve;
  const handlers: Record<string, (req: Request) => Response | Promise<Response>> = {};
  let library: Record<string, unknown> | null = null;
  let brew: Record<string, unknown> | null = null;
  const database = nativeServe({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
    const table = new URL(req.url).pathname.split("/").pop();
    if (req.method === "POST") {
      const row = await req.json();
      if (table === "pi_profile_library") library = row;
      if (table === "brew_readings") brew = { ...row, id: "test-brew", linked_controller_id: null };
    }
    const objectResponse = req.headers.get("Accept")?.includes("vnd.pgrst.object");
    let data: unknown = [];
    if (table === "pi_profile_library" && library) data = { payload: library.payload, received_at: library.received_at };
    if (table === "brew_readings" && brew) data = objectResponse ? brew : [brew];
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  });
  const databaseUrl = `http://127.0.0.1:${database.addr.port}`;
  const env = {
    SUPABASE_URL: databaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    PI_BLE_INGEST_SECRET: "test-pi-secret",
    BREW_INGEST_SECRET: "test-brew-secret",
    BREW_INGEST_SECRET_2: "test-brew-secret-2",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  let functionServer: Deno.HttpServer | undefined;
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    for (const name of ["pi-profiles", "receive-brew", "pi-control"]) {
      Deno.serve = ((handler: (req: Request) => Response | Promise<Response>) => {
        handlers[name] = handler;
        return {};
      }) as typeof Deno.serve;
      await import(`../${name}/index.ts`);
    }
    Deno.serve = nativeServe;
    functionServer = nativeServe({ port: 0, hostname: "127.0.0.1", onListen() {} }, (req) => {
      const handler = handlers[new URL(req.url).pathname.split("/").pop() ?? ""];
      return handler ? handler(req) : new Response("Not found", { status: 404 });
    });
    const base = `http://127.0.0.1:${functionServer.addr.port}/functions/v1`;
    const call = async (name: string, method: string, header: string, secret: string, body?: unknown) => {
      const response = await fetch(`${base}/${name}`, {
        method, headers: { [header]: secret, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const document = {
      contract: 1, profiles: [{ id: "novalager-v2", steps: [{ arbitrary: "preserved" }] }],
      builder: { contract: 1, templates: [] }, requests: [{ status: "built" }],
      published_at: "2026-10-18T12:00:00Z",
    };
    await t.step("GET before publication returns nulls", async () => {
      assertEquals(await call("pi-profiles", "GET", "x-brew-secret", env.BREW_INGEST_SECRET), {
        status: 200, data: { payload: null, received_at: null },
      });
    });
    await t.step("curl-style POST then GET preserves the entire document and replaces singleton", async () => {
      for (const payload of [document, { ...document, profiles: [] }]) {
        assertEquals(await call("pi-profiles", "POST", "x-pi-secret", env.PI_BLE_INGEST_SECRET, payload), { status: 200, data: { ok: true } });
        const result = await call("pi-profiles", "GET", "x-brew-secret", env.BREW_INGEST_SECRET_2);
        assertEquals(result.status, 200);
        assertEquals(result.data.payload, payload);
        assertEquals(Number.isFinite(Date.parse(result.data.received_at)), true);
        assertEquals(library?.id, 1);
        assertEquals(library?.published_at, payload.published_at);
      }
    });
    for (const [rule, patch] of [
      ["contract equals 1", { contract: 2 }],
      ["profiles is array", { profiles: {} }],
      ["builder is object", { builder: [] }],
      ["builder is not null", { builder: null }],
      ["published_at is timestamp", { published_at: "invalid" }],
      ["document below 512 KB", { extra: "x".repeat(512 * 1024) }],
    ] as const) {
      await t.step(rule, async () => {
        const before = library;
        assertEquals((await call("pi-profiles", "POST", "x-pi-secret", env.PI_BLE_INGEST_SECRET, { ...document, ...patch })).status, 400);
        assertEquals(library, before);
      });
    }
    await t.step("GET and POST reject wrong secrets and cross-use", async () => {
      assertEquals((await call("pi-profiles", "POST", "x-pi-secret", env.BREW_INGEST_SECRET, document)).status, 401);
      assertEquals((await call("pi-profiles", "GET", "x-brew-secret", env.PI_BLE_INGEST_SECRET)).status, 401);
    });
    await t.step("receive-brew payload reaches pi-control unchanged, without a cloud UUID", async () => {
      const payload = {
        source_id: "test-source", name: "Test brew", og: 1.050, fg: 1.010,
        profile_id: "novalager-v2", profile_request: { template: "smart", params: { ferment_temp_c: 17 }, extra: ["unchanged"] },
      };
      assertEquals((await call("receive-brew", "POST", "x-brew-secret", env.BREW_INGEST_SECRET, payload)).status, 200);
      // A legacy mirror identifier must never override the recipe's Pi identifier.
      if (brew) brew.profile_id = "00000000-0000-4000-8000-000000000001";
      const result = await call("pi-control", "GET", "x-pi-secret", env.PI_BLE_INGEST_SECRET);
      assertEquals(result.status, 200);
      assertEquals(result.data.pending_brews.length, 1);
      const pending = result.data.pending_brews[0];
      assertEquals(pending.profile_id, payload.profile_id);
      assertEquals(pending.profile_request, payload.profile_request);
      assertEquals(pending.recipe.profile_id, payload.profile_id);
      assertEquals(pending.recipe.profile_request, payload.profile_request);
    });
  } finally {
    Deno.serve = nativeServe;
    await functionServer?.shutdown();
    await database.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});