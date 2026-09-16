/** Test-only relocation of immutable archived artifacts; never rehashes or changes gates. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ACTIVE = 'openspec/changes/add-durable-smart-order-panel-and-protective-exits/';
const ARCHIVED = 'openspec/changes/archive/2026-08-27-add-durable-smart-order-panel-and-protective-exits/';
export async function archivedAcceptanceTestFixture(repoRoot, manifestPath) {
    const root = await mkdtemp(path.join(tmpdir(), 'archived-offline-acceptance-'));
    const copied = new Set();
    const copy = async relative => {
        if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error('invalid_fixture_path');
        if (copied.has(relative)) return;
        copied.add(relative);
        let content;
        try { content = await readFile(path.join(repoRoot, relative)); }
        catch (error) {
            if (error.code !== 'ENOENT' || !relative.startsWith(ACTIVE)) throw error;
            content = await readFile(path.join(repoRoot, ARCHIVED + relative.slice(ACTIVE.length)));
        }
        const target = path.join(root, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
        if (relative.endsWith('.json')) {
            const manifest = JSON.parse(content);
            for (const source of manifest.sources ?? []) await copy(source.path);
            if (manifest.companionMatrix?.path) await copy(manifest.companionMatrix.path);
        }
    };
    try {
        const relative = path.relative(repoRoot, manifestPath);
        await copy(relative);
        return { root, manifestPath: path.join(root, relative), close: () => rm(root, { recursive: true, force: true }) };
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
