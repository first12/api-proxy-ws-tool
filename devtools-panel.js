// DevTools 面板：左侧连接索引 + 右侧帧表（主从布局）。
// chrome.devtools.network 没有 WebSocket 帧事件，帧从页面侧钩子读取。
let currentPage = null;
let lastSeq = 0;
let rightLastSeq = 0;
let selectedId = null;
let data = { frames: [], connections: [] };
const framesByConn = new Map();
const connMeta = new Map();
const pendingRows = new Map(); // seq -> 二进制帧的 DOM 引用
let renderedSeqList = [];

const ui = { q: "", host: "", st: "all", onlyFrames: false, dir: "all", payloadQ: "", loaded: 20, follow: true };

const $ = (s) => document.querySelector(s);

function evalInPage(expression, callback) {
  chrome.devtools.inspectedWindow.eval(expression, { useContentScriptContext: false }, (result, isException) => {
    if (callback) callback(result, isException);
  });
}

// 静态注入：页面通过 web_accessible_resources 加载打包好的钩子文件，注入即执行。
// inspectedWindow.eval 只做“创建 script 标签”这一最小桥接，不再把源码字符串喂给 eval。
function inject(cb) {
  const url = chrome.runtime.getURL("ws-hook-source.js");
  evalInPage(
    "(function(){ if (window.__WS_VERSION__ === 3) return; var s = document.createElement('script');" +
    "s.src = " + JSON.stringify(url) + "; (document.head || document.documentElement).appendChild(s); })()",
    () => { if (cb) cb(); }
  );
}

// 降级路径：站点未授权时 chrome.scripting 无法注册内容脚本，改为面板打开期间静态注入 mock 脚本。
// 同样只创建 <script> 标签，不把源码字符串交给 eval。
function injectMock(cb) {
  const rmUrl = chrome.runtime.getURL("rules-model.js");
  const mockUrl = chrome.runtime.getURL("mock-inject.js");
  evalInPage(
    "(function(){ if (window.__MOCK_VERSION__ === 4) return;" +
    " var rm = document.createElement('script'); rm.src = " + JSON.stringify(rmUrl) + ";" +
    " rm.onload = function(){ var mi = document.createElement('script'); mi.src = " + JSON.stringify(mockUrl) +
    "; (document.head || document.documentElement).appendChild(mi); };" +
    " (document.head || document.documentElement).appendChild(rm); })()",
    () => { if (cb) cb(); }
  );
}

function pushMockConfig() {
  chrome.storage.local.get("proxyRules", (res) => {
    const table = RuleModel.buildMockTable(res.proxyRules || []);
    const cfg = JSON.stringify({ source: "api-proxy-mock", table, enabled: table.length > 0 });
    evalInPage(
      "window.__MOCK_CONFIG__ = " + cfg + ";" +
      "window.postMessage({ __mockSource: 'api-proxy-mock', type: 'config', table: window.__MOCK_CONFIG__.table," +
      " enabled: window.__MOCK_CONFIG__.enabled }, '*');"
    );
  });
}

function injectAll() {
  inject();
  injectMock(() => pushMockConfig());
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.proxyRules) pushMockConfig();
});

function readBuffer(callback) {
  evalInPage(
    "JSON.stringify({page: location.href, frames: window.__WS_FRAMES__ || [], connections: window.__WS_CONNECTIONS__ || []})",
    (result, isException) => {
      if (isException) return;
      let parsed = null;
      try { parsed = JSON.parse(result); } catch (e) { return; }
      callback(parsed);
    }
  );
}

function sizeText(bytes) {
  if (!bytes) return "0B";
  if (bytes < 1024) return bytes + "B";
  const kb = bytes / 1024;
  return kb >= 1024 ? (kb / 1024).toFixed(1) + "MB" : kb.toFixed(1) + "KB";
}

function timeText(ms, withMs) {
  const d = new Date(ms);
  // 时间格式跟随界面语言：英文环境用 en-US，其余用 zh-CN
  const base = d.toLocaleTimeString(I18N.lang === "en" ? "en-US" : "zh-CN", { hour12: false });
  return withMs ? base + "." + String(d.getMilliseconds()).padStart(3, "0") : base;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hostOf(url) {
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(url || "");
  return m ? m[1] : "";
}

function urlShort(url) {
  return String(url || "").replace(/^(wss?|http)\:\/\//, "");
}

function connFrames(id) {
  return framesByConn.get(id) || [];
}

// ---------- 左侧连接索引 ----------

function filteredConns() {
  const q = ui.q.trim().toLowerCase();
  const list = Array.from(connMeta.values()).filter((c) => {
    if (ui.onlyFrames && !connFrames(c.id).length) return false;
    if (ui.host && hostOf(c.url) !== ui.host) return false;
    if (ui.st === "open" && c.closedAt) return false;
    if (ui.st === "closed" && !c.closedAt) return false;
    if (q && !(c.id + " " + (c.url || "")).toLowerCase().includes(q)) return false;
    return true;
  });
  // 新连接在前，便于最近建立的连接被看到
  return list.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

function renderConnList() {
  document.getElementById("connTotal").textContent = String(connMeta.size);
  const listEl = document.getElementById("connList");
  const prevScroll = listEl.scrollTop;
  const rows = filteredConns();
  const shown = rows.slice(0, ui.loaded);

  listEl.innerHTML = "";
  shown.forEach((c) => {
    const frames = connFrames(c.id);
    const el = document.createElement("div");
    el.className = "conn-item" + (c.id === selectedId ? " active" : "");
    el.dataset.id = c.id;
    el.innerHTML =
      '<div class="conn-line1">' +
        '<span class="dot ' + (c.closedAt ? "" : "ok") + '"></span>' +
        '<span class="conn-id">' + escapeHtml(c.id) + '</span>' +
        '<span class="conn-url" title="' + escapeHtml(c.url) + '">' + escapeHtml(urlShort(c.url)) + '</span>' +
      '</div>' +
      '<div class="conn-line2">' +
        '<span>' + (c.openedAt ? timeText(c.openedAt) : I18N.t("panel.connecting")) + '</span>' +
        '<span>' + I18N.t("panel.frameCount", { n: frames.length }) + '</span>' +
        (c.truncated ? '<span class="trunc">' + escapeHtml(I18N.t("panel.truncatedShort")) + '</span>' : "") +
        '<span class="code">' + (c.closedAt ? ("code " + (c.closeCode == null ? "-" : c.closeCode)) : I18N.t("panel.inProgress")) + '</span>' +
      '</div>';
    listEl.appendChild(el);
  });

  document.getElementById("loadInfo").textContent = I18N.t("panel.loadInfo", { shown: shown.length, total: rows.length });
  document.getElementById("loadMore").disabled = shown.length >= rows.length;
  listEl.scrollTop = prevScroll;
}

function renderHostOptions() {
  const sel = document.getElementById("hostSel");
  const hosts = Array.from(new Set(Array.from(connMeta.values()).map((c) => hostOf(c.url)).filter(Boolean)));
  const current = ui.host;
  sel.innerHTML = '<option value="">' + escapeHtml(I18N.t("panel.allHosts")) + '</option>' + hosts.map((h) =>
    '<option value="' + escapeHtml(h) + '"' + (h === current ? " selected" : "") + ">" + escapeHtml(h) + "</option>").join("");
}

// ---------- 右侧帧区 ----------

function selectedConn() {
  return selectedId ? connMeta.get(selectedId) : null;
}

function dirCounts() {
  const c = { all: 0, in: 0, out: 0, open: 0, close: 0 };
  connFrames(selectedId).forEach((f) => {
    c.all++;
    if (c[f.direction] != null) c[f.direction]++;
  });
  return c;
}

function renderDirChips() {
  const c = dirCounts();
  const items = [["all", I18N.t("panel.dirAll")], ["in", "in"], ["out", "out"], ["open", "open"]];
  document.getElementById("dirChips").innerHTML = items.map(([k, label]) =>
    '<button class="dir-chip' + (ui.dir === k ? " active" : "") + '" data-dir="' + k + '">' + label + " " + c[k] + "</button>").join("");
}

function renderMainHead() {
  const c = selectedConn();
  const head = document.getElementById("mainHead");
  if (!c) {
    head.innerHTML = '<div class="l1"><span class="url">' + escapeHtml(I18N.t("panel.selectConnHint")) + '</span></div>';
    return;
  }
  const frames = connFrames(c.id);
  const l2 = [
    I18N.t("panel.openedAt", { time: c.openedAt ? timeText(c.openedAt, true) : "-" }),
    I18N.t("panel.closedAt", { time: c.closedAt ? timeText(c.closedAt, true) : I18N.t("panel.inProgress") }),
    "closeCode " + (c.closeCode == null ? "-" : c.closeCode),
    I18N.t("panel.frameCount", { n: frames.length }),
    c.truncated ? I18N.t("panel.truncatedYes") : I18N.t("panel.truncatedNo")
  ].join(" · ");
  head.innerHTML =
    '<div class="l1"><span class="dot ' + (c.closedAt ? "" : "ok") + '"></span><span class="id">' + escapeHtml(c.id) + '</span>' +
    '<span class="url" title="' + escapeHtml(c.url) + '">' + escapeHtml(c.url) + "</span></div>" +
    '<div class="l2">' + escapeHtml(l2) + "</div>";
}

function frameVisible(f) {
  if (ui.dir !== "all" && f.direction !== ui.dir) return false;
  const q = ui.payloadQ.trim().toLowerCase();
  if (!q) return true;
  return String(f.payload || "").toLowerCase().includes(q) || String(f.previewBase64 || "").toLowerCase().includes(q);
}

function payloadText(f) {
  if (f.kind === "binary") {
    return f.pending ? I18N.t("panel.reading") : "bin · " + sizeText(f.byteLength) + (f.truncated ? I18N.t("panel.truncatedMarker") : "");
  }
  return f.payload;
}

function isWide(f) {
  return f.kind === "binary" || String(f.payload || "").length > 600;
}

function renderRow(f) {
  const row = document.createElement("div");
  row.className = "frame-row" + (isWide(f) ? " wide" : "");
  row.dataset.seq = f.seq;
  const lenText = f.kind === "binary" ? sizeText(f.byteLength) : (f.byteLength ? f.byteLength + "B" : "0B");
  row.innerHTML =
    '<span class="time">' + timeText(f.ts, true) + "</span>" +
    '<span><span class="dir ' + escapeHtml(f.direction) + '">' + escapeHtml(f.direction) + "</span></span>" +
    '<span class="len' + (String(f.payload || "").length > 600 ? " big" : "") + '">' + escapeHtml(lenText) + "</span>" +
    '<span class="payload' + (f.kind === "binary" ? " bin" : "") + '" title="' + escapeHtml(payloadText(f)) + '">' + escapeHtml(payloadText(f)) + "</span>" +
    '<button class="text" data-seq="' + f.seq + '"' + (isWide(f) ? "" : ' style="visibility:hidden"') + ">" + escapeHtml(I18N.t("panel.view")) + "</button>";

  if (f.pending) {
    pendingRows.set(f.seq, {
      payload: row.querySelector(".payload"),
      len: row.querySelector(".len")
    });
  }
  return row;
}

function frameListEl() { return document.getElementById("frameList"); }

function appendFrame(f) {
  if (!frameVisible(f)) return;
  frameListEl().appendChild(renderRow(f));
}

function rebuildFrames() {
  const listEl = frameListEl();
  listEl.innerHTML = "";
  pendingRows.clear();
  renderedSeqList = [];
  if (!selectedId) return;
  const frames = connFrames(selectedId).filter(frameVisible);
  frames.forEach((f) => {
    appendFrame(f);
    renderedSeqList.push(f.seq);
  });
  rightLastSeq = connFrames(selectedId).length ? connFrames(selectedId)[connFrames(selectedId).length - 1].seq : 0;
  updateEmptyMain();
  updateFrameFoot();
  if (ui.follow) listEl.scrollTop = listEl.scrollHeight;
}

function updateFrameFoot() {
  const c = selectedConn();
  const total = connFrames(selectedId).length;
  const visible = renderedSeqList.length;
  document.getElementById("frameFoot").textContent = c
    ? I18N.t("panel.frameFoot", { visible: visible, total: total }) +
      (c.truncated ? I18N.t("panel.frameFootTruncated") : "") +
      (ui.follow ? I18N.t("panel.frameFootFollowing") : I18N.t("panel.frameFootPaused"))
    : "";
}

function updateEmptyMain() {
  const empty = document.getElementById("emptyMain");
  const c = selectedConn();
  if (!c) {
    empty.style.display = "flex";
    document.getElementById("emptyTitle").textContent = I18N.t("panel.selectConnHint");
    document.getElementById("emptyDesc").textContent = I18N.t("panel.emptyDesc");
    return;
  }
  const total = connFrames(selectedId).length;
  const visible = renderedSeqList.length;
  if (total === 0) {
    empty.style.display = "flex";
    document.getElementById("emptyTitle").textContent = I18N.t("panel.emptyTitleNoFrames");
    document.getElementById("emptyDesc").textContent = I18N.t("panel.emptyDescNoFrames");
  } else if (visible === 0) {
    empty.style.display = "flex";
    document.getElementById("emptyTitle").textContent = I18N.t("panel.emptyTitleFiltered");
    document.getElementById("emptyDesc").textContent = I18N.t("panel.emptyDescFiltered");
  } else {
    empty.style.display = "none";
  }
}

function selectConn(id) {
  if (selectedId === id) return;
  selectedId = id;
  ui.dir = "all";
  ui.payloadQ = "";
  document.getElementById("payloadSearch").value = "";
  renderConnList();
  renderMainHead();
  renderDirChips();
  rebuildFrames();
}

// ---------- 数据轮询 ----------

function resetAll() {
  data = { frames: [], connections: [] };
  framesByConn.clear();
  connMeta.clear();
  pendingRows.clear();
  renderedSeqList = [];
  selectedId = null;
  lastSeq = 0;
  rightLastSeq = 0;
  renderHostOptions();
  renderConnList();
  renderMainHead();
  renderDirChips();
  frameListEl().innerHTML = "";
  updateFrameFoot();
  updateEmptyMain();
}

function consume(incoming) {
  const frames = incoming.frames || [];
  const connections = incoming.connections || [];
  const maxSeq = frames.length ? frames[frames.length - 1].seq : 0;

  if (incoming.page !== currentPage || maxSeq < lastSeq || (frames.length === 0 && lastSeq !== 0)) {
    currentPage = incoming.page;
    resetAll();
  }

  let structureChanged = false;

  connections.forEach((c) => {
    const prev = connMeta.get(c.id);
    if (!prev) structureChanged = true;
    connMeta.set(c.id, c);
    if (!framesByConn.has(c.id)) framesByConn.set(c.id, []);
  });

  frames.forEach((f) => {
    if (f.seq <= lastSeq) return;
    const id = f.connId || "unknown";
    if (!framesByConn.has(id)) {
      framesByConn.set(id, []);
      structureChanged = true;
    }
    framesByConn.get(id).push(f);
  });

  if (frames.length) lastSeq = maxSeq;

  // 连接数/主机变化时刷新索引与 host 下拉
  if (structureChanged) {
    renderHostOptions();
    renderConnList();
  } else {
    updateConnCounts();
  }

  // 未选中时自动选中第一条（有帧优先）
  if (!selectedId && connMeta.size) {
    const withFrames = Array.from(connMeta.values()).find((c) => connFrames(c.id).length);
    selectConn((withFrames || Array.from(connMeta.values())[0]).id);
  }

  if (selectedId) {
    const all = connFrames(selectedId);
    all.forEach((f) => {
      if (f.seq > rightLastSeq) {
        appendFrame(f);
        if (frameVisible(f)) renderedSeqList.push(f.seq);
      }
      const row = pendingRows.get(f.seq);
      if (row && !f.pending) {
        row.payload.textContent = payloadText(f);
        row.payload.title = payloadText(f);
        row.len.textContent = sizeText(f.byteLength);
        pendingRows.delete(f.seq);
      }
    });
    if (all.length) rightLastSeq = all[all.length - 1].seq;
    if (ui.follow) frameListEl().scrollTop = frameListEl().scrollHeight;
    renderMainHead();
    updateFrameFoot();
    updateEmptyMain();
  }
}

function updateConnCounts() {
  // 只更新已渲染行的帧数文本，避免整表重绘造成闪烁
  const rows = Array.from(document.querySelectorAll("#connList .conn-item"));
  rows.forEach((el) => {
    const frames = connFrames(el.dataset.id);
    const line2 = el.querySelector(".conn-line2");
    if (line2) {
      const span = line2.querySelectorAll("span")[1];
      if (span) span.textContent = I18N.t("panel.frameCount", { n: frames.length });
    }
  });
}

function pull() {
  readBuffer((incoming) => {
    if (incoming.frames.length === 0 && incoming.connections.length === 0 && !lastSeq) {
      document.getElementById("hookHint").textContent = I18N.t("panel.hookHint");
    } else {
      document.getElementById("hookHint").textContent = "";
    }
    consume(incoming);
  });
}

// ---------- 事件 ----------

document.getElementById("connList").addEventListener("click", (e) => {
  const item = e.target.closest(".conn-item");
  if (item) selectConn(item.dataset.id);
});

document.getElementById("connSearch").addEventListener("input", (e) => {
  ui.q = e.target.value;
  ui.loaded = 20;
  ensureSelectionVisible();
  renderConnList();
});

document.getElementById("hostSel").addEventListener("change", (e) => {
  ui.host = e.target.value;
  ui.loaded = 20;
  ensureSelectionVisible();
  renderConnList();
});

// 当前选中连接不在筛选后的列表里时，自动选中第一条可见连接，避免右侧停留在不可见连接或空屏
function ensureSelectionVisible() {
  if (!selectedId) return;
  if (filteredConns().some((c) => c.id === selectedId)) return;
  const rows = filteredConns();
  selectedId = rows.length ? rows[0].id : null;
  ui.dir = "all";
  ui.payloadQ = "";
  document.getElementById("payloadSearch").value = "";
  renderConnList();
  renderMainHead();
  renderDirChips();
  rebuildFrames();
}

document.getElementById("connChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  ui.st = chip.dataset.st;
  ui.loaded = 20;
  Array.from(document.querySelectorAll("#connChips .chip")).forEach((c) => c.classList.toggle("active", c === chip));
  ensureSelectionVisible();
  renderConnList();
});

document.getElementById("onlyFrames").addEventListener("change", (e) => {
  ui.onlyFrames = e.target.checked;
  ui.loaded = 20;
  ensureSelectionVisible();
  renderConnList();
});

document.getElementById("loadMore").addEventListener("click", () => {
  ui.loaded += 20;
  renderConnList();
});

function connHasDir(id, dir) {
  if (dir === "all") return connFrames(id).length > 0;
  return connFrames(id).some((f) => f.direction === dir);
}

// 当前选中连接在 dir 方向下没有帧时，自动切到最近一个有该方向帧的连接，避免右侧空屏
function ensureSelectionForDir() {
  if (connHasDir(selectedId, ui.dir)) return;
  const fallback = Array.from(connMeta.values())
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
    .find((c) => connHasDir(c.id, ui.dir));
  if (fallback && fallback.id !== selectedId) {
    selectedId = fallback.id; // 直接换选中，避免 selectConn 重置 dir 造成循环
    renderConnList();
    renderMainHead();
  }
}

document.getElementById("dirChips").addEventListener("click", (e) => {
  const chip = e.target.closest(".dir-chip");
  if (!chip) return;
  ui.dir = chip.dataset.dir;
  renderDirChips();
  ensureSelectionForDir();
  renderDirChips();
  rebuildFrames();
});

document.getElementById("payloadSearch").addEventListener("input", (e) => {
  ui.payloadQ = e.target.value;
  rebuildFrames();
});

document.getElementById("followBtn").addEventListener("click", () => {
  ui.follow = !ui.follow;
  document.getElementById("followBtn").textContent = ui.follow ? I18N.t("panel.followLatest") : I18N.t("panel.paused");
  if (ui.follow) frameListEl().scrollTop = frameListEl().scrollHeight;
  updateFrameFoot();
});

frameListEl().addEventListener("scroll", () => {
  const el = frameListEl();
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  if (ui.follow && !atBottom) {
    ui.follow = false;
    document.getElementById("followBtn").textContent = I18N.t("panel.paused");
    updateFrameFoot();
  }
});

frameListEl().addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-seq]");
  if (!btn) return;
  const seq = Number(btn.dataset.seq);
  const frame = connFrames(selectedId).find((f) => f.seq === seq);
  if (frame) openOverlay(frame);
});

function openOverlay(frame) {
  const body = document.getElementById("ovBody");
  document.getElementById("ovTitle").textContent = I18N.t("panel.overlayTitle", { time: timeText(frame.ts, true), dir: frame.direction });
  if (frame.kind === "binary") {
    document.getElementById("ovMeta").textContent = sizeText(frame.byteLength) + (frame.truncated ? I18N.t("panel.previewLimit") : "");
    body.innerHTML = '<code>' + escapeHtml(frame.previewBase64 || I18N.t("panel.noPreview")) + '</code>' +
      '<div class="bin-hint">' + escapeHtml(I18N.t("panel.binHint")) + '</div>';
  } else {
    document.getElementById("ovMeta").textContent = I18N.t("panel.textMeta", { n: String(frame.payload || "").length });
    body.textContent = frame.payload || "";
  }
  document.getElementById("overlay").classList.add("show");
}

document.getElementById("ovClose").onclick = () => document.getElementById("overlay").classList.remove("show");
document.getElementById("ovCopy").onclick = () => {
  const text = document.getElementById("ovBody").textContent || "";
  navigator.clipboard.writeText(text).catch(() => {});
};

document.getElementById("clearBtn").onclick = () => {
  evalInPage(
    "(function(){ if (window.__WS_FRAMES__) window.__WS_FRAMES__.splice(0); if (window.__WS_CONNECTIONS__) window.__WS_CONNECTIONS__.splice(0); window.__WS_VERSION__ = 3; return true; })()",
    () => resetAll()
  );
};

// 导出：schema v2（按连接分组），direction/payload 等既有字段语义不变
function buildExport(input) {
  const connections = input.connections || [];
  const frames = input.frames || [];
  const groups = new Map();
  const order = [];

  connections.forEach((c) => {
    const group = {
      id: c.id,
      url: c.url,
      openedAt: c.openedAt ? new Date(c.openedAt).toISOString() : null,
      closedAt: c.closedAt ? new Date(c.closedAt).toISOString() : null,
      closeCode: c.closeCode,
      truncated: !!c.truncated,
      frameCount: 0,
      frames: []
    };
    groups.set(c.id, group);
    order.push(group);
  });

  frames.forEach((f) => {
    let group = groups.get(f.connId);
    if (!group) {
      group = { id: f.connId || "unknown", url: f.url || "", openedAt: null, closedAt: null, closeCode: null, truncated: false, frameCount: 0, frames: [] };
      groups.set(group.id, group);
      order.push(group);
    }
    group.frames.push({
      direction: f.direction,
      timestamp: new Date(f.ts).toISOString(),
      ts: f.ts,
      kind: f.kind || "text",
      byteLength: f.byteLength || 0,
      previewBase64: f.previewBase64 || null,
      truncated: !!f.truncated,
      pending: !!f.pending,
      payload: f.payload
    });
  });

  // wsDataList：按时间顺序平铺所有收发（in/out）的文本帧 payload，便于下游直接消费消息数据。
  // payload 是合法 JSON 时自动解析为对象/数组，解析失败（纯文本/半截帧）保留原字符串。
  function parsePayload(text) {
    if (typeof text !== "string") return text;
    const s = text.trim();
    if (s.length < 2 || (s[0] !== "{" && s[0] !== "[")) return text;
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? parsed : text;
    } catch (e) {
      return text;
    }
  }
  const timed = [];
  order.forEach((group) => {
    group.frames.forEach((f) => {
      if ((f.direction === "in" || f.direction === "out") && f.kind === "text") {
        timed.push({ ts: f.ts, payload: parsePayload(f.payload) });
      }
    });
  });
  timed.sort((a, b) => a.ts - b.ts);
  const wsDataList = timed.map((x) => x.payload);

  return {
    exportedAt: new Date().toISOString(),
    page: input.page,
    wsDataList,
    connections: order.map((group) => { group.frameCount = group.frames.length; return group; })
  };
}

document.getElementById("exportBtn").onclick = () => {
  readBuffer((incoming) => {
    const payload = buildExport(incoming);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "ws-frames-" + new Date().getTime() + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });
};

// ---------- 初始化 ----------
// 等待语言字典就绪后再启动注入与轮询，保证首屏与后续动态渲染都使用当前语言
I18N.ready.then(() => {
  chrome.devtools.network.onNavigated.addListener(() => {
    currentPage = null;
    resetAll();
    setTimeout(() => injectAll(), 500);
  });

  injectAll();
  pull();
  setInterval(pull, 800);
});
