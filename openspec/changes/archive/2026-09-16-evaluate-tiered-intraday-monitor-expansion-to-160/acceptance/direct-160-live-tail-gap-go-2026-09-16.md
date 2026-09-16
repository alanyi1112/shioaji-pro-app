# 2026-09-16 exact 160 收盤尾端例外 GO dossier

## 審閱結論

- 決策：`GO`
- reviewer：Codex（依使用者明確授權代理審閱）
- reviewedAt：`2026-09-16T14:13:31+08:00`
- 正式 active limit：`160`
- product runtime：`phase=complete_go`、`evaluationState=go`
- production／broker write：未授權且未執行

原始 live capture 仍保留 3026.TW 的 13:29／13:30 unknown 與首次 `NO_GO`。本次依新增的受限政策建立另一份 derived acceptance：最多 4 檔、每檔只可缺 13:26–13:30 內連續的最後 5 分鐘；09:01 live canary、盤中前綴、圖表、資源、reconnect 與安全 Gate 不得放寬。

## 3026.TW 雙抓結果

- 原始 live：09:01–13:28，共 268 分鐘，13:28 累計量 7,646 張。
- 盤後 REST KBar：連續兩次讀取均為完整 270 分鐘，canonical payload hash 均為 `sha256:92a4ec56138bf55b92dbbd210889d4743ddb1dd56cc4f28bb21a2e06cfb96e78`。
- REST 與 live 在 09:01–13:28 的每分鐘累計量完全相符。
- 13:29 volume 為 0；13:30 volume 為 261 張，收盤累計量為 7,907 張。
- 衍生資料只加入 13:29、13:30，均標記 `liveDelivered=false`、`reason=post_close_historical_tail_repair`；不具通知、retroactive trigger、production 或 broker-write 權限。

## 其餘 Gate

- 09:02:15 canary：160／160 檔均收到 live 09:01 KBar，`liveAvailabilityComplete=true`。
- 159 檔原始 live 已完整涵蓋 09:01–13:30；只有 1 檔套用例外，低於 5 檔上限。
- replay：43,200 steps，兩次輸出一致；17 個 `zero_denominator` 保持 unknown，沒有強制改判；notification dispatch 為 0。
- 被動圖表 freshness、SSE reconnect、資源與零交易副作用 Gate 通過。
- activation 只將 active limit 由 20 原子改為 160 一次；`activeLimitMutations=1`，其他操作計數為 0。

## Artifact 與 SHA-256

- immutable source capture：`319290088be2091445ebb471d248c7b1262e1f5609a79f00bb1cab050935245e`
- derived capture：`ae76b22ce243e6f901fd20c296b8a7034d02b9271745233a08c954b2d1a33a1d`
- evidence bundle：`babdda391c0e89a6bed93fe0c3784aa56df16f94799060b7a57663c0ee9ce03f`
- GO review artifact：`1f97ac521242269514604fe8f633c0aad6b5b0586cc881deffe5036013a3138c`
- activated product state：`9c436fab24fe35f4b251ef1a68e20cd80398f7409c47e14130f3aeb61e9eff9c`

## 判定邊界

這次 GO 證明 160 檔盤中監控與盤中選股在 2026-09-16 盤中可用。它不把盤後補列冒充 live、不建立補發通知，也不證明 provider physical usage、global ownership、release 或 headroom。未來只要缺漏達 5 檔、單檔超過 5 分鐘、缺口不在連續尾端、09:01 canary 失敗、雙抓漂移或 live prefix 衝突，仍須維持 NO-GO。
