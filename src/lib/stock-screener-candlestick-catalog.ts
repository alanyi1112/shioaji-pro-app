/** 外部研究參考，不是本篩選器回測；不得匯入判定公式。 */
export const CANDLESTICK_CATALOG_VERSION = 'candlestick-video-taiwan-study-2026-10-04-v2' as const;
export const CANDLESTICK_CATALOG = {
    'three-white-soldiers': { name: '紅三兵', direction: 'bullish', reversalPct: 82, reversalRank: 3, source: 'https://www.thepatternsite.com/ThreeWhiteSoldiers.html' },
    'bearish-engulfing': { name: '看跌吞噬', direction: 'bearish', reversalPct: 79, reversalRank: 5, source: 'https://thepatternsite.com/BearEngulfing.html' },
    'morning-star': { name: '晨星', direction: 'bullish', reversalPct: 78, reversalRank: 6, source: 'https://thepatternsite.com/MorningStar.html' },
    'morning-doji-star': { name: '晨星十字', direction: 'bullish', reversalPct: 76, reversalRank: 8, source: 'https://thepatternsite.com/CandleReverse.html' },
    'three-black-crows': { name: '三隻烏鴉', direction: 'bearish', reversalPct: 78, reversalRank: 7, overallPerformanceRank: 3, source: 'https://www.thepatternsite.com/ThreeBlackCrows.html' },
    piercing: { name: '刺透', direction: 'bullish', reversalPct: 64, reversalRank: null, source: 'https://thepatternsite.com/Piercing.html' },
} as const;
export const PIERCING_TAIWAN_STUDY = {
    authors: 'Lu／Shiu／Liu（2012）', table: 'Table 1', universe: '台灣 50 成分股研究母體',
    from: '2002-10-29', through: '2008-12-31', meanTradeProfitAfterCostPct: 13.25,
    profitableTradesPct: 90.91, trades: 11, roundTripCostPct: 1, maxProfitPct: 24.80, minProfitPct: -6.72,
    strategy: '型態後下一日開盤進場，相反型態後下一日開盤出場；變動持有期，非固定日數、非年化報酬。',
    trendDifference: '原研究以 MA5 趨勢判定；本功能採排除型態的 OLS 與首末收盤變化，並非重製原交易策略。',
    source: 'https://ah.lib.nccu.edu.tw/bitstream/140.119/61660/1/6368.pdf', doi: '10.1016/j.rfe.2012.02.001',
} as const;
export const CANDLESTICK_STATISTICS_NOTICE = '核對日 2026-10-04。影片四強不等於原研究 103 種全部排名；約 470 萬根為整體研究規模，不是各型態樣本數。反轉率、綜合表現、平均交易報酬與獲利比例不可混用；外部統計不是本功能台股勝率或未來保證，改參數及額外過濾也不繼承來源百分比。';
