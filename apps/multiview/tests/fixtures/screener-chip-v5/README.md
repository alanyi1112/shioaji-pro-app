# 盤後選股 v5 正式來源契約樣本

這些資料是去識別化、縮減後的契約測試 fixture，不是行情證據，也不得用來發布正式快照。

| 檔案 | 市場／資料集 | 正式來源 | 日期欄位 | Canonical 單位 |
| --- | --- | --- | --- | --- |
| `twse-t86.json` | TWSE／三大法人 | `TWSE T86` | `date` | 投信買進、賣出、淨額均為股 |
| `twse-mi-margn.json` | TWSE／信用交易 | `TWSE MI_MARGN` | `date` | 融資、融券餘額均為張 |
| `tpex-institutional.json` | TPEx／三大法人歷史日報 | `3itrade_hedge_result.php` | `date` | 投信買進、賣出、淨額均為股 |
| `tpex-margin.json` | TPEx／信用交易歷史日報 | `margin_bal_result.php` | `date` | 融資、融券餘額均為張 |

解析器必須核對實際報表日期、必要欄位、買進減賣出等於淨額、今日減前日等於餘額變化，以及商品代碼與市場。缺列保留為缺漏；不得改成零。fixture 不含帳號、token、cookie 或其他機密資料。
