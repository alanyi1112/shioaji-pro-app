# 10/14 重開機中斷與明日基準有界補件

時間全部 Asia/Taipei。使用者明確要求：「處理中斷後的補件，把剩下的63檔補齊，準備好明天的比較基準，完成後告訴我。」這是操作者補件授權，不是重跑原生排程、登入／訂閱、啟停服務或交易授權。

## 原件與缺口

- 原生13:35 PID46363：attempt-01於14:37:15.238 partial62／160，125次請求，budget_or_rate_denied；原15分鐘冷卻後attempt-02於14:52:15.279取得claim。
- 主機boot時間為15:28:09，原owner已退出；attempt-02完成receipt及attempt-03claim均不存在，原程序不能算正常collecting。正式repository有97份來源10/14／目標10/15的合法v2，TSE76／OTC21，末次保存15:27:20.624；尚缺63份。
- 原claim hash為84ac5e42392400240ebc293802b286db28981e05c7819540636cd6cc61f51782；原attempt-01receipt、原claim、97份manifest及當日live／稽核失敗全部保留。
- 原生postclose官方日曆13:35:03.773，calendarVersion=sha256:4d8e53bbb4431ba2c16fda36d3f8269ccaaaf48eb21b083ccf9af7f60f4300fb，原官方雙市場cache確認10/14→10/15。補件重用原文與原時間，不再寫一份假的scheduled cache。

## 安全與預算

- 現有simulation generation為simulation:7b2fbecb-6cf4-45ed-8aae-982465f4c234；既有business session／2330 Snapshot正常，無另一採集owner或reserved／dispatched。Web971／MultiView977／API1302是本次重開機後listener錨點，不宣稱全日未換PID。
- 原同週期v4帳本usage high-water17,295,412 bytes仍在，原本198筆charged估量72,706,788 bytes不移除。來源重開機後raw usage降至約2.2MB，普通單調檢查拒絕；不宣稱這是來源日重置。
- 第一次operator於16:58:56.286保存receipt，為partial97／160、0次下載、stoppedReason=broker_budget_pending；此原件不刪改。第二次須等17:13:56.286原冷卻到期，保留這張partial，不清除冷卻。
- 同epoch保守carry固定17,295,412 bytes，加上新generation真正raw計數，raw／carry／conservativeUsedBytes分列；scope／帳戶HMAC／上限／原daily identity不變，不新建quota epoch、不清charged／quarantined。新generation再變、帳戶變、計數退回或預算不足時拒絕。
- 第二次operator-resume PID6215已啟動，固定126筆contract／KBar上限、原18:30截止、中央兩請求／分鐘及300MiB池不變。未更動每日profile、名單、門檻或共用服務；補件不在Vite config依賴鏈。

## 證據位置

私密root：`/Users/alanyi/Library/Application Support/RealTimeStock/IntradayMonitor/operator-interruption-recovery/84ac5e42392400240ebc293802b286db28981e05c7819540636cd6cc61f51782/`。

- `operator-claim.json`：原97份逐檔hash、parent claim／receipt hash、source／target、期限及上限。
- `operator-receipt.json`及內層`attempt-01-receipt.json`：第一次零下載partial。
- `operator-conservative-resume-claim.json`與`same-epoch-conservative-carry.json`：第二次獨立操作者claim、原冷卻及同週期保守carry，不是scheduled。
- 第二次完成時預期生成`operator-attempt-02-receipt.json`及內層`attempt-02-receipt.json`；未生成前不能稱160份已完成。

## 候選驗證與未完成判定

- 新增16項Node24聚焦回歸通過：重開機／原owner／原時間／冷卻／calendar／母體／交易權限拒絕、保守計帳、原子中央admission、速率限制、charged保留、重開相同carry不清帳／不倍增、帳戶／generation／計數異常拒絕。
- 既有中央admission／daily identity／舊補件28項Node24及collector8項Vitest通過；tsc／Vite build、OpenSpec strict及git diff --check通過，build既有chunk大小警告不隱藏。
- 17:13:56.286冷卻到期後，第二次真正下載已開始；17:14唯讀查正式repository為98／160、第一新增manifest fetchedAt=17:13:56.501。原198筆charged增至200筆，原舊198筆未清除；同週期保守用量21,815,504 bytes，原新raw與carry分列，沒有重置quota。PID6215仍工作，完成receipt尚未生成。
- 原97份不重抓；只有160／160全部重驗schema／hash／source／target／270分鐘／provenance、原件不變且完成receipt成立後才通知準備好。原生projection仍可能因原attempt02缺receipt顯示中斷，不將它改寫為原生成功。
- 17:16:53再次唯讀確認PID6215仍在，已100／160（本輪新增3份，剩60），末次來源保存17:15:56.574；實際進度符合中央每分鐘兩次請求，不是單純等待或fixture。完成前仍維持進行中判定。
- 沿用原Codex主追蹤automation，暫改每5分鐘只唯讀此唯一補件程序，scheduler實算下一次為10/14台北17:17:39。正常累積不通知，完成／新失敗才通知；本次補件完成或確定失敗後須恢復原台北08:05／09:05／14:05／17:05頻率並保留主結案追蹤，不建立另一份下載排程。
- 此補件完成不追認當日live或原13:35程序自動完整。主change仍46／49，7.4／7.6／8.6不勾；不archive／commit／push。

## 18:16 完成與18:20獨立重驗

- 原operator PID6215在18:16:00.952產生完成收據後退出。`operator-attempt-02-receipt.json`與內層`attempt-02-receipt.json`均complete160／160，waiting0、conflict0；本輪真正126次請求，HTTP response bytes共1,008,966。集中速率等待70次、3,704,405ms；未提高兩請求／分鐘限制，原18:30期限內完成，原97份全數重用、補齊63份。
- 18:20:22正式SQLite唯讀重驗：160份全數通過`isDailyMinuteVolumeBaseline`，固定cohort完全一致、TSE121／OTC39、來源10/14及目標10/15、雙市場官方calendar reference一致。共43,200個canonical封閉分鐘（每檔09:01–13:30共270），closeMode均normal_or_revised_13_30、known-zero carry0、來源日衝突0。獨立closeTotalCheck仍not_observed160，不假稱做過獨立總量對帳或取得live資格。
- 原97份manifest內容hash全不變，原native attempt-02 claim與attempt-01receipt hash全不變；原native attempt-02完成receipt仍不存在，不由operator補造原生成功。當日09:01 live partial0及原13:40失敗不改判。
- 完成operator receipt SHA-256：b8106994c7d05627d534610020b8c3224246c3c14f97093deda77a71b8d11acb；內層collector receipt SHA-256：2c00f00a18ff5688253904981c29df418a06a972a36f4b02986021804cc09491。原parent claim hash仍84ac5e42392400240ebc293802b286db28981e05c7819540636cd6cc61f51782。
- 完成後既有simulation business session／2330 Snapshot可用、generation未變、原帳戶HMAC一致；reserved／dispatched0。原charged198筆保留，追加126後charged324筆、估量118,974,744 bytes，300MiB保護池維持314,572,800 bytes，沒有quota reset／刪帳。
- 18:20:22.458真正provider raw usage=7,110,566／524,288,000 bytes、remaining=517,177,434 bytes；這是共用來源計數，不是本輪126請求的獨占消耗。既有`recordBrokerResetObservation`於18:20:22.484另存0600原始來源錨點，evidenceHash=1afe039f95f9c374461a17dd4e428228290353e8de8dc3d597961a31e0e318c7；僅有HMAC摘要，未保存原始帳號、不把carry寫成raw、沒有admission／遷移權限，供10/15盤前核對。
- 完成後runtime status證實production-readonly stopped、write master disabled、business watchdog healthy且本次restart count0；Web971／API1302／MultiView977 listener仍與補件前錨點相同。smart-order sidecar顯示not-ready／required_before_any_write，不宣稱所有其他change通過，也未操作其write／drain。
- 本次補件目標完成：10/15正式比較基準160／160備妥。主追蹤恢復台北每日08:05／09:05／14:05／17:05，五分鐘補件輪詢停止，主結案追蹤保留。7.4／7.6／8.6仍未完成，不archive／commit／push。
- 恢復後直接讀scheduler DB確認status ACTIVE、原target thread不變、notification policy正常；下一個名義查核點10/15台北08:05，scheduler實算喚醒時間08:04:55。這是實算排程時間，不僅憑ACTIVE判定；屆時先核08:00後真實來源計數，不能提前手動CAS。
