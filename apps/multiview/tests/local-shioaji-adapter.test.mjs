import assert from "node:assert/strict";
import test from "node:test";
import { handleLocalShioajiAdapter } from "../worker/local-shioaji-adapter.ts";

const origin = "http://127.0.0.1:5174/local-shioaji";
const contract = { security_type: "STK", region: "TW", exchange: "TSE", code: "2330", target_code: null };

test("adapter 只將 allowlist 行情路由送往 loopback 8080", async () => {
  const forwarded = [];
  const result = await handleLocalShioajiAdapter(
    new Request(`${origin}/api/v1/data/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contracts: [contract] }),
    }),
    {},
    async (request) => {
      forwarded.push(String(request));
      return new URL(String(request)).pathname === "/api/v1/info"
        ? Response.json({ simulation: true })
        : Response.json([{ code: "2330" }]);
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(forwarded.map((item) => new URL(item).pathname), ["/api/v1/info", "/api/v1/data/snapshots"]);
  assert.equal(new URL(forwarded[1]).origin, "http://127.0.0.1:8080");
});

test("order、account、CA、server 與未知路由一律 403 且不轉送", async () => {
  for (const path of [
    "/api/v1/order/stock",
    "/api/v1/auth/accounts",
    "/api/v1/auth/ca_activate",
    "/api/v1/server/restart",
    "/api/v1/data/ticks",
  ]) {
    let called = false;
    const result = await handleLocalShioajiAdapter(
      new Request(`${origin}${path}`, { method: path.includes("accounts") ? "GET" : "POST" }),
      {},
      async () => { called = true; return Response.json({}); },
    );
    assert.equal(result.status, 403, path);
    assert.equal(called, false, path);
  }
});

test("adapter 拒絕非 loopback target、FUT／OPT 與超量商品", async () => {
  const invalidTarget = await handleLocalShioajiAdapter(new Request(`${origin}/api/v1/info`), { SHIOAJI_API_TARGET: "https://example.com" });
  assert.equal(invalidTarget.status, 503);

  for (const security_type of ["FUT", "OPT"]) {
    const result = await handleLocalShioajiAdapter(new Request(`${origin}/api/v1/data/snapshots`, {
      method: "POST",
      body: JSON.stringify({ contracts: [{ ...contract, security_type }] }),
    }), {});
    assert.equal(result.status, 400);
  }

  const tooMany = await handleLocalShioajiAdapter(new Request(`${origin}/api/v1/data/snapshots`, {
    method: "POST",
    body: JSON.stringify({ contracts: Array.from({ length: 9 }, () => contract) }),
  }), {});
  assert.equal(tooMany.status, 400);
});

test("contract query 僅接受 TW 與 STK／IND／WRT", async () => {
  const ok = await handleLocalShioajiAdapter(
    new Request(`${origin}/api/v1/data/contracts/IX0001/info?security_type=IND&region=TW`),
    {},
    async (request) => new URL(String(request)).pathname === "/api/v1/info"
      ? Response.json({ simulation: true })
      : Response.json({ code: "IX0001", security_type: "IND" }),
  );
  assert.equal(ok.status, 200);
  const rejected = await handleLocalShioajiAdapter(
    new Request(`${origin}/api/v1/data/contracts/TXF/info?security_type=FUT&region=TW`),
    {},
  );
  assert.equal(rejected.status, 403);
});

test("非 simulation 模式拒絕行情、契約與串流且不轉送目標請求", async () => {
  const forwarded = [];
  const result = await handleLocalShioajiAdapter(
    new Request(`${origin}/api/v1/data/contracts/2330?region=TW`),
    {},
    async (request) => {
      forwarded.push(new URL(String(request)).pathname);
      return Response.json({ simulation: false });
    },
  );
  assert.equal(result.status, 409);
  assert.equal((await result.json()).reasonCode, "simulation_required");
  assert.deepEqual(forwarded, ["/api/v1/info"]);
});
