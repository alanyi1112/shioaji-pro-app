import assert from "node:assert/strict";
import test from "node:test";
import { withLocalLauncherCors } from "../worker/local-launcher-cors.ts";

test("5173 loopback launcher 只能讀取固定 health 路徑", async () => {
  const response = withLocalLauncherCors(
    new Request("http://127.0.0.1:5174/api/health", {
      headers: { origin: "http://127.0.0.1:5173" },
    }),
    Response.json({ ok: true }),
  );
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  assert.equal(response.headers.get("vary"), "Origin");
});

test("外部 origin 與未列名路徑不取得 CORS", () => {
  for (const request of [
    new Request("http://127.0.0.1:5174/api/health", { headers: { origin: "https://example.com" } }),
    new Request("http://127.0.0.1:5174/api/instruments", { headers: { origin: "http://127.0.0.1:5173" } }),
  ]) {
    const response = withLocalLauncherCors(request, Response.json({ ok: true }));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});
