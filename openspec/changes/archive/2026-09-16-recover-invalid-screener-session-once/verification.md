# 2026-09-16 驗證

- 實作及 CLI：日期／phase／冷卻／總預算／唯一 receipt，沿用 operator lease。自動 invalid 規則未變。
- 聚焦 12／12，operator Node tests 13／13。
- 單次恢復 receipt `screener-invalid-recovery:2026-09-16` 已保存原 invalid／TPEx invalid_source_payload 與 hash，未刪除或重設。
- v2 發布 1,975 檔，effective=2026-09-16；v3 bounded 3 期後 120／120；v4 bounded 4＋7 期後 260／260，均發布到 9/16。逐商品缺值仍保留 unknown。
- 實際 UI 成交量 ≥3 倍：P=9/15、D=9/16，137 符合、1,818 不符合、20 無法判定；console warning/error 0。
- v5 補 9/14、9/15 成功；9/16 TWSE institutional-flow 已 verified，下一份回 empty_report，後續未全部完成；81／84 receipts，維持 pending。未聲稱所有選股條件完成。
- 隔離整合候選樹驗證：240 files／2,469 tests、選股 Node 85／85、TypeScript 與 Vite build 通過。修正 12 個新檔 EOF blank；真實 index staged 0。
- 提交候選合併共用相依，未強拆出不可建置的中間版本。Cloudflare deferred、秘密、憑證、outputs／exports／暫存附件排除；原有成交明細與日 K 稽核仍 active。未 commit／push／部署或啟停服務。
