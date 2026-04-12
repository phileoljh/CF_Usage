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

請依序完成 **API Token 申請**、**Backend 部署** 與 **Frontend 部署**。

### Phase 1: 取得 Cloudflare API Token 🔑
1. 登入 [Cloudflare 儀表板](https://dash.cloudflare.com)。
2. 前往右上方個人頭像 > **My Profile** > **API Tokens**。
3. 點選 **Create Token** > 最下方選擇 **Create Custom Token**。
4. 給 Token 命名 (如: `CF-Usage-Dashboard-API`)，並賦予以下權限 (依您需要監看的服務增減)：
   - `Account` > `Account Analytics` > `Read`
   - `Account` > `D1` > `Read` 
   - `Account` > `Workers Scripts` > `Read`
5. 設定 Account Resources 為指定的帳號。
6. 點擊 **Continue to summary** > **Create Token**。
7. **非常重要**：請將畫面上出現的字串 (Token) 妥善保存，離開該頁面就再也看不到了。同時也準備好您的 **Account ID** (可以在 Cloudflare 儀表板右下角找到)。

### Phase 2: 部署 Backend (Cloudflare Worker) ⚙️
需在本地環境使用終端機與 Node.js 執行：
1. 開啟終端機並切換至 backend 資料夾：
   ```bash
   cd backend
   ```
2. 安裝必要的 Wrangler 套件：
   ```bash
   npm install
   ```
3. 設定環境變數 `Account ID`：
   開啟 `backend/wrangler.toml` 檔案，在 `[vars]` 區塊依照註解填入您的 `CLOUDFLARE_ACCOUNT_ID`。
4. 將您的 API Token 上傳至 Cloudflare Secrets (確保安全不外流)：
   ```bash
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   # 依照提示貼上您在 Phase 1 拿到的 API Token
   ```
5. 部署 Worker：
   ```bash
   npx wrangler deploy
   ```
6. **(重要)** 部署成功後，終端機會顯示一個類似 `https://cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev` 的 **URL**，先把它複製下來。

### Phase 3: 部署 Frontend (Cloudflare Pages) 🌐
前端您可以放在任何靜態網頁託管服務，推薦直接放上 Cloudflare Pages：
1. 開啟 `frontend/script.js`。
2. 將第一行的 `API_URL` 修改為您在 Phase 2 部署所取得的 Worker URL。
   ```javascript
   const API_URL = "https://cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev";
   ```
3. 在 Cloudflare 儀表板，前往 **Workers & Pages** > **Overview** > **Create application** > **Pages** 頁籤。
4. 選擇 **Upload assets**。
5. 給您的專案命名 (Project name)，點選 **Create project**。
6. 將本專案的 `frontend/` **整個資料夾拖曳進上傳區塊**。
7. 上傳完成後，點擊下方的 **Deploy site**。
8. 大功告成！您現在可以開啟 Pages 給您的網址來即時監控 Cloudflare 用量。

---

> 開發提醒：若需要增加不同的服務監控，請至 `backend/src/index.js` 修改 GraphQL 或 REST 請求邏輯，與上方的 `QUOTAS` 變數來調整硬編碼的免費額度上限。
