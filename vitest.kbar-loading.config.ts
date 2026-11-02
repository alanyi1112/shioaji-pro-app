import { defineConfig } from 'vitest/config';

// 圖表 transport 回歸不載入正式 Vite gateway 或任何資料庫 initializer。
export default defineConfig({
    test: { include: [
        'src/lib/shioaji-kbar-ranges.test.ts',
        'src/lib/shioaji-kbar-dedupe.test.ts',
        'src/lib/kbar-turnover.test.ts',
        'src/lib/candle-series-integrity.test.ts',
        'src/lib/chart-kbar-memory-cache.test.ts',
        'src/lib/stream-generation.test.ts',
    ] },
});
