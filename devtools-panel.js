// DevTools 面板：向被检查页面注入 WebSocket 钩子，按 WS 连接分组展示与导出
// chrome.devtools.network 没有 WebSocket 帧事件（只有 getHAR / onNavigated / onRequestFinished），
// 因此帧必须从页面侧采集，不能用 network API 直接拿。
let lastSeq = 0;
let currentPage = null;
let hookSource = null;
const connViews = new Map();
const logEl = document.getElementById("log");

function evalInPage(expression, callback) {
  chrome.devtools.inspectedWindow.eval(expression, { useContentScriptContext: false }, (result, isException) => {
    callback(result, isException);
  });
}

function inject(cb) {
  if (!hookSource) return;
  evalInPage(hookSource, () => {
    if (cb) cb();
  });
}

// 注入前先读入钩子源码，保证只有一份实现
fetch("ws-hook-source.js")
  .then((r) => r.text())
  .then((text) => {
    hookSource = text;
    inject();
  })
  .catch(() => {});

function readBuffer(callback) {
  evalInPage(
    "JSON.stringify({page: location.href, frames: window.__WS_FRAMES__ || [], connections: window.__WS_CONNECTIONS__ || []})",
    (result, isException) => {
      if (isException) return;
      let data = null;
      try { data = JSON.parse(result); } catch (e) { return; }
      callback(data);
    }
  );
}

function resetView() {
  logEl.innerHTML = "";
  connViews.clear();
  lastSeq = 0;
}

function connView(frame, connections) {
  const id = frame.connId || "unknown";
  let view = connViews.get(id);
  if (view) return view;

  const meta = connections.find((c) => c.id === id);

  const details = document.createElement("details");
  details.open = true;
  details.className = "conn";

  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = `${id} · ${frame.url || (meta && meta.url) || ""}`;
  const count = document.createElement("span");
  count.textContent = " · 0 帧";
  summary.appendChild(title);
  summary.appendChild(count);
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "frames";
  details.appendChild(body);

  logEl.appendChild(details);
  view = { details, body, count, frames: 0 };
  connViews.set(id, view);
  return view;
}

function renderFrame(frame, connections) {
  const view = connView(frame, connections);
  const div = document.createElement("div");
  div.className = "item";
  div.textContent = `[${new Date(frame.ts).toLocaleTimeString()}] [${frame.direction}] ${frame.payload}`;
  view.body.appendChild(div);
  view.frames += 1;
  view.count.textContent = " · " + view.frames + " 帧";
  logEl.scrollTop = logEl.scrollHeight;
}

function pull() {
  readBuffer((data) => {
    const frames = data.frames || [];
    const connections = data.connections || [];
    const maxSeq = frames.length ? frames[frames.length - 1].seq : 0;

    // 页面切换、清空、或缓冲被重置（seq 回退）时重建视图，避免跨页面/跨连接串数据
    if (data.page !== currentPage || maxSeq < lastSeq || (frames.length === 0 && lastSeq !== 0)) {
      currentPage = data.page;
      resetView();
    }

    // 钩子被页面覆盖或尚未注入时重试一次
    if (frames.length === 0 && !window.__hookRetry) {
      window.__hookRetry = true;
      inject(() => { window.__hookRetry = false; });
      return;
    }

    // 按单调帧序号做增量渲染：帧总量超过 2000 被裁剪后索引会前移，不能用数组下标
    frames.forEach((frame) => {
      if (frame.seq > lastSeq) renderFrame(frame, connections);
    });
    if (frames.length) lastSeq = maxSeq;
  });
}

setInterval(pull, 800);
pull();

document.getElementById("clearBtn").onclick = () => {
  evalInPage(
    "(function(){ if (window.__WS_FRAMES__) window.__WS_FRAMES__.splice(0); if (window.__WS_CONNECTIONS__) window.__WS_CONNECTIONS__.splice(0); return true; })()",
    () => {
      resetView();
    }
  );
};

// 导出：按连接分组，保留原有 direction/payload 字段名
function buildExport(data) {
  const connections = data.connections || [];
  const frames = data.frames || [];
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
      group = {
        id: f.connId || "unknown",
        url: f.url || "",
        openedAt: null,
        closedAt: null,
        closeCode: null,
        truncated: false,
        frameCount: 0,
        frames: []
      };
      groups.set(group.id, group);
      order.push(group);
    }
    group.frames.push({
      direction: f.direction,
      timestamp: new Date(f.ts).toISOString(),
      ts: f.ts,
      payload: f.payload
    });
  });

  return {
    exportedAt: new Date().toISOString(),
    page: data.page,
    connections: order.map((group) => {
      group.frameCount = group.frames.length;
      return group;
    })
  };
}

document.getElementById("exportBtn").onclick = () => {
  readBuffer((data) => {
    const payload = buildExport(data);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ws-frames-" + new Date().getTime() + ".json";
    a.click();
    URL.revokeObjectURL(url);
  });
};

// 页面导航后钩子随旧页面销毁，需要重新注入
chrome.devtools.network.onNavigated.addListener(() => {
  currentPage = null;
  resetView();
  setTimeout(() => inject(), 500);
});
