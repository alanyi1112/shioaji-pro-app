export type CatalogEntry = {
  symbol: string;
  exchange: string;
  localizedName: string;
  englishName: string;
  aliases: string[];
  market: string;
  group: string;
  quoteType: string;
  provider: string;
  source: string;
  sourceUpdatedAt?: string;
  active?: boolean;
};

export type InstrumentCandidate = CatalogEntry & {
  name: string;
  matchedBy: string;
  score: number;
  enabled: boolean;
  tab?: string;
  tabId?: string;
  defaultOrder?: number | null;
};

const entry = (
  symbol: string,
  exchange: string,
  localizedName: string,
  englishName: string,
  aliases: string[],
  market: string,
  group: string,
  quoteType: string,
  provider = "yfinance",
): CatalogEntry => ({ symbol, exchange, localizedName, englishName, aliases, market, group, quoteType, provider, source: "localized-seed", active: true });

export const LOCALIZED_INSTRUMENT_SEED: CatalogEntry[] = [
  entry("^DJI", "DJI", "道瓊工業平均指數", "Dow Jones Industrial Average", ["道瓊", "道瓊指數", "Dow Jones"], "美股", "指數", "INDEX"),
  entry("^IXIC", "NIM", "那斯達克綜合指數", "NASDAQ Composite", ["那斯達克", "納斯達克", "那指", "NASDAQ"], "美股", "指數", "INDEX"),
  entry("^SOX", "Nasdaq GIDS", "費城半導體指數", "PHLX Semiconductor Index", ["費半", "費城半導體"], "美股", "指數", "INDEX"),
  entry("^GSPC", "SNP", "標準普爾 500 指數", "S&P 500", ["標普500", "標普 500", "S&P500"], "美股", "指數", "INDEX"),
  entry("^RUT", "Chicago Options", "羅素 2000 指數", "Russell 2000", ["羅素2000", "羅素指數"], "美股", "指數", "INDEX"),
  entry("^N225", "Osaka", "日經 225 指數", "Nikkei 225", ["日經", "日經225", "Nikkei"], "日本股市", "指數", "INDEX"),
  entry("^KS11", "Korea", "韓國綜合指數", "KOSPI Composite Index", ["韓國指數", "KOSPI"], "韓國股市", "指數", "INDEX"),
  entry("TSM", "NYQ", "台積電 ADR", "Taiwan Semiconductor Manufacturing Company Limited", ["台積ADR", "台積電美股", "TSMC"], "美股", "ADR", "EQUITY"),
  entry("NVDA", "NMS", "輝達", "NVIDIA Corporation", ["NVIDIA", "英偉達"], "美股", "大型科技股", "EQUITY"),
  entry("GOOGL", "NMS", "Alphabet A（Google）", "Alphabet Inc.", ["Google", "谷歌", "Alphabet"], "美股", "大型科技股", "EQUITY"),
  entry("AMD", "NMS", "超微", "Advanced Micro Devices, Inc.", ["AMD", "超微半導體"], "美股", "半導體", "EQUITY"),
  entry("AVGO", "NMS", "博通", "Broadcom Inc.", ["Broadcom"], "美股", "半導體", "EQUITY"),
  entry("AAPL", "NMS", "蘋果公司", "Apple Inc.", ["蘋果", "Apple"], "美股", "大型科技股", "EQUITY"),
  entry("AMZN", "NMS", "亞馬遜", "Amazon.com, Inc.", ["Amazon"], "美股", "大型科技股", "EQUITY"),
  entry("META", "NMS", "Meta Platforms（臉書）", "Meta Platforms, Inc.", ["Meta", "臉書", "Facebook"], "美股", "大型科技股", "EQUITY"),
  entry("MSFT", "NMS", "微軟", "Microsoft Corporation", ["Microsoft"], "美股", "大型科技股", "EQUITY"),
  entry("NFLX", "NMS", "網飛", "Netflix, Inc.", ["Netflix", "奈飛"], "美股", "大型科技股", "EQUITY"),
  entry("TSLA", "NMS", "特斯拉", "Tesla, Inc.", ["Tesla"], "美股", "大型科技股", "EQUITY"),
  entry("COST", "NMS", "好市多", "Costco Wholesale Corporation", ["Costco", "開市客"], "美股", "消費", "EQUITY"),
  entry("XOM", "NYQ", "埃克森美孚", "Exxon Mobil Corporation", ["Exxon Mobil", "艾克森美孚"], "美股", "能源", "EQUITY"),
  entry("UNH", "NYQ", "聯合健康集團", "UnitedHealth Group Incorporated", ["UnitedHealth", "聯合健康"], "美股", "醫療", "EQUITY"),
  entry("BRK-B", "NYQ", "波克夏海瑟威 B", "Berkshire Hathaway Inc. Class B", ["波克夏", "伯克希爾", "Berkshire Hathaway"], "美股", "金融", "EQUITY"),
  entry("JPM", "NYQ", "摩根大通", "JPMorgan Chase & Co.", ["JPMorgan", "小摩"], "美股", "金融", "EQUITY"),
  entry("^IRX", "CBOE", "13 週美國國庫券殖利率", "13 Week Treasury Bill", ["13週美債", "美國短債殖利率"], "匯率債券", "美國債券", "INDEX"),
  entry("^FVX", "CBOE", "美國 5 年期公債殖利率", "Treasury Yield 5 Years", ["5年美債", "五年美債"], "匯率債券", "美國債券", "INDEX"),
  entry("^TNX", "CBOE", "美國 10 年期公債殖利率", "Treasury Yield 10 Years", ["10年美債", "十年美債"], "匯率債券", "美國債券", "INDEX"),
  entry("^TYX", "CBOE", "美國 30 年期公債殖利率", "Treasury Yield 30 Years", ["30年美債", "三十年美債"], "匯率債券", "美國債券", "INDEX"),
  entry("JPY=X", "CCY", "美元兌日圓", "USD/JPY", ["美日", "美元日圓", "USDJPY"], "匯率債券", "日圓匯率", "CURRENCY"),
  entry("EURJPY=X", "CCY", "歐元兌日圓", "EUR/JPY", ["歐日", "歐元日圓"], "匯率債券", "日圓匯率", "CURRENCY"),
  entry("GBPJPY=X", "CCY", "英鎊兌日圓", "GBP/JPY", ["鎊日", "英鎊日圓"], "匯率債券", "日圓匯率", "CURRENCY"),
  entry("AUDJPY=X", "CCY", "澳幣兌日圓", "AUD/JPY", ["澳日", "澳元日圓"], "匯率債券", "日圓匯率", "CURRENCY"),
  entry("ES=F", "CME", "E-mini 標普 500 期貨", "E-mini S&P 500 Futures", ["標普期貨", "ES期貨"], "美國指數期貨", "E-mini", "FUTURE"),
  entry("NQ=F", "CME", "E-mini 那斯達克 100 期貨", "E-mini Nasdaq-100 Futures", ["那斯達克期貨", "納斯達克期貨", "那指期貨", "NQ期貨"], "美國指數期貨", "E-mini", "FUTURE"),
  entry("YM=F", "CBT", "E-mini 道瓊期貨", "E-mini Dow Futures", ["道瓊期貨", "YM期貨"], "美國指數期貨", "E-mini", "FUTURE"),
  entry("RTY=F", "CME", "E-mini 羅素 2000 期貨", "E-mini Russell 2000 Futures", ["羅素期貨", "RTY期貨"], "美國指數期貨", "E-mini", "FUTURE"),
  entry("MES=F", "CME", "微型 E-mini 標普 500 期貨", "Micro E-mini S&P 500 Futures", ["微型標普期貨", "MES期貨"], "美國指數期貨", "Micro", "FUTURE"),
  entry("MNQ=F", "CME", "微型 E-mini 那斯達克 100 期貨", "Micro E-mini Nasdaq-100 Futures", ["微型那指期貨", "MNQ期貨"], "美國指數期貨", "Micro", "FUTURE"),
  entry("MYM=F", "CBT", "微型 E-mini 道瓊期貨", "Micro E-mini Dow Futures", ["微型道瓊期貨", "MYM期貨"], "美國指數期貨", "Micro", "FUTURE"),
  entry("M2K=F", "CME", "微型 E-mini 羅素 2000 期貨", "Micro E-mini Russell 2000 Futures", ["微型羅素期貨", "M2K期貨"], "美國指數期貨", "Micro", "FUTURE"),
  entry("EMD=F", "CME", "E-mini 標普中型 400 期貨", "E-mini S&P MidCap 400 Futures", ["標普中型期貨", "EMD期貨"], "美國指數期貨", "E-mini", "FUTURE"),
  entry("CL=F", "NYM", "WTI 原油期貨", "Crude Oil WTI Futures", ["WTI原油", "原油", "西德州原油"], "其他", "CME 期貨", "FUTURE"),
  entry("BZ=F", "NYM", "布蘭特原油期貨", "Brent Crude Oil Futures", ["布蘭特原油", "布蘭特", "北海原油", "Brent"], "其他", "CME 期貨", "FUTURE"),
  entry("GC=F", "CMX", "黃金期貨", "Gold Futures", ["黃金", "Gold"], "其他", "CME 期貨", "FUTURE"),
  entry("HE=F", "CME", "瘦豬期貨", "Lean Hogs Futures", ["瘦豬", "Lean Hogs"], "其他", "CME 期貨", "FUTURE"),
  entry("HG=F", "CMX", "銅期貨", "Copper Futures", ["銅", "Copper"], "其他", "CME 期貨", "FUTURE"),
  entry("LE=F", "CME", "活牛期貨", "Live Cattle Futures", ["活牛", "Live Cattle"], "其他", "CME 期貨", "FUTURE"),
  entry("NG=F", "NYM", "天然氣期貨", "Natural Gas Futures", ["天然氣", "Natural Gas"], "其他", "CME 期貨", "FUTURE"),
  entry("SI=F", "CMX", "白銀期貨", "Silver Futures", ["白銀", "Silver"], "其他", "CME 期貨", "FUTURE"),
  entry("ZB=F", "CBT", "30 年美國公債期貨", "30-Year U.S. Treasury Bond Futures", ["30年美債期貨", "三十年美債期貨"], "其他", "CME 期貨", "FUTURE"),
  entry("ZC=F", "CBT", "玉米期貨", "Corn Futures", ["玉米", "Corn"], "其他", "CME 期貨", "FUTURE"),
  entry("ZN=F", "CBT", "10 年美國公債期貨", "10-Year T-Note Futures", ["10年美債期貨", "十年美債期貨"], "其他", "CME 期貨", "FUTURE"),
  entry("ZS=F", "CBT", "黃豆期貨", "Soybean Futures", ["黃豆", "大豆", "Soybean"], "其他", "CME 期貨", "FUTURE"),
  entry("ZW=F", "CBT", "小麥期貨", "Wheat Futures", ["小麥", "Wheat"], "其他", "CME 期貨", "FUTURE"),
  entry("BTC", "Hyperliquid", "比特幣永續", "Bitcoin Perpetual", ["比特幣", "Bitcoin", "BTC永續"], "其他", "Hyperliquid 加密貨幣", "CRYPTOCURRENCY", "hyperliquid"),
  entry("ETH", "Hyperliquid", "以太幣永續", "Ethereum Perpetual", ["以太幣", "以太坊", "Ethereum", "ETH永續"], "其他", "Hyperliquid 加密貨幣", "CRYPTOCURRENCY", "hyperliquid"),
  entry("SOL", "Hyperliquid", "Solana 永續", "Solana Perpetual", ["索拉納", "Solana", "SOL永續"], "其他", "Hyperliquid 加密貨幣", "CRYPTOCURRENCY", "hyperliquid"),
  entry("SAMPLE", "Local", "本機測試資料", "Local Sample Data", ["範例", "測試資料"], "其他", "本機範例", "SAMPLE", "sample"),
];

export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\-_/.,，。．、()（）［\]【】'"：:]+/g, "")
    .trim();
}

export function normalizeSymbol(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
}

export function inferredExchange(symbol: string, exchange = "") {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (normalizedSymbol.endsWith(".TWO")) return "TPEx";
  if (normalizedSymbol.endsWith(".TW")) return "TWSE";
  return String(exchange || "").trim();
}

function ngrams(value: string, size: number) {
  if (value.length <= size) return new Set(value ? [value] : []);
  return new Set(Array.from({ length: value.length - size + 1 }, (_, index) => value.slice(index, index + size)));
}

function diceSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const size = Math.min(left.length, right.length) >= 3 ? 2 : 1;
  const a = ngrams(left, size);
  const b = ngrams(right, size);
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return (2 * overlap) / (a.size + b.size || 1);
}

export function scoreCatalogEntry(query: string, item: CatalogEntry) {
  const needle = normalizeSearchText(query);
  const symbol = normalizeSearchText(normalizeSymbol(item.symbol));
  const localized = normalizeSearchText(item.localizedName);
  const english = normalizeSearchText(item.englishName);
  const aliases = item.aliases.map(normalizeSearchText).filter(Boolean);
  const names = [localized, ...aliases];
  if (!needle) return null;
  if (needle === symbol) return { score: 1000, matchedBy: "symbol-exact" };
  if (names.includes(needle)) return { score: 950, matchedBy: "localized-exact" };
  if (symbol.startsWith(needle)) return { score: 900, matchedBy: "symbol-prefix" };
  if (names.some((value) => value.startsWith(needle))) return { score: 850, matchedBy: "localized-prefix" };
  if (names.some((value) => value.includes(needle) || needle.includes(value))) return { score: 750, matchedBy: "localized-contains" };
  if (english === needle) return { score: 700, matchedBy: "english-exact" };
  if (english.startsWith(needle)) return { score: 650, matchedBy: "english-prefix" };
  if (english.includes(needle)) return { score: 620, matchedBy: "english-contains" };
  if (needle.length >= 2) {
    const similarity = Math.max(...names.map((value) => diceSimilarity(needle, value)), diceSimilarity(needle, english));
    if (similarity >= 0.42) return { score: Math.round(500 + similarity * 100), matchedBy: "fuzzy" };
  }
  return null;
}

export function toCandidate(item: CatalogEntry, query: string): InstrumentCandidate | null {
  const match = scoreCatalogEntry(query, item);
  if (!match || item.active === false) return null;
  return {
    ...item,
    symbol: normalizeSymbol(item.symbol),
    exchange: inferredExchange(item.symbol, item.exchange),
    name: item.localizedName || item.englishName || normalizeSymbol(item.symbol),
    enabled: true,
    ...match,
  };
}

export function seedForSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  return LOCALIZED_INSTRUMENT_SEED.find((item) => normalizeSymbol(item.symbol) === normalized);
}

const sourcePriority = (source: string) => ({ local: 5, "taiwan-catalog": 4, "localized-seed": 3, twse: 2, tpex: 2, "yahoo-search": 1 }[source] ?? 0);

export function mergeCandidates(candidates: InstrumentCandidate[], limit: number) {
  const merged = new Map<string, InstrumentCandidate>();
  for (const candidate of candidates) {
    const exchange = inferredExchange(candidate.symbol, candidate.exchange);
    const key = `${normalizeSymbol(candidate.symbol)}|${normalizeSearchText(exchange)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...candidate, exchange });
      continue;
    }
    const preferred = sourcePriority(candidate.source) > sourcePriority(existing.source) ? candidate : existing;
    const secondary = preferred === candidate ? existing : candidate;
    merged.set(key, {
      ...secondary,
      ...preferred,
      localizedName: preferred.localizedName || secondary.localizedName,
      englishName: preferred.englishName || secondary.englishName,
      aliases: [...new Set([...(preferred.aliases || []), ...(secondary.aliases || [])])],
      name: preferred.localizedName || secondary.localizedName || preferred.name,
      score: Math.max(preferred.score, secondary.score),
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || sourcePriority(b.source) - sourcePriority(a.source) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}

export function validateLocalizedSeed(symbols: string[]) {
  const duplicateKeys = new Set<string>();
  const seen = new Set<string>();
  for (const item of LOCALIZED_INSTRUMENT_SEED) {
    const key = `${normalizeSymbol(item.symbol)}|${normalizeSearchText(item.exchange)}`;
    if (seen.has(key)) duplicateKeys.add(key);
    seen.add(key);
  }
  const covered = new Set(LOCALIZED_INSTRUMENT_SEED.map((item) => normalizeSymbol(item.symbol)));
  return {
    duplicates: [...duplicateKeys],
    missingSymbols: symbols.map(normalizeSymbol).filter((symbol) => !covered.has(symbol)),
    invalid: LOCALIZED_INSTRUMENT_SEED.filter((item) => !item.localizedName || !item.englishName || !item.exchange || !item.market || !item.group),
  };
}
