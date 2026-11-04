import { defineConfig } from 'vitest/config';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';

// 圖表回歸不載入正式 Vite gateway，避免初始化盤中監控 repository。
export default defineConfig({
    plugins: [vanillaExtractPlugin()],
    test: {
        include: [
            'src/lib/daily-indicator-levels.test.ts',
            'src/lib/daily-indicator-authority.test.ts',
            'src/lib/daily-level-settings.test.ts',
            'src/lib/daily-level-renderer.test.ts',
            'src/lib/indicator-defs.test.ts',
            'src/lib/indicators.reference.test.ts',
            'src/lib/pivot-primitive.test.ts',
            'src/components/indicator-dialog.test.tsx',
            'src/lib/support-resistance.test.ts',
            'src/lib/support-resistance-state.test.ts',
            'src/lib/chart-volume-parity.integration.test.ts',
            'src/lib/main-chart-daily-drilldown.test.ts',
            'src/lib/chart-daily-history.test.ts',
            'src/lib/stock-screener-gateway.test.ts',
        ],
    },
});
