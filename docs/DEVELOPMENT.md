# DEVELOPMENT

## 1. 模組系統

- **後端一律 CommonJS**：`require(...)` / `module.exports = ...`。`package.json` 沒有 `"type": "module"`。
- 例外：`vitest.config.js` 使用 ESM `import { defineConfig }`（Vitest 會自行處理設定檔）。測試檔本身仍是 CommonJS（`const { app, request } = require('./setup')`），`describe/it/expect/beforeAll` 為 Vitest `globals: true` 注入的全域。
- 前端為**無打包的傳統 `<script>`**：不得使用 `import/export`；跨檔共用靠全域變數（`Auth`、`apiFetch`、`Notification`）。頁面腳本以 `const { createApp, ref } = Vue;` 取得 Vue。
- 資料庫連線是單例：`const db = require('../database')`，各模組共用同一個 `better-sqlite3` 實例。

## 2. 命名規則

| 對象 | 規則 | 範例 |
|------|------|------|
| 路由檔案 | `<資源>Routes.js`，camelCase；後台加 `admin` 前綴 | `cartRoutes.js`、`adminOrderRoutes.js` |
| Middleware 檔案 | `<用途>Middleware.js`（errorHandler 例外） | `authMiddleware.js` |
| 測試檔案 | `<資源>.test.js`，與路由資源對應 | `adminProducts.test.js` |
| 前端頁面腳本 | kebab-case，與 pageRoutes 的 `pageScript` 一致 | `product-detail.js`、`admin-orders.js` |
| EJS 頁面 | kebab-case；後台放 `pages/admin/` | `order-detail.ejs` |
| 資料庫表 / 欄位 | snake_case，表名複數 | `cart_items.product_id` |
| API JSON 回應欄位（資料表映射） | 沿用 snake_case | `order_no`、`total_amount`、`image_url` |
| API 請求 body 欄位 | camelCase（購物車與訂單）；後台商品沿用 snake_case `image_url` | `productId`、`recipientName`、`image_url` |
| JS 變數 / 函式 | camelCase | `getOwnerCondition` |
| 常數 | UPPER_SNAKE（localStorage key 在 `Auth` 物件內） | `TOKEN_KEY` |
| 主鍵 | `uuidv4()` 字串 | — |
| 錯誤碼 | UPPER_SNAKE | `STOCK_INSUFFICIENT` |
| 訂單編號 | `ORD-YYYYMMDD-XXXXX` | `ORD-20261114-A1B2C` |
| localStorage keys | `flower_` 前綴 | `flower_token`、`flower_user`、`flower_session_id` |

> 注意請求／回應欄位大小寫混用（camelCase 請求 vs snake_case 回應），這是現況；新增端點請依照所屬資源既有慣例，不要在同一資源內混用。

## 3. 環境變數

由 `dotenv` 在 `app.js` 第一行載入（`.env` 位於專案根目錄，不入版控；範本為 `.env.example`）。

| 變數 | 用途 | 必要性 | 預設值 |
|------|------|--------|--------|
| `JWT_SECRET` | JWT 簽章／驗證密鑰 | **必要**（`node server.js` 缺少會直接 exit 1；測試與簽發 token 也需要） | 無 |
| `PORT` | HTTP 監聽埠 | 選填 | `3001` |
| `FRONTEND_URL` | CORS 允許的 origin（單一字串） | 選填 | `http://localhost:3001`（注意 `.env.example` 寫的是 `http://localhost:5173`） |
| `BASE_URL` | 站台網址；綠界 `OrderResultURL`／`ReturnURL` 以此組成（`src/services/ecpay.js`） | 選填 | `http://localhost:3001` |
| `ADMIN_EMAIL` | seed 管理員 email | 選填 | `admin@hexschool.com` |
| `ADMIN_PASSWORD` | seed 管理員密碼 | 選填 | `12345678` |
| `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` / `ECPAY_ENV` | 綠界 AIO 金流參數（`src/services/ecpay.js` 讀取）；`ECPAY_ENV` 非 `production` 皆走 stage | 選填 | 公開測試帳號 3002607 / `pwFHCqoQZGmho4w6` / `EkRm7iFT261dpevs` / `staging` |
| `NODE_ENV` | `test` 時 seed 管理員的 bcrypt rounds=1 | 由 Vitest 自動設定 | 無 |

重點：
- `ADMIN_EMAIL/PASSWORD` 只在「該 email 尚不存在」時生效；改了環境變數但資料庫已有舊管理員不會更新。**測試的 `getAdminToken()` 寫死 `admin@hexschool.com / 12345678`**，若改了 seed 帳密，測試會失敗。
- 部署時務必改掉預設管理員密碼與 `JWT_SECRET`。

## 4. 新增 API 的步驟

1. **選擇／建立路由檔**：`src/routes/<resource>Routes.js`。新檔案需：
   ```js
   const express = require('express');
   const db = require('../database');
   const router = express.Router();
   // ...handlers
   module.exports = router;
   ```
2. **套用認證**：
   - 需登入：`router.use(authMiddleware)` 或逐路由 `router.get('/x', authMiddleware, handler)`。
   - 需 admin：`router.use(authMiddleware, adminMiddleware)`（順序不可顛倒）。
   - 購物車式雙模式：目前 `dualAuth` 定義在 `cartRoutes.js` 內，若別的路由要共用，請先抽到 `src/middleware/` 再引用。
3. **在 `app.js` 掛載**：`app.use('/api/<prefix>', require('./src/routes/<resource>Routes'));`，放在 404 handler 之前。
4. **回應必須遵守格式**：`res.json({ data, error: null, message })`；錯誤 `res.status(code).json({ data: null, error: 'CODE', message: '繁體中文訊息' })`。
5. **參數驗證**：Handler 內手動驗證（專案不使用驗證套件），先驗證輸入 → 再查資料 → 再寫入。多張表寫入使用 `db.transaction(() => {...})()`。
6. **SQL 一律使用 `?` 參數化**，不要把使用者輸入串進 SQL（`cartRoutes` 中串入的 `owner.field` 是程式內固定值，屬例外）。
7. **寫 `@openapi` JSDoc**（見 §7），並更新 `docs/FEATURES.md`。
8. **補測試**：`tests/<resource>.test.js`，並加入 `vitest.config.js` 的 `sequence.files`（見 TESTING.md）。
9. 若是頁面：在 `pageRoutes.js` 用 `renderFront`/`renderAdmin` 新增路由 → `views/pages/<name>.ejs` → `public/js/pages/<name>.js`。

### 綠界金流開發備忘
- 服務邏輯集中在 `src/services/ecpay.js`（CMV、組表單、`queryTradeInfo`、`syncOrderPayment`）；路由只做驗證與回應。
- 本地收不到 Server Notify：付款結果一律以主動 `QueryTradeInfo/V5` 為準，不信任導回 body 的 `RtnCode`。`ReturnURL` 僅為必填佔位。
- `MerchantTradeNo` 英數 ≤20，每次付款嘗試重新產生並寫入 `orders.merchant_trade_no`；`TimeStamp` 為 Unix 秒、3 分鐘有效。
- 新增 `orders` 欄位時沿用 `src/database.js` 內「`PRAGMA table_info` 檢查後 `ALTER TABLE`」的寫法。

## 5. 新增 Middleware 的步驟

1. 建立 `src/middleware/<name>Middleware.js`，匯出 `function (req, res, next)`；失敗時直接回應統一格式 JSON 並 `return`，成功呼叫 `next()`。
2. 若需要附加資訊，掛在 `req` 上並在本文件或 ARCHITECTURE.md 記錄（現有：`req.user = { userId, email, role }`、`req.sessionId`）。
3. 全域使用 → `app.js` 內 `app.use(...)`，**放在路由掛載之前**（目前順序：cors → json → urlencoded → sessionMiddleware → routes）。路由層使用 → 在 router 內 `use`。
4. Express 4 的 async middleware 不會自動捕捉 rejection，請 try/catch 後 `next(err)`。
5. 錯誤處理 middleware 必須維持四個參數簽名 `(err, req, res, next)` 並保持在 `app.js` 最後。

## 6. 資料庫變更步驟

沒有 migration 工具。修改 `src/database.js`：
1. 新表：在 `db.exec` 的 SQL 中加 `CREATE TABLE IF NOT EXISTS`，對既有資料庫會自動建立。
2. **修改／新增既有表的欄位**：`IF NOT EXISTS` 不會更新舊表。選擇其一：(a) 開發環境刪除 `database.sqlite`、`database.sqlite-wal`、`database.sqlite-shm` 重建（會遺失資料並重新 seed）；(b) 加一段啟動時的 `ALTER TABLE`（先用 `PRAGMA table_info(<table>)` 檢查欄位是否存在）。
3. 新增 seed 資料：寫成「條件式」（先判斷是否已存在，如 `seedAdminUser`/`seedProducts`），因為每次啟動都會執行。
4. 金額用 INTEGER（元），ID 用 `uuidv4()`，時間用 `datetime('now')`，並寫好 CHECK 約束。
5. 更新 `docs/ARCHITECTURE.md` 的 schema 章節。
6. 注意測試與開發共用 `database.sqlite`：改 schema 後先清庫再跑測試。

## 7. JSDoc / OpenAPI 格式

每個端點在 handler 上方以 `@openapi` 區塊描述；`swagger-config.js` 掃描 `./src/routes/*.js`。YAML 縮排用空白，每行以 ` *` 開頭。

```js
/**
 * @openapi
 * /api/orders/{id}/pay:
 *   patch:
 *     summary: 模擬付款
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []        # 訪客可用的端點加 sessionId: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [success, fail]
 *     responses:
 *       200:
 *         description: 付款結果
 *       400:
 *         description: 參數錯誤或訂單狀態不是 pending
 *       404:
 *         description: 訂單不存在
 */
router.patch('/:id/pay', (req, res) => { /* ... */ });
```
- 路徑參數寫成 `{id}`（不是 `:id`）。
- tags 現有：`Auth`、`Products`、`Cart`、`Orders`、`Admin Products`、`Admin Orders`。
- 產出：`npm run openapi` → `openapi.json`。

## 8. 前端開發規範

- 新頁面腳本結構：`const { createApp, ref, onMounted } = Vue; createApp({ setup() { ... return {...}; } }).mount('#app');`，`#app` 在 EJS 內；需要伺服器值就用 `data-*` 屬性（參考 `order-detail.ejs`）。
- 需登入的頁面在 `setup()` 開頭 `if (!Auth.requireAuth()) return {};`。
- 呼叫 API 一律用 `apiFetch`（自動帶 Authorization / X-Session-Id；非 2xx 會 `throw { status, data }`；401 會自動登出並導向登入頁）。
- 使用者回饋用 `Notification.show(msg, type)`。
- 新增樣式：用 Tailwind utility class 與 `input.css` 的 `@theme` 色票；改完執行 `npm run css:build`。`output.css` 被 gitignore，部署／新環境需先建置。

## 9. 程式風格

- 縮排 2 空格、單引號、分號；字串訊息為繁體中文。
- 錯誤回應的 `message` 給使用者看，`error` 給程式判斷；新增錯誤碼請同步更新 ARCHITECTURE.md 的錯誤碼表。
- 不洩漏內部細節：未預期錯誤交給 errorHandler。

## 計畫歸檔流程

1. 計畫檔案命名格式：YYYY-MM-DD-<feature-name>.md
2. 計畫文件結構：User Story → Spec → Tasks
3. 功能完成後：移至 docs/plans/archive/
4. 更新 docs/FEATURES.md 和 docs/CHANGELOG.md

計畫範本：

```markdown
# <Feature Name>

## User Story
身為 <角色>，我想要 <功能>，以便 <價值>。

## Spec
- 行為描述、API 端點／請求／回應、資料表變更、錯誤情境、非功能需求

## Tasks
- [ ] 任務 1
- [ ] 任務 2
- [ ] 補測試
- [ ] 更新 docs/FEATURES.md、docs/CHANGELOG.md
```

進行中的計畫放 `docs/plans/`，完成後 `git mv` 到 `docs/plans/archive/`。
