# Realtime Operator Pilot Checklist

本清單只保存可公開的操作步驟、固定欄位與判定結果。不得在本文件、repository、issue、CI、對話或瀏覽器驗收紀錄中貼入 API key、secret、token、cookie、帳戶識別、完整 header、原始 Tick 或上游 exception。

## 1. 永豐金展示方式確認

公開 Shioaji 文件目前證明行情訂閱可作為盤中即時來源，並要求避免輪詢 `snapshots`／`ticks`／`kbars`；但沒有明確說明以下私人多人展示方式是否被允許，因此不能自行推定 task 1.1 已完成：

- 一組本人申請的行情 API credential 只在私人 gateway 使用。
- Cloudflare 正式站不是公開服務，只允許唯一 active owner 登入；Sites 保留站維持獨立既有身分邊界。
- gateway 將訂閱行情彙整為每秒有界更新，用於日／週／月當期 K 棒及分時走勢。
- 網站不提供原始 Tick 下載、不轉交 API credential、不販售行情，也不提供交易功能。
- 只保留短期盤中 buffer；正式歷史資料仍由既有批次來源提供。

向永豐金詢問時，至少要求書面回答：API 登記人本人是否可在僅自己一位 active owner 可登入的私人網站顯示即時價量、日週月即時 K 棒與衍生分時圖；允許的資料保留時間、顯名、衍生圖表與禁止轉傳邊界為何。並明確確認「網站與 API 為同一人」是否仍需額外行情展示授權。回覆紀錄只保存日期、聯絡管道、結論、限制摘要及可公開的條款版本，不保存帳戶資料或客服對話中的個資。

參考官方文件：

- <https://sinotrade.github.io/zh/tutor/market_data/streaming/stocks/>
- <https://sinotrade.github.io/zh/tutor/limit/>
- <https://sinotrade.github.io/zh/tutor/prepare/token/>
- <https://sinotrade.github.io/zh/tutor/prepare/terms/>

## 2. Exact-release 安裝

安裝前須已在小馬的非同步 staging 目錄以 lockfile 建立 `.venv`，並通過完整 gateway tests 與 `tools/scan_safe_artifacts.py`。operator 再於小馬互動式終端執行：

```bash
sudo <STAGING_RELEASE_DIR>/tools/install_system_service.sh <EXACT_COMMIT_SHA>
```

installer 只建立 root-owned release、更新 `current` symlink、安裝 unit 並執行 `systemd-analyze verify`；不啟用或啟動 service。安裝後核對：

```bash
systemctl is-enabled multichart-gateway.service
systemctl is-active multichart-gateway.service
readlink /opt/multichart-gateway/current
systemctl show multichart-gateway.service -p LimitCORE -p User -p FragmentPath
```

在 task 8.2 完成前，前兩項必須仍為 `disabled`／`inactive`，`LimitCORE` 必須為 `0`，release 目標必須是剛驗證的 exact commit。

## 3. Credential 注入與啟動

operator 依 [secret-lifecycle-runbook.md](./secret-lifecycle-runbook.md) 在小馬本機以隱藏輸入建立五個獨立 encrypted credential。Codex 只可檢查 encrypted blob 的存在數量、owner／mode，以及 service 的 allowlist health；不得讀取或回顯內容。

正式啟動前仍須同時成立：

- 永豐金展示方式已有足夠依據。
- Cloudflare D1 乾淨 24 小時 rolling window 低於安全線。
- Cloudflare hosted ingest secret 與 Access service credential 已由 operator 建立。
- Cloudflare realtime feature flag 仍為 `false`，避免尚未驗收的瀏覽器功能先行曝光。

## 4. 兩檔與三日 Pilot

第一個真實交易日只使用兩檔台股。每日只保存以下安全摘要：

- 日期、開始／結束時間與 exact commit。
- gateway `state`、`reasonCode`、reconnect 次數與 active universe 數量。
- Cloudflare gateway state、source age、subscription／drop／replay 計數及 load-shedding 狀態。
- 兩檔來源時間、OHLCV／分時與官方收盤的通過／失敗結果；不保存原始 Tick。
- 新增商品的 queued→provider 權威結果、開盤至當下回補狀態、single-flight 與 capacity fallback。
- Worker requests／CPU、Durable Object requests／GB-s、D1 reads／writes／storage 與錯誤率。
- 斷線、回前景、Yahoo fallback、收盤 canonical handoff 與 feature-off rollback 的可見結果。

兩檔一日全部通過後，才可擴至受限預設 universe 並連續驗證三個真實交易日。任一日發生授權不明、來源時間倒退、整窗 D1 重寫、錯誤標示即時、secret pattern 命中或超過安全預算，該日失敗並維持 feature flag 關閉。

## 5. 發布與歸檔

只有 OpenSpec tasks 1.1、1.5、8.2～8.8 都有當次證據後，才可啟用 Cloudflare feature flag。啟用後等待 exact-commit deploy，監測完整交易日並完成正式 rollback 演練；最後更新驗證紀錄、strict validate、commit／push／deploy，才可歸檔 change。
