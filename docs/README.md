# 花漾生活 Flower Life

花卉電商示範網站：前台購物（商品瀏覽、訪客／會員購物車、結帳、模擬付款）與後台管理（商品 CRUD、訂單檢視）。單一 Node.js 程序同時提供 REST API 與伺服器端渲染的頁面。

## 技術棧

| 層級 | 技術 |
|------|------|
| 執行環境 | Node.js（CommonJS） |
| Web 框架 | Express ~4.16 |
| 資料庫 | SQLite（`better-sqlite3`，WAL 模式，檔案 `database.sqlite`） |
| 認證 | JWT（`jsonwebtoken`，HS256，7 天）、`bcrypt` 密碼雜湊；訪客以 `X-Session-Id` |
| 模板 | EJS 5（layout + partials） |
| 前端 | Vue 3（unpkg CDN，無打包）、Tailwind CSS 4（CLI 建置） |
| API 文件 | `swagger-jsdoc`（產生 `openapi.json`） |
| 測試 | Vitest 2 + Supertest |
| 其他 | `uuid` v11、`cors`、`dotenv` |

## 快速開始

```bash
# 1. 安裝相依套件
npm install

# 2. 建立環境變數（至少需要 JWT_SECRET）
cp .env.example .env
# 編輯 .env，將 JWT_SECRET 改為任意隨機字串

# 3. 建置 CSS 並啟動（啟動時會自動建立資料庫、管理員帳號與 8 筆範例商品）
npm start
# 開啟 http://localhost:3001
```

預設管理員：`admin@hexschool.com` / `12345678`（可由 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 在**首次建立前**修改）。後台入口：`/admin/products`、`/admin/orders`。

開發時可開兩個終端機：
```bash
npm run dev:css      # Tailwind watch
npm run dev:server   # node server.js（不會自動重啟）
```

## 常用指令

| 指令 | 說明 |
|------|------|
| `npm start` | 先 `css:build` 再啟動伺服器 |
| `npm run dev:server` | 只啟動伺服器（`node server.js`） |
| `npm run dev:css` | Tailwind watch 模式輸出 `public/css/output.css` |
| `npm run css:build` | 一次性建置並壓縮 CSS |
| `npm test` | 執行全部 Vitest 整合測試（需 `.env`） |
| `npm run openapi` | 由 `@openapi` 註解產生 `openapi.json` |

## 注意事項

- 付款為**模擬**（訂單頁按鈕），尚未串接綠界 ECPay，詳見 ARCHITECTURE.md §7.3。
- 測試與開發共用同一個 `database.sqlite`。
- Vue 與 Google Fonts 從 CDN 載入，離線時前端無法運作。
- 登入時不會合併訪客購物車。

## 文件索引

| 文件 | 內容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 目錄結構、啟動流程、路由總覽、認證機制、資料庫 schema、資料流 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 命名規則、環境變數、新增 API／middleware／DB 步驟、JSDoc、計畫歸檔流程 |
| [FEATURES.md](./FEATURES.md) | 功能清單、完成狀態與詳細行為描述 |
| [TESTING.md](./TESTING.md) | 測試檔案、輔助函式、撰寫方式、常見陷阱 |
| [CHANGELOG.md](./CHANGELOG.md) | 更新日誌 |
| [plans/](./plans/) | 進行中的開發計畫（完成後移至 `plans/archive/`） |
