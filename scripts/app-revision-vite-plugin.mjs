import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const endpoint = '/__realtimestock/app-revision';

/** Independent disk inventory catches updates even when the HMR socket/watcher missed one. */
export function frontendRevision(root) {
    const hash = createHash('sha256');
    function visit(relative) {
        const file = path.join(root, relative), stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) return;
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(file).sort()) {
                if (name.startsWith('.') || ['__screenshots__', 'fixtures', 'node_modules'].includes(name)) continue;
                visit(path.join(relative, name));
            }
        } else if (!/\.(?:test|spec)\.[^.]+$/.test(file) && /\.(?:[cm]?[jt]sx?|css|html|json|svg|png|ico|woff2?|yaml)$/.test(file)) {
            hash.update(relative); hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0');
        }
    }
    for (const file of ['src', 'public', 'index.html', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'scripts/app-revision-vite-plugin.mjs']) {
        if (fs.existsSync(path.join(root, file))) visit(file);
    }
    return hash.digest('hex');
}
export function appRevisionPlugin() {
    let root = '', cached = '', checkedAt = 0;
    const revision = () => {
        const now = Date.now();
        if (!cached || now - checkedAt >= 1_000) { cached = frontendRevision(root); checkedAt = now; }
        return cached;
    };
    return {
        name: 'realtimestock-app-revision', apply: 'serve',
        configResolved(config) { root = config.root; },
        transformIndexHtml() {
            return [{ tag: 'meta', attrs: { name: 'realtimestock-app-revision', content: revision() }, injectTo: 'head' }];
        },
        // The checkpointed client owns source updates. Ordinary HMR can remount
        // a chart or an open settings dialog before its UI state is saved.
        handleHotUpdate(context) {
            const relative = path.relative(root, context.file);
            if (relative.startsWith('src' + path.sep) || relative.startsWith('public' + path.sep)) return [];
        },
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                if (new URL(request.url ?? '/', 'http://localhost').pathname !== endpoint) return next();
                response.setHeader('Cache-Control', 'no-store');
                response.setHeader('Content-Type', 'application/json');
                if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
                try { response.end(JSON.stringify({ revision: revision() })); }
                catch { response.statusCode = 503; response.end(JSON.stringify({ error: 'app_revision_unavailable' })); }
            });
        },
    };
}
