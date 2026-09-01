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
import { smartOrderSameOriginGateway } from './scripts/smart-order-runtime/vite-same-origin-gateway.mjs';
import { stockScreenerGateway } from './scripts/stock-screener-gateway.mjs';

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

function smartOrderAppSupportRoot() {
    return (
        process.env.REALTIME_STOCK_APP_SUPPORT ??
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'RealTimeStock',
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

const smartOrderSidecarOnlyModulePaths = new Set(
    [
        'smart-order-activation-domain.ts',
        'smart-order-contract-price-domain.ts',
        'smart-order-domain-atr.ts',
        'smart-order-domain-calendar.ts',
        'smart-order-domain-money.ts',
        'smart-order-domain-types.ts',
        'smart-order-domain.ts',
        'smart-order-observation-domain.ts',
        'smart-order-resolution-domain.ts',
        'smart-order-risk-domain.ts',
        'smart-order-state-machine.ts',
        'smart-order-domain-test-mode.ts',
        'smart-order-domain-test-mode.vitest.ts',
    ].map((fileName) => path.resolve(__dirname, 'src/lib', fileName)),
);

export function isSmartOrderSidecarOnlyModule(id: string) {
    const queryIndex = id.indexOf('?');
    const cleanId = queryIndex === -1 ? id : id.slice(0, queryIndex);
    return smartOrderSidecarOnlyModulePaths.has(path.resolve(cleanId));
}

export function smartOrderSidecarOnlyBoundary(): Plugin {
    return {
        name: 'smart-order-sidecar-only-boundary',
        enforce: 'pre',
        load(id) {
            if (!isSmartOrderSidecarOnlyModule(id)) return null;
            this.error(
                `智慧下單交易核心只能由 Node sidecar 載入，禁止進入 Safari/WKWebView 瀏覽器 bundle：${id}`,
            );
        },
    };
}

export default defineConfig(({ command, mode, isPreview }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const isManagedLocalServe = command === 'serve' && isPreview === false;
    const isActualVitestExecution =
        isManagedLocalServe &&
        mode === 'test' &&
        process.env.VITEST === 'true' &&
        process.env.NODE_ENV === 'test';
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
            ...(command === 'build'
                ? [smartOrderSidecarOnlyBoundary()]
                : []),
            ...(isManagedLocalServe
                ? [
                      stockScreenerGateway(),
                      smartOrderSameOriginGateway({
                          appSupportRoot: smartOrderAppSupportRoot(),
                      }),
                  ]
                : []),
            productionReadonlyGuard(),
            vanillaExtractPlugin(),
            react(),
        ],
        resolve: {
            alias: {
                './smart-order-browser-gateway-mode':
                    isManagedLocalServe
                        ? path.resolve(
                              __dirname,
                              './src/lib/smart-order-browser-gateway-mode.vite.ts',
                          )
                        : path.resolve(
                              __dirname,
                              './src/lib/smart-order-browser-gateway-mode.ts',
                          ),
                './smart-order-domain-test-mode': isActualVitestExecution
                    ? path.resolve(
                          __dirname,
                          './src/lib/smart-order-domain-test-mode.vitest.ts',
                      )
                    : path.resolve(
                          __dirname,
                          './src/lib/smart-order-domain-test-mode.ts',
                      ),
                './shioaji-trade-observer-runtime-authority.mjs':
                    isActualVitestExecution
                        ? path.resolve(
                              __dirname,
                              './scripts/smart-order-runtime/shioaji-trade-observer-runtime-authority.vitest.mjs',
                          )
                        : path.resolve(
                              __dirname,
                              './scripts/smart-order-runtime/shioaji-trade-observer-runtime-authority.mjs',
                          ),
                './official-market-calendar-authority.mjs':
                    isActualVitestExecution
                        ? path.resolve(
                              __dirname,
                              './scripts/smart-order-runtime/official-market-calendar-authority.vitest.mjs',
                          )
                        : path.resolve(
                              __dirname,
                              './scripts/smart-order-runtime/official-market-calendar-authority.mjs',
                          ),
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
