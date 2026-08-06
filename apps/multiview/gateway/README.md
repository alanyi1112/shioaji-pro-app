# MultiChart Shioaji Data-only Gateway

本模組只負責行情登入、行情訂閱、正規化與送往 Cloudflare 的 outbound uplink；不得提供下單、改單、刪單、帳務、部位或 CA 能力。

## 安全預設

- 預設模式為 `simulation`，不讀取任何正式 credential。
- `production` 只接受 systemd `CREDENTIALS_DIRECTORY` runtime handle。
- 正式模式缺少任一 credential、檔案權限過寬、檔案是 symlink、內容為空或 placeholder 時立即 fail closed。
- 不讀取 `.env`、shell profile 或 CLI secret argument。
- Shioaji 登入固定使用 `subscribe_trade=False`，且不載入 CA。
- Shioaji API key／secret 與 Cloudflare gateway machine trust domain 分離。後者包含 hosted ingest secret 與 Access service token 的 client ID／secret，五個 runtime credential 均為獨立 encrypted file，不能進入 environment 或 command line。
- active universe 以目前 24 檔預設台股優先，再合併所有使用者清單中的合格 `.TW`／`.TWO` 並去重；初始上限 32，可用 `ACTIVE_UNIVERSE_LIMIT` 在 pilot 下調但不可超過 32。
- 超出 active universe 容量的商品仍保留於使用者清單，只能由後續 control plane 回報無即時容量並沿用延遲來源；health 只公開數量，不公開清單商品。
- 每個 canonical symbol 共用一個上游訂閱；多 panel／多使用者只增加 reference count。同一 reference 重送為冪等，最後一個 reference 離開後預設冷卻 30 秒才 unsubscribe，期間重新需要會取消退訂。
- `UNSUBSCRIBE_COOLDOWN_SECONDS` 可在 `0`～`300` 秒內調整；背景退訂失敗不在 timer 內無界重試。
- gateway control plane 只接受由同一條 outbound WebSocket 下行的 `subscription-demand-v1` canonical symbol 清單；不接收帳號或個資。gateway 逐項轉成內部 `{type: "watchlist-symbol-added", symbol: canonicalSymbol}`，成功新增得到 `started`，重複事件得到 `already-subscribed`，超過 active universe 得到 `capacity`，其他錯誤只保留安全 reason code。Cloudflare 在收到 gateway 的權威結果前只回報 `queued`，不得把連線存在冒充訂閱成功。
- production feature flag 維持預設關閉；Sites 保留站固定不讀取 realtime binding 或 secret，也不會呼叫此能力。
- 當日 session ring buffer 只存在 gateway 記憶體，每商品最多保留 18,000 個 callback coalesced points；依來源時間與序號去重，跨日原子換新 session，滿額淘汰最舊點並標記 truncated。`SESSION_BUFFER_POINTS_PER_SYMBOL` 可在 `1`～`20,000` 內調整。
- session buffer 重啟後為空，清理只移除記憶體 session；不引用 D1、不寫入 `candle_history`。gateway service 在 callback 外每 250ms 有界排空 coalesced Tick，停止前再做最後一次 drain。
- 盤中新增商品先訂閱 Tick，再以既有 session buffer 判斷是否已覆蓋開盤；不足時同一 canonical symbol／台北交易日只共用一次 `api.kbars` 查詢。Kbars 只補到第一筆 live Tick 所在分鐘之前，避免同分鐘價量重複，部分結果會立即留在記憶體並繼續接收 Tick；盤前／盤後不查詢，也不以輪詢取代訂閱。
- provider guard 對登入、訂閱與當日 Kbars 設硬預算；預設登入 6 次、訂閱操作 64 次、Kbars 每台北日 32 次。同一操作連續失敗 3 次會開啟 60 秒 circuit breaker，期間 fail closed，不進行 snapshot／ticks／Kbars 輪詢。可用對應 `PROVIDER_*` 環境變數在文件範圍內下調，不能超過程式硬上限。
- 每個 Shioaji 連線都有不含秘密的隨機 connection ID。reconnect 後 sequence 可由 1 重新開始，但舊連線重送、倒序與相同時間 replay 會被拒絕；盤中缺口超過 5 秒或 ring buffer 淘汰資料時，session 對外標記 `partial`，不把接收時間冒充來源時間。跨交易日會建立新 session，休市或一般盤後 Tick 不驅動當日走勢。
- callback 外的 uplink 每秒最多送一個微批次、每批最多 32 檔且不超過 64 KiB；同秒同商品只送最新完整 OHLCV snapshot。連線以 hosted ingest secret、Access service token、timestamp、uplink connection ID 與單調 batch sequence 驗證，訊息本體不含任何 credential。
- production 啟動在 data-only login 與預設 universe 訂閱完成後立即建立 outbound WebSocket，不等待第一筆 Tick；因此盤前或冷啟動期間新增商品也能先到達 gateway control plane。

## 本機 Simulation 測試

測試不需安裝 Shioaji，也不需任何真實秘密：

```bash
PYTHONPATH=gateway/src python3 -m unittest discover -s gateway/tests -v
```

解析固定套件版本：

```bash
uv lock --project gateway
```

以 lockfile 的 Python 3.12 與目前 source 執行測試：

```bash
cd gateway
PYTHONPATH=src uv run --frozen python -m unittest discover -s tests -v
```

`PYTHONPATH=src` 可避免新版 Python 忽略底線開頭 editable `.pth`，並確保每次驗證目前工作樹，而不是先前建置的 wheel。正式安裝仍使用 `uv sync --frozen --no-editable` 產生不可變 runtime。

## Service runtime

- `python -m multichart_gateway` 啟動長駐程序。
- health 固定只監聽 `127.0.0.1:8788`。
- 啟動／登入失敗使用有限 backoff，耗盡後結束並交由 systemd 低頻重啟。
- Shioaji quote connection event 只轉成安全狀態，不保存官方 event 原文。

部署單元與操作方式見 [service-operations.md](./docs/service-operations.md)，秘密的建立、輪替、撤銷與事故處理見 [secret-lifecycle-runbook.md](./docs/secret-lifecycle-runbook.md)，授權確認、exact-release 安裝與真實交易日驗收見 [operator-pilot-checklist.md](./docs/operator-pilot-checklist.md)。真實 credential 注入仍須等待 OpenSpec task 8.2 並由 operator 在小馬本機操作；不得把值輸入 Codex 對話、repository、CI、Cloudflare、Sites、D1 或 Obsidian。
