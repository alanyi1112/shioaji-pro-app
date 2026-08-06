## 小馬 Gateway 主機與安全基線

本文件只保存不含帳號、個資與秘密的驗證摘要。任何 Shioaji API key、secret、Cloudflare ingest secret、cookie、token 或 credential 值均不得寫入本文件、repository、OpenSpec、Obsidian、CI、log 或支援訊息。

## 主機與 Supervisor 決策

- 主機：私人網路內的「小馬」，不公開內網位址或登入帳號。
- 作業系統：Ubuntu 24.04、Linux x86_64、64-bit。
- 執行環境：Python 3.12.3、`uv 0.11.11`；Shioaji 固定使用經 simulation 與 pilot 驗證的 `1.7.1`。
- 資源安全線：16 logical CPU、31 GiB RAM、根檔案系統 386 GiB 可用，足以支援受限 32 檔 active universe；實際上限仍以 pilot 與 provider budget 為準。
- supervisor：systemd 255 system service，使用專用 `multichart-gateway` system identity，不沿用日常互動帳號。
- 開機：service 必須等待 `network-online.target`，使用 bounded `Restart=on-failure`、啟動速率限制與 health watchdog；不得以無限快速重登恢復。
- 校時：`Asia/Taipei`、NTP 已啟用且 `NTPSynchronized=yes`；來源時間仍須使用 Shioaji Tick 時間，不得用接收時間冒充。
- 休眠：主機無電池，GNOME 插電 idle timeout 為 `0`；正式 service 仍須設定 sleep inhibitor，並在 pilot 前確認 BIOS AC power restore 與必要 UPS。
- 網路：1 Gbps 有線、carrier 正常，DNS 與 outbound HTTPS 成功；gateway 只建立 outbound 連線，不開公開 HTTP、SSE、WebSocket 或 Cloudflare Tunnel inbound。
- 故障切換：主機、provider 或 uplink 超時後，Cloudflare 正式站停止宣稱即時並原子切換 Yahoo 延遲備援；Sites 保留站不依賴 gateway。

## OS 級秘密與 Service Identity

- 正式 service identity 固定為 `multichart-gateway`；不得提供互動 shell、sudo、一般 home 目錄或網站／D1 管理權限。
- 秘密 provider 固定使用 TPM2 綁定的 `systemd-creds` 與 `LoadCredentialEncrypted=`。小馬已確認 systemd credential 與 TPM2 firmware、driver、system、subsystem、libraries 均可用。
- 三個 runtime credential 名稱分別代表 Shioaji API key、Shioaji secret 與 Cloudflare ingest secret；只使用 placeholder 名稱，不在 unit 或文件保存值。
- gateway 只接受 systemd 提供的 `CREDENTIALS_DIRECTORY` 路徑 handle；正式模式缺少任一檔案、檔案為 symlink、權限允許 group／other 讀取、內容為空或 placeholder 時必須 fail closed。
- encrypted credential store 位於 repository、同步資料夾與一般使用者 home 之外，並排除一般備份；解密後的 runtime 檔案只存在 `/run` 的 ephemeral credential mount。
- 秘密不得出現在 `.env`、shell profile、service command line、process arguments、exception locals、health、request header dump 或 crash dump。主機目前 core dump limit 為 `0`，正式 unit 仍須明確設定 `LimitCORE=0`。
- Shioaji credential 與 Cloudflare ingest secret 必須分開建立、輪替與撤銷；瀏覽器人員登入是第三個獨立 trust domain。

2026-07-31 未注入前基線只做名稱、權限邊界與存在性檢查，不讀取任何值：小馬已建立專用 service identity、root-owned encrypted store 與 gateway unit；encrypted store 的上層目錄為 `0700`，一般 SSH 身分無法列出或讀取內容。service 維持 `disabled`／`inactive`，尚無 Shioaji process；小馬 shell profiles、home `.env` 與本機專案 `.env` 均未出現 Shioaji secret variable name，repository 內沒有 private key／CA 檔案。此結果只證明尚未把正式 credential 放入錯誤位置，不等同 task 8.2 的正式注入驗收。

## 三個 Trust Domain Threat Model

### 1. 小馬 Gateway Domain

- 持有：Shioaji runtime credential、獨立 Cloudflare ingest secret、最新行情與有界 session buffer。
- 不持有：Cloudflare 人員 session、Sites secret、下單 CA、網站使用者 cookie。
- 允許出口：Shioaji 行情連線與單一 Cloudflare outbound uplink。
- 主要威脅：host compromise、credential file 誤權限、shell／process／crash dump 洩漏、重登風暴、睡眠／斷網、惡意或異常 Tick。
- 控制：專用 identity、TPM2 systemd credential、systemd sandbox、`LimitCORE=0`、allowlist log、bounded queue／backoff、無 inbound listener、來源時間與序號驗證。

### 2. Cloudflare Ingest Domain

- 持有：hosted ingest secret、連線 ID、最後接受序號、正規化行情與短期 hub state。
- 不持有：Shioaji API key、Shioaji secret、CA、帳號物件。
- 主要威脅：偽造 uplink、secret replay、倒序／過舊微批次、payload 放大、Tick 寫入 D1、quota 耗盡。
- 控制：獨立 ingest secret、timestamp／connection ID／monotonic sequence、payload allowlist 與硬上限、WebSocket hibernation、D1 zero-tick-write、feature flag 與 circuit breaker。

### 3. Browser Domain

- 持有：已登入網站人員 session、可見 panel symbol 與 page-scoped subscription。
- 不持有：任何 Shioaji 或 gateway machine credential、原始帳戶物件、Cloudflare ingest secret。
- 主要威脅：DOM／storage 洩密、未授權 symbol 訂閱、每 panel 建立連線、stale 資料冒充即時、跨使用者資料混用。
- 控制：同源已授權 WebSocket、每頁一條 multiplex 連線、canonical symbol allowlist、來源／freshness 可見狀態、頁面生命週期 cleanup、Yahoo 原子 fallback。

## 輪替、撤銷與事故邊界

1. Cloudflare ingest secret 疑似外洩時，先關閉 realtime feature flag、拒絕舊 secret、建立有限重疊的新 secret；不得接觸 Shioaji credential。
2. Shioaji credential 疑似外洩時，先停止 gateway 與正式即時能力，再於永豐金端撤銷／輪替；事故紀錄只能保存 reason code、時間與影響範圍。
3. 瀏覽器人員授權異常時，只停用對應網站身分，不輪替 gateway 或 Shioaji credential。

## Service 實作驗證（2026-07-31）

- 已建立 production systemd unit、NTP preflight、loopback-only health、sleep inhibitor、有限程序重試及 systemd restart budget；simulation 啟動後 health 回報 `state=live`、`transport=loopback`，SIGINT 可乾淨停止。
- 修正版已由使用者在小馬完成 privileged 安裝；唯讀終驗確認 `/opt/multichart-gateway/current` 精確指向 commit `5c093d29b8f38cfaa73beabaea2b238dfb2a431b` 的 root-owned release，安裝檔 hash 與 feature branch 一致，該 release 的 Python 可匯入 gateway 與 Shioaji runtime。
- gateway tree 對應的 branch commit `4c4a9430cf77e6a3c914e18c45e30c3c47741de4` 已於小馬的非同步 staging 建立鎖定 `.venv`，在該主機完成 `80/80` simulation tests 與 safe-artifact scan；system release 仍保持前述舊版，等待 operator 執行不含秘密的 privileged installer 後才可切換。這項 staging 證據不等同 task 8.2 的 credential 注入或 production pilot。
- 專用 `multichart-gateway` system identity、root-owned `0644` unit 與 root-only encrypted store 邊界已建立；`systemd-analyze verify`、NTP preflight、安全 artifact scan 與 UFW active 狀態均通過。service 依設計維持 `disabled`／`inactive`，TCP 8788 與 sleep inhibitor 均不存在，直到 task 8.2 使用 OS secret provider 注入正式 credential 並進行 production pilot 才可啟動。
- 安裝前曾發現 staging 的 `0700` mode 被複製到 release root，導致非 root service identity 無法穿透；修正版將 release 正規化為 root-owned、全員可讀／可穿透且 group／other 不可寫，重新安裝後 runtime import 與 unit 驗證已通過。
- Shioaji quote event callback 只映射 event code 為安全連線狀態，不保存上游 `info`／`event` 原文；task 3.6 仍負責更完整的 provider quota、cooldown 與 circuit breaker。
- Shioaji credential 與 Cloudflare ingest secret 的建立、輪替、撤銷、疑似外洩與恢復流程已分開寫入 `gateway/docs/secret-lifecycle-runbook.md`，全程只使用 placeholder，task 2.9 完成。
4. 任一 domain 失效時，既有 Yahoo／官方資料流程與 Sites 保留站必須維持；不得為恢復即時能力而把秘密貼入終端歷史、對話或臨時 `.env`。

## 尚待 Production Pilot 的 Gate

- 永豐金對 API 登記人本人以單一 owner 私人登入網站自用展示方式的可接受使用依據。
- BIOS AC power restore、必要 UPS 與至少三個交易日的實際 uptime／網路量測。
- 使用 task 8.2 正式 credential 啟動 service 後，驗證 runtime sleep inhibitor、loopback-only health 與停止／重啟行為；在此前 service 必須維持停用。
- 既有 Cloudflare D1 24 小時 rolling window 回到安全預算以下。
- 兩檔 simulation／真實 pilot、來源比對、fallback、收盤核定與 Free-tier 驗證。
