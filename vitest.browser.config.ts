import { playwright } from '@vitest/browser-playwright';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [vanillaExtractPlugin()],
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
