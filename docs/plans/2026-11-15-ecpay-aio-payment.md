# 串接綠界 ECPay AIO 信用卡付款（本地端，主動查詢驗證）

## User Story
身為購物網站的會員，我想要在結帳後透過綠界（信用卡）完成付款，以便取得真實的付款流程與訂單狀態；因專案僅在本地執行、收不到綠界 Server Notify，付款結果改由本地端主動呼叫 `QueryTradeInfo/V5` 驗證。

## Spec
- 範圍：AIO `ChoosePayment=Credit`（測試環境，MerchantID 3002607）；保留既有模擬付款 `PATCH /api/orders/:id/pay`。
- 簽章：CheckMacValue SHA256，`ecpayUrlEncode` 依 ecpay skill guides/13（Node.js 版）；驗證使用 timing-safe 比較。
- 付款流程：
  1. 訂單詳情頁「前往綠界付款」→ `POST /api/orders/:id/ecpay/checkout`（需 JWT、僅 pending 且屬本人）→ 產生新的 `merchant_trade_no`（英數 ≤20，每次嘗試重新產生）並回傳 `{ action, fields }`。
  2. 前端動態 form POST 至綠界（不使用 iframe）。
  3. 綠界以 form POST 導回 `POST /api/payment/ecpay/result`（OrderResultURL，無 JWT）→ 驗 CheckMacValue → 主動 `QueryTradeInfo/V5` → 302 `/orders/:id?payment=success|failed|pending`。
  4. 使用者可按「查詢付款結果」→ `POST /api/orders/:id/ecpay/query`（需 JWT）補查。
- 狀態對應：`TradeStatus=1` 且 `TradeAmt === total_amount` → `paid`；`10200095` → `failed`；`0` → 維持 `pending`。以 `UPDATE ... WHERE status='pending'` 確保冪等；不信任導回 body 的 RtnCode。
- ReturnURL 為必填但本地收不到，填 `${BASE_URL}/api/payment/ecpay/notify` 作佔位，不實作處理。
- 資料表：`orders` 新增 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at`（啟動時以 `PRAGMA table_info` 檢查後 `ALTER TABLE`）。
- 錯誤情境：非 pending → 400 `INVALID_STATUS`；訂單不存在／非本人 → 404；未發起綠界付款就查詢 → 400 `VALIDATION_ERROR`；查詢綠界失敗／簽章不符 → 502。
- 測試帳號：卡號 `4311-9522-2222-2222`、3D 驗證碼 `1234`。

## Tasks
- [x] `src/services/ecpay.js`：CMV、組付款參數、`queryTradeInfo`、`syncOrderPayment`
- [x] `src/database.js`：orders 新增綠界欄位
- [x] `src/routes/orderRoutes.js`：`/ecpay/checkout`、`/ecpay/query`
- [x] `src/routes/paymentRoutes.js` 與 `app.js` 掛載 `/api/payment`
- [x] 前端：order-detail 新增「前往綠界付款」「查詢付款結果」按鈕與 `pending` 提示
- [x] 補測試 `tests/ecpay.test.js`，加入 `vitest.config.js` 的 `sequence.files`
- [x] 更新 docs/FEATURES.md、ARCHITECTURE.md、CHANGELOG.md
- [ ] 在可執行的環境重裝相依套件後跑 `npm test`
- [ ] 實際走一次綠界測試付款（驗證 `?payment=success`）
- [x] 更新 docs/DEVELOPMENT.md、docs/TESTING.md
- [x] 確認 `.env` 的 `BASE_URL`（http://localhost:3001）
