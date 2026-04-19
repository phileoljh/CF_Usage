// --- 定義免費額度上限 (Quotas) ---
const QUOTAS = {
  workers_requests: 100000,      // Daily
  // workers_observability: 200000, // Daily (註解：目前 Cloudflare 未開放公開 API，待官方支援後再取消註解使用)
  // workers_build_minutes: 3000,   // Monthly (註解：由於無法透過單一公開端點精準取得所有相關建置時間，待官方 API 完善支援後再使用)
  r2_class_a_ops: 1000000,       // Monthly
  r2_class_b_ops: 10000000,      // Monthly
  d1_databases: 10,              // Total
  d1_rows_read: 5000000,         // Daily
  d1_rows_written: 100000,       // Daily
  // KV 
  kv_read: 100000,               // Daily
  kv_write: 1000,                // Daily
  kv_delete: 1000,               // Daily
  kv_list: 1000                  // Daily
};

// 全域渲染鎖 (防止 Cache Stampede 快取雪崩效應)
const renderLocks = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── [新增] 資源耗盡與限流防護 (Rate Limiting) ──
    const rateLimitRes = await checkRateLimit(request, env);
    if (rateLimitRes) return withSecurityHeaders(rateLimitRes);
    // ──────────────────────────────────────────────

    // ── [新增] 惡意掃閱攔截邏輯 ──
    // 條件一：判斷是否為非標準的 Port (通訊埠)
    const isUnusualPort = url.port !== "" && url.port !== "80" && url.port !== "443";

    // 條件二：判斷路徑是否以 "/." 開頭 (涵蓋 /.git, /.env 等隱藏檔)
    const isHiddenFile = url.pathname.startsWith('/.');

    // 若符合任一惡意特徵，直接 301 永久重新導向 (Redirect) 至首頁
    if (isUnusualPort || isHiddenFile) {
      return withSecurityHeaders(Response.redirect("https://cfusage.hihimonitor.win/", 301));
    }
    // ─────────────────────────────────────

    // ── [新增] 身份驗證檢查 (Zero Trust 或 Turnstile Cookie) ──
    const authorized = await isAuthorized(request, env);
    
    // 如果是驗證請求，則不攔截
    if (url.pathname === "/api/verify" && request.method === "POST") {
      return withSecurityHeaders(await handleVerify(request, env));
    }

    // 若未授權且非驗證請求，則顯示 Turnstile 挑戰頁面
    if (!authorized) {
      // 如果是 API 請求但未授權，返回 401
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
      }
      // 返回人機驗證頁面
      return withSecurityHeaders(new Response(getChallengeHtml(env.TURNSTILE_SITE_KEY), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      }));
    }
    // ────────────────────────────────────────────────────────────

    // 路由 1: 獲取 API 資料
    if (url.pathname === "/api/data") {
      return withSecurityHeaders(await handleApiRequest(request, env, ctx));
    }

    // 路由 2: 返回整合後的 HTML 頁面
    return withSecurityHeaders(new Response(getHtmlContent(), {
      headers: { "Content-Type": "text/html;charset=UTF-8" }
    }));
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
    const cacheKeyUrl = cacheKey.url;
    
    // [STAMPEDE 防護] 檢查併發鎖
    if (renderLocks.has(cacheKeyUrl)) {
      console.log(`[STAMPEDE 防護] 搭便車！等候並共用 API 獲取結果`);
      const sharedData = await renderLocks.get(cacheKeyUrl);
      return new Response(sharedData, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" }
      });
    }

    // 第一個進入的請求，建立鎖定
    const fetchPromise = (async () => {
      try {
        const usage = await fetchCloudflareUsage(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ACCOUNT_ID);
        
        const dashboardData = {
          // --- Workers & Pages ---
          workers_requests: { id: "workers_requests", name: "Requests today", used: usage.workers_requests, limit: QUOTAS.workers_requests, percentage: ((usage.workers_requests / QUOTAS.workers_requests) * 100).toFixed(2), unit: "Req", period: "日結算" },
          // 註解：因 Cloudflare API 尚未開放取得 Observability 數據，故暫不顯示於正式版面，待官方支援後補上
          // workers_observability: { id: "workers_observability", name: "Observability events today", used: usage.workers_observability || 0, limit: QUOTAS.workers_observability, percentage: (((usage.workers_observability || 0) / QUOTAS.workers_observability) * 100).toFixed(2), unit: "Events", period: "日結算" },
          // 註解：缺乏單點公開 API 能精準統計 Build minutes，容易計算為 0，為避免失真暫時隱藏
          // workers_build: { id: "workers_build", name: "Workers build minutes this month", used: usage.workers_build || 0, limit: QUOTAS.workers_build_minutes, percentage: (((usage.workers_build || 0) / QUOTAS.workers_build_minutes) * 100).toFixed(2), unit: "Min", period: "月結算" },
          
          // --- R2 Object Storage ---
          r2_class_a: { id: "r2_class_a", name: "Class A Operations", used: usage.r2_class_a_ops, limit: QUOTAS.r2_class_a_ops, percentage: ((usage.r2_class_a_ops / QUOTAS.r2_class_a_ops) * 100).toFixed(2), unit: "Ops", period: "月結算" },
          r2_class_b: { id: "r2_class_b", name: "Class B Operations", used: usage.r2_class_b_ops, limit: QUOTAS.r2_class_b_ops, percentage: ((usage.r2_class_b_ops / QUOTAS.r2_class_b_ops) * 100).toFixed(2), unit: "Ops", period: "月結算" },
          // 註解：儲存空間總量 (Total storage) GraphQL 調用較繁瑣且常有落差，隱藏至官方推出易用統計端點
          // r2_storage: { id: "r2_storage", name: "Total storage", used: 0, limit: 10, percentage: 0, unit: "GB", period: "總額" },
          
          // --- D1 Database ---
          d1_databases: { id: "d1_databases", name: "Total Databases", used: usage.d1_databases || 0, limit: QUOTAS.d1_databases, percentage: (((usage.d1_databases || 0) / QUOTAS.d1_databases) * 100).toFixed(2), unit: "DBs", period: "總額" },
          d1_read: { id: "d1_read", name: "Rows read", used: usage.d1_rows_read, limit: QUOTAS.d1_rows_read, percentage: ((usage.d1_rows_read / QUOTAS.d1_rows_read) * 100).toFixed(2), unit: "Rows", period: "日結算" },
          d1_written: { id: "d1_written", name: "Rows written", used: usage.d1_rows_written, limit: QUOTAS.d1_rows_written, percentage: ((usage.d1_rows_written / QUOTAS.d1_rows_written) * 100).toFixed(2), unit: "Rows", period: "日結算" },
          // 註解：D1 儲存空間總量 API 未有簡單直觀的容量輸出格式，隱藏至後續官方支援
          // d1_storage: { id: "d1_storage", name: "Total storage", used: 0, limit: 5, percentage: 0, unit: "GB", period: "總額" },
          
          // --- Workers KV ---
          kv_read: { id: "kv_read", name: "Reads", used: usage.kv_read || 0, limit: QUOTAS.kv_read, percentage: (((usage.kv_read || 0) / QUOTAS.kv_read) * 100).toFixed(2), unit: "Req", period: "日結算" },
          kv_write: { id: "kv_write", name: "Writes", used: usage.kv_write || 0, limit: QUOTAS.kv_write, percentage: (((usage.kv_write || 0) / QUOTAS.kv_write) * 100).toFixed(2), unit: "Req", period: "日結算" },
          kv_delete: { id: "kv_delete", name: "Deletes", used: usage.kv_delete || 0, limit: QUOTAS.kv_delete, percentage: (((usage.kv_delete || 0) / QUOTAS.kv_delete) * 100).toFixed(2), unit: "Req", period: "日結算" },
          kv_list: { id: "kv_list", name: "Lists", used: usage.kv_list || 0, limit: QUOTAS.kv_list, percentage: (((usage.kv_list || 0) / QUOTAS.kv_list) * 100).toFixed(2), unit: "Req", period: "日結算" }
        };

        const resultData = JSON.stringify({
          updated_at: new Date().toISOString(),
          data: dashboardData
        });

        const cacheResponse = new Response(resultData, {
          headers: { "Content-Type": "application/json", "Cache-Control": "s-maxage=900" }
        });
        ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));
        
        return resultData;
      } catch (error) {
        throw error;
      }
    })();

    renderLocks.set(cacheKeyUrl, fetchPromise);
    try {
      const resultData = await fetchPromise;
      response = new Response(resultData, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    } finally {
      renderLocks.delete(cacheKeyUrl);
    }
  }

  return response;
}

/**
 * 核心：取得 Cloudflare 真實數據 (GraphQL)
 */
async function fetchCloudflareUsage(apiToken, accountId) {
  // 修正時間對齊：官方儀表板是依據使用者的本地（例如 UTC+8）切換每日週期
  // 且 R2 配額為「每月」重置，Workers 與 D1 則是「每日」重置。
  const now = new Date();
  const twTime = new Date(now.getTime() + 8 * 3600000);
  
  // 取得台灣時間當日 00:00:00 與當月 1 號 00:00:00，再轉為正確的 UTC 基準供 API 篩選
  const startOfDay = new Date(Date.UTC(twTime.getUTCFullYear(), twTime.getUTCMonth(), twTime.getUTCDate()) - 8 * 3600000).toISOString();
  const startOfMonth = new Date(Date.UTC(twTime.getUTCFullYear(), twTime.getUTCMonth(), 1) - 8 * 3600000).toISOString();

  const query = `
    query($accountId: String!, $startOfDay: String!, $startOfMonth: String!) {
      viewer {
        accounts(filter: {accountTag: $accountId}) {
          workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $startOfDay}) {
            sum { requests }
          }
          d1QueriesAdaptiveGroups(limit: 10000, filter: {datetime_geq: $startOfDay}) {
            sum { rowsRead, rowsWritten }
          }
          r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $startOfMonth}) {
            dimensions { actionType }
            sum { requests }
          }
        }
      }
    }
  `;

  let workersRequests = 0;
  let d1RowsRead = 0;
  let d1RowsWritten = 0;
  let r2ClassA = 0;
  let r2ClassB = 0;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { accountId, startOfDay, startOfMonth } })
    });
    const json = await res.json();
    const accountData = json?.data?.viewer?.accounts?.[0];

    // 解析 Workers 請求
    workersRequests = accountData?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
    
    // 解析 D1 (讀/寫 Rows 數值計算)
    const d1Sum = accountData?.d1QueriesAdaptiveGroups?.[0]?.sum;
    if (d1Sum) {
      d1RowsRead = d1Sum.rowsRead || 0;
      d1RowsWritten = d1Sum.rowsWritten || 0;
    }

    // 解析 R2
    const r2Ops = accountData?.r2OperationsAdaptiveGroups || [];
    for (const op of r2Ops) {
      const action = op.dimensions?.actionType;
      const reqs = op.sum?.requests || 0;
      if (["PutObject", "ListObjects", "PutBucket", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration", "ListBuckets"].includes(action)) {
        r2ClassA += reqs;
      } else if (["GetObject", "HeadObject", "HeadBucket", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration", "UsageSummary"].includes(action)) {
        r2ClassB += reqs;
      }
    }
  } catch (err) {
    console.error("fetchCloudflareUsage failed:", err);
  }

  // 取得 D1 Database 總數量 (REST API)
  let d1Databases = 0;
  try {
    const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" }
    });
    const d1Json = await d1Res.json();
    if (d1Json.success) d1Databases = d1Json.result.length;
  } catch(err) {
    console.error("fetchD1Databases failed:", err);
  }

  // 回傳前端完整的結構化數據
  return {
    workers_requests: workersRequests,
    // workers_observability: 0, // 註解說明：Cloudflare API 未開放第三方呼叫 Observability 數據，在 CF 官方正式支援前不用。
    // workers_build: 0, // 註解說明：Build Minutes 官方無穩定 API，在 CF 官方正式支援前不用。
    d1_databases: d1Databases, 
    d1_rows_read: d1RowsRead, 
    d1_rows_written: d1RowsWritten,
    r2_class_a_ops: r2ClassA,
    r2_class_b_ops: r2ClassB,
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
        .period-tag { display: inline-block; font-size: 0.65rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 4px; background: rgba(148, 163, 184, 0.15); color: var(--text-secondary); margin-left: 0.5rem; border: 1px solid rgba(148, 163, 184, 0.2); vertical-align: middle; transform: translateY(-1px); }
        .stats-row { display: flex; justify-content: space-between; }
        .stat-label { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.25rem; }
        .category-container { margin-bottom: 2.5rem; }
        .category-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: var(--text-primary); padding-bottom: 0.5rem; border-bottom: 1px solid var(--card-border); }
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
        <main id="dashboard-data">
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
            
            // 梳理指標的分類：對齊官方儀表板介面的大項目與分類
            const categories = {
                "Workers & Pages": [data.workers_requests], // workers_observability, workers_build 因無官方API暫時隱藏
                "R2 Object Storage": [data.r2_class_a, data.r2_class_b], // r2_storage 置換無有效公開 API 暫隱藏
                "D1 Database": [data.d1_databases, data.d1_read, data.d1_written], // d1_storage 置換無有效公開 API 暫隱藏
                "Workers KV": [data.kv_read, data.kv_write, data.kv_delete, data.kv_list]
            };

            for (const [category, items] of Object.entries(categories)) {
                let sectionContent = \`<div class="category-container">\`;
                sectionContent += \`<h2 class="category-title">\${category}</h2>\`;
                sectionContent += \`<div class="grid-container">\`;
                
                items.forEach(item => {
                    if (!item) return;
                    const perc = parseFloat(item.percentage);
                    let statusClass = "";
                    if (perc >= 95) statusClass = "danger";
                    else if (perc >= 80) statusClass = "warning";
                    
                    sectionContent += \`
                        <div class="glass-card">
                            <div class="card-header">
                                <span style="font-weight:600">\${item.name}<span class="period-tag">\${item.period}</span></span>
                                <span class="percentage-badge" style="\${perc >= 80 ? 'color:white; border-color:transparent; background:red' : ''}">\${perc}%</span>
                            </div>
                            <div class="progress-track"><div class="progress-bar \${statusClass}" style="width:\${Math.min(perc, 100)}%"></div></div>
                            <div class="stats-row">
                                <div><div class="stat-label">已使用</div><div>\${Number(item.used).toLocaleString()} \${item.unit}</div></div>
                                <div style="text-align:right"><div class="stat-label">額度</div><div>\${Number(item.limit).toLocaleString()} \${item.unit}</div></div>
                            </div>
                        </div>\`;
                });
                
                sectionContent += \`</div></div>\`;
                container.innerHTML += sectionContent;
            }
        }
        loadData();
    </script>
</body>
</html>
  `;
}

// ── 人機驗證與授權輔助函式 ──

/**
 * 檢查使用者是否具備存取權限 (Zero Trust 或有效的驗證 Cookie)
 */
async function isAuthorized(request, env) {
  // 1. 檢查 Cloudflare Access (Zero Trust) JWT
  // 這是使用者要求的功能：偵測到 Zero Trust 登入資訊時自動跳過
  if (request.headers.get('Cf-Access-Jwt-Assertion')) {
    return true;
  }

  // 2. 檢查本機驗證 Cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
  
  // 檢查是否存在驗證標記
  if (cookies.cf_usage_auth === 'authorized') {
    return true;
  }

  return false;
}

/**
 * 驗證 Turnstile Token 並設定 Cookie (有效期 24H)
 */
async function handleVerify(request, env) {
  try {
    const { token } = await request.json();
    if (!token) throw new Error("缺少 Token");

    const formData = new FormData();
    formData.append('secret', env.TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    formData.append('remoteip', request.headers.get('CF-Connecting-IP'));

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });

    const outcome = await result.json();
    if (outcome.success) {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'cf_usage_auth=authorized; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict; Secure'
        }
      });
    } else {
      return new Response(JSON.stringify({ success: false, error: '驗證失敗' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 返回 Turnstile 挑戰頁面 HTML
 */
function getChallengeHtml(siteKey) {
  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>人機驗證 - Cloudflare Usage</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
    <style>
        body { background-color: #0f121b; color: #f8fafc; font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); padding: 2.5rem; border-radius: 1.5rem; backdrop-filter: blur(16px); text-align: center; max-width: 400px; width: 90%; }
        h1 { font-size: 1.5rem; margin-bottom: 1rem; background: linear-gradient(to right, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 2rem; line-height: 1.5; }
        #turnstile-container { display: flex; justify-content: center; min-height: 65px; }
        .loading { color: #3b82f6; font-size: 0.875rem; display: none; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>安全檢查</h1>
        <p>為了保護系統安全，請完成下方的人機驗證以存取儀表板。</p>
        <div id="turnstile-container" class="cf-turnstile" data-sitekey="${siteKey || ''}" data-callback="onVerify"></div>
        <div id="loading" class="loading">正在驗證身分，請稍候...</div>
    </div>
    <script>
        async function onVerify(token) {
            document.getElementById('loading').style.display = 'block';
            try {
                const res = await fetch('/api/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const result = await res.json();
                if (result.success) {
                    window.location.reload();
                } else {
                    alert('驗證失敗：' + (result.error || '原因未知'));
                    window.location.reload();
                }
            } catch (e) {
                alert('連線失敗，請稍後再試');
            }
        }
    </script>
</body>
</html>`;
}

// ── 安全性輔助工具 ──

/**
 * 封裝常用的 HTTP 安全標頭
 */
function withSecurityHeaders(response) {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('X-Frame-Options', 'DENY');
  newResponse.headers.set('X-Content-Type-Options', 'nosniff');
  newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CSP: 限制資源來源，允許內聯樣式、Turnstile 腳本與 API 存取
  const csp = "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com; " +
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "font-src https://fonts.gstatic.com; " +
              "img-src 'self' data:; " +
              "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com; " +
              "frame-src https://challenges.cloudflare.com; " +
              "worker-src 'self' blob:;";
  newResponse.headers.set('Content-Security-Policy', csp);

  return newResponse;
}

/**
 * 資源耗盡與限流防護 (利用 Cache API 實作零成本計數)
 */
async function checkRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return null;

  const url = new URL(request.url);
  const isApiRequest = url.pathname.startsWith('/api/');
  const type = isApiRequest ? 'api' : 'dash';

  const threshold = parseInt(isApiRequest ? (env.RATE_LIMIT_API || '15') : (env.RATE_LIMIT_DASH || '30'));
  const cache = caches.default;
  const baseUrl = `http://ratelimit.local/${type}/${ip}`;

  const blockKey = new Request(`${baseUrl}/blocked`);
  const isBlocked = await cache.match(blockKey);
  if (isBlocked) return new Response('Too Many Requests (IP Blocked)', { status: 429 });

  const countKey = new Request(`${baseUrl}/count`);
  const cachedRes = await cache.match(countKey);
  let currentCount = cachedRes ? (parseInt(await cachedRes.text()) || 0) : 0;

  if (currentCount >= threshold) {
    const blockRes = new Response('blocked', { headers: { 'Cache-Control': 'max-age=60, s-maxage=60' } });
    await cache.put(blockKey, blockRes);
    return new Response('Too Many Requests', { status: 429 });
  }

  const nextCountRes = new Response((currentCount + 1).toString(), { headers: { 'Cache-Control': 'max-age=60, s-maxage=60' } });
  await cache.put(countKey, nextCountRes);
  return null;
}
