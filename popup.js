const $ = (s) => document.querySelector(s);
const R = RuleModel;
// 取词条：语言在 I18N.ready 后确定，渲染统一在 ready 之后执行
const T = (key, params) => I18N.t(key, params);

let rules = [];
let status = null;
const perms = {};

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function load() {
  const res = await chrome.storage.local.get(["proxyRules", "proxySyncStatus"]);
  rules = R.migrateRules(res.proxyRules || []).rules;
  status = res.proxySyncStatus || null;

  const hosts = {};
  rules.forEach((r) => { hosts[R.normalizeHost(r.match && r.match.host)] = true; });
  for (const host of Object.keys(hosts)) {
    if (!host) continue;
    const [https, http] = await Promise.all([
      chrome.permissions.contains({ origins: ["https://" + host + "/*"] }),
      chrome.permissions.contains({ origins: ["http://" + host + "/*"] })
    ]);
    perms[host] = { https: !!https, http: !!http };
  }
  render();
}

function pendingHosts() {
  const out = [];
  rules.forEach((r) => {
    if (r.enabled === false) return;
    const host = R.normalizeHost(r.match && r.match.host);
    const g = perms[host];
    if (host && g && !g.https && !g.http && out.indexOf(host) < 0) out.push(host);
  });
  return out;
}

function render() {
  const enabled = rules.filter((r) => r.enabled !== false).length;
  const pending = pendingHosts();

  $("#nAll").textContent = rules.length;
  $("#nOn").textContent = enabled;
  $("#nPend").textContent = pending.length;

  const bar = $("#syncBar");
  if (status && status.lastSyncError) {
    bar.className = "bar bad";
    bar.textContent = T("popup.syncFailed", { msg: status.lastSyncError });
  } else if (status) {
    bar.className = "bar " + (pending.length ? "warn" : "ok");
    bar.textContent = T("popup.syncDone", { n: status.applied || 0 })
      + (status.skippedNoPermission ? T("popup.syncPending", { n: status.skippedNoPermission }) : "")
      + (status.at
        ? " · " + new Date(status.at).toLocaleTimeString(I18N.lang === "en" ? "en-US" : "zh-CN", { hour12: false })
        : "");
  } else {
    bar.className = "bar warn";
    bar.textContent = T("popup.syncNever");
  }

  const wrap = $("#pendingWrap");
  wrap.innerHTML = "";
  pending.forEach((host) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      '<span class="h">' + escapeHtml(host) + '</span>' +
      '<span class="m">' + escapeHtml(T("popup.rowPending")) + '</span>' +
      '<button data-host="' + escapeHtml(host) + '">' + escapeHtml(T("popup.grant")) + '</button>';
    wrap.appendChild(row);
  });
  $("#pendingEmpty").style.display = pending.length ? "none" : "block";
}

// 等语言确定后再渲染，避免英文环境下首屏闪现中文
I18N.ready.then(() => {
  $("#pendingWrap").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const host = btn.dataset.host;
    // 必须由用户手势触发
    const granted = await chrome.permissions.request({
      origins: ["https://" + host + "/*", "http://" + host + "/*"]
    });
    if (!granted) {
      $("#syncBar").className = "bar bad";
      $("#syncBar").textContent = T("popup.grantDenied", { host: host });
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
    await load();
  });

  $("#openOptions").onclick = () => chrome.runtime.openOptionsPage();
  $("#resync").onclick = () => {
    chrome.runtime.sendMessage({ type: "resync" }, () => {
      void chrome.runtime.lastError;
      setTimeout(load, 300);
    });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.proxyRules || changes.proxySyncStatus)) {
      load().catch((e) => console.warn("[ProxyPlugin] popup 刷新失败", e));
    }
  });

  return load().catch((e) => {
    $("#syncBar").className = "bar bad";
    $("#syncBar").textContent = T("popup.initFailed", { msg: e.message });
  });
});
