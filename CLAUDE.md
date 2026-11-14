# CLAUDE.md

## 專案概述
花漾生活 Flower Life — 花卉電商示範站：Express 4 + better-sqlite3（SQLite）+ JWT/bcrypt，EJS 版型 + Vue 3（CDN）+ Tailwind CSS 4，測試用 Vitest + Supertest。CommonJS，無前端打包。

## 常用指令
- `npm start` — 建置 CSS 並啟動（http://localhost:3001）
- `npm run dev:server` — 只啟動伺服器（`node server.js`）
- `npm run dev:css` — Tailwind watch
- `npm run css:build` — 建置並壓縮 CSS（`public/css/output.css` 已 gitignore，新環境需先建置）
- `npm test` — 執行 Vitest 整合測試（需 `.env` 含 `JWT_SECRET`）
- `npm run openapi` — 產生 `openapi.json`

## 關鍵規則
- 所有 API 回應格式固定為 `{ data, error, message }`，錯誤時 `data: null`、`error` 為大寫錯誤碼、`message` 為繁體中文。
- 認證有兩套：Bearer JWT（`authMiddleware`；後台再加 `adminMiddleware`）與購物車專用的雙模式（`dualAuth`：JWT 優先，否則 `X-Session-Id`；token 無效不會退回 session）。登入不會合併訪客購物車。
- 付款是模擬（`PATCH /api/orders/:id/pay`），ECPay 環境變數尚未被使用。下單即在 transaction 內扣庫存，失敗不回補。
- 資料庫無 migration（`CREATE TABLE IF NOT EXISTS`）；測試與開發共用 `database.sqlite`；測試檔順序固定於 `vitest.config.js`，新增測試檔需加入 `sequence.files`。
- 前端為全域 script（`Auth`、`apiFetch`、`Notification` 會覆蓋原生 Notification），頁面腳本檔名需與 `pageRoutes.js` 的 `pageScript` 一致。
- 功能開發使用 docs/plans/ 記錄計畫；完成後移至 docs/plans/archive/

## 詳細文件
- ./docs/README.md — 項目介紹與快速開始
- ./docs/ARCHITECTURE.md — 架構、目錄結構、資料流
- ./docs/DEVELOPMENT.md — 開發規範、命名規則
- ./docs/FEATURES.md — 功能列表與完成狀態
- ./docs/TESTING.md — 測試規範與指南
- ./docs/CHANGELOG.md — 更新日誌

@docs/README.md
@docs/ARCHITECTURE.md
@docs/DEVELOPMENT.md
@docs/FEATURES.md
@docs/TESTING.md
@docs/CHANGELOG.md
