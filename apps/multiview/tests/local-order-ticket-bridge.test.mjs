import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleLocalOrderTicketBridge } from "../worker/local-order-ticket-bridge.ts";

const [indexHtml, appSource, styles] = await Promise.all([
  readFile(new URL("../public/static/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/static/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/static/styles.css", import.meta.url), "utf8"),
]);

const origin = "http://127.0.0.1:5174/local-order-ticket";
const contract = { code: "2330", security_type: "STK", exchange: "TSE", target_code: null };

function fakeFetch(input) {
  const url = new URL(String(input));
  if (url.port === "8080" && url.pathname === "/api/v1/info") return Response.json({ simulation: true });
  if (url.port === "8080") return Response.json(contract);
  if (url.port === "5173") return new Response("ok");
  throw new Error("unexpected target");
}

test("bridge 僅以 code、security type、exchange 開啟 5173 ticket", async () => {
  const response = await handleLocalOrderTicketBridge(new Request(`${origin}?code=2330&security_type=STK&exchange=TSE`), {}, fakeFetch);
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location"));
  assert.equal(target.origin, "http://127.0.0.1:5173");
  assert.deepEqual([...target.searchParams.keys()], ["popout", "bridge", "code", "security_type", "exchange"]);
});

test("bridge 整體拒絕交易參數、IND、FUT、OPT 與非 loopback 請求", async () => {
  for (const query of [
    "code=2330&security_type=STK&exchange=TSE&side=Buy",
    "code=IX0001&security_type=IND&exchange=TSE",
    "code=TXF&security_type=FUT&exchange=OES",
    "code=TXO&security_type=OPT&exchange=OES",
  ]) {
    const response = await handleLocalOrderTicketBridge(new Request(`${origin}?${query}`), {}, fakeFetch);
    assert.equal(response.status, 400, query);
  }
  const remote = await handleLocalOrderTicketBridge(new Request("https://example.com/local-order-ticket?code=2330&security_type=STK&exchange=TSE"), {}, fakeFetch);
  assert.equal(remote.status, 403);
});

test("5173 未啟動時顯示可重試錯誤，不直接交易", async () => {
  const response = await handleLocalOrderTicketBridge(
    new Request(`${origin}?code=2330&security_type=STK&exchange=TSE`),
    {},
    async (input) => {
      const url = new URL(String(input));
      if (url.port === "8080" && url.pathname === "/api/v1/info") return Response.json({ simulation: true });
      if (url.port === "8080") return Response.json(contract);
      return Promise.reject(new Error("offline"));
    },
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /請先啟動 RealTimeStock/);
});

test("非 simulation 模式不開啟 5173 下單面板", async () => {
  const response = await handleLocalOrderTicketBridge(
    new Request(`${origin}?code=2330&security_type=STK&exchange=TSE`),
    {},
    async (input) => {
      const url = new URL(String(input));
      if (url.port === "8080") return Response.json({ simulation: false });
      throw new Error("5173 不應被探測");
    },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reasonCode, "simulation_required");
});

test("MultiView 以同頁遮罩 iframe 顯示既有 OrderTicket，不另開分頁", () => {
  assert.match(indexHtml, /id="order-ticket-overlay"[^>]*hidden/);
  assert.match(indexHtml, /id="order-ticket-frame"[^>]*title="RealTimeStock 下單面板"/);
  assert.match(appSource, /function openOrderTicketOverlay\(contract\)/);
  assert.match(appSource, /frame\.src = orderBridgeUrl\(contract\)/);
  assert.match(appSource, /function closeOrderTicketOverlay\(\)[\s\S]*?frame\.src = "about:blank"/);
  assert.doesNotMatch(appSource, /window\.open\(orderBridgeUrl\(panelOrderContract\)/);
  assert.match(styles, /\.order-ticket-overlay\s*\{[\s\S]*?background:\s*rgba\(2, 6, 23, 0\.52\);[\s\S]*?backdrop-filter:\s*blur\(2px\);/);
  assert.match(styles, /\.order-ticket-modal\s*\{[\s\S]*?width: min\(420px,[\s\S]*?height: min\(500px,/);
});

test("商品右鍵選單維持精簡寬度，詳細資料展開時才加寬", () => {
  assert.match(styles, /\.panel-context-menu\s*\{[\s\S]*?width:\s*min\(176px, calc\(100vw - 16px\)\);[\s\S]*?min-width:\s*0;/);
  assert.match(styles, /\.panel-context-menu:has\(\.panel-context-menu-pe-river-details:not\(\[hidden\]\)\)\s*\{[\s\S]*?width:\s*min\(520px, calc\(100vw - 16px\)\);/);
});
