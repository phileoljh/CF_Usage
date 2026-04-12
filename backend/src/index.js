// --- 定義免費額度上限 (Quotas) ---
const QUOTAS = {
  workers_requests: 100000,      // Daily
  d1_rows_read: 5000000,         // Daily
  d1_rows_written: 100000,       // Daily
  r2_class_a_ops: 1000000,       // Monthly
  r2_class_b_ops: 10000000,      // Monthly
  kv_read: 100000,               // Daily
  kv_write: 1000,                // Daily
  kv_delete: 1000,               // Daily
  kv_list: 1000                  // Daily
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由 1: 獲取 API 資料
    if (url.pathname === "/api/data") {
      return handleApiRequest(request, env, ctx);
    }

    // 路由 2: 返回整合後的 HTML 頁面
    return new Response(getHtmlContent(), {
      headers: { "Content-Type": "text/html;charset=UTF-8" }
    });
  }
};

/**
 * 處理 API 請求並返回 JSON 數據
 */
async function handleApiRequest(request, env, ctx) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return new Response(JSON.stringify({ error: "Missing CF configs (ACCOUNT_ID or API_TOKEN)" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url);
  let response = await cache.match(cacheKey);

  if (!response) {
    try {
      const usage = await fetchCloudflareUsage(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ACCOUNT_ID);
      
      const dashboardData = {
        workers_requests: { id: "workers_requests", name: "Workers (請求)", used: usage.workers_requests, limit: QUOTAS.workers_requests, percentage: ((usage.workers_requests / QUOTAS.workers_requests) * 100).toFixed(2), unit: "Req" },
        d1_read: { id: "d1_read", name: "D1 (讀取)", used: usage.d1_rows_read, limit: QUOTAS.d1_rows_read, percentage: ((usage.d1_rows_read / QUOTAS.d1_rows_read) * 100).toFixed(2), unit: "Rows" },
        d1_written: { id: "d1_written", name: "D1 (寫入)", used: usage.d1_rows_written, limit: QUOTAS.d1_rows_written, percentage: ((usage.d1_rows_written / QUOTAS.d1_rows_written) * 100).toFixed(2), unit: "Rows" },
        r2_class_a: { id: "r2_class_a", name: "R2 (Class A)", used: usage.r2_class_a_ops, limit: QUOTAS.r2_class_a_ops, percentage: ((usage.r2_class_a_ops / QUOTAS.r2_class_a_ops) * 100).toFixed(2), unit: "Ops" },
        r2_class_b: { id: "r2_class_b", name: "R2 (Class B)", used: usage.r2_class_b_ops, limit: QUOTAS.r2_class_b_ops, percentage: ((usage.r2_class_b_ops / QUOTAS.r2_class_b_ops) * 100).toFixed(2), unit: "Ops" },
        kv_read: { id: "kv_read", name: "KV (讀取)", used: usage.kv_read, limit: QUOTAS.kv_read, percentage: ((usage.kv_read / QUOTAS.kv_read) * 100).toFixed(2), unit: "Req" },
        kv_write: { id: "kv_write", name: "KV (寫入)", used: usage.kv_write, limit: QUOTAS.kv_write, percentage: ((usage.kv_write / QUOTAS.kv_write) * 100).toFixed(2), unit: "Req" },
        kv_delete: { id: "kv_delete", name: "KV (刪除)", used: usage.kv_delete, limit: QUOTAS.kv_delete, percentage: ((usage.kv_delete / QUOTAS.kv_delete) * 100).toFixed(2), unit: "Req" },
        kv_list: { id: "kv_list", name: "KV (列表)", used: usage.kv_list, limit: QUOTAS.kv_list, percentage: ((usage.kv_list / QUOTAS.kv_list) * 100).toFixed(2), unit: "Req" }
      };

      response = new Response(JSON.stringify({
        updated_at: new Date().toISOString(),
        data: dashboardData
      }), {
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "s-maxage=900" // 邊緣節點快取 15 分鐘
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  return response;
}

/**
 * 核心：取得 Cloudflare 真實數據 (GraphQL)
 */
async function fetchCloudflareUsage(apiToken, accountId) {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  const query = `
    query($accountId: String!, $date: String!) {
      viewer {
        accounts(filter: {accountTag: $accountId}) {
          workersInvocationsAdaptive(limit: 1000, filter: {date: $date}) {
            sum { requests }
          }
        }
      }
    }
  `;

  let workersRequests = 0;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { accountId, date: dateStr } })
    });
    const json = await res.json();
    workersRequests = json?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
  } catch (err) {}

  // 其他服務目前以 0 或隨機佔位，你可以根據需求串接對應 API
  return {
    workers_requests: workersRequests,
    d1_rows_read: 0, 
    d1_rows_written: 0,
    r2_class_a_ops: 0,
    r2_class_b_ops: 0,
    kv_read: 0,
    kv_write: 0,
    kv_delete: 0,
    kv_list: 0
  };
}

/**
 * 返回包含 CSS 與 JS 的完整 HTML 字串
 */
function getHtmlContent() {
  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Usage Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #0f121b;
            --card-bg: rgba(255, 255, 255, 0.03);
            --card-border: rgba(255, 255, 255, 0.08);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-blue: #3b82f6;
            --accent-cyan: #06b6d4;
            --accent-orange: #f97316;
            --accent-red: #ef4444;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
        body { background-color: var(--bg-dark); color: var(--text-primary); min-height: 100vh; overflow-x: hidden; }
        .blob { position: fixed; border-radius: 50%; filter: blur(80px); z-index: -1; opacity: 0.4; animation: float 20s infinite alternate; }
        .blob-1 { top: -10%; left: -10%; width: 600px; height: 600px; background: radial-gradient(circle, rgba(59,130,246,0.3) 0%, rgba(0,0,0,0) 70%); }
        .blob-2 { bottom: -20%; right: -10%; width: 700px; height: 700px; background: radial-gradient(circle, rgba(249,115,22,0.2) 0%, rgba(0,0,0,0) 70%); }
        @keyframes float { 0% { transform: translate(0, 0); } 100% { transform: translate(50px, 30px); } }
        .container { max-width: 1200px; margin: 0 auto; padding: 3rem 1.5rem; }
        .dashboard-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 3rem; flex-wrap: wrap; gap: 1rem; }
        h1 { font-size: 2.25rem; background: linear-gradient(to right, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .last-updated { font-size: 0.875rem; color: var(--text-secondary); background: var(--card-bg); border: 1px solid var(--card-border); padding: 0.5rem 1rem; border-radius: 999px; backdrop-filter: blur(10px); }
        .grid-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; }
        .glass-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 1.25rem; padding: 1.5rem; backdrop-filter: blur(16px); transition: transform 0.3s ease; }
        .glass-card:hover { transform: translateY(-5px); border-color: rgba(255, 255, 255, 0.15); }
        .card-header { display: flex; justify-content: space-between; margin-bottom: 1.25rem; }
        .percentage-badge { font-size: 0.875rem; padding: 0.25rem 0.75rem; border-radius: 999px; background: rgba(59, 130, 246, 0.15); color: var(--accent-blue); border: 1px solid rgba(59, 130, 246, 0.3); }
        .progress-track { width: 100%; height: 8px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; margin-bottom: 1.25rem; }
        .progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent-cyan), var(--accent-blue)); transition: width 1.5s ease; }
        .progress-bar.warning { background: linear-gradient(90deg, #fcd34d, var(--accent-orange)); }
        .progress-bar.danger { background: linear-gradient(90deg, #fca5a5, var(--accent-red)); }
        .stats-row { display: flex; justify-content: space-between; }
        .stat-label { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="container">
        <header class="dashboard-header">
            <div><h1>Cloudflare 資源用量</h1><p style="color:var(--text-secondary)">即時監控</p></div>
            <div class="last-updated">最後更新：<span id="update-time">載入中...</span></div>
        </header>
        <main class="grid-container" id="dashboard-data">
            <p>正在從 Worker 獲取最新實時數據...</p>
        </main>
    </div>
    <script>
        async function loadData() {
            try {
                const res = await fetch("/api/data");
                const result = await res.json();
                document.getElementById("update-time").textContent = new Date(result.updated_at).toLocaleString();
                render(result.data);
            } catch (e) { alert("無法載入資料"); }
        }
        function render(data) {
            const container = document.getElementById("dashboard-data");
            container.innerHTML = "";
            Object.values(data).forEach(item => {
                const perc = parseFloat(item.percentage);
                let statusClass = "";
                if (perc >= 95) statusClass = "danger";
                else if (perc >= 80) statusClass = "warning";
                
                container.innerHTML += \`
                    <div class="glass-card">
                        <div class="card-header">
                            <span style="font-weight:600">\${item.name}</span>
                            <span class="percentage-badge" style="\${perc >= 80 ? 'color:white; border-color:transparent; background:red' : ''}">\${perc}%</span>
                        </div>
                        <div class="progress-track"><div class="progress-bar \${statusClass}" style="width:\${Math.min(perc, 100)}%"></div></div>
                        <div class="stats-row">
                            <div><div class="stat-label">已使用</div><div>\${Number(item.used).toLocaleString()} \${item.unit}</div></div>
                            <div style="text-align:right"><div class="stat-label">額度</div><div>\${Number(item.limit).toLocaleString()} \${item.unit}</div></div>
                        </div>
                    </div>\`;
            });
        }
        loadData();
    </script>
</body>
</html>
  `;
}
