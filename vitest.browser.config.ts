import { playwright } from '@vitest/browser-playwright';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    plugins: [vanillaExtractPlugin()],
    optimizeDeps: {
        include: [
            'react',
            'react-dom',
            'react-dom/client',
            'lucide-react',
            '@tauri-apps/api/window',
        ],
    },
    resolve: {
        alias: {
            './smart-order-browser-gateway-mode': path.resolve(
                import.meta.dirname,
                './src/lib/smart-order-browser-gateway-mode.vite.ts',
            ),
        },
    },
    test: {
        include: ['src/**/*.browser.test.ts'],
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
        },
    },
});
