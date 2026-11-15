# TESTING

## 1. 技術與指令

- **Vitest 2** + **Supertest**：對 `app`（未 listen）直接發送 HTTP 請求的整合測試，涵蓋 API 層，沒有前端／單元測試。
- 指令：`npm test`（= `vitest run`，單次執行）。單一檔案：`npx vitest run tests/cart.test.js`。
- 設定檔 `vitest.config.js`：

| 設定 | 值 | 原因 |
|------|----|------|
| `globals` | `true` | 可直接用 `describe/it/expect/beforeAll`，不需 import |
| `fileParallelism` | `false` | 所有測試檔共用同一個 SQLite 檔，必須循序 |
| `sequence.files` | 見下表順序 | 後面的檔案假設前面已建立 seed 資料／帳號 |
| `hookTimeout` | `10000` | `beforeAll` 內做註冊／下單，bcrypt 較慢 |

- 前置條件：專案根目錄需有 `.env`（至少 `JWT_SECRET`），`app.js` 會 `dotenv.config()`。Vitest 自動設定 `NODE_ENV=test`。

## 2. 測試檔案

| 順序 | 檔案 | 涵蓋 | 依賴 |
|------|------|------|------|
| 1 | `tests/auth.test.js` | 註冊成功、重複 email 409、登入成功、錯誤密碼 401、profile 有／無 token | seed 管理員 `admin@hexschool.com/12345678` |
| 2 | `tests/products.test.js` | 列表、分頁 `page/limit`、詳情、不存在 404 | seed 商品（≥1 筆） |
| 3 | `tests/cart.test.js` | 訪客新增／查詢／改數量／刪除、會員新增、不存在商品 404 | seed 商品、`registerUser` |
| 4 | `tests/orders.test.js` | 建單、空車 400、未登入 401、列表、詳情、不存在 404 | seed 商品庫存足夠 |
| 5 | `tests/ecpay.test.js` | CMV 官方測試向量、ecpay checkout 簽章、非本人 404、mock 查詢（pending／paid）、OrderResultURL 導回與偽造簽章 | orders 測試之後；以 `vi.spyOn(ecpay, 'queryTradeInfo')` mock，不打真實綠界 |
| 6 | `tests/adminProducts.test.js` | admin 列表／新增／更新／刪除、一般使用者 403、無 token 401 | 管理員帳號 |
| 7 | `tests/adminOrders.test.js` | 後台列表、`status=pending` 篩選、詳情含 user、一般使用者 403 | 管理員帳號、商品庫存 |
| — | `tests/setup.js` | 輔助函式（非測試檔） | — |

> `sequence.files` 只列出上述 7 個檔案；新增測試檔必須加入該陣列，否則順序不受控。

**目前未覆蓋**：`PATCH /api/orders/:id/pay`、綠界 `TradeStatus=10200095`（failed）與金額不符路徑、真實綠界 API 連線、庫存不足情境、購物車累加超過庫存、admin 商品刪除遇 pending 訂單 409、`/api/admin/orders/:id` 404、頁面路由、errorHandler、前端程式碼。

## 3. 輔助函式（`tests/setup.js`）

```js
const { app, request, getAdminToken, registerUser } = require('./setup');
```

| 匯出 | 說明 |
|------|------|
| `app` | `require('../app')` 的 Express app，傳給 `request(app)`（Supertest 會臨時綁定埠） |
| `request` | `supertest` |
| `getAdminToken()` | 以 `admin@hexschool.com / 12345678` 登入，回傳 JWT 字串 |
| `registerUser(overrides)` | 註冊新使用者，回傳 `{ token, user }`。email 預設 `test-<timestamp>-<random>@example.com`，password 預設 `password123`，name 預設「測試使用者」；可用 `overrides.email/password/name` 覆蓋 |

## 4. 執行順序與依賴關係

- 測試檔之間**不隔離資料庫**：每次 `npm test` 都寫入專案根目錄的 `database.sqlite`（開發用同一份）。測試建立的使用者、訂單、扣掉的庫存都會**永久留下**。
- 檔案內的 `it` 彼此依賴（以閉包變數傳遞，如 `cartItemId`、`orderId`、`createdProductId`）。不要單獨用 `it.only` 跑中間的案例，會因變數為 undefined 而失敗。
- `orders.test.js` 與 `adminOrders.test.js` 每次各扣 1 件第一個商品（`products[0]`，排序為 `created_at DESC`）的庫存。長期重複執行，該商品庫存會歸零導致 STOCK_INSUFFICIENT／建單失敗。庫存耗盡時：刪除 `database.sqlite*` 重建，或用後台 API 補庫存。
- 測試資料以 `Date.now()`／隨機字串避免 email 衝突，所以可重複執行而不需清庫。

## 5. 撰寫新測試的步驟

1. 建立 `tests/<resource>.test.js`，開頭引入輔助函式。
2. 在 `vitest.config.js` 的 `sequence.files` 中加入新檔案（放在其依賴的檔案之後）。
3. 在 `beforeAll` 準備前置資料（登入、建立資料）。
4. 每個 `it` 驗證：狀態碼、`body` 的 `data/error/message` 三欄位、關鍵資料。
5. 錯誤情境至少驗證 `status`、`data === null`、`error` 非 null。

範例（測試模擬付款失敗路徑）：

```js
const { app, request, registerUser } = require('./setup');

describe('Orders pay API', () => {
  let token, orderId;

  beforeAll(async () => {
    ({ token } = await registerUser());
    const products = await request(app).get('/api/products');
    const productId = products.body.data.products[0].id;
    await request(app).post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: 1 });
    const order = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientName: 'A', recipientEmail: 'a@example.com', recipientAddress: 'Taipei' });
    orderId = order.body.data.id;
  });

  it('marks order as failed', async () => {
    const res = await request(app).patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'fail' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
  });

  it('rejects paying a non-pending order', async () => {
    const res = await request(app).patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'success' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_STATUS');
  });
});
```

## 6. 常見陷阱

1. **缺 `JWT_SECRET`**：`jwt.sign` 丟錯 → register/login 回 500，且 `registerUser()` 取 `res.body.data.token` 會 TypeError。確認 `.env` 存在。
2. **改了 seed 管理員帳密**：`getAdminToken()` 寫死預設帳密，會取不到 token。
3. **庫存耗盡**：見 §4。症狀是 `orders.test.js` 建單回 400。
4. **共用 DB 殘留資料**：測試期間若同時開著開發伺服器，兩者共用 `database.sqlite`（WAL 模式可同時讀寫但資料會混）。
5. **`it.only` / 單獨跑中間案例**：案例之間以變數傳遞狀態。
6. **購物車隔離**：訪客用 `X-Session-Id`，會員用 Bearer；帶 Bearer 時 session id 被忽略。測會員購物車不要期待看到訪客資料。
7. **非 2xx 的 `error` 欄位**：errorHandler 路徑永遠是 `INTERNAL_ERROR`，不要用它斷言特定錯誤碼。
8. **價格／庫存型別**：後台 POST／PUT 的 `price`、`stock` 必須是 number，測試送字串會得到 400。
9. **ECPay 測試不打真實綠界**：`queryTradeInfo` 以 `vi.spyOn(require('../src/services/ecpay'), 'queryTradeInfo')` mock；`syncOrderPayment` 與路由必須透過 `ecpay.` 物件呼叫才能被 spy 攔截（不要解構匯入）。偽造導回要用 `ecpay.generateCheckMacValue` 簽章。真實付款需手動在瀏覽器以測試卡 `4311-9522-2222-2222`、3D 驗證碼 `1234` 驗證。
10. **加密成本**：註冊使用 bcrypt rounds=10，大量 `registerUser()` 會讓測試變慢，必要時提高 `hookTimeout`。
