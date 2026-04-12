# Cloudflare 資源用量監控儀表板 (CF Usage Dashboard)

這是一個設計精美的 Cloudflare 用量狀態儀表板。為保護使用者的 API 金鑰且避免過度消耗官方 API 請求次數，本專案採用 **BFF (Backend For Frontend)** 架構進行實作。

## 系統架構

專案區分為兩大模組：
1. **`backend/` (Cloudflare Worker)**
   - 作為中介 API，負責使用您設定好的 API Token 對 Cloudflare 的 GraphQL/REST API 提取最新數據。
   - 預設提供 15 分鐘的 TTL 快取。
   - 回傳給前端已處理好、結構化的 JSON，含：已使用量、上限限制、百分比。
2. **`frontend/` (Static Web App)**
   - 注重質感與效能的使用者介面。
   - 採用純 HTML、CSS (深色模式/Glassmorphism)、JavaScript 撰寫。
   - 提供 Skeleton 載入與動態進度條。網頁打開當下，非同步向 Backend Worker 獲取資料。

---

## 部署標準作業程序 (SOP)

本專案經過設計，**完全不需要經歷本地端測試或複雜的 CI/CD 建置**，所有元件皆可直接部署於 Cloudflare 平台上。請依序完成以下步驟。

### Phase 1: 取得 Cloudflare API Token 🔑
1. 登入 [Cloudflare 儀表板](https://dash.cloudflare.com)。
2. 前往右上方個人頭像 > **My Profile** > **API Tokens**。
3. 點選 **Create Token** > 最下方選擇 **Create Custom Token**。
4. 給 Token 命名 (如: `CF-Usage-Dashboard-API`)，並務必賦予以下權限 (包含最新加入的 KV 與 R2)：
   - `Account` > `Account Analytics` > `Read`
   - `Account` > `D1` > `Read` 
   - `Account` > `Workers Scripts` > `Read`
   - `Account` > `Workers KV Storage` > `Read`
   - `Account` > `R2 Storage` (或選擇對應的 R2 讀取權限) > `Read`
5. 設定 Account Resources 為指定的帳號。
6. 點擊 **Continue to summary** > **Create Token**。
7. **非常重要**：請將畫面上出現的字串 (Token) 妥善保存，離開該頁面就再也看不到了。同時也準備好您的 **Account ID** (可以在 Cloudflare 儀表板右下角找到)。

### Phase 2: 直接發布 Backend (Cloudflare Worker) ⚙️
不需在本地建置測試環境，直接使用終端機一鍵發布至 Cloudflare：
1. 開啟終端機並切換至 `backend` 資料夾：
   ```bash
   cd backend
   npm install
   ```
2. 將您的 Account ID 填寫至 `backend/wrangler.toml` 內的 `[vars]` 區塊。
3. 把 Phase 1 拿到的 Token 安全地上傳給 Cloudflare (不會寫入任何可視檔案)：
   ```bash
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   ```
4. 直接推送 Worker 上雲端：
   ```bash
   npx wrangler deploy
   ```
5. **(重要)** 紀錄發布成功後顯示的網址 (例：`https://cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev`)。

### Phase 3: 直接發布 Frontend (Cloudflare Pages) 🌐
無需透過 GitHub，直接在網頁端將前端推上線：
1. 編輯 `frontend/script.js` 檔案，將第一行的 `API_URL` 改為 Phase 2 獲得的 Worker 網址。
2. 進入 Cloudflare 儀表板，前往左側 **Workers & Pages** > 選擇 **Pages** 頁籤 > 點擊 **Upload assets**。
3. 設定專案名稱 (如: `cf-usage-dashboard`) 並建立專案。
4. **將您電腦上的 `frontend/` 資料夾，直接整包拖曳到網頁虛線框內上傳**。
5. 點擊 **Deploy site**。發布後您會得到一個類似 `https://cf-usage-dashboard.pages.dev` 的專用預設網址。

### Phase 4: 套用 Zero Trust 保護 (無需綁定自訂網域) 🛡️
為了達到「只有您或您的團隊才能觀看這個儀表板」的效果，我們將直接對 `*.pages.dev` 網址套用 Zero Trust (CF Access)：
1. 在 Cloudflare 儀表板，前往左側選單的 **Zero Trust** (若首次使用可能需要選擇免費方案開通)。
2. 在 Zero Trust 介面左側選擇 **Access** > **Applications** > 點擊 **Add an application**。
3. 選擇 **Self-hosted**。
4. **Application name** 隨意填寫 (如：`CF Dashboard Access`)。
5. 在 **Application domain** 中：
   - 網域下拉選單中，您理論上可以直接選擇您的 `.pages.dev` 網域 (如果 Pages 已自動幫你連結到 Zone 的話)。
   - **補充：如果您的 Pages 沒掛入 Zone**：Cloudflare 最近直接在 Pages 設定後台提供了 Access 整合。回到原本一般 Dashboard 的 **Workers & Pages** > 點選您的 Pages 專案 > 切換到 **Settings** 頁籤 > 側邊欄點選 **Access policy** > 點擊 **Enable Access policy**，即可為 `*.pages.dev` 預設網域直接開啟保護。
6. 設定 **Policies**：
   - Action: `Allow`
   - Include: 選擇 `Emails`，並輸入您自己的信箱，或是設定 `Email Domains` 只允許特定後綴信箱登入。
7. 儲存設定。現在當任何人訪問您的儀表板網址時，都會跳出由 Cloudflare 提供的 Email One-Time-Pin (OTP) 登入畫面，且只有被授權的使用者能進入系統，完美達成內部安全保護。

---

> 開發提醒：若需要監視其他新服務，請至 `backend/src/index.js` 修改抓取邏輯，並調整上方的 `QUOTAS` 變數來控制上限值。
