# ARCHITECTURE

花漾生活 Flower Life — 花卉電商示範網站。Express 4 + better-sqlite3 後端，EJS 版型 + Vue 3（CDN）+ Tailwind CSS 4 前端，單一 Node 程序同時提供 REST API 與伺服器端渲染頁面。

## 1. 目錄結構

```
.
├── server.js                  # 進入點：檢查 JWT_SECRET、listen PORT（預設 3001）；僅在 require.main === module 時啟動，測試可直接 require
├── app.js                     # Express app 組裝：dotenv、view engine、靜態檔、全域 middleware、路由掛載、404、errorHandler；module.exports = app
├── generate-openapi.js        # 以 swagger-jsdoc 掃描 src/routes/*.js 的 @openapi 註解，輸出 openapi.json 到專案根目錄（`.gitignore` 未排除，執行後會出現在 git status）
├── swagger-config.js          # OpenAPI 3.0.3 定義：info、servers、securitySchemes（bearerAuth / sessionId）、apis 掃描路徑
├── vitest.config.js           # Vitest 設定：globals、fileParallelism=false、固定測試檔順序、hookTimeout 10s
├── package.json               # scripts 與相依套件
├── .env / .env.example        # 環境變數（.env 不入版控）
├── database.sqlite(+ -wal/-shm) # SQLite 資料庫檔，啟動時自動建立，位於專案根目錄（已 gitignore）
├── src/
│   ├── database.js            # 開啟 SQLite、PRAGMA、建表、seed 管理員與 8 筆商品；export 單一 db 實例
│   ├── middleware/
│   │   ├── authMiddleware.js      # 驗證 Bearer JWT + 確認使用者仍存在於 DB，設定 req.user
│   │   ├── adminMiddleware.js     # 檢查 req.user.role === 'admin'，否則 403
│   │   ├── sessionMiddleware.js   # 讀取 X-Session-Id header 存入 req.sessionId（全域套用）
│   │   └── errorHandler.js        # 全域錯誤處理，統一回應格式、隱藏 500 細節
│   └── routes/
│       ├── authRoutes.js          # /api/auth：register / login / profile
│       ├── productRoutes.js       # /api/products：公開商品列表與詳情
│       ├── cartRoutes.js          # /api/cart：購物車（內含 dualAuth 雙模式認證）
│       ├── orderRoutes.js         # /api/orders：建立訂單、列表、詳情、模擬付款（整支 router 需登入）
│       ├── adminProductRoutes.js  # /api/admin/products：商品 CRUD（需 admin）
│       ├── adminOrderRoutes.js    # /api/admin/orders：訂單列表（可篩選狀態）與詳情（需 admin）
│       └── pageRoutes.js          # 伺服器端渲染頁面（前台 + 後台）
├── views/                     # EJS 模板
│   ├── layouts/front.ejs      # 前台版型：head + header + <main> + footer + toast + 共用 JS + pageScript
│   ├── layouts/admin.ejs      # 後台版型：admin-header + sidebar + main；載入後執行 Auth.requireAdmin()
│   ├── partials/              # head（字型、output.css）、header、admin-header、admin-sidebar、footer、notification（toast 容器）
│   └── pages/                 # index、product-detail、cart、checkout、login、orders、order-detail、404；admin/products、admin/orders
├── public/                    # 靜態資源（express.static）
│   ├── css/input.css          # Tailwind 入口 + @theme 自訂色票（rose-primary、sage、cream…）
│   ├── css/output.css         # Tailwind 建置輸出（gitignore，需 `npm run css:build` 產生）
│   ├── stylesheets/style.css  # express-generator 殘留樣式，目前沒有任何 view 引用
│   └── js/
│       ├── auth.js            # 全域 `Auth`：localStorage 的 token/user/session id 管理、requireAuth/requireAdmin
│       ├── api.js             # 全域 `apiFetch`：自動帶 Authorization 與 X-Session-Id；401 時清除登入並導向 /login
│       ├── notification.js    # 全域 `Notification.show(msg, type)` toast（注意：覆蓋瀏覽器內建 Notification）
│       ├── header-init.js     # 前台 header：依登入狀態渲染 auth-nav、顯示「我的訂單」、載入購物車徽章
│       └── pages/*.js         # 每頁一支 Vue 3 `createApp(...).mount('#app')`，檔名 = pageRoutes 的 pageScript
├── tests/                     # Vitest + Supertest 整合測試（見 TESTING.md）
└── docs/                      # 專案文件
```

## 2. 啟動流程

1. `node server.js`（或 `npm start`，會先 `css:build`）。
2. `server.js` `require('./app')`。
3. `app.js` 第一行 `require('dotenv').config()` 載入 `.env`。
4. `require('./src/database')`：開啟 `database.sqlite` → `journal_mode = WAL`、`foreign_keys = ON` → `CREATE TABLE IF NOT EXISTS` 五張表 → `seedAdminUser()`（email 不存在才建立）→ `seedProducts()`（products 表為空才寫入 8 筆，用 transaction）。**database 在 require 時就初始化，任何 require 到 `src/database` 的模組（含 middleware）都會觸發。**
5. 設定 view engine 為 ejs、靜態檔、CORS（`origin: FRONTEND_URL || 'http://localhost:3001'`）、`express.json()`、`express.urlencoded`、`sessionMiddleware`。
6. 掛載路由（順序見下表）、404 handler、`errorHandler`。
7. 回到 `server.js`：若 `require.main === module`，檢查 `JWT_SECRET`（沒設定 → `process.exit(1)`），然後 `app.listen(PORT || 3001)`。

> **關鍵**：`JWT_SECRET` 的檢查只在 `server.js` 直接執行時進行。測試（直接 require app）不會檢查，但 `jwt.sign` 沒有 secret 會丟錯，所以跑測試也必須有 `.env`（或環境變數）提供 `JWT_SECRET`。

## 3. 路由總覽

掛載順序（`app.js`）：`/api/auth` → `/api/admin/products` → `/api/admin/orders` → `/api/products` → `/api/cart` → `/api/orders` → `/`（pageRoutes）→ 404 → errorHandler。

| 前綴 | 檔案 | 認證 | 說明 |
|------|------|------|------|
| `/api/auth` | authRoutes.js | `/profile` 需 Bearer JWT；`register`/`login` 公開 | 註冊、登入、取得個人資料 |
| `/api/products` | productRoutes.js | 無 | 公開商品列表（分頁）、單一商品 |
| `/api/cart` | cartRoutes.js | **dualAuth**：Bearer JWT 或 `X-Session-Id` | 購物車 CRUD，訪客可用 |
| `/api/orders` | orderRoutes.js | `router.use(authMiddleware)`，全部需 JWT | 建立訂單、我的訂單、訂單詳情、模擬付款 |
| `/api/admin/products` | adminProductRoutes.js | `authMiddleware` + `adminMiddleware` | 後台商品列表／新增／編輯／刪除 |
| `/api/admin/orders` | adminOrderRoutes.js | `authMiddleware` + `adminMiddleware` | 後台訂單列表（status 篩選）／詳情 |
| `/` | pageRoutes.js | 無（頁面本身公開，權限由前端 JS 檢查） | EJS 頁面渲染 |

頁面路由：`/`、`/products/:id`、`/cart`、`/checkout`、`/login`、`/orders`、`/orders/:id`、`/admin/products`、`/admin/orders`。

> **admin 路由必須先於 `/api/products` 掛載嗎？** 前綴不同（`/api/admin/...` vs `/api/products`），不會互相攔截；但新增路由時請維持「較具體前綴在前」的習慣。

## 4. 統一回應格式

所有 API（含 404、403、500）都回傳相同三欄位：

```json
// 成功
{ "data": { ... }, "error": null, "message": "成功" }

// 失敗
{ "data": null, "error": "VALIDATION_ERROR", "message": "email、password、name 為必填欄位" }
```

`error` 為機器可讀的錯誤碼字串，`message` 為繁體中文給人看的訊息。目前使用到的錯誤碼：

| error | HTTP | 出現情境 |
|-------|------|----------|
| `VALIDATION_ERROR` | 400 | 欄位缺漏或格式不符 |
| `UNAUTHORIZED` | 401 | 缺少／無效／過期 token、使用者不存在、帳密錯誤、缺少 session |
| `FORBIDDEN` | 403 | 非 admin 存取後台 |
| `NOT_FOUND` | 404 | 資源不存在；未知 `/api/*` 路徑 |
| `CONFLICT` | 409 | Email 已註冊、商品有未完成訂單無法刪除 |
| `STOCK_INSUFFICIENT` | 400 | 庫存不足（購物車新增／修改、建立訂單） |
| `CART_EMPTY` | 400 | 建立訂單時購物車為空 |
| `INVALID_STATUS` | 400 | 訂單不是 pending 卻要付款 |
| `INTERNAL_ERROR` | 依 `err.status`，預設 500 | errorHandler 兜底（**不論狀態碼，error 欄位一律是 `INTERNAL_ERROR`**） |

### errorHandler 行為（`src/middleware/errorHandler.js`）
- 狀態碼 = `err.status || err.statusCode || 500`。
- 500 → message 固定「伺服器內部錯誤」，不洩漏細節；其他狀態碼 → 若 `err.isOperational` 用 `err.message`，否則查 `SAFE_MESSAGES` 表（400/401/403/404/409/422/429），查不到則「請求處理失敗」。
- 例如 body-parser 遇到壞 JSON 會丟 `status: 400` 的錯誤，最後回 `{ error: 'INTERNAL_ERROR', message: '請求格式錯誤' }`。
- 所有 route handler 都是同步（better-sqlite3 同步 API），丟出的例外由 Express 自動送進 errorHandler；**新增 async handler 時需自行 try/catch 或呼叫 `next(err)`**（Express 4 不會捕捉 rejected promise）。

### 404
- 路徑以 `/api` 開頭 → JSON `NOT_FOUND`「找不到該路徑」。
- 其他 → 以 `pages/404` + `layouts/front` 渲染 HTML（HTTP 404）。

## 5. 認證與授權機制

系統有**兩套身分**：登入使用者（JWT）與訪客（Session ID，僅限購物車）。

### JWT
| 項目 | 值 |
|------|----|
| 演算法 | HS256（驗證時明確指定 `algorithms: ['HS256']`） |
| Secret | `process.env.JWT_SECRET` |
| 有效期 | `7d`（register 與 login 都是） |
| Payload | `{ userId, email, role, iat, exp }` |
| 傳遞方式 | `Authorization: Bearer <token>` |
| 前端儲存 | `localStorage['flower_token']`、`['flower_user']`（JSON：id/email/name/role） |

### authMiddleware（`src/middleware/authMiddleware.js`）
1. 沒有 `Authorization: Bearer ...` → 401 `請先登入`。
2. `jwt.verify` 失敗（簽章錯、過期）→ 401 `Token 無效或已過期`。
3. **再查一次 DB** `SELECT id FROM users WHERE id = decoded.userId`；不存在 → 401 `使用者不存在，請重新登入`（避免已刪除使用者的 token 仍可用）。
4. 設定 `req.user = { userId, email, role }`（**role 來自 token，不是 DB**；變更使用者角色後舊 token 仍帶舊角色直到過期）。

### adminMiddleware
必須接在 authMiddleware 之後；`req.user.role !== 'admin'` → 403 `FORBIDDEN 權限不足`。後台路由用 `router.use(authMiddleware, adminMiddleware)` 整個 router 保護。

### 訪客 Session（sessionMiddleware）
- 全域 middleware，若請求帶 `X-Session-Id` header 就設 `req.sessionId`，**不驗證格式、不查 DB、不簽章**。
- 前端 `Auth.getSessionId()` 在 localStorage（`flower_session_id`）產生並保存 `crypto.randomUUID()`；`apiFetch` 對**每個請求**都帶 `X-Session-Id`（登入後也帶）。

### cart 的 dualAuth（`cartRoutes.js` 內部函式，未抽成共用 middleware）
1. 有 `Authorization: Bearer` header → 走 JWT 驗證（含 DB 檢查）。**token 無效不會 fallback 到 session，直接 401**。成功則 `req.user` 有值。
2. 沒有 Bearer header 但有 `req.sessionId` → 放行（訪客）。
3. 兩者皆無 → 401 `請提供有效的登入 Token 或 X-Session-Id`。
4. `getOwnerCondition(req)`：`req.user` 存在 → `{ field: 'user_id', value: userId }`，否則 `{ field: 'session_id', value: sessionId }`。之後所有 SQL 以 `` `WHERE ${owner.field} = ?` `` 組字串（欄位名來自程式內固定值，非使用者輸入，安全）。

> **重要知識點（影響整合）**：
> - 登入使用者的購物車只看 `user_id`，訪客購物車只看 `session_id`，**登入時沒有合併購物車**。訪客加入的商品在登入後不會出現（仍留在 DB 的 session_id 列）。
> - 建立訂單只讀取 `cart_items.user_id = 目前使用者`，所以訪客車內商品無法直接結帳。
> - 前端 `apiFetch` 收到任何 401 都會清掉 localStorage 登入資訊並跳轉 `/login`——因此 cart API 的 401（例如 token 過期）會讓使用者被導回登入頁。

### 前端權限（僅 UX，不是安全邊界）
- `Auth.requireAuth()`：未登入 → 導向 `/login?redirect=<目前路徑>`（checkout、orders、order-detail 頁在 `setup()` 開頭呼叫）。
- `Auth.requireAdmin()`：未登入或 `user.role !== 'admin'` → 導向 `/login`（admin layout 在 DOMContentLoaded 呼叫）。`/admin/*` 頁面本身 HTTP 公開，真正保護來自 API 的 admin middleware。

## 6. 資料庫 Schema

SQLite（`better-sqlite3`，同步 API），檔案 `database.sqlite`。`PRAGMA journal_mode = WAL`、`PRAGMA foreign_keys = ON`。所有主鍵為 `uuid v4` 字串。時間欄位為 `datetime('now')` 的 UTC 字串（`YYYY-MM-DD HH:MM:SS`，**無時區標記**）。

### users
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| email | TEXT | UNIQUE NOT NULL |
| password_hash | TEXT | NOT NULL（bcrypt） |
| name | TEXT | NOT NULL |
| role | TEXT | NOT NULL DEFAULT 'user'，CHECK IN ('user','admin') |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |

### products
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| name | TEXT | NOT NULL |
| description | TEXT | 可 NULL |
| price | INTEGER | NOT NULL，CHECK(price > 0)（單位：新台幣元，整數） |
| stock | INTEGER | NOT NULL DEFAULT 0，CHECK(stock >= 0) |
| image_url | TEXT | 可 NULL |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |
| updated_at | TEXT | NOT NULL DEFAULT datetime('now')（後台 PUT 時手動更新） |

### cart_items
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| session_id | TEXT | 可 NULL（訪客購物車） |
| user_id | TEXT | 可 NULL，FK → users(id)（登入使用者購物車） |
| product_id | TEXT | NOT NULL，FK → products(id) |
| quantity | INTEGER | NOT NULL DEFAULT 1，CHECK(quantity > 0) |

`session_id` 與 `user_id` 互斥由程式保證（資料庫無 CHECK）。**沒有 UNIQUE(product_id, owner) 約束**，「同商品只有一列」靠 POST /api/cart 先查詢再 UPDATE 維持。

### orders
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| order_no | TEXT | UNIQUE NOT NULL，格式 `ORD-YYYYMMDD-XXXXX`（日期為 UTC；XXXXX = uuid 前 5 字元大寫） |
| user_id | TEXT | NOT NULL，FK → users(id) |
| recipient_name | TEXT | NOT NULL |
| recipient_email | TEXT | NOT NULL |
| recipient_address | TEXT | NOT NULL |
| total_amount | INTEGER | NOT NULL（建立時以當下價格計算並固定） |
| status | TEXT | NOT NULL DEFAULT 'pending'，CHECK IN ('pending','paid','failed') |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |
| merchant_trade_no / ecpay_trade_no / payment_type / paid_at | TEXT | 可 NULL，綠界付款欄位（啟動時以 ALTER TABLE 補上） |

### order_items
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| order_id | TEXT | NOT NULL，FK → orders(id) |
| product_id | TEXT | NOT NULL（**無 FK**，商品被刪除後訂單明細仍保留） |
| product_name | TEXT | NOT NULL（下單當下的**快照**） |
| product_price | INTEGER | NOT NULL（下單當下的**快照**） |
| quantity | INTEGER | NOT NULL |

### 資料庫關鍵事項
- `CREATE TABLE IF NOT EXISTS`：**沒有 migration 機制**。修改既有表結構需手動處理或刪除 `database.sqlite*` 重建。
- Seed 管理員：`ADMIN_EMAIL` / `ADMIN_PASSWORD`（預設 `admin@hexschool.com` / `12345678`），僅在該 email 不存在時建立；`NODE_ENV === 'test'` 時 bcrypt saltRounds=1（加速測試），否則 10。
- Seed 商品：8 筆花卉商品（粉色玫瑰花束 1680、白色百合花禮盒 1280、繽紛向日葵花束 980、紫色鬱金香盆栽 750、乾燥花藝術花圈 1450、迷你多肉組合盆 580、經典紅玫瑰花束 3980、季節鮮花訂閱 890），僅在 products 表為空時寫入。
- 商品列表以 `created_at DESC` 排序；seed 商品 `created_at` 相同（同一秒），順序不保證穩定。
- 資料庫是**單一檔案、測試與開發共用**（`tests/` 未使用獨立 DB），見 TESTING.md。

## 7. 資料流

### 7.1 頁面渲染
```
瀏覽器 GET /orders/:id
  → pageRoutes.renderFront(res, 'order-detail', { title, pageScript, orderId, paymentResult })
  → res.render('pages/order-detail') 取得 body 字串
  → res.render('layouts/front', { body, ...locals }) 組版回傳 HTML
  → 瀏覽器載入 Vue(unpkg) → auth.js → api.js → notification.js → header-init.js → /js/pages/<pageScript>.js
  → 頁面 JS 用 apiFetch 呼叫 /api/*，Vue 渲染資料
```
- 頁面本身不含資料，**所有資料由前端呼叫 API 取得**。伺服器只把 `productId` / `orderId` / `paymentResult` 以 `data-*` 屬性傳給 `#app`。
- `renderFront`/`renderAdmin` 用「兩段渲染」：先渲染 page 取得 `body`，再塞進 layout；渲染失敗回 500 純文字。
- `pageScript` 對應 `public/js/pages/<pageScript>.js`；layout 以 `<%= pageScript %>` 組路徑。

### 7.2 購物 → 結帳 → 付款
```
商品頁 POST /api/cart {productId, quantity}   (訪客: X-Session-Id；已登入: Bearer)
        │  → 同商品已存在則累加；檢查「累加後」≤ 庫存
        ▼
購物車頁 PATCH /api/cart/:itemId {quantity}  → 直接設定數量（非累加），檢查 ≤ 庫存
        ▼
結帳頁（需登入）POST /api/orders {recipientName, recipientEmail, recipientAddress}
        │  讀 cart_items(user_id) JOIN products
        │  驗證：購物車非空 → 每項 quantity ≤ 當前庫存 → 計算 total
        │  db.transaction:
        │     INSERT orders (status='pending')
        │     FOR EACH item: INSERT order_items(名稱/價格快照) + UPDATE products SET stock = stock - qty
        │     DELETE FROM cart_items WHERE user_id = ?
        ▼
訂單詳情頁 PATCH /api/orders/:id/pay {action: 'success'|'fail'}
           pending → paid / failed（模擬付款，無金流）
```

### 7.3 金流整合現況（重要）
- `.env.example` 內有 `ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV / ECPAY_ENV`（綠界 ECPay 測試參數），`order-detail` 頁也預留 `?payment=success|failed|cancel` 查詢參數與對應提示訊息。
- **但目前程式碼完全沒有串接綠界**：沒有 CheckMacValue 計算、沒有送出表單、沒有 callback／notify 路由；這些環境變數沒有任何程式讀取。
- 實際付款是**模擬**：訂單詳情頁在 `pending` 時顯示「模擬付款成功／失敗」按鈕，呼叫 `PATCH /api/orders/:id/pay`，由使用者自己決定結果。任何登入使用者都能把自己的訂單標為 paid（無金額校驗、無第三方驗證）。
- 若日後接入真實金流：必須新增伺服器端 callback 路由驗證簽章，並移除或限制 `/pay` 的 `success` 動作，否則可被任意呼叫繞過付款。
- 訂單 `failed` 後**不會回補庫存**，也沒有重新付款機制（`/pay` 只接受 `pending`）。

### 7.3.1 綠界 AIO 串接（信用卡，已實作）
訂單詳情頁「前往綠界付款」→ `POST /api/orders/:id/ecpay/checkout`（產生新的 `merchant_trade_no`、簽 CheckMacValue）→ 前端動態 form POST 到綠界 → 付款後綠界以 form POST 導回 `/api/payment/ecpay/result`（OrderResultURL，無 JWT）→ 驗 CheckMacValue → **主動 `QueryTradeInfo/V5`**（`TradeStatus` 1=paid、10200095=failed、0=仍 pending，並核對金額）→ 302 `/orders/:id?payment=...`。使用者也可按「查詢付款結果」（`/ecpay/query`）。ReturnURL（`/api/payment/ecpay/notify`）本地收不到、未實作。服務邏輯在 `src/services/ecpay.js`。模擬付款 `/pay` 仍保留。測試帳號：卡號 `4311-9522-2222-2222`、3D 驗證碼 `1234`。

### 7.4 API 文件
各 route 檔案頂部以 `@openapi` JSDoc 描述端點；`npm run openapi` 產生 `openapi.json`。專案**未掛載 Swagger UI**，僅產出檔案。

## 8. 前端架構重點

- **無打包工具**：Vue 3 由 `https://unpkg.com/vue@3/dist/vue.global.prod.js` 載入（需網路），頁面腳本是普通 `<script>`，全域變數 `Auth`、`apiFetch`、`Notification` 共用。
- **`Notification` 覆蓋瀏覽器原生 `window.Notification`**（`const Notification = {...}`，頂層 script 作用域）。不要在此專案使用 Web Notifications API。
- **載入順序有依賴**：Vue → auth.js → api.js（用到 `Auth`）→ notification.js → header-init.js（前台）→ 頁面腳本。調整時請保持順序。
- 每個頁面 `createApp(...).mount('#app')`。EJS 使用 `<% %>` / `<%= %>`，`{{ }}` 留給 Vue，兩者不衝突。
- 購物車徽章數字 = 購物車**品項數**（`items.length`），不是總數量；首頁/商品頁加入購物車成功後徽章前端 +1（即使是累加既有品項，數字也會 +1，與實際品項數可能不一致，重新整理後才校正）。
- 色票定義在 `public/css/input.css` 的 `@theme`（`rose-primary #C4727F`、`rose-dark`、`rose-light`、`apricot`、`sage`、`cream`、`blush`、`rose-bg`、`text-primary/secondary/muted`）。新增 Tailwind class 後需重新 `npm run css:build`（或跑 `dev:css` watch）。
- 後台頁面（`/admin/*`）的 API 失敗訊息多為固定字串（如「儲存失敗」），不顯示伺服器回傳 message。
