// 定義免費額度上限 (Quotas)
const QUOTAS = {
  workers_requests: 100000,
  d1_rows_read: 5000000,
  d1_rows_written: 100000,
  r2_class_b_ops: 10000000,
  r2_class_a_ops: 1000000
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function handleOptions(request) {
  let headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null &&
    headers.get("Access-Control-Request-Headers") !== null
  ) {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers"),
      },
    });
  }
  return new Response(null, {
    headers: {
      Allow: "GET, HEAD, POST, OPTIONS",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    // 檢查 API 金鑰與 Account ID 是否存在
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      return new Response(JSON.stringify({ error: "Missing CF configs (ACCOUNT_ID or API_TOKEN) in Worker vars/secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 實作快取，以快取網址為 Key (TTL: 15分鐘)
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (!response) {
      try {
        const usage = await fetchCloudflareUsage(env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_ACCOUNT_ID);
        
        const dashboardData = {
          workers_requests: {
            id: "workers_requests",
            name: "Workers (請求數)",
            used: usage.workers_requests,
            limit: QUOTAS.workers_requests,
            percentage: ((usage.workers_requests / QUOTAS.workers_requests) * 100).toFixed(2),
            unit: "Req"
          },
          d1_read: {
            id: "d1_read",
            name: "D1 (讀取行數)",
            used: usage.d1_rows_read,
            limit: QUOTAS.d1_rows_read,
            percentage: ((usage.d1_rows_read / QUOTAS.d1_rows_read) * 100).toFixed(2),
            unit: "Rows"
          },
          d1_written: {
            id: "d1_written",
            name: "D1 (寫入行數)",
            used: usage.d1_rows_written,
            limit: QUOTAS.d1_rows_written,
            percentage: ((usage.d1_rows_written / QUOTAS.d1_rows_written) * 100).toFixed(2),
            unit: "Rows"
          },
          r2_class_b: {
            id: "r2_class_b",
            name: "R2 (Class B操作)",
            used: usage.r2_class_b_ops,
            limit: QUOTAS.r2_class_b_ops,
            percentage: ((usage.r2_class_b_ops / QUOTAS.r2_class_b_ops) * 100).toFixed(2),
            unit: "Ops"
          }
        };

        response = new Response(JSON.stringify({
          updated_at: new Date().toISOString(),
          data: dashboardData
        }), {
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Cache-Control": "s-maxage=900" // Cache 900秒 = 15分鐘
          }
        });

        // 非同步寫入快取
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      } catch (error) {
        return new Response(JSON.stringify({ error: "Fetch Error: " + error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    return response;
  }
};

/**
 * 取得 Cloudflare 各項服務用量
 * ※ 此處包含 GraphQL 查詢範例，D1 等資料建議您根據需求擴展對應的 REST 端點
 */
async function fetchCloudflareUsage(apiToken, accountId) {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0]; // UTC 日期，符合 CF 重置時間

  // --- 1. 使用 GraphQL 獲取 Workers 使用量 ---
  const query = `
    query($accountId: String!, $date: String!) {
      viewer {
        accounts(filter: {accountTag: $accountId}) {
          workersInvocationsAdaptive(limit: 1000, filter: {date: $date}) {
            sum {
              requests
            }
          }
        }
      }
    }
  `;

  let workersRequests = 0;
  try {
    const graphqlResponse = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { accountId, date: dateStr }
      })
    });
    
    if (graphqlResponse.ok) {
      const graphqlData = await graphqlResponse.json();
      workersRequests = graphqlData?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
    }
  } catch (err) {
    console.error("GraphQL fetching error", err);
  }

  // --- 2. 其他服務 (可換成各自的 REST API 或繼續在上方撰寫 GraphQL) ---
  // R2 / D1 在官方文件中可能有另外的端點，此處提供介面佔位符作為擴充點
  return {
    workers_requests: workersRequests,
    d1_rows_read: Math.floor(Math.random() * 4500000),    // TODO: 介接真實 D1 API
    d1_rows_written: Math.floor(Math.random() * 50000),   // TODO: 介接真實 D1 API
    r2_class_b_ops: Math.floor(Math.random() * 8000000),  // TODO: 介接真實 R2 API
  };
}
