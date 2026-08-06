# Gateway Service 操作手冊

本手冊只涵蓋不含秘密的安裝、啟停、health 與主機防護。真實 credential 必須依 [secret-lifecycle-runbook.md](./secret-lifecycle-runbook.md) 由 operator 在小馬本機注入，禁止貼入對話、repository、CI、Cloudflare、Sites、D1、Obsidian 或一般備份。

## 已驗證主機前提

2026-07-31 對小馬執行唯讀預檢：systemd 255、`systemd-creds`、`systemd-inhibit` 與 `curl` 均可用，NTP 已同步，主機 firewall 已啟用，TCP 8788 未被占用。此摘要不包含主機位址、登入帳號或 credential。

## 安裝邊界

1. 建立不可登入的 `multichart-gateway` system identity，不加入額外群組。
2. 在非同步 staging 目錄執行 `uv sync --frozen --no-editable`，不得使用未鎖定套件；simulation 與 secret scan 通過後才可安裝。
3. 以 [install_system_service.sh](../tools/install_system_service.sh) 加 exact commit SHA 執行一次互動式 sudo 安裝。安裝器把 release 保存到 `/opt/multichart-gateway/releases/<EXACT_COMMIT>`，owner 固定為 root；目錄與原有 executable 允許 service identity 讀取／穿越，但移除所有 group／other 寫入權。`current` symlink 原子選版且不刪除前一版。
4. 安裝器建立專用 system identity、空的 encrypted credential store、systemd unit 並執行 `daemon-reload`；因尚未注入 credential，必須維持 `installed_not_enabled`，不得啟動。
5. 完成 task 8.2 的 encrypted credential 注入後，才執行 `systemctl enable --now multichart-gateway.service`。

正式 unit 使用專用 identity、空 capability set、唯讀系統、私有暫存目錄、有限 address family 與 journald。程式從唯讀 `/opt/multichart-gateway/current` 載入，working directory 固定為 systemd 管理且 mode 0700 的 `/var/lib/multichart-gateway`，讓 Shioaji 自身可能建立的 runtime log 不會污染程式目錄。啟動前必須通過 NTP 預檢；程序由 `systemd-inhibit` 持有 sleep inhibitor。gateway 本身只建立 outbound 行情／Cloudflare 連線，唯一 health listener 固定為 `127.0.0.1:8788`，不得改成 `0.0.0.0` 或公開轉送。

## 啟停與健康檢查

```bash
sudo systemctl start multichart-gateway.service
sudo systemctl stop multichart-gateway.service
sudo systemctl restart multichart-gateway.service
systemctl is-active multichart-gateway.service
curl --fail --silent --show-error http://127.0.0.1:8788/health
```

health 只允許 `runtime`、`transport`、`mode`、`state`、`reasonCode`、`reconnectAttempts` 與 active universe 上限。不得加入帳戶、header、environment、原始 Tick、上游 response 或 exception。

防火牆與 listener 驗證：

```bash
systemctl is-active ufw.service
ss -lnt 'sport = :8788'
systemd-inhibit --list --no-legend
python3 /opt/multichart-gateway/current/tools/scan_safe_artifacts.py /var/lib/multichart-gateway
```

8788 必須只顯示 loopback。若 firewall 未啟用、出現非 loopback listener、NTP 不同步或 sleep inhibitor 消失，pilot 必須停止。

## Reconnect 邊界

- Shioaji quote event `12` 進入 `degraded/provider_reconnecting`，event `13` 才恢復 `live`；callback 不保存官方 `info` 或 `event` 原文。
- 程序啟動／登入失敗採 `1, 2, 5, 10, 30, 60` 秒六段等待；第七次失敗以安全 reason code 結束。
- systemd 僅在異常結束後等待 300 秒重啟，30 分鐘最多三次，避免登入風暴。
- 不以 `snapshots`、`ticks` 或 `kbars` 輪詢取代行情訂閱。provider quota、circuit breaker 與盤中一次性缺口回補均由 runtime 硬限制；uplink 僅在 callback 外每秒送出一個有界微批次。
- uplink 使用 hosted ingest secret 加 Cloudflare Access Service Token 建立單一 outbound WebSocket；每次連線帶不含秘密的 connection ID、30 秒內 timestamp，訊息使用單調 sequence。64 KiB、32 商品或一秒頻率任一上限不合格即 fail closed。
- 同一 WebSocket 的下行 `subscription-demand-v1` 最多 32 個 canonical 台股商品。service loop 每 250ms 在 callback 外讀取，逐項經 single-flight control plane 訂閱並執行當日一次性 Kbars 回補；Cloudflare 在收到權威結果前只顯示 `queued`，不能把 socket 已連線冒充 provider 已訂閱。
- gateway restart 後 connection ID 更新且 sequence 可從 1 開始；Durable Object 會退休舊 connection。倒序、舊 connection replay、過期 timestamp 或 payload 欄位越界都必須拒絕。

## 降載與事故處理

- active universe 初始上限 32；pilot 可下調，不得上調超過程式硬限制。
- provider 登入、訂閱與 Kbars 各有硬預算、三次失敗 circuit breaker 與 60 秒 cooldown；不得用額外輪詢繞過。
- Cloudflare 達 soft quota 後先只傳可見商品並停 backfill；再升高時停止新增訂閱；hard limit 暫停 ingest。gateway 保留 bounded queue，不無限累積。
- source age 超過門檻或 uplink 中斷時，網站標示連線不穩／資料過期並原子切換 Yahoo 延遲備援，不混合兩個 provider 的 OHLCV。
- 疑似秘密外洩時先關 feature flag、停 gateway，再只撤銷受影響 trust domain；事故紀錄只保存時間、phase、固定 reason code、計數與恢復結果。

## 安全停止與復原

先停用網站 realtime feature flag，再停止 gateway。不得刪除 canonical candle history 或反向移除 D1 migration。Gateway 程式回復只需把 `/opt/multichart-gateway/current` 原子改指先前已驗證 release、執行 `daemon-reload` 並重啟；網站程式回復則從 `baseline-pre-shioaji-realtime-2026-07-31` 建立 recovery branch、通過驗證後再部署。秘密撤銷與輪替依獨立 runbook 執行。
