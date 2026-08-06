// vite.config.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import {
    RUNTIME_MODE_ENDPOINT,
    isTradingWriteRequest,
    normalizeRuntimeMode,
} from './src/lib/runtime-mode-shared';

function runtimeModeFile() {
    return (
        process.env.REALTIME_STOCK_MODE_FILE ??
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'RealTimeStock',
            'runtime-mode',
        )
    );
}

function readRuntimeMode() {
    try {
        return normalizeRuntimeMode(
            fs.readFileSync(runtimeModeFile(), 'utf8').trim(),
        );
    } catch {
        return 'unknown';
    }
}

function productionReadonlyGuard(): Plugin {
    return {
        name: 'realtimestock-production-readonly-guard',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const pathname = new URL(
                    req.url ?? '/',
                    'http://127.0.0.1',
                ).pathname;
                const runtimeMode = readRuntimeMode();

                if (pathname === RUNTIME_MODE_ENDPOINT) {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Cache-Control', 'no-store');
                    res.end(JSON.stringify({ mode: runtimeMode }));
                    return;
                }

                if (
                    runtimeMode === 'production-readonly' &&
                    isTradingWriteRequest(pathname, req.method)
                ) {
                    res.statusCode = 403;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(
                        JSON.stringify({
                            code: 403,
                            message:
                                '正式行情唯讀模式：交易寫入已由本機 Web 安全層封鎖',
                        }),
                    );
                    return;
                }

                next();
            });
        },
    };
}

// closed-source modules (AI Agent, future tiered features) live in the
// private repo, checked out into ./modules on desktop builds; open-source
// builds resolve '@modules' to the empty stub manifest
const modulesDir = path.resolve(__dirname, './modules/index.ts');
const modulesTarget = fs.existsSync(modulesDir)
    ? modulesDir
    : path.resolve(__dirname, './src/modules-stub/index.ts');
const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version?: string };

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        base: env.VITE_BASE ?? '/',
        // shioaji app upload flattens nested paths — emit a flat bundle.
        // target: old Intel Macs run older WKWebView (Safari 13–15 era);
        // Vite 8's default (baseline-widely-available ≈ Safari 16) emits
        // syntax those webviews cannot parse → white screen on launch (#4)
        build: { assetsDir: '', target: ['es2020', 'safari13'] },
        // react-draggable (react-grid-layout dep) reads process.env at runtime
        define: {
            'process.env': {},
            // feature-flag service client key (publishable) — from .env
            // locally, or the STATSIG_CLIENT_KEY secret in CI builds
            __STATSIG_CLIENT_KEY__: JSON.stringify(
                env.STATSIG_CLIENT_KEY ??
                    process.env.STATSIG_CLIENT_KEY ??
                    '',
            ),
            __SHIOAJI_APP_VERSION__: JSON.stringify(pkg.version ?? ''),
            // bundled server version（repo 根目錄 SHIOAJI_VERSION —
            // 與 CI 下載 sidecar 的同一個來源）— app 開機做版本握手
            __SHIOAJI_SERVER_VERSION__: JSON.stringify(
                fs
                    .readFileSync(
                        path.resolve(__dirname, 'SHIOAJI_VERSION'),
                        'utf8',
                    )
                    .trim(),
            ),
        },
        plugins: [
            productionReadonlyGuard(),
            vanillaExtractPlugin(),
            react(),
        ],
        resolve: {
            alias: {
                '@modules': modulesTarget,
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            // honor a harness-assigned port (preview tooling sets PORT);
            // default stays 5173 for tauri dev
            port: Number(process.env.PORT) || 5173,
            proxy: {
                // dev 打自帶 sidecar（scripts/dev-api.sh，與 CI 打包同版
                // binary、port 21322）— 確保 API/UI 版本相符，不依賴使用
                // 者自裝在 8080 的 CLI。要打別台時用 VITE_API_TARGET 蓋掉
                '/api': env.VITE_API_TARGET ?? 'http://127.0.0.1:21322',
            },
        },
    };
});
