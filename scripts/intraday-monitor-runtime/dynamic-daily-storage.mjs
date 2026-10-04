import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';

// 每日產品上限是容量，不是 Stage 的 exact-cohort 身分或 exact-160 筆數。
export const DYNAMIC_DAILY_STORAGE = Object.freeze({
    schemaVersion: 'intraday-monitor-daily-storage/1',
    maximumCohortSize: 160,
    streamTotalBytes: DIRECT_160_STORAGE.streamTotalBytes,
    streamFrameBytes: DIRECT_160_STORAGE.streamFrameBytes,
    sessionCanonicalBytes: DIRECT_160_STORAGE.sessionCanonicalBytes,
});
