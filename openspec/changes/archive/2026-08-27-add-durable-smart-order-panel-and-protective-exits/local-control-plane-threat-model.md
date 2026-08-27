# 本機智慧下單控制面威脅模型

## 版本與判定邊界

| 欄位 | 值 |
|---|---|
| schema | `realtimestock.local-smart-order-threat-model/v1` |
| version | `2026-08-11.2` |
| 適用 change | `add-durable-smart-order-panel-and-protective-exits` |
| 部署邊界 | macOS 本機、loopback-only、Shioaji simulation；Runtime 檔案由單一 owner UID 管理，但其他本機 UID 與程序皆不受信任；不是遠端或券商雲端控制面 |
| 本文件作用 | Gate 0 task 0.10 的風險、控制、驗收與殘餘風險基線 |
| 非作用 | 不代表控制已實作、Gate 已通過、production／CA／真實委託已授權 |

本 change 的智慧下單 Runtime 會持續監控行情並可能產生交易 side effect，因此「只綁 `127.0.0.1`」不是完整安全邊界。本機惡意網頁、DNS rebinding、同使用者程序、瀏覽器 extension、被竄改的 build、重放 request、mode 切換競態與直接存取 Shioaji 8080，都必須個別處理。任一必要控制尚未成立時，對應 automation write 維持 `disabled`。

## 資產與安全目標

| 資產 | 必須保證 |
|---|---|
| broker session 與固定帳號 | browser 不得取得 credential／capability；每個 broker operation 綁定完整固定帳號與可信 provenance |
| 委託 side effect | 只有通過 mode、risk、reservation、revision、gate manifest 與合法 provenance 的單一 sender 可送出 |
| 策略、outbox、義務與稽核資料 | 私有、持久、可恢復、不可被 browser 任意改寫；未知結果不得被當成未送 |
| gateway capability 與 identity key | repo 外 `0600`、用途分離、可 rotation；不得出現在 URL、HTML、JS、DB、status、log 或錯誤訊息 |
| mode／generation／fence | dispatch 前後一致；unknown、mismatch、重啟或切換一律 fail closed |
| account／position／PnL／working-order evidence | account-scoped、fresh、完整性可證；缺漏不得以 0 或「沒有委託」解讀 |
| availability | DoS 不得退化成繞過安全檢查；readiness false 時停止新 activation，保留對帳與人工處理能力 |

## 信任區與資料流

```text
不受信任網頁／extension
        │ Origin / Host / Sec-Fetch / CSRF / schema
        ▼
127.0.0.1:5173 same-origin gateway ──私有 capability──► smart-order sidecar
        ▲                                                  │
        │ 最小化 view / SSE                                │ single sender + DB fence
        │                                                  ▼
   RealTimeStock browser                            Shioaji loopback API
                                                           │
                                                           ▼
                                                    simulation broker session
```

信任假設只有：受管 build、受管 LaunchAgent／sidecar、owner-only Application Support 目錄、可信 Gate runner與經驗證的 Shioaji simulation Runtime。Browser DOM、localStorage、URL、query、client-supplied provenance、環境變數、feature flag、一般 loopback caller與 8080 response 均不是權威。

## 現況差距

| 現況 | 證據 | 風險判定 |
|---|---|---|
| Vite guard 只在 `production-readonly` 阻擋已知 write paths | `vite.config.ts` `productionReadonlyGuard()` | `unknown` 仍可放行；sidecar／Tauri direct API 可繞過 Vite，不能沿用為 Runtime 安全邊界 |
| client guard 只在 current mode 為 `production-readonly` 時拒絕 | `src/lib/runtime-mode.ts` | mode 尚未同步、讀取失敗或 generation 改變時 fail open |
| generic `apiPost`／`apiPut`／`apiDelete` 可送任意 path | `src/lib/api.ts` | 沒有 server-derived provenance、capability、replay 與中央 account／risk arbiter |
| Tauri 可直接對 loopback 發 request | `src/lib/api.ts`、`src/lib/runtime.ts` | 不經 Vite middleware；packaged desktop 必須有等價 gateway，否則智慧單 fail closed |
| browser 可由 localStorage 選擇 API port，`VITE_API_BASE` 可覆寫 base | `src/lib/runtime.ts` | 對智慧單不得接受 browser／build env 任意導向非受管 target |
| runtime script mode file 為本機檔案，但 Node 路徑與新 sidecar 尚未納管 | `scripts/realtimestock-runtime` | 尚無 shared lock、sidecar drain、capability lifecycle、pinned executable fingerprint |
| Shioaji 8080 可被同使用者程序直接呼叫 | 既有架構 | gateway 只能約束 RealTimeStock；外部 client 競態屬殘餘風險，需 reconciliation／claim，不可宣稱全帳號原子鎖 |

## 威脅、必要控制與驗收

| ID | 威脅／攻擊 | 必要控制 | 必要負向驗收 | 未完成時政策 |
|---|---|---|---|---|
| `TM-01` | 惡意網頁以 form／fetch 呼叫 loopback mutation | exact Origin、Host、`Sec-Fetch-Site`、JSON content type、CSRF、私有 capability；mutation 不接受 simple request | foreign Origin、缺 Origin、`Sec-Fetch-Site=cross-site`、form POST、text/plain 全部在 handler 前拒絕 | 全部 smart-order mutation disabled |
| `TM-02` | DNS rebinding／Host header 混淆 | sidecar 只綁 `127.0.0.1`；gateway 與 sidecar exact Host allowlist；不信任 `localhost`、萬用 host或 forwarded headers | 惡意 Host、IPv6、LAN IP、帶 userinfo、尾點／大小寫／port 混淆均拒絕 | sidecar 不啟動 write capability |
| `TM-03` | remote tunnel／Cloudflare／反向代理暴露控制面 | 明確拒絕 non-loopback peer、`Forwarded`／`X-Forwarded-*`、remote origin；不提供 CORS | tunnel header、remote peer、Cloudflare origin與 reverse proxy smoke 皆 fail closed | remote smart-order control plane 不支援 |
| `TM-04` | CSRF token／request ID 重放 | per-session CSRF、single-use或有界 request ID、payload hash、revision、TTL、durable replay record | 同 request 重放、跨 endpoint／account／payload 使用、過期與 revision drift 均拒絕 | mutation disabled |
| `TM-05` | browser 偽造 `manual`、`automation` 或 `gate_probe` | provenance 只由 server 根據 route、短效 confirmation、durable intent或 probe nonce衍生；browser 欄位忽略／拒絕 | scheduler 使用 manual nonce、client 傳 provenance、automation 打 manual route 均不得產生 broker bytes | automation disabled，manual route亦不得降級繞過 |
| `TM-06` | capability 洩漏到 browser／URL／log／DB | capability 僅 gateway process與sidecar持有，repo 外 `0600`；header 注入；固定 redaction schema | DOM、bundle、source map、network response、URL、status、DB dump、log與crash report secret scan | rotation並關 write master；證據不完整不得重開 |
| `TM-07` | 同使用者惡意程序讀 capability，或其他本機 UID／程序經 loopback 直連 sidecar | owner-only `0700` 目錄／`0600`檔、process boundary、短效 session binding、rotation與 emergency stop；socket 不把 loopback peer 視為已認證，所有 UID 都仍須 capability 與 endpoint 來源驗證 | 不同 UID 無法讀 capability 檔且無 capability 的 loopback request 被拒絕；另測權限錯誤、symlink、替換檔、stale capability與rotation中 request | 跨 UID 由檔案權限與 capability 阻擋；同 owner UID 被攻陷無法完全消除，列殘餘風險並以 OS 帳號完整性為信任假設 |
| `TM-08` | sidecar 直接打 8080 繞過 production-readonly | 每次 write 前持 shared mode lease，重讀 owner-only marker並查 `/info.simulation=true`，綁 generation／adapter fingerprint；unknown fail closed | marker unknown、切換中、`/info` timeout／false、PID或capability drift、response後 commit前切 mode | 不取得 dispatch lease，不送 bytes |
| `TM-09` | request 在檢查後、write 前被 TOCTOU 改變 | intent／payload／account／risk／target revision與dispatch nonce先 durable commit；同一 arbiter線性化；adapter只收 immutable fenced envelope | queue 中 account／position／order revision改變、switch commit與dispatch競態 | intent invalid/reconcile；可能已送則 unknown，不 retry |
| `TM-10` | 未知／新增 write endpoint 漏出 allowlist | endpoint-specific gateway registry＋resolved build graph hash；禁止 gateway 外 import generic sender；unknown method/path default deny | trailing slash、query、case、method confusion、private modules新增callsite與direct 8080 route | route manifest drift 時整個對應account automation disabled |
| `TM-11` | update/cancel 以裸 `trade_id` 命中錯帳號／錯日委託 | 固定帳號 refreshed trades唯一解析；綁trade date、contract、side、immutable IDs與revision；write緊鄰前重驗 | 跨日ID重用、同ID跨帳號、queue中fill/cancel、跨probe-run target | 不 update／cancel，轉 reconcile／manual |
| `TM-12` | oversized／slow body或 SSE 消耗資源 | method與content type allowlist、request／response bytes、events、connections、timeout、queue與backpressure上限 | content-length欺騙、chunked oversize、header後stall、無界SSE、slowloris | 關閉該連線並使 readiness false，不得跳過驗證 |
| `TM-13` | SSE 未授權、cursor重放或漏事件被當完整 | SSE同樣驗 capability／Origin；bounded cursor、generation與account scope；gap轉recovery | 未授權SSE、舊cursor、跨account event、pre-subscription queued event、disconnect gap | 不以 event 建立 readiness；gap後 reconcile／manual |
| `TM-14` | log／error 回顯帳號、person ID、broker payload或server detail | 固定 reason code、accountRef、欄位 allowlist、長度上限、recursive sensitive scan；不保存任意server body | identifier嵌在前後綴／跳脫字串、oversized error、未知欄位 | evidence invalid、write master關閉、必要時rotation |
| `TM-15` | DB／key檔權限、symlink、corruption或backup洩密 | private subdir `0700`；DB/WAL/SHM/backup/key `0600`；`O_NOFOLLOW`／owner／inode檢查；加密不取代權限 | permissive mode、symlink、替換、backup競態、disk full、corruption | fail-stop；不得建立空 DB 或無持久化降級 |
| `TM-16` | browser 竄改策略、risk、PnL、kill switch或 gate | sidecar canonical schema、revision、stable confirmation hash；Gate manifest與risk authority不可由browser mutation | localStorage／devtools／feature flag／env改值、舊confirmation重放 | 不改變 canonical state；unknown關新增曝險 |
| `TM-17` | probe 被策略重用或誤碰既有委託 | 獨立 CLI、operation nonce、probe provenance、同run唯一lineage、最大1 CommonLot、無CA、逐次授權 | 一般UI呼叫、跨run target、任意trade ID、策略scheduler呼叫 | probe拒絕；一般 write master不因probe開啟 |
| `TM-18` | build／private module／adapter被替換 | manifest綁app、resolved modules graph、probe source、sidecar、adapter與Shioaji fingerprint；Gate runner獨立重算 | digest drift、自報eligibility、fixture report、舊artifact | observe-only，manifest失效 |
| `TM-19` | kill switch、stop、rollback或uninstall使義務失聯 | deny-union、與dispatch共用arbiter；non-terminal intent/order/obligation/reservation/claim阻擋停止 | emergency during dispatch、reconciling、PendingSubmit、working order、unknown、uninstall | drain或break-glass audit；不得靜默停止監控 |
| `TM-20` | 外部 App／client 在本地檢查後另行賣出 | account-wide position／working-sell evidence、ExternalSellClaim、dispatch緊鄰前重驗、持續 reconciliation | snapshot後外部sell、queue中外部sell、外部cancel/fill重排 | 只能保證RealTimeStock依最後證據不主動超額；競態轉人工 |

## Endpoint 安全矩陣

| 類別 | 允許 method | 認證與來源 | replay／revision | response | 副作用政策 |
|---|---|---|---|---|---|
| strategy mutation | endpoint-specific POST／DELETE | capability＋exact Origin／Host／Sec-Fetch＋CSRF | request ID、payload hash、expected revision、durable replay | 固定schema與reason code | 只改本地state；broker dispatch另經sender gate |
| manual broker command | endpoint-specific POST | 上述控制＋server-issued短效single-use confirmation | 綁route/account/contract/class/payload/revision | accepted不等於成交 | 只由`manual_user_confirmed` route進arbiter |
| automation dispatch | browser無直接endpoint | durable intent、sender epoch、manifest與strategy arm | dispatch nonce、fence、mode/risk/account revision | durable broker correlation或unknown | scheduler不可借manual route |
| gate probe | 獨立CLI／orchestrator | 一次性probe nonce＋逐operation授權＋shared lease | 同run lineage與target revision | 遮罩證據、零秘密 | 不開一般write master，不接受UI target |
| read API | GET或明確read POST | capability＋exact Origin／Host／Sec-Fetch；method與request size limit；query／body schema | bounded cursor／ETag（需要時） | 最小化、redacted、no-store | 完全無副作用；subscribe、refresh、reconciliation或其他會改變資源／狀態的工作必須走明確受控 operation endpoint |
| event SSE | GET | capability＋exact Origin／Host／Sec-Fetch | bounded cursor、generation、accountRef | 固定event union、heartbeat無權威 | gap使readiness false |
| health／readiness | GET | capability＋exact Origin／Host／Sec-Fetch；method與request size limit；不回capability／identifier | no-store | 最小布林／reason code／count | 完全無副作用；不得自動修復、refresh、subscribe或送單 |

## 生命週期與 capability rotation

1. install 以 `umask 077` 建立私有目錄、gateway capability與分離的identity key；不把值寫入 plist、repo或status。
2. sidecar 啟動先驗檔案owner／mode／symlink、manifest、DB、mode與listener identity；未通過只可輸出redacted blocked status。
3. gateway 與sidecar以versioned capability handshake；browser只取得same-origin session與CSRF，不取得sidecar capability。
4. rotation 先關閉新mutation與write master，等待in-flight dispatch線性化，產生新capability、原子切換、撤銷舊值並做secret scan。
5. capability疑似洩漏、owner／mode漂移、build hash改變或sidecar重啟時立即失效；有未終結義務先進recovery／reconciliation，不得用新key建立空白世界。
6. uninstall 預設保留DB／history，移除 capability前先證明零non-terminal side effect與義務；否則拒絕或只接受明示break-glass audit。

## Gate 0 驗收責任

- task 0.10只有在本文件的威脅、控制、負向測試與殘餘邊界完成review後，才可視為「威脅模型完成」；它不會自行解鎖任何寫入。
- task 0.13負責 current build graph 的所有 write route與provenance coverage；task 0.17負責 machine-readable manifest與獨立 verifier。
- Gate 1 必須以 hostile tests 實證 `TM-01` 至 `TM-19` 的可機械控制；`TM-20` 必須以殘餘風險揭露、ExternalSellClaim與故障情境驗收。
- packaged Tauri、private `modules` build graph、Cloudflare／tunnel拒絕與直接8080旁路任一未證實時，該部署型態智慧單必須 fail closed。
- 本 threat model 未授權讀取或記錄秘密、未授權simulation write probe，也不改變production／CA禁用狀態。

## 殘餘風險

1. 同一 macOS 使用者身分下已被攻陷的程序，理論上可讀owner-only檔案或直接呼叫Shioaji；本 change只能縮小capability暴露、偵測drift與限制RealTimeStock sender，不能建立OS帳號內的完整機密隔離。
2. 外部大戶投、其他Shioaji client或人工委託不受RealTimeStock gateway鎖保護；snapshot後TOCTOU無法被本地原子消除。
3. Mac關機、睡眠、斷網、session／Runtime中斷時不監控；本機功能不是券商雲端服務，也不能作為實盤唯一保護。
4. simulation成功不代表production語意、成交品質或券商雲端能力；未另案取得正式API、授權與production驗證前不得外推。
