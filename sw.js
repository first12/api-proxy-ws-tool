// MV3 service worker：把 proxyRules 编译为 declarativeNetRequest 动态规则。
// MV3 的 service worker 里 fetch 监听不拦截网页请求，因此这里不再做 fetch 劫持。
importScripts("rules-model.js");

const STORAGE_KEY = "proxyRules";
const STATUS_KEY = "proxySyncStatus";

// 动态规则上限（Chrome 的 MAX_NUMBER_OF_DYNAMIC_RULES 通常为 500）
const MAX_DYNAMIC_RULES = 500;

// 串行化：避免两次 storage 变更交错覆盖
let chain = Promise.resolve();
function serial(task) {
  chain = chain.then(task, task);
  return chain;
}

async function readRules() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const raw = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
  const migrated = RuleModel.migrateRules(raw);
  if (migrated.changed) {
    await chrome.storage.local.set({ [STORAGE_KEY]: migrated.rules });
  }
  return migrated.rules;
}

// 每条规则按 scheme 检查站点权限，只编译已授权的 scheme
async function grantedMapFor(rules) {
  const map = {};
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const host = RuleModel.normalizeHost(rule.match && rule.match.host);
    if (!host || map[host]) continue;
    const [httpsGranted, httpGranted] = await Promise.all([
      chrome.permissions.contains({ origins: ["https://" + host + "/*"] }),
      chrome.permissions.contains({ origins: ["http://" + host + "/*"] })
    ]);
    map[host] = { https: !!httpsGranted, http: !!httpGranted };
  }
  return map;
}

async function writeStatus(status) {
  await chrome.storage.local.set({ [STATUS_KEY]: status });
}

// ---------- Mock 注入脚本的注册 / 注销 ----------
// 只在存在启用的 mock 规则、且对应主机已授权时注册；页面内的热更新由 mock-bridge.js 负责。
const MOCK_SCRIPT_IDS = ["mock-bridge", "mock-core"];

async function unregisterMockScripts() {
  if (!chrome.scripting) return;
  const list = await chrome.scripting.getRegisteredContentScripts();
  const ids = list.map((s) => s.id).filter((id) => MOCK_SCRIPT_IDS.indexOf(id) >= 0);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}

async function syncMockScripts(rules, grantedMap) {
  if (!chrome.scripting) return { registered: 0, error: "当前环境没有 chrome.scripting" };
  try {
    await unregisterMockScripts();
    const matches = [];
    rules.forEach((rule) => {
      if (!rule || rule.enabled === false || !rule.action || rule.action.kind !== "mock") return;
      const host = RuleModel.normalizeHost(rule.match && rule.match.host);
      if (!host) return;
      const grant = grantedMap[host] || { https: false, http: false };
      const scheme = (rule.match && rule.match.scheme) || "both";
      if ((scheme === "both" || scheme === "https") && grant.https) matches.push("https://" + host + "/*");
      if ((scheme === "both" || scheme === "http") && grant.http) matches.push("http://" + host + "/*");
    });
    const uniq = Array.from(new Set(matches));
    if (!uniq.length) return { registered: 0, error: null };

    await chrome.scripting.registerContentScripts([
      {
        id: MOCK_SCRIPT_IDS[0],
        js: ["rules-model.js", "mock-bridge.js"],
        matches: uniq,
        runAt: "document_start",
        world: "ISOLATED",
        persistAcrossSessions: true
      },
      {
        id: MOCK_SCRIPT_IDS[1],
        js: ["rules-model.js", "mock-inject.js"],
        matches: uniq,
        runAt: "document_start",
        world: "MAIN",
        persistAcrossSessions: true
      }
    ]);
    return { registered: uniq.length, error: null };
  } catch (err) {
    return { registered: 0, error: String(err && err.message ? err.message : err) };
  }
}

async function syncRules() {
  try {
    const rules = await readRules();
    const enabled = rules.filter((r) => r.enabled !== false);
    const granted = await grantedMapFor(enabled);

    const compiled = RuleModel.compileRules(rules, granted);
    const mock = await syncMockScripts(rules, granted);
    const addRules = compiled.rules;
    const exceeded = compiled.totalGenerated > MAX_DYNAMIC_RULES;
    const finalRules = addRules;

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);

    let failed = [];
    let lastSyncError = null;

    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: finalRules });
    } catch (batchError) {
      // 整批失败（通常是个别规则非法）：清空后逐条添加，把坏规则隔离出来
      lastSyncError = String(batchError && batchError.message ? batchError.message : batchError);
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
      } catch (clearError) {
        lastSyncError += " | 清理失败：" + String(clearError && clearError.message ? clearError.message : clearError);
      }
      for (const rule of finalRules) {
        try {
          await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
        } catch (e) {
          failed.push({
            id: rule.id,
            message: String(e && e.message ? e.message : e)
          });
        }
      }
    }

    const status = {
      at: Date.now(),
      ok: failed.length === 0 && !lastSyncError,
      configured: rules.length,
      applied: finalRules.length - failed.length,
      skippedNoPermission: compiled.skippedNoPermission.length,
      skippedOther: compiled.skippedOther.length + compiled.failed.length,
      warnings: compiled.warnings,
      exceeded,
      failed,
      lastSyncError,
      mockRules: rules.filter((r) => r.enabled !== false && r.action && r.action.kind === "mock").length,
      mockMatches: mock.registered,
      mockRegistrationError: mock.error
    };
    await writeStatus(status);
    console.log("[ProxyPlugin] 规则同步完成", status);
    return status;
  } catch (err) {
    const status = {
      at: Date.now(),
      ok: false,
      configured: 0,
      applied: 0,
      skippedNoPermission: 0,
      skippedOther: 0,
      exceeded: false,
      failed: [],
      lastSyncError: String(err && err.message ? err.message : err),
      mockRules: 0,
      mockMatches: 0,
      mockRegistrationError: null
    };
    await writeStatus(status);
    console.error("[ProxyPlugin] 规则同步失败", err);
    return status;
  }
}

function resync() {
  return serial(syncRules);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  resync();
});

chrome.permissions.onAdded.addListener(() => resync());
chrome.permissions.onRemoved.addListener(() => resync());
chrome.runtime.onInstalled.addListener(() => resync());
chrome.runtime.onStartup.addListener(() => resync());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "resync") {
    resync().then((status) => sendResponse({ ok: true, status }));
    return true;
  }
  // 内容脚本环境没有 chrome.permissions，由 SW 代查（mock-bridge 用）
  if (msg && msg.type === "mockOriginGrant" && typeof msg.origin === "string") {
    chrome.permissions.contains({ origins: [msg.origin + "/*"] })
      .then((granted) => sendResponse({ granted: !!granted }))
      .catch(() => sendResponse({ granted: true }));
    return true;
  }
  // MAIN world 注册注入失效时的降级：由 SW 直接向该标签页注入引擎（不受页面 CSP 限制）
  if (msg && msg.type === "mockInjectMain" && sender && sender.tab && sender.tab.id != null) {
    console.log("[ProxyPlugin] 收到降级注入请求，tabId =", sender.tab.id, "frame =", sender.frameId);
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, allFrames: true },
      files: ["rules-model.js", "mock-inject.js"],
      world: "MAIN"
    }).then(
      () => { console.log("[ProxyPlugin] 降级注入成功"); sendResponse({ ok: true }); },
      (err) => {
        const m = String(err && err.message ? err.message : err);
        console.error("[ProxyPlugin] 降级注入失败：", m);
        sendResponse({ ok: false, error: m });
      }
    );
    return true;
  }
  return false;
});

// SW 冷启动也同步一次，保证重启后状态与 storage 一致
resync();
