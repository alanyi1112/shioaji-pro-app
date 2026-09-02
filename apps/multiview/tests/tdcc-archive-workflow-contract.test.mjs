import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TDCC_ARCHIVE_MANIFEST, TDCC_ARCHIVE_MANIFEST_VERSION } from "../../../src/lib/tdcc-archive-validator.ts";

const sites = await readFile(new URL("../.github/workflows/tdcc-verified-archive-bootstrap.yml", import.meta.url), "utf8");
const cloudflare = await readFile(new URL("../.github/workflows/cloudflare-tdcc-verified-archive-bootstrap.yml", import.meta.url), "utf8");
const app = await readFile(new URL("../worker/app.ts", import.meta.url), "utf8");

test("archive workflow 僅能手動執行固定 manifest，且逐期日期與程式 allowlist 一致", () => {
  for (const workflow of [sites, cloudflare]) {
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /schedule:/);
    assert.match(workflow, new RegExp(`MANIFEST_VERSION: ${TDCC_ARCHIVE_MANIFEST_VERSION}`));
    assert.match(workflow, /ARCHIVE_SCOPE: full-market/);
    assert.doesNotMatch(workflow, /inputs:/);
    for (const entry of TDCC_ARCHIVE_MANIFEST) assert.match(workflow, new RegExp(entry.date));
    assert.equal((workflow.match(/2026-\d{2}-\d{2}/g) || []).filter((value, index, all) => all.indexOf(value) === index).length, TDCC_ARCHIVE_MANIFEST.length);
    assert.match(workflow, /archive\.target == 18/);
    assert.match(workflow, /archive\.remaining == 0/);
    assert.match(workflow, /archive\.failed == 0/);
    assert.match(workflow, /archive\.overdue == 0/);
    assert.doesNotMatch(workflow, /echo\s+"?\$response/);
  }
  assert.match(app, /assertTdccArchiveRequestContract\(body\.manifestVersion, body\.scope\)/);
});

test("Sites 與 Cloudflare 使用獨立權限、concurrency 與 exact release health gate", () => {
  assert.match(sites, /group: tdcc-verified-archive-bootstrap/);
  assert.match(sites, /OAI-Sites-Authorization/);
  assert.match(sites, /deploymentTarget == "sites"/);
  assert.doesNotMatch(sites, /CF-Access-Client-/);
  assert.match(cloudflare, /group: cloudflare-tdcc-verified-archive-bootstrap/);
  assert.match(cloudflare, /environment: cloudflare-production/);
  assert.match(cloudflare, /CF-Access-Client-Id/);
  assert.match(cloudflare, /CF-Access-Client-Secret/);
  assert.match(cloudflare, /X-MultiChart-Pipeline-Authorization/);
  assert.match(cloudflare, /deploymentTarget == "cloudflare"/);
  assert.doesNotMatch(cloudflare, /SITES_BYPASS_TOKEN/);
  for (const workflow of [sites, cloudflare]) {
    assert.match(workflow, /\.commitSha == \$sha/);
    assert.match(workflow, /\.persistence\.d1 == true/);
    assert.match(workflow, /taiwanStockChip\.archive\.complete == true/);
  }
});
