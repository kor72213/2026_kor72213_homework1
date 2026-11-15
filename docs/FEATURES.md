# FEATURES

功能清單與行為描述。狀態圖例：✅ 已完成　⚠️ 已完成但有限制（見說明）　❌ 未實作（僅預留）。

所有 API 回應格式皆為 `{ data, error, message }`（見 ARCHITECTURE.md §4）。

## 功能總覽

| 區塊 | 功能 | 狀態 |
|------|------|------|
| 認證 | 註冊 / 登入 / 取得個人資料（JWT 7 天） | ✅ |
| 認證 | 登出（純前端清除 localStorage） | ⚠️ 無伺服器端撤銷 |
| 商品 | 公開商品列表（分頁）、商品詳情 | ✅ |
| 購物車 | 訪客（Session）/ 會員（JWT）雙模式購物車 | ✅ |
| 購物車 | 登入後合併訪客購物車 | ❌ |
| 訂單 | 由購物車建立訂單（transaction 扣庫存） | ✅ |
| 訂單 | 我的訂單列表 / 詳情 | ✅ |
| 付款 | 模擬付款（success / fail） | ⚠️ 非真實金流 |
| 付款 | 綠界 ECPay AIO 信用卡（測試環境，主動查詢驗證） | ⚠️ 無 Server Notify；ReturnURL 僅為必填佔位 |
| 後台 | 商品管理 CRUD | ✅ |
| 後台 | 訂單列表（狀態篩選）/ 詳情 | ✅（唯讀，無法修改狀態） |
| 前端 | 前台 7 頁 + 後台 2 頁 + 404 | ✅ |
| 文件 | OpenAPI 產生（`npm run openapi`） | ⚠️ 無 Swagger UI |

---

## 1. 認證（`/api/auth`）

### POST `/api/auth/register`（公開）
**請求 body**（JSON，皆必填）：`email`、`password`、`name`。

**行為與驗證（依序檢查）**
1. 任一欄位為空（falsy）→ 400 `VALIDATION_ERROR`「email、password、name 為必填欄位」。
2. Email 不符合 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → 400「Email 格式不正確」。
3. `password.length < 6` → 400「密碼至少需要 6 個字元」。
4. Email 已存在（**區分大小寫的精確比對**，`A@x.com` 與 `a@x.com` 視為不同帳號）→ 409 `CONFLICT`「Email 已被註冊」。
5. 建立使用者：bcrypt `hashSync(password, 10)`，**role 固定為 `user`**（無法透過 API 註冊 admin，也忽略 body 內的 role）。
6. 回傳 **201**：`data = { user: { id, email, name, role }, token }`，訊息「註冊成功」。註冊後直接視為登入。

### POST `/api/auth/login`（公開）
**請求 body**：`email`、`password`（必填）。缺任一 → 400。
- Email 不存在或密碼錯誤 → 同一個 401 `UNAUTHORIZED`「Email 或密碼錯誤」（不區分，避免帳號枚舉）。
- 成功 → 200，回傳 `{ user, token }`，token 有效 7 天，訊息「登入成功」。

### GET `/api/auth/profile`（需 Bearer JWT）
回傳 `data = { id, email, name, role, created_at }`。token 有效但使用者已不存在 → authMiddleware 先擋下回 401。

### 前端登入頁（`/login`，`login.js`）
- 單頁兩個分頁（登入 / 註冊），各自做前端驗證（必填、密碼 ≥ 6）。
- 成功後 `Auth.login(token, user)` 寫入 localStorage，導向 `?redirect=` 指定路徑，沒有則 `/`。**`redirect` 參數未做站內路徑檢查**（開放重新導向風險，需要時請限制為以 `/` 開頭且非 `//`）。
- 登出：`Auth.logout()` 清除 `flower_token`、`flower_user` 並回首頁；**不清除 `flower_session_id`**，訪客購物車仍保留。

---

## 2. 商品（公開）

### GET `/api/products`
| 參數 | 預設 | 規則 |
|------|------|------|
| `page` | 1 | `Math.max(1, parseInt(page) \|\| 1)`；非數字 → 1 |
| `limit` | 10 | `Math.max(1, Math.min(100, parseInt(limit) \|\| 10))`；上限 100；**`limit=0` 會因 `\|\| 10` 變成 10** |

排序 `created_at DESC`。回傳 `data = { products: [...全部欄位...], pagination: { total, page, limit, totalPages } }`。`page` 超過範圍時回空陣列（不會 404）。首頁前端固定使用 `limit=9`。

### GET `/api/products/:id`
回傳單一商品全部欄位；不存在 → 404 `NOT_FOUND`「商品不存在」。

### 前端
- 首頁 `/`：商品卡片網格（每頁 9 筆）、分頁、「加入購物車」（數量固定 1）、點卡片進詳情。含靜態 hero 區塊與 4 張精選圖。
- 商品詳情 `/products/:id`：數量選擇（1 ~ stock）、加入購物車；商品不存在顯示 notFound 狀態。
- 加入購物車失敗（含庫存不足）一律顯示通用訊息「加入購物車失敗」，**不會顯示伺服器的 STOCK_INSUFFICIENT 訊息**。

---

## 3. 購物車（`/api/cart`，雙模式認證）

### 雙模式認證流程
每個購物車端點都經過 `dualAuth`：
1. 若有 `Authorization: Bearer ...` → 以 JWT 為準（驗簽、查使用者）。**Token 無效 → 直接 401，不會退回使用 Session**。
2. 否則若有 `X-Session-Id` → 以訪客身分放行。
3. 都沒有 → 401「請提供有效的登入 Token 或 X-Session-Id」。

資料歸屬：登入 → `cart_items.user_id`；訪客 → `cart_items.session_id`。兩邊完全隔離。
**⚠️ 限制**：沒有「登入後合併訪客購物車」功能；訪客加入的商品登入後看不到，也無法拿去結帳。前端每個請求都同時帶 token 與 session id，但伺服器在有 token 時只看 token。

### GET `/api/cart`
回傳 `data = { items: [{ id, product_id, quantity, product: { name, price, stock, image_url } }], total }`；`total = Σ price × quantity`（以**目前**商品價格計算）。空車回 `items: []`、`total: 0`。

### POST `/api/cart`
**body**：`productId`（必填）、`quantity`（選填，預設 1）。
1. `productId` 缺 → 400「productId 為必填欄位」。
2. `quantity` 經 `parseInt`；不是 ≥ 1 的整數 → 400「quantity 必須為正整數」（`"2"`、`2.7` 會被轉成 2／2；`"abc"`、`0`、負數被拒）。
3. 商品不存在 → 404「商品不存在」。
4. **累加邏輯**：同一擁有者購物車已有該商品 → `newQty = 既有數量 + qty`；若 `newQty > stock` → 400 `STOCK_INSUFFICIENT`「庫存不足」（購物車不變）；否則 UPDATE。沒有 → 若 `qty > stock` 400，否則 INSERT。
5. 成功一律回 **200**（包含新增，非 201）：`data = { id, product_id, quantity }`（quantity 為累加後的總量），訊息「已加入購物車」。

### PATCH `/api/cart/:itemId`
**body**：`quantity`（必填）。這是**設定**數量，不是累加。
- `quantity` 非 ≥ 1 整數（含缺漏→NaN）→ 400。
- 項目不存在**或不屬於目前擁有者** → 404「購物車項目不存在」（不洩漏他人項目是否存在）。
- `qty > 商品目前庫存` → 400 `STOCK_INSUFFICIENT`。
- 成功 → `data = { id, product_id, quantity }`，訊息「數量已更新」。

### DELETE `/api/cart/:itemId`
擁有者驗證同上；不存在 → 404；成功 → `data: null`，「已從購物車移除」。

### 前端購物車頁 `/cart`
載入購物車 → 數量 +/− 即時 PATCH（`qty < 1` 不送出，只在 PATCH 成功後更新畫面）→ 刪除前跳確認視窗 → 「前往結帳」：未登入導向 `/login?redirect=/checkout`。Header 徽章 = 品項數。

---

## 4. 訂單（`/api/orders`，全部需 Bearer JWT）

### POST `/api/orders`（建立訂單）
**body（皆必填）**：`recipientName`、`recipientEmail`、`recipientAddress`。

**驗證與流程**
1. 欄位缺漏 → 400 `VALIDATION_ERROR`「收件人姓名、Email 和地址為必填欄位」。
2. `recipientEmail` 格式不符 → 400「Email 格式不正確」。
3. 讀取 `cart_items WHERE user_id = 目前使用者` JOIN products。空 → 400 `CART_EMPTY`「購物車為空」。
4. 任一品項 `quantity > 商品庫存` → 400 `STOCK_INSUFFICIENT`，message 列出不足的商品名稱：「以下商品庫存不足：A, B」。
5. `total_amount = Σ product_price × quantity`（下單當下價格）。
6. **單一 `db.transaction`（原子操作）**：
   - INSERT `orders`（`status='pending'`，`order_no = ORD-YYYYMMDD-XXXXX`）
   - 每個品項：INSERT `order_items`（**快照** product_name / product_price）＋ `UPDATE products SET stock = stock - ?`
   - `DELETE FROM cart_items WHERE user_id = ?`
   任一步失敗整筆 rollback；`products.stock` 的 `CHECK(stock >= 0)` 是最後防線（並發超賣時 transaction 會丟錯 → 500）。
7. 回 **201**：`data = { id, order_no, total_amount, status:'pending', items:[{product_name, product_price, quantity}], created_at }`。

**注意**
- **下單即扣庫存**（付款前）。訂單變 `failed` 不會回補庫存，也沒有取消訂單功能。
- 庫存檢查在 transaction 之外，transaction 內以 `stock - ?` 相對扣減；better-sqlite3 為同步單執行緒，單一 Node 程序內不會交錯，但多程序部署需重新考慮。
- `order_no` 的 5 碼隨機尾碼理論上可能碰撞（`UNIQUE` 約束會使請求 500）。

### GET `/api/orders`
只回目前使用者的訂單，`created_at DESC`，**無分頁**。`data = { orders: [{ id, order_no, total_amount, status, created_at }] }`。

### GET `/api/orders/:id`
條件 `id = ? AND user_id = 目前使用者`；不存在**或屬於他人** → 404「訂單不存在」。`data = { ...orders 全欄位, items: [order_items 全欄位] }`。

### PATCH `/api/orders/:id/pay`（模擬付款）
**body**：`action` ∈ `success` | `fail`。
- 其他值或缺漏 → 400「action 必須為 success 或 fail」。
- 訂單不存在／非本人 → 404。
- 訂單 `status !== 'pending'` → 400 `INVALID_STATUS`「訂單狀態不是 pending，無法付款」（`paid`/`failed` 是終態，不可重試）。
- `success` → `paid`，訊息「付款成功」；`fail` → `failed`，訊息「付款失敗」。回傳更新後訂單＋items。
- 狀態機：`pending → paid` 或 `pending → failed`，沒有其他轉換。

### 前端
- 結帳頁 `/checkout`（需登入）：載入購物車摘要（空車導回 `/cart`）、收件資訊表單（前端驗證）、送出成功導向 `/orders/:id`。
- 我的訂單 `/orders`（需登入）：列表＋狀態標籤（待付款 / 已付款 / 付款失敗）。
- 訂單詳情 `/orders/:id`（需登入）：顯示訂單資訊、明細、收件資料；`pending` 時顯示「模擬付款成功／失敗」按鈕；`?payment=success|failed|cancel` 會顯示對應提示橫幅（為未來金流 redirect 預留，目前只有付款按鈕會設定 success／failed）。

---

## 5. 後台商品管理（`/api/admin/products`，需 admin）

Router 層 `router.use(authMiddleware, adminMiddleware)`：無 token → 401；非 admin → 403。

### GET `/api/admin/products`
分頁規則與公開列表相同（`page` 預設 1；`limit` 預設 10、上限 100）；回傳格式相同。

### POST `/api/admin/products`
| 欄位 | 必填 | 規則 |
|------|------|------|
| `name` | ✅ | falsy → 400「name 為必填欄位」 |
| `price` | ✅ | 必須是**整數 number**（`"500"` 字串會被拒）且 > 0 → 否則 400「price 必須為正整數」 |
| `stock` | ✅ | 整數 ≥ 0 → 否則 400「stock 必須為非負整數」 |
| `description` | ❌ | 缺或空字串 → 存 NULL |
| `image_url` | ❌ | 缺或空字串 → 存 NULL |

成功 **201**，回傳完整商品。

### PUT `/api/admin/products/:id`（部分更新）
- 商品不存在 → 404「商品不存在」。
- 只更新 body 中**出現（!== undefined）**的欄位，其餘沿用舊值；`updated_at` 設為 `datetime('now')`。
- 驗證：`name` 若提供不可為空白字串（`name.trim() === ''` → 400「商品名稱不能為空」；**name 若傳非字串如數字，`.trim` 會丟錯 → 500**）；`price` 整數 > 0；`stock` 整數 ≥ 0。
- 因為 `!== undefined` 判斷，可傳 `description: ""` 清空描述（會存成空字串而非 NULL，與 POST 行為不同）。

### DELETE `/api/admin/products/:id`
1. 不存在 → 404。
2. 若該商品出現在任何 `status='pending'` 訂單的明細 → 409 `CONFLICT`「此商品存在未完成的訂單，無法刪除」。（`paid`/`failed` 訂單不阻擋；因 `order_items.product_id` 無 FK，歷史明細保留快照。）
3. 否則刪除，回 `data: null`，「商品刪除成功」。
- **⚠️ 已知陷阱**：`cart_items.product_id` 有 FK → products。若有任何購物車（訪客或會員）含該商品，`DELETE` 會觸發 `FOREIGN KEY constraint failed` → 走 errorHandler 回 500。目前程式未先清除購物車項目。

### 前端 `/admin/products`
表格＋分頁（每頁 10）、新增／編輯 modal（前端僅檢查 name 非空與 price > 0）、刪除確認視窗。失敗時只顯示「儲存失敗」「刪除失敗」，不顯示 409 原因。price/stock 輸入框使用 `v-model.number`，送出時為 number；欄位清空時會變成空字串，後端將回 400（前端只擋 price ≤ 0）。

---

## 6. 後台訂單管理（`/api/admin/orders`，需 admin）

### GET `/api/admin/orders`
| 參數 | 預設 | 規則 |
|------|------|------|
| `page` | 1 | 同上 |
| `limit` | 10 | 上限 100 |
| `status` | 無 | 僅接受 `pending` / `paid` / `failed`；**其他值被忽略（等同不篩選，不報錯）** |

回傳 `data = { orders: [orders 全欄位], pagination }`（列表不含 items）。

### GET `/api/admin/orders/:id`
可查任何使用者的訂單。`data = { ...order, items: [...], user: { name, email } | null }`（使用者已刪除時 `user` 為 null）。不存在 → 404「訂單不存在」。

### 限制
後台**只能檢視**，沒有修改訂單狀態、取消、退款端點。

### 前端 `/admin/orders`
狀態下拉篩選（變更自動回第 1 頁）、分頁、詳情 modal。

---

## 7. 頁面與導覽

| 路徑 | 版型 | 需登入（前端檢查） | pageScript |
|------|------|--------------------|------------|
| `/` | front | 否 | index |
| `/products/:id` | front | 否 | product-detail |
| `/cart` | front | 否（結帳時才要求） | cart |
| `/checkout` | front | 是 | checkout |
| `/login` | front | 否 | login |
| `/orders` | front | 是 | orders |
| `/orders/:id` | front | 是 | order-detail |
| `/admin/products` | admin | 是（admin） | admin-products |
| `/admin/orders` | admin | 是（admin） | admin-orders |
| 其他 | front | — | 404 頁（HTTP 404） |

Header（`header-init.js`）：登入 → 顯示使用者名稱、登出、（admin）「後台管理」連結、「我的訂單」；未登入 → 登入按鈕。載入時呼叫 `/api/cart` 更新徽章（失敗靜默）。

---

## 8. 工具功能

- **OpenAPI**：`npm run openapi` → `openapi.json`（掃描 `src/routes/*.js`）。
- **Toast 通知**：`Notification.show(message, 'success'|'error'|'warning'|'info')`，3 秒自動消失。
