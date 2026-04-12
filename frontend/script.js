// --- 設定 ---
// TODO: 部署 Backend 後，請將此處切換為您的 Cloudflare Worker 網址
const API_URL = "http://127.0.0.1:8787"; 
// const API_URL = "https://cf-usage-api.<YOUR-SUBDOMAIN>.workers.dev";

document.addEventListener("DOMContentLoaded", () => {
    fetchDashboardData();
});

async function fetchDashboardData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        
        // 更新最後更新時間
        const updateTimeSpan = document.getElementById("update-time");
        const dateObj = new Date(result.updated_at);
        updateTimeSpan.textContent = dateObj.toLocaleString("zh-TW");

        renderCards(result.data);

    } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
        document.getElementById("update-time").textContent = "載入失敗";
        document.getElementById("loading-state").classList.add("hidden");
        // 可在此加入前端 Error UI 處理，目前簡單跳出 Alert
        alert("無法獲取 Cloudflare 用量資料，請確認 API 是否已開啟，或跨域 (CORS) 設定。");
    }
}

function renderCards(dataObj) {
    const loadingState = document.getElementById("loading-state");
    const dashboardData = document.getElementById("dashboard-data");
    const template = document.getElementById("card-template");

    // 清空上次資料
    dashboardData.innerHTML = '';

    // 將 Object 轉換為 Array 以利迴圈
    const items = Object.values(dataObj);

    items.forEach(item => {
        // 複製 Template
        const clone = template.content.cloneNode(true);

        // 填入文字資料
        clone.querySelector(".service-name").textContent = item.name;
        
        // 處理數字千分位格式
        clone.querySelector(".used-val").textContent = Number(item.used).toLocaleString() + ` ${item.unit}`;
        clone.querySelector(".limit-val").textContent = Number(item.limit).toLocaleString() + ` ${item.unit}`;
        
        const percentageNum = parseFloat(item.percentage);
        const percentBadge = clone.querySelector(".percentage-badge");
        percentBadge.textContent = `${percentageNum}%`;

        // 處理進度條動畫與顏色
        const progressBar = clone.querySelector(".progress-bar");
        
        // 利用 setTimeout 創造渲染後的動畫播放效果
        setTimeout(() => {
            progressBar.style.width = `${Math.min(percentageNum, 100)}%`;
        }, 100);

        if (percentageNum >= 95) {
            progressBar.classList.add("danger");
            percentBadge.style.color = "var(--accent-red)";
            percentBadge.style.borderColor = "rgba(239, 68, 68, 0.3)";
            percentBadge.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
        } else if (percentageNum >= 80) {
            progressBar.classList.add("warning");
            percentBadge.style.color = "var(--accent-orange)";
            percentBadge.style.borderColor = "rgba(249, 115, 22, 0.3)";
            percentBadge.style.backgroundColor = "rgba(249, 115, 22, 0.15)";
        }

        dashboardData.appendChild(clone);
    });

    // 切換顯示狀態
    loadingState.classList.add("hidden");
    dashboardData.classList.remove("hidden");
}
