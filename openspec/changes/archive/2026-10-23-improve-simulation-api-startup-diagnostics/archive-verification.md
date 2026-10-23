# 主規格同步與歸檔收據

完成時間：2026-10-23T18:45:37.642833+08:00（Asia/Taipei）。依使用者明確授權，先同步主規格，再只歸檔`improve-simulation-api-startup-diagnostics`；其他未完成change、無關變更及原證據保留，不新增請求、不重啟服務，先不commit／push。

## 完成結果

- 原10／10任務、全部artifacts完成；原change strict通過，自然載入證據SHA與repo／已安裝wrapper SHA核對仍一致。本輪不新增行情探測、不重跑程式測試或build。
- 主規格：[simulation-api-startup-diagnostics](../../../specs/simulation-api-startup-diagnostics/spec.md)。新增繁體中文Purpose及3項requirement／7個scenario，Requirements內文與delta逐字相等；同步後strict通過。
- 主規格先同步並驗證後，才執行`OPENSPEC_TELEMETRY=0 openspec archive improve-simulation-api-startup-diagnostics --skip-specs --yes`。skip-specs只避免再次套用已同步的ADDED，沒有使用no-validate。
- 歸檔位置：`openspec/changes/archive/2026-10-23-improve-simulation-api-startup-diagnostics/`。原8份檔案連同`.openspec.yaml`及acceptance原件完整移動，內容SHA均未變；本收據為新增第9份檔案。
- `docs/local-runtime-macos.md`只修正本change驗收原件的歸檔路徑，保留原檔其他既有變更。

## 驗證與保留邊界

- 歸檔後根專案`openspec validate --all --strict`：**79／79**；MultiView同指令：**38／38**。兩次均設定`OPENSPEC_TELEMETRY=0`；`git diff --check`通過。
- 歸檔前盤點的472份dirty檔案，扣除本案8份及需修正連結的操作文件1份，其餘**463份內容／刪除狀態完全相同**。未清理generated artifacts、其他已歸檔目錄或無關未追蹤檔案。
- App Support wrapper、RealTimeStock plist及全部observer TOML共**23份前後SHA一致**。8080／5173／5174仍為PID1200／934／940；只讀lsof，未呼叫runtime/status/watchdog/collector或API。
- HEAD仍`4f33a618b8d74900a714a218923f3a69ffb5f04a`，index未變、staged0；未commit／push／部署或改任何排程、休市設定與行情連線。
- active changes保留：共用交易日曆`add-manual-special-market-closures` **21／22**、名單同步`sync-monitor-roster-postclose-baselines` **39／41**、晚開機補救`support-intraday-monitor-late-boot-premarket-catchup` **12／13**。沒有將本案歸檔擴張成它們自然驗收完成。
- 自然載入只證wrapper正式載入；HTTP400／unknown、未製造真實退出或spawn失敗及完整行情未驗收等限制仍保留於原驗證紀錄，不因歸檔而移除。

## 原件內容指紋

以下SHA在移動前後逐一核對一致。本收據不改寫原verification或失敗證據。

| 相對於change的檔案 | SHA-256 |
| --- | --- |
| `.openspec.yaml` | `54c2a6955b514abf783374521da3b6364c1d6b221970ad9faa7124a7e1124528` |
| `acceptance/natural-load-2026-10-23.json` | `c985a1b902ffd485058b758f23ae52d77a5b737e979c339696ceed470e979ba0` |
| `acceptance/natural-load-2026-10-23.md` | `4f6dc0c66b4fb298f13c4b7670b441e49868cfb1efabc3533e4f112c692377ed` |
| `design.md` | `908566db3ca80e4a185aa5c704ed3347a33fc742a9ca1016b42ced25ce00bf3a` |
| `proposal.md` | `89b7d0b859fb2a27d59d12212d7afe4061bca14f4016ad42e5682a6f9336d013` |
| `specs/simulation-api-startup-diagnostics/spec.md` | `698df1d05e9984e9ec3af968e8a9deead0af6436a94131b88431cb19e59682e8` |
| `tasks.md` | `c9c95900dd1ca78fcd78fd9b0335e6062145eedd2e3053485f8ad0a9ac58c037` |
| `verification.md` | `81e87d2d037ec42f2c832dc273a0e70b6cd0ea1cff80a1f15309ae1f75792ead` |

主規格完成時SHA-256：`a3fb4909cc940c875e600cf860f65284968c238f10d58c73de499112c7c28736`。
