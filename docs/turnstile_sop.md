# Cloudflare Turnstile 申請與配置 SOP

本專案已整合 Cloudflare Turnstile 人機驗證，可作為 Zero Trust 之外的額外防護，或是當您未開啟 Zero Trust 時的基本安全屏障。請依照以下步驟完成申請與配置：

## 步驟 1：建立 Turnstile 網站設定
1. 登入 [Cloudflare 儀表板](https://dash.cloudflare.com)。
2. 在左側選單中點選 **Turnstile**。
3. 點擊 **Add site** 按鈕。
4. 填寫以下資訊：
   - **Site name**：建議填寫 `CF-Usage-Dashboard`。
   - **Domain**：填入您 Worker 的網域名稱 (例如 `cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev`)。
   - **Widget type**：建議選擇 **Managed** (由 Cloudflare 自動根據風險評估決定是否顯示挑戰)。
5. 點擊 **Create**。

## 步驟 2：獲取金鑰
完成建立後，您將獲得兩組金鑰：
- **Site Key (網站金鑰)**：用於前端顯示驗證小工具。
- **Secret Key (秘密金鑰)**：用於後端驗證 Token 的真實性。

請將這兩組金鑰記錄下來，稍後需要填入 Worker 設定中。

## 步驟 3：配置 Worker 環境變數
1. 回到 **Workers & Pages** > 點選您的 Worker 專案。
2. 切換至 **Settings** 頁籤 > 點選 **Variables and Secrets**。
3. 在 **Environment Variables** 區塊，點擊 **Add variable** 新增以下兩項：
   - 名稱：`TURNSTILE_SITE_KEY`
     - Value：填入剛取得的 Site Key。
   - 名稱：`TURNSTILE_SECRET_KEY`
     - Value：填入剛取得的 Secret Key。
     - **務必點選 `Encrypt`** 進行加密。
4. 點擊 **Save and deploy**。

## 完成驗證
配置完成後，當您存取儀表板時：
- 若未登入且無有效 Cookie，系統會顯示 Turnstile 驗證小工具。
- 驗證通過後，您將獲得 24 小時的存取權限。
- 若偵測到您已透過 Zero Trust 登入，系統將會**自動跳過** Turnstile 驗證以提升使用體驗。
