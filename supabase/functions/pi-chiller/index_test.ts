// Local HTTP checks: test secrets and mocked storage, never production writes.
Deno.test("pi-chiller chart contract", async (t) => {
  const originalServe = Deno.serve;
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  let handler: ((req: Request) => Response | Promise<Response>) | undefined;
  let saved: Record<string, unknown> | undefined;
  Deno.serve = ((fn: typeof handler) => { handler = fn; }) as typeof Deno.serve;
  Deno.env.get = (key: string) => ({ PI_BLE_INGEST_SECRET: "test-pi-secret", SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-service-key" }[key]);
  globalThis.fetch = async (_input, init) => {
    saved = JSON.parse(String(init?.body));
    return new Response(null, { status: 201 });
  };
  try {
    await import("./index.ts");
    const call = async (chart: unknown, secret = "test-pi-secret") => {
      if (!handler) throw new Error("HTTP handler not registered");
      return handler(new Request("https://test.invalid/pi-chiller", { method: "POST", headers: { "x-pi-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify({ chart }) }));
    };
    await t.step("wrong secret returns 401", async () => {
      if ((await call({}, "wrong")).status !== 401) throw new Error("Expected 401");
    });
    for (const chart of [[], "bad", 42, true]) {
      await t.step(`invalid chart ${JSON.stringify(chart)} returns 400`, async () => {
        saved = undefined;
        const response = await call(chart);
        const body = await response.json();
        if (response.status !== 400 || body.error !== "chart must be an object or null" || saved) throw new Error("Invalid chart was not rejected before storage");
      });
    }
    for (const chart of [null, { series: [[0, 12, null, null]], runs: [] }]) {
      await t.step(`accepts ${chart === null ? "null" : "object"} unchanged`, async () => {
        const response = await call(chart);
        if (response.status !== 200 || JSON.stringify(saved?.chart) !== JSON.stringify(chart)) throw new Error("Chart was not forwarded unchanged");
      });
    }
  } finally {
    Deno.serve = originalServe;
    Deno.env.get = originalGet;
    globalThis.fetch = originalFetch;
  }
});