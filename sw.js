// MV3 service worker：把 popup 里保存的规则同步成 declarativeNetRequest 动态重定向规则
// 原实现用 self.addEventListener("fetch") 劫持网页请求是无效的：
// 扩展 service worker 的 fetch 事件只作用于自身作用域，不会拦截网页的网络请求；
// 且 MV3 普通扩展拿不到 webRequestBlocking，只能走 declarativeNetRequest。
// 限制：DNR 只能改请求目标，无法返回自定义 Mock 响应体，也无法读取 WebSocket 帧，
// 所以 type=mock 的规则在此版本不生效（保持原行为，不删除字段）。

const RULES_KEY = "proxyRules";
const RESOURCE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest", "other", "websocket"];
const MAX_RULE_ID = 500;

function buildRedirect(rule) {
  if (rule.type !== "proxy") return null;
  if (rule.proxyMode === "fullUrl") {
    return rule.proxyTarget ? { url: rule.proxyTarget } : null;
  }
  // 路径替换：只改 path，query 由浏览器保留
  return rule.proxyPathPrefix ? { transform: { path: rule.proxyPathPrefix } } : null;
}

function toDynamicRules(proxyRules) {
  const dynamic = [];
  const used = new Set();

  // 规则有稳定 id 时优先复用 rule.id*2(+1) 作为 DNR id：编辑同一条时 DNR id 不变
  function pickId(rule, scheme) {
    if (Number.isInteger(rule.id)) {
      const preferred = rule.id * 2 + (scheme === "https" ? 0 : 1);
      if (preferred >= 1 && preferred <= MAX_RULE_ID && !used.has(preferred)) return preferred;
    }
    let fallback = 1;
    while (fallback <= MAX_RULE_ID && used.has(fallback)) fallback++;
    return fallback <= MAX_RULE_ID ? fallback : null;
  }

  for (const rule of proxyRules) {
    if (!rule.enable) continue;
    const redirect = buildRedirect(rule);
    if (!redirect || !rule.host || !rule.pathPattern) continue;

    // urlFilter 的 * 是通配符，分别给 http / https 生成一条，达到原 host + path 的匹配效果
    for (const scheme of ["https", "http"]) {
      const id = pickId(rule, scheme);
      if (id === null) break;
      used.add(id);
      dynamic.push({
        id,
        priority: 1,
        action: { type: "redirect", redirect },
        condition: {
          urlFilter: "|" + scheme + "://" + rule.host + rule.pathPattern,
          resourceTypes: RESOURCE_TYPES
        }
      });
    }
  }

  return dynamic;
}

async function syncRules() {
  const res = await chrome.storage.local.get(RULES_KEY);
  const proxyRules = res[RULES_KEY] || [];
  const existing = await chrome.declarativeNetRequest.getDynamicRules();

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: toDynamicRules(proxyRules)
  });

  console.log("[ProxyPlugin] 规则同步完成", proxyRules.length, "条配置");
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[RULES_KEY]) syncRules();
});

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);

syncRules();
