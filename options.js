const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
const R = RuleModel;

const state = {
  rules: [],
  status: null,
  perms: {},
  filter: "all",
  q: "",
  editingId: null,
  draft: null,
  errors: []
};

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

async function load() {
  const res = await chrome.storage.local.get(["proxyRules", "proxySyncStatus"]);
  const migrated = R.migrateRules(res.proxyRules || []);
  state.rules = migrated.rules;
  state.status = res.proxySyncStatus || null;
  if (migrated.changed) {
    await chrome.storage.local.set({ proxyRules: state.rules });
  }
  await refreshPerms();
  render();
}

async function persist() {
  await chrome.storage.local.set({ proxyRules: state.rules });
  chrome.runtime.sendMessage({ type: "resync" }, () => void chrome.runtime.lastError);
}

async function refreshPerms() {
  const hosts = {};
  state.rules.forEach((r) => { hosts[R.normalizeHost(r.match && r.match.host)] = true; });
  for (const host of Object.keys(hosts)) {
    if (!host) continue;
    const [https, http] = await Promise.all([
      chrome.permissions.contains({ origins: ["https://" + host + "/*"] }),
      chrome.permissions.contains({ origins: ["http://" + host + "/*"] })
    ]);
    state.perms[host] = { https: !!https, http: !!http };
  }
}

// 派生状态：启用 / 停用 / 配置错误 / 待授权 / Mock 不生效
function ruleState(rule) {
  if (rule.enabled === false) return { key: "off", text: "已停用", dot: "warn" };
  const errors = R.validateRule(rule, state.rules);
  if (errors.length) return { key: "bad", text: "配置错误", dot: "bad", errors };
  const host = R.normalizeHost(rule.match && rule.match.host);
  const grant = state.perms[host] || { https: false, http: false };
  if (!grant.https && !grant.http) return { key: "pending", text: "待授权", dot: "warn", host };
  if (rule.action && rule.action.kind === "mock") return { key: "on", text: "Mock 生效", dot: "ok" };
  return { key: "on", text: "生效", dot: "ok" };
}

function targetText(rule) {
  const a = rule.action || {};
  if (a.kind === "mock") return "Mock " + ((a.mock && a.mock.status) || 200);
  if (a.kind === "url") return a.targetUrl || "未设置";
  return a.targetPath || "未设置";
}

function matchesQuery(rule) {
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [rule.match && rule.match.host, rule.match && rule.match.path, targetText(rule), rule.name].join(" ").toLowerCase();
  return hay.indexOf(q) >= 0;
}

function filteredRules() {
  return state.rules.filter((r) => {
    if (!matchesQuery(r)) return false;
    const st = ruleState(r);
    if (state.filter === "on") return st.key === "on";
    if (state.filter === "off") return st.key === "off";
    if (state.filter === "bad") return st.key === "bad";
    if (state.filter === "pending") return st.key === "pending";
    return true;
  });
}

function renderStats() {
  const counts = { all: state.rules.length, on: 0, off: 0, bad: 0, pending: 0 };
  state.rules.forEach((r) => {
    const st = ruleState(r);
    if (st.key === "on") counts.on++;
    if (st.key === "off") counts.off++;
    if (st.key === "bad") counts.bad++;
    if (st.key === "pending") counts.pending++;
  });
  $("#stats").innerHTML = `共 <b>${counts.all}</b> 条 · 生效 <b>${counts.on}</b> · 停用 <b>${counts.off}</b> · 异常 <b>${counts.bad}</b> · 待授权 <b>${counts.pending}</b>`;
  $("#nAll").textContent = counts.all;
  $("#nOn").textContent = counts.on;
  $("#nOff").textContent = counts.off;
  $("#nBad").textContent = counts.bad;
  $("#nPend").textContent = counts.pending;
  $$(".chip").forEach((el) => el.classList.toggle("active", el.dataset.filter === state.filter));
}

function renderTable() {
  const rows = filteredRules();
  const tbody = $("#tbody");
  tbody.innerHTML = "";

  rows.forEach((rule) => {
    const st = ruleState(rule);
    const tr = document.createElement("tr");
    if (state.editingId === rule.id) tr.className = "selected";
    const typeText = rule.action.kind === "mock" ? "Mock" : "转发";
    const subText = rule.action.kind === "mock" ? "本地响应" : (rule.action.kind === "url" ? "完整 URL" : "路径替换");
    const pendingBtn = st.key === "pending"
      ? ' <button class="text grant" data-id="' + escapeHtml(rule.id) + '">授权此域名</button>'
      : "";
    tr.innerHTML =
      '<td class="col-en"><button class="switch ' + (rule.enabled !== false ? "on" : "") + '" data-act="toggle" data-id="' + escapeHtml(rule.id) + '" aria-label="启用"></button></td>' +
      '<td class="col-match" title="' + escapeHtml((rule.match.host || "") + (rule.match.path || "")) + '">' +
        '<span class="host">' + escapeHtml(rule.match.host) + '</span><span class="path">' + escapeHtml(rule.match.path) + '</span>' +
      '</td>' +
      '<td class="col-type"><span class="tag">' + typeText + '</span> <span class="sub">' + subText + '</span></td>' +
      '<td class="col-target" title="' + escapeHtml(targetText(rule)) + '">' + escapeHtml(targetText(rule)) + '</td>' +
      '<td class="col-status"><span class="status"><span class="dot ' + st.dot + '"></span>' + st.text + pendingBtn + '</span></td>' +
      '<td class="col-order mono">P' + (Number(rule.order) + 1) + '</td>' +
      '<td class="col-act"><button class="text" data-act="edit" data-id="' + escapeHtml(rule.id) + '">编辑</button>' +
        '<button class="text danger" data-act="del" data-id="' + escapeHtml(rule.id) + '">删除</button></td>';
    tbody.appendChild(tr);
  });

  const empty = $("#empty");
  empty.classList.toggle("show", rows.length === 0);
  if (rows.length === 0) {
    const hasRules = state.rules.length > 0;
    $("#emptyTitle").textContent = hasRules ? "没有匹配的规则" : "还没有代理规则";
    $("#emptyDesc").textContent = hasRules
      ? "当前筛选或搜索条件下没有结果。"
      : "新增规则后会编译为 declarativeNetRequest 动态规则，仅对已授权的域名生效。";
    $("#emptyClear").style.display = hasRules ? "inline-block" : "none";
    $("#emptyNew").style.display = hasRules ? "none" : "inline-block";
  }
  renderStatusBar();
}

function renderStatusBar() {
  const s = state.status;
  const enabled = state.rules.filter((r) => r.enabled !== false).length;
  if (!s) {
    $("#syncText").textContent = "尚未同步 · 已启用 " + enabled + " 条";
    $("#syncAt").textContent = "";
    $("#syncErr").textContent = "";
    $("#retryBtn").style.display = "none";
    return;
  }
  const applied = s.applied || 0;
  const mockRules = s.mockRules || 0;
  const skipped = (s.skippedNoPermission || 0) + Math.max(0, (s.skippedOther || 0) - mockRules);
  const warnCount = (s.warnings || []).length;
  $("#syncText").textContent = "已启用 " + enabled + " 条 → 生成 " + applied + " 条 DNR 规则" +
    (skipped ? "（跳过 " + skipped + "）" : "") + (warnCount ? "（" + warnCount + " 条警告）" : "") +
    (mockRules ? " · Mock " + mockRules + " 条（注入 " + (s.mockMatches || 0) + " 个域名）" : "") +
    (s.exceeded ? " · 超出上限" : "");
  $("#syncAt").textContent = s.at ? "上次同步 " + fmtTime(s.at) : "";
  $("#syncErr").textContent = s.lastSyncError ? ("同步异常：" + s.lastSyncError) :
    (s.mockRegistrationError ? ("Mock 注入失败：" + s.mockRegistrationError) : "");
  $("#retryBtn").style.display = (s.lastSyncError || s.mockRegistrationError) ? "inline-block" : "none";
}

function render() {
  renderStats();
  renderTable();
}

// ---------- 抽屉 ----------

function openDrawer(rule) {
  state.editingId = rule ? rule.id : null;
  state.draft = rule ? JSON.parse(JSON.stringify(rule)) : newRule();
  fillForm(state.draft);
  $("#drawer").classList.add("open");
  $("#drawerTitle").textContent = rule ? "编辑规则" : "新建规则";
  $("#deleteBtn").style.display = rule ? "inline-block" : "none";
  clearErrors();
  updateKindUi();
  updateSummary();
  setTimeout(() => $("#fHost").focus(), 60);
}

function closeDrawer() {
  $("#drawer").classList.remove("open");
  state.editingId = null;
  state.draft = null;
  render();
}

function newRule() {
  const ids = new Set(state.rules.map((r) => r.id));
  return {
    id: R.nextRuleId(ids),
    name: "",
    enabled: true,
    order: state.rules.length,
    match: { scheme: "both", host: "", path: "/", caseSensitive: true },
    action: { kind: "prefix", targetPath: "", targetUrl: "", keepQuery: true, headers: [], mock: R.defaultMock() },
    scope: { resourceTypes: ["xmlhttprequest", "other"] },
    notes: "",
    meta: {}
  };
}

function fillForm(rule) {
  $("#fName").value = rule.name || "";
  $("#fEnabled").checked = rule.enabled !== false;
  $("#fScheme").value = rule.match.scheme || "both";
  $("#fHost").value = rule.match.host || "";
  $("#fPath").value = rule.match.path || "";
  $("#fCase").checked = rule.match.caseSensitive !== false;
  $("#fTargetPath").value = rule.action.targetPath || "";
  $("#fTargetUrl").value = rule.action.targetUrl || "";
  $("#fKeepQuery").checked = rule.action.keepQuery !== false;
  const mk = R.normalizeMock(rule.action.mock);
  $("#fMockStatus").value = mk.status;
  $("#fMockDelay").value = mk.delayMs;
  $("#fMockBodyType").value = mk.bodyType;
  $("#fMockType").value = mk.contentType || "application/json";
  $("#fMockBody").value = mk.body;
  renderMockHeaderRows(mk.headers);
  $("#fNotes").value = rule.notes || "";
  $$(".rt").forEach((cb) => {
    cb.checked = (rule.scope.resourceTypes || []).indexOf(cb.value) >= 0;
  });
  renderHeaderRows(rule.action.headers || []);
  $$("#kindSeg button").forEach((b) => b.classList.toggle("active", b.dataset.kind === rule.action.kind));
}

function fillDraftFromForm() {
  const d = state.draft;
  d.name = $("#fName").value.trim();
  d.enabled = $("#fEnabled").checked;
  d.match.scheme = $("#fScheme").value;
  d.match.host = $("#fHost").value.trim();
  d.match.path = $("#fPath").value.trim();
  d.match.caseSensitive = $("#fCase").checked;
  const kind = $("#kindSeg button.active").dataset.kind;
  d.action.kind = kind;
  d.action.targetPath = $("#fTargetPath").value.trim();
  d.action.targetUrl = $("#fTargetUrl").value.trim();
  d.action.keepQuery = $("#fKeepQuery").checked;
  d.action.mock = {
    status: parseInt($("#fMockStatus").value, 10) || 200,
    delayMs: parseInt($("#fMockDelay").value, 10) || 0,
    bodyType: $("#fMockBodyType").value,
    contentType: $("#fMockBodyType").value === "empty" ? "" : ($("#fMockType").value.trim() || "application/json"),
    body: $("#fMockBody").value,
    headers: readMockHeaders()
  };
  d.notes = $("#fNotes").value.trim();
  d.scope.resourceTypes = $$(".rt").filter((cb) => cb.checked).map((cb) => cb.value);
}

function renderHeaderRows(headers) {
  const wrap = $("#headerList");
  wrap.innerHTML = "";
  headers.forEach((h) => addHeaderRow(h));
}

function addHeaderRow(h) {
  const row = document.createElement("div");
  row.className = "header-row";
  row.innerHTML =
    '<input class="h-name" placeholder="X-Debug" value="' + escapeHtml(h && h.name || "") + '">' +
    '<select class="h-op"><option value="set">set</option><option value="append">append</option><option value="remove">remove</option></select>' +
    '<input class="h-value" placeholder="值" value="' + escapeHtml(h && h.value || "") + '">' +
    '<button class="rm" title="删除">×</button>';
  row.querySelector(".h-op").value = (h && h.operation) || "set";
  const sync = () => {
    const op = row.querySelector(".h-op").value;
    row.querySelector(".h-value").disabled = op === "remove";
    if (op === "remove") row.querySelector(".h-value").value = "";
  };
  row.querySelector(".h-op").onchange = sync;
  row.querySelector(".rm").onclick = () => { row.remove(); updateSummary(); };
  sync();
  $("#headerList").appendChild(row);
}

function readHeaderRows() {
  return $$("#headerList .header-row").map((row) => ({
    name: row.querySelector(".h-name").value.trim(),
    operation: row.querySelector(".h-op").value,
    value: row.querySelector(".h-value").value
  })).filter((h) => h.name);
}

function renderMockHeaderRows(headers) {
  const wrap = $("#mockHeaderList");
  wrap.innerHTML = "";
  headers.forEach((h) => addMockHeaderRow(h));
}

function addMockHeaderRow(h) {
  const row = document.createElement("div");
  row.className = "header-row";
  row.innerHTML =
    '<input class="h-name" placeholder="X-Mock" value="' + escapeHtml(h && h.name || "") + '">' +
    '<input class="h-value" placeholder="值" value="' + escapeHtml(h && h.value || "") + '">' +
    '<button class="rm" title="删除">×</button>';
  row.querySelector(".rm").onclick = () => { row.remove(); updateSummary(); };
  $("#mockHeaderList").appendChild(row);
}

function readMockHeaders() {
  return $$("#mockHeaderList .header-row").map((row) => ({
    name: row.querySelector(".h-name").value.trim(),
    value: row.querySelector(".h-value").value
  })).filter((h) => h.name);
}

function syncMockBodyUi() {
  const type = $("#fMockBodyType").value;
  $("#fMockBody").disabled = type === "empty";
  $("#fMockType").disabled = type === "empty";
}

function updateKindUi() {
  const kind = $("#kindSeg button.active").dataset.kind;
  $("#mockWrap").style.display = kind === "mock" ? "block" : "none";
  $("#headerGroup").style.display = kind === "mock" ? "none" : "block";
  $('[data-field="targetPath"]').style.display = kind === "prefix" ? "block" : "none";
  $('[data-field="targetUrl"]').style.display = kind === "url" ? "block" : "none";
  $("#fKeepQuery").closest(".checkline").style.display = kind === "url" ? "flex" : "flex";
  syncMockBodyUi();
}

function updateSummary() {
  if (!state.draft) return;
  fillDraftFromForm();
  const errors = R.validateRule(state.draft, state.rules);
  const host = R.normalizeHost(state.draft.match.host);
  const grant = state.perms[host] || { https: false, http: false };
  const compiled = R.compileRule(state.draft, state.draft.order, grant);
  const box = $("#compileSummary");
  box.className = "summary";

  if (errors.length) {
    box.className = "summary bad";
    box.textContent = "配置有 " + errors.length + " 个问题，保存后将不会生效。";
  } else if (!grant.https && !grant.http) {
    box.className = "summary warn";
    box.textContent = "未授权 " + host + "：保存后不会注入/编译，需在列表里点击「授权此域名」。";
  } else if (compiled.skipped === "mock") {
    box.className = "summary";
    box.textContent = "Mock 不生成 DNR 规则：保存后在已授权的页面上由 fetch/XHR 拦截器返回伪造响应（延迟 " +
      ((state.draft.action.mock && state.draft.action.mock.delayMs) || 0) + " ms）；仅覆盖页面脚本请求。";
  } else if (compiled.rules.length) {
    box.textContent = "将生成 " + compiled.rules.length + " 条 DNR 规则" +
      (compiled.rules.length > 1 ? "（转发 1 条 + 请求头 1 条）" : "（转发）") +
      "，优先级 P" + (Number(state.draft.order) + 1) + "。";
  } else {
    box.textContent = "当前配置不会生成 DNR 规则。";
  }

  const list = $("#errSummary");
  list.innerHTML = "";
  if (errors.length) {
    list.style.display = "block";
    errors.forEach((e) => {
      const li = document.createElement("li");
      li.textContent = e.message;
      list.appendChild(li);
    });
  } else {
    list.style.display = "none";
  }
  $("#saveBtn").disabled = errors.length > 0;
}

function clearErrors() {
  $$(".field").forEach((f) => f.classList.remove("invalid"));
  $$(".field .err").forEach((e) => { e.textContent = ""; });
  $("#headerErr").style.display = "none";
  $("#headerErr").textContent = "";
  $("#mockHeaderErr").style.display = "none";
  $("#mockHeaderErr").textContent = "";
  $("#errSummary").style.display = "none";
}

function showErrors(errors) {
  clearErrors();
  errors.forEach((e) => {
    if (e.field === "headers" || e.field === "mockHeaders") {
      const isMock = $("#kindSeg button.active").dataset.kind === "mock";
      const box = (isMock || e.field === "mockHeaders") ? $("#mockHeaderErr") : $("#headerErr");
      box.style.display = "block";
      box.textContent = box.textContent ? box.textContent + "；" + e.message : e.message;
      return;
    }
    const field = document.querySelector('.field[data-field="' + e.field + '"]');
    if (!field) return;
    field.classList.add("invalid");
    const err = field.querySelector(".err");
    if (err) {
      err.textContent = err.textContent ? err.textContent + "；" + e.message : e.message;
    }
  });
}

async function saveRule() {
  fillDraftFromForm();
  state.draft.action.headers = readHeaderRows();
  const errors = R.validateRule(state.draft, state.rules);
  if (errors.length) {
    showErrors(errors);
    updateSummary();
    return;
  }
  const draft = state.draft;
  const idx = state.rules.findIndex((r) => r.id === draft.id);
  if (idx >= 0) state.rules[idx] = draft;
  else state.rules.push(draft);
  state.rules.forEach((r, i) => { r.order = i; });
  await persist();
  closeDrawer();
  await refreshPerms();
  render();
}

async function deleteRule(id) {
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return;
  if (!confirm("删除规则「" + (rule.name || rule.match.host + rule.match.path) + "」？")) return;
  state.rules = state.rules.filter((r) => r.id !== id);
  state.rules.forEach((r, i) => { r.order = i; });
  await persist();
  if (state.editingId === id) closeDrawer();
  render();
}

async function requestHost(host) {
  const origins = ["https://" + host + "/*", "http://" + host + "/*"];
  try {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      $("#syncErr").textContent = "未获得 " + host + " 的授权，规则仍不会生效，可再次点击重试";
      return;
    }
    await refreshPerms();
    render();
  } catch (e) {
    $("#syncErr").textContent = "授权失败：" + (e.message || e);
  }
}

// ---------- 事件 ----------

$("#search").addEventListener("input", (e) => { state.q = e.target.value; renderTable(); });

$$(".chip").forEach((chip) => {
  chip.onclick = () => { state.filter = chip.dataset.filter; render(); };
});

$("#tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains("grant")) {
    const rule = state.rules.find((r) => r.id === id);
    if (rule) await requestHost(R.normalizeHost(rule.match.host));
    return;
  }
  const act = btn.dataset.act;
  const rule = state.rules.find((r) => r.id === id);
  if (!rule) return;
  if (act === "toggle") {
    rule.enabled = rule.enabled === false;
    await persist();
    render();
  } else if (act === "edit") {
    openDrawer(rule);
  } else if (act === "del") {
    await deleteRule(id);
  }
});

$("#newBtn").onclick = () => openDrawer(null);
$("#emptyNew").onclick = () => openDrawer(null);
$("#emptyClear").onclick = () => { state.q = ""; state.filter = "all"; $("#search").value = ""; render(); };
$("#cancelBtn").onclick = closeDrawer;
$("#saveBtn").onclick = saveRule;
$("#deleteBtn").onclick = () => deleteRule(state.editingId);
$("#addHeader").onclick = () => { addHeaderRow({}); updateSummary(); };
$("#retryBtn").onclick = () => {
  chrome.runtime.sendMessage({ type: "resync" }, () => void chrome.runtime.lastError);
  setTimeout(load, 300);
};
$("#importBtn").onclick = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : (data.proxyRules || []);
        const migrated = R.migrateRules(list);
        state.rules = migrated.rules;
        state.rules.forEach((r, i) => { r.order = i; });
        await persist();
        await refreshPerms();
        render();
      } catch (e) {
        $("#syncErr").textContent = "导入失败：" + e.message;
      }
    };
    reader.readAsText(file);
  };
  input.click();
};
$("#exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ proxyRules: state.rules }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "proxy-rules-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

$$("#kindSeg button").forEach((b) => {
  b.onclick = () => {
    $$("#kindSeg button").forEach((x) => x.classList.toggle("active", x === b));
    updateKindUi();
    updateSummary();
  };
});

["fHost", "fPath", "fTargetPath", "fTargetUrl", "fMockStatus", "fMockDelay", "fMockType", "fMockBody"].forEach((id) => {
  $("#" + id).addEventListener("input", updateSummary);
});
$("#fMockBodyType").addEventListener("change", () => { syncMockBodyUi(); updateSummary(); });
$("#addMockHeader").addEventListener("click", () => { addMockHeaderRow({ name: "", value: "" }); updateSummary(); });
$("#fScheme").addEventListener("change", updateSummary);
$("#fCase").addEventListener("change", updateSummary);
$("#fKeepQuery").addEventListener("change", updateSummary);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.proxyRules || changes.proxySyncStatus) {
    load().catch((e) => console.warn("[ProxyPlugin] 刷新失败", e));
  }
});

load().catch((e) => {
  console.error("[ProxyPlugin] options 初始化失败", e);
  $("#syncErr").textContent = "初始化失败：" + e.message;
});
