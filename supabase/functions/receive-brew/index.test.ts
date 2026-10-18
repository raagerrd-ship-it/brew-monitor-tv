import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Helt lokala HTTP-tester mot en mockad PostgREST — inga produktionsrader skrivs.
type Row = Record<string, unknown>;

function matches(row: Row, key: string, expr: string): boolean {
  const value = row[key];
  if (expr.startsWith("eq.")) return String(value ?? "") === expr.slice(3);
  if (expr === "is.null") return value == null;
  if (expr === "not.is.null") return value != null;
  if (expr.startsWith("gte.")) return String(value ?? "") >= expr.slice(4);
  if (expr.startsWith("neq.")) return String(value ?? "") !== expr.slice(4);
  if (expr.startsWith("in.")) return expr.slice(4, -1).split(",").includes(String(value ?? ""));
  return true;
}

Deno.test({
  name: "receive-brew omsändningar och pi-control profile_asks",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const nativeServe = Deno.serve;
    const handlers: Record<string, (req: Request) => Response | Promise<Response>> = {};
    const tables: Record<string, Row[]> = {
      brew_readings: [], pi_commands: [], rapt_temp_controllers: [], pi_setpoint: [], pending_notifications: [],
    };
    const failTables = new Set<string>();
    let nextId = 1;

    const database = nativeServe({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
      const url = new URL(req.url);
      const table = url.pathname.split("/").pop() ?? "";
      const rows = (tables[table] ??= []);
      if (failTables.has(table)) {
        return new Response(JSON.stringify({ code: "XX000", message: "boom" }), { status: 500 });
      }
      if (req.method === "GET") {
        let result = rows.filter((row) =>
          [...url.searchParams.entries()].every(([key, expr]) =>
            ["select", "order", "limit", "offset"].includes(key) || matches(row, key, expr))
        );
        if (url.searchParams.get("order")) {
          const [col, dir] = url.searchParams.get("order")!.split(".");
          result = [...result].sort((a, b) =>
            (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (dir === "desc" ? -1 : 1));
        }
        const objectResponse = req.headers.get("Accept")?.includes("vnd.pgrst.object");
        return new Response(JSON.stringify(objectResponse ? (result[0] ?? null) : result),
          { headers: { "Content-Type": "application/json" } });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const conflict = url.searchParams.get("on_conflict");
        let stored: Row;
        const existingIndex = conflict ? rows.findIndex((r) => r[conflict] === body[conflict]) : -1;
        if (existingIndex >= 0) {
          rows[existingIndex] = { ...rows[existingIndex], ...body };
          stored = rows[existingIndex];
        } else {
          stored = { id: `row-${nextId++}`, ...body };
          rows.push(stored);
        }
        return new Response(JSON.stringify(req.headers.get("Accept")?.includes("vnd.pgrst.object") ? stored : [stored]),
          { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (req.method === "PATCH") {
        const body = await req.json();
        const targets = rows.filter((row) =>
          [...url.searchParams.entries()].every(([key, expr]) =>
            ["select"].includes(key) || matches(row, key, expr)));
        for (const target of targets) Object.assign(target, body);
        return new Response(JSON.stringify(req.headers.get("Accept")?.includes("vnd.pgrst.object") ? targets[0] : targets),
          { headers: { "Content-Type": "application/json" } });
      }
      return new Response("Method?", { status: 405 });
    });
    const databaseUrl = `http://127.0.0.1:${database.addr.port}`;

    const env = {
      SUPABASE_URL: databaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      PI_BLE_INGEST_SECRET: "test-pi-secret",
      BREW_INGEST_SECRET: "test-brew-secret",
    };
    const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
    let functionServer: Deno.HttpServer | undefined;
    try {
      for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
      for (const name of ["receive-brew", "pi-control"]) {
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
      if (functionServer.addr.transport !== "tcp") throw new Error("Expected TCP server");
      const base = `http://127.0.0.1:${functionServer.addr.port}/functions/v1`;
      const sendBrew = (body: unknown) =>
        fetch(`${base}/receive-brew`, {
          method: "POST",
          headers: { "x-brew-secret": env.BREW_INGEST_SECRET, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (r) => ({ status: r.status, data: await r.json() }));
      const pollPi = () =>
        fetch(`${base}/pi-control`, { headers: { "x-pi-secret": env.PI_BLE_INGEST_SECRET } })
          .then(async (r) => ({ status: r.status, data: await r.json() }));
      const storedBrew = (sourceId: string) =>
        tables.brew_readings.find((r) => r.batch_id === `custom_${sourceId}`);

      await t.step("profil utan source_id avvisas", async () => {
        const result = await sendBrew({ name: "X", profile_id: "p1" });
        assertEquals(result.status, 400);
        assertEquals(result.data.error, "source_id krävs med jäsprofil");
      });

      await t.step("omsändning efter att kön rensats: ask syns, bryggen orörd", async () => {
        // Ny brygg utan profil → köas.
        assertEquals((await sendBrew({ source_id: "s1", name: "Köad", og: 1.05, fg: 1.01 })).status, 200);
        // Rollupen rensar kön (profile_ask_at rörs aldrig).
        Object.assign(storedBrew("s1")!, { pi_pending_at: null });
        // Omsändning med profil efter att Pi:n redan plockat bryggen.
        const resend = await sendBrew({
          source_id: "s1", name: "Köad", og: 1.05, fg: 1.01,
          profile_id: "novalager-v2", profile_request: { template: "smart" },
          yeasts: [{ name: "NovaLager", min_temp: 10, max_temp: 15 }],
        });
        assertEquals(resend.status, 200);
        const brew = storedBrew("s1")!;
        assertEquals(brew.pi_pending_at, null); // kön återställs inte
        assertEquals(typeof brew.profile_ask_at, "string");
        const poll = await pollPi();
        assertEquals(poll.status, 200);
        assertEquals(poll.data.pending_brews.length, 0); // inte köad igen
        assertEquals(poll.data.profile_asks.length, 1);
        const ask = poll.data.profile_asks[0];
        assertEquals(ask.source_id, "s1");
        assertEquals(ask.profile_id, "novalager-v2");
        assertEquals(ask.profile_request, { template: "smart" });
        assertEquals(ask.yeasts.map((y: Row) => [y.name, y.min_temp, y.max_temp]), [["NovaLager", 10, 15]]);
        assertEquals(ask.recipe.profile_id, "novalager-v2");
      });

      await t.step("omsändning av brygg i tank: bara recept/namn/stil/volym", async () => {
        tables.brew_readings.push({
          id: "linked-1", batch_id: "custom_s2", name: "I tank", style: "Lager",
          status: "Jäsning", original_gravity: 1.062, final_gravity: 1.012,
          current_sg: 1.02, attenuation: 67, abv: 5.2, current_temp: 12.3,
          fermentation_start: "2026-10-01T10:00:00Z", pi_pending_at: null,
          linked_controller_id: "ctrl-1", volume_l: 20,
          recipe: { name: "I tank", yeasts: [{ name: "W-34/70", min_temp: 9, max_temp: 15 }] },
        });
        const result = await sendBrew({
          source_id: "s2", name: "I tank", style: "Lager", og: 1.062, fg: 1.012, volume_l: 21,
          profile_id: "p-lager",
        });
        assertEquals(result.status, 200);
        const brew = storedBrew("s2")!;
        assertEquals(brew.status, "Jäsning");
        assertEquals(brew.current_sg, 1.02);
        assertEquals(brew.attenuation, 67);
        assertEquals(brew.fermentation_start, "2026-10-01T10:00:00Z");
        assertEquals(brew.pi_pending_at, null);
        assertEquals(brew.volume_l, 21);
        assertEquals(typeof brew.profile_ask_at, "string");
        assertEquals((brew.recipe as Row).profile_id, "p-lager");
      });

      await t.step("omsändning av tappad Klar-brygg: status och gravities orörda", async () => {
        tables.brew_readings.push({
          id: "racked-1", batch_id: "custom_s3", name: "El Sueco Dorado v4", style: "IPA",
          status: "Klar", original_gravity: 1.048, final_gravity: 1.0069,
          current_sg: 1.0069, attenuation: 86, abv: 5.5, current_temp: 1.95,
          fermentation_start: "2026-09-01T10:00:00Z", fermentation_end: "2026-09-15T10:00:00Z",
          pi_pending_at: null, linked_controller_id: null, volume_l: 19,
          recipe: { name: "El Sueco Dorado v4" },
        });
        const result = await sendBrew({ source_id: "s3", name: "El Sueco Dorado v4", style: "IPA", og: 1.05, fg: 1.012 });
        assertEquals(result.status, 200);
        const brew = storedBrew("s3")!;
        assertEquals(brew.status, "Klar");
        assertEquals(brew.original_gravity, 1.048);
        assertEquals(brew.final_gravity, 1.0069);
        assertEquals(brew.current_sg, 1.0069);
        assertEquals(brew.fermentation_start, "2026-09-01T10:00:00Z");
        assertEquals(brew.pi_pending_at, null);
      });

      await t.step("profilbyte: bara bodyns profilfält finns kvar", async () => {
        tables.brew_readings.push({
          id: "switch-1", batch_id: "custom_s4", name: "Byte", style: "Lager",
          status: "Fermenting", original_gravity: 1.05, final_gravity: 1.01,
          pi_pending_at: new Date().toISOString(), linked_controller_id: null,
          recipe: { name: "Byte", profile_id: "gammal", yeasts: [{ name: "W-34/70", min_temp: 9, max_temp: 15 }] },
        });
        const req = { template: "smart", temp: 12 };
        assertEquals((await sendBrew({ source_id: "s4", name: "Byte", profile_request: req })).status, 200);
        const stored = storedBrew("s4")!.recipe as Row;
        assertEquals("profile_id" in stored, false);
        assertEquals(stored.profile_request, req);
        const poll = await pollPi();
        const pending = poll.data.pending_brews.find((b: Row) => b.source_id === "s4");
        const ask = poll.data.profile_asks.find((b: Row) => b.source_id === "s4");
        for (const item of [pending, ask]) {
          assertEquals(item.profile_id ?? null, null);
          assertEquals(item.profile_request, req);
          assertEquals("profile_id" in item.recipe, false);
          assertEquals(item.recipe.profile_request, req);
        }
      });

      await t.step("profil borttagen: varken profile_id eller profile_request", async () => {
        assertEquals((await sendBrew({ source_id: "s4", name: "Byte" })).status, 200);
        const stored = storedBrew("s4")!.recipe as Row;
        assertEquals("profile_id" in stored, false);
        assertEquals("profile_request" in stored, false);
        assertEquals(stored.yeasts, [{ name: "W-34/70", min_temp: 9, max_temp: 15 }]);
        const pending = (await pollPi()).data.pending_brews.find((b: Row) => b.source_id === "s4");
        assertEquals(pending.profile_id ?? null, null);
        assertEquals(pending.profile_request ?? null, null);
        assertEquals("profile_id" in pending.recipe, false);
        assertEquals("profile_request" in pending.recipe, false);
      });

      await t.step("body utan yeasts behåller lagrad jäst", async () => {
        const brew = storedBrew("s2")!;
        const before = (brew.recipe as Row).yeasts;
        const result = await sendBrew({ source_id: "s2", name: "I tank", style: "Lager", og: 1.062, fg: 1.012 });
        assertEquals(result.status, 200);
        assertEquals((storedBrew("s2")!.recipe as Row).yeasts, before);
      });

      await t.step("köad brygg får fortfarande full omskrivning", async () => {
        tables.brew_readings.push({
          id: "queued-1", batch_id: "custom_s4", name: "Köad två", style: "Okänd",
          status: "Fermenting", original_gravity: 1, final_gravity: 1,
          pi_pending_at: new Date().toISOString(), linked_controller_id: null,
          recipe: {},
        });
        const result = await sendBrew({ source_id: "s4", name: "Köad två", og: 1.055, fg: 1.011, volume_l: 25 });
        assertEquals(result.status, 200);
        const brew = storedBrew("s4")!;
        assertEquals(brew.original_gravity, 1.055);
        assertEquals(brew.final_gravity, 1.011);
        assertEquals(brew.volume_l, 25);
        assertEquals(brew.status, "Fermenting");
      });

      await t.step("databasfel ger 500, inte 400 eller tyst 200", async () => {
        failTables.add("brew_readings");
        assertEquals((await sendBrew({ source_id: "s5", name: "Fel" })).status, 500);
        assertEquals((await pollPi()).status, 500);
        failTables.delete("brew_readings");
        failTables.add("pi_commands");
        assertEquals((await pollPi()).status, 500);
        failTables.delete("pi_commands");
      });
    } finally {
      Deno.serve = nativeServe;
      await functionServer?.shutdown();
      await database.shutdown();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
      }
    }
  },
});
