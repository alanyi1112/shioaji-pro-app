import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frontendRevision, appRevisionPlugin } from './app-revision-vite-plugin.mjs';

test('磁碟版本獨立於watcher，捕捉新增修改刪除但不讀取秘密及測試', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rts-revision-'));
    try {
        fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root,'src/main.ts'), 'export const version = 1');
        const a = frontendRevision(root); fs.writeFileSync(path.join(root, '.env'), 'FIXTURE_SECRET');
        fs.writeFileSync(path.join(root,'src/main.test.ts'), 'ignored'); assert.equal(frontendRevision(root), a);
        fs.writeFileSync(path.join(root,'src/main.ts'), 'export const version = 2'); const b = frontendRevision(root); assert.notEqual(a,b);
        fs.writeFileSync(path.join(root,'src/new.ts'), 'new module'); assert.notEqual(frontendRevision(root),b);
        fs.unlinkSync(path.join(root,'src/new.ts')); assert.equal(frontendRevision(root),b);
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('HTML與唯讀GET同版，回應禁止快取且不洩漏路徑', () => {
    const plugin = appRevisionPlugin(); plugin.configResolved({root: new URL('../',import.meta.url).pathname});
    let middleware; plugin.configureServer({middlewares:{use(fn){middleware=fn;}}});
    const headers={}, response={setHeader(k,v){headers[k]=v;},end(value){this.body=value;}};
    middleware({url:'/__realtimestock/app-revision',method:'GET'},response,()=>assert.fail());
    const revision=JSON.parse(response.body).revision; assert.match(revision,/^[a-f0-9]{64}$/);
    assert.equal(plugin.transformIndexHtml()[0].attrs.content,revision); assert.equal(headers['Cache-Control'],'no-store');
    assert.deepEqual(Object.keys(JSON.parse(response.body)),['revision']);
    middleware({url:'/__realtimestock/app-revision',method:'POST'},response,()=>assert.fail()); assert.equal(response.statusCode,405);
});
test('前端更新交給已保存狀態的重載流程，避免HMR提早重建圖表', () => {
    const plugin=appRevisionPlugin(), root='/fixture';plugin.configResolved({root});
    assert.deepEqual(plugin.handleHotUpdate({file:path.join(root,'src/App.tsx')}),[]);
    assert.equal(plugin.handleHotUpdate({file:path.join(root,'scripts/collector.mjs')}),undefined);
});
