// 舊量比入口相容；所有讀寫及判定皆使用同一全域 store，沒有第二份設定。
export { readSpecialMarketClosures, saveSpecialMarketClosure, specialMarketClosureDecision,
    assertNoSpecialMarketClosure, defaultClosureRoot, taipeiClosureDate, SPECIAL_CLOSURE_SCHEMA } from '../market-calendar-store.mjs';
