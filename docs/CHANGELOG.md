# CHANGELOG

格式：依日期倒序；分類為 新增 / 變更 / 修正 / 移除 / 文件。

## [Unreleased]

### 新增
- 綠界 ECPay AIO 信用卡付款（測試環境）：`POST /api/orders/:id/ecpay/checkout` 取得簽章表單、`POST /api/orders/:id/ecpay/query` 主動呼叫 `QueryTradeInfo/V5` 驗證、`POST /api/payment/ecpay/result`（OrderResultURL）導回後以查詢結果更新訂單。因本地收不到 Server Notify，不依賴 ReturnURL。
- `orders` 新增 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at`（啟動時 ALTER）。
- 測試：`tests/ecpay.test.js`（CMV 向量、checkout、mock 查詢 paid/pending、偽造回導）。

### 文件
- 新增 `CLAUDE.md` 與 `docs/`（README、ARCHITECTURE、DEVELOPMENT、FEATURES、TESTING、CHANGELOG、plans）。

## [1.0.0] - 2026-11-11（初始提交）

### 新增
- 認證：註冊、登入、個人資料（JWT HS256，7 天）。
- 商品：公開列表（分頁）與詳情；8 筆 seed 花卉商品與 seed 管理員。
- 購物車：訪客（`X-Session-Id`）與會員（JWT）雙模式；同商品累加並檢查庫存。
- 訂單：由購物車建立訂單（transaction：寫入訂單與明細快照、扣庫存、清空購物車）、我的訂單、訂單詳情。
- 模擬付款：`PATCH /api/orders/:id/pay`（`pending → paid | failed`）。
- 後台：商品 CRUD（刪除會檢查 pending 訂單）、訂單列表（狀態篩選）與詳情。
- 前端：Vue 3 + Tailwind 4 前台 7 頁、後台 2 頁、404 頁。
- 測試：Vitest + Supertest，6 個測試檔涵蓋 auth、products、cart、orders、admin products、admin orders。
- OpenAPI 產生腳本（`npm run openapi`）。

### 已知限制
- 未串接綠界 ECPay（環境變數預留）。
- 登入不合併訪客購物車。
- 刪除仍在購物車中的商品會觸發 FK 錯誤（500）。
- 訂單失敗不回補庫存。
