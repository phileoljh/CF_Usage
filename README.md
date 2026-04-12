# Cloudflare 資源用量監控儀表板 (CF Usage Dashboard)

這是一個設計精美的 Cloudflare 用量狀態儀表板。為保護使用者的 API 金鑰且避免過度消耗官方 API 請求次數，本專案採用 **BFF (Backend For Frontend)** 架構進行實作。

## 系統架構

本專案採用 **All-in-one Worker (單一化 Cloudflare Worker)** 架構進行實作：
- 將 HTML/CSS/JS 前端介面與 API 後端數據獲取邏輯整合在同一個 `index.js` 中。
- **後端數據處理**：負責調用 Cloudflare GraphQL API 獲取最新用量數據，並以內建 Edge Cache 快取資源。
- **前端網頁渲染**：訪問根目錄 `/` 即可取得完整的儀表板 HTML 網頁，網頁啟動後會自動從同網域的 `/api/data` 介面動態即時載入最新數據。
- **優勢**：部署極度簡單（一個指令），同網域無 CORS 跨域困擾，且擁有最高安全性（Token 存放於伺服器端不外洩）。

---

## 部署標準作業程序 (SOP)

您完全不需要安裝 Node.js 或任何本地終端機指令，整個過程都在 Cloudflare 網頁版完成。請依序完成以下步驟：

### Phase 1: 取得 Cloudflare API Token 🔑
1. 登入 [Cloudflare 儀表板](https://dash.cloudflare.com)。
2. 前往右上方個人頭像 > **My Profile** > **API Tokens**。
3. 點選 **Create Token** > 選擇 **Create Custom Token**。
4. 給 Token 命名 (如: `CF-Usage-Dashboard-API`)，並賦予以下權限：
   - `Account` > `Account Analytics` > `Read`
   - `Account` > `D1` > `Read` 
   - `Account` > `Workers Scripts` > `Read`
   - `Account` > `Workers KV Storage` > `Read`
   - `Account` > `R2 Storage` > `Read`
5. 設定 Account Resources 為指定的帳號。
6. 完成並點擊 **Create Token**。
7. **非常重要**：保存好畫面上顯示的 Token 以及您的 **Account ID** (位於儀表板右下角)。

### Phase 2: 在網頁版直接建立 All-in-One Cloudflare Worker ⚙️
1. 進入 Cloudflare 儀表板左側選單 **Workers & Pages** > 點擊 **Create application** > 選擇 **Create Worker**。
2. 給 Worker 命名 (如: `cf-usage-api`)，點選 **Deploy**。
3. 點擊 **Edit code**，刪除畫面左側編輯器內的所有預設程式碼。
4. 打開您電腦上的 `backend/src/index.js` 檔案，將所有內容全選複製，貼上到網頁編輯器中，並點擊右上角 **Deploy** 儲存。
5. 點擊畫面左上角的返回按鈕，回到 Worker 的管理頁面。切換到 **Settings** 頁籤 > 點選 **Variables and Secrets**。
6. 在 **Environment Variables** 區塊進行以下新增：
   - 點擊 Add variable：名稱填寫 `CLOUDFLARE_ACCOUNT_ID`，Value 填入您的 Account ID，點選 Save。
   - 點擊 Add variable：名稱填寫 `CLOUDFLARE_API_TOKEN`，Value 填入 Phase 1 拿到的 API Token，然後 **務必點選 `Encrypt`** (加密按鈕，讓 Token 隱藏不外流)，點選 Save。
7. 回到 Worker 主畫面，紀錄下您的 Worker 專屬網址 (例：`https://cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev`)，這就是您的儀表板網址了！

### Phase 3: 套用 Zero Trust 保護 🛡️
為了達到只有您或內部人員才能觀看的安全要求，請為該 Worker 網址套用 Zero Trust 驗證：
1. 前往左側選單 **Zero Trust** 的儀表板。
2. 選擇左側 **Access controls** > **Applications** > **Add an application** > **Self-hosted**。
3. 在 **Configure app** 階段：設定名稱，並在 **Application domain** 中填入該 Worker 的網域名稱 (例如 `cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev`)。
4. 在 **Add policies** 階段：Action 選擇 `Allow`，Include 選擇 `Emails` 或 `Email Domains`，來限制只有您本人的 Email 或特定網域可登入。
5. 點擊 **Add application** 完成儲存。現在存取您的儀表板就會有一層 OTP (One-Time-Pin) 登入保護。

> [!TIP]
> **免驗證進階設定**：如果您有安裝 Cloudflare WARP 且已加入您的 Zero Trust 組織，可以再新增一項 Policy，將 Action 設為 `Bypass` 並 Include `Gateway` (或 `Warp`)。這樣當您連著 WARP 瀏覽時，就能免除 Email 驗證，實現無感登入。

---

> 開發提醒：若需要監視其他新服務，請至 `backend/src/index.js` 修改抓取邏輯，並調整上方的 `QUOTAS` 變數來控制上限值。舊版的 `frontend` 資料夾目前已不需使用，可視需求保留或刪除。
