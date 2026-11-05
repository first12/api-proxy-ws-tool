// DevTools 面板：向被检查页面注入 WebSocket 钩子，并轮询页面内的帧缓冲
// chrome.devtools.network 没有 WebSocket 帧事件（只有 getHAR / onNavigated / onRequestFinished），
// 因此帧必须从页面侧采集，不能用 network API 直接拿。
let rendered = 0;
let hookSource = null;
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

function render(item) {
  const div = document.createElement("div");
  const time = new Date(item.ts).toLocaleTimeString();
  div.className = "item";
  div.textContent = `[${time}] [${item.direction}] ${item.payload}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function pull() {
  evalInPage("JSON.stringify(window.__WS_FRAMES__ || [])", (result, isException) => {
    if (isException) return;
    let frames = [];
    try { frames = JSON.parse(result); } catch (e) { return; }

    // 页面刷新/导航后缓冲被重置
    if (frames.length === 0 && rendered > 0) {
      logEl.innerHTML = "";
      rendered = 0;
    }
    // 钩子被页面覆盖或尚未注入时重试一次
    if (frames.length === 0 && !window.__hookRetry) {
      window.__hookRetry = true;
      inject(() => { window.__hookRetry = false; });
      return;
    }

    frames.slice(rendered).forEach(render);
    rendered = frames.length;
  });
}

setInterval(pull, 800);
pull();

document.getElementById("clearBtn").onclick = () => {
  evalInPage("window.__WS_FRAMES__ = []", () => {
    logEl.innerHTML = "";
    rendered = 0;
  });
};

document.getElementById("exportBtn").onclick = () => {
  evalInPage("JSON.stringify(window.__WS_FRAMES__ || [])", (result, isException) => {
    if (isException) return;
    const blob = new Blob([result], { type: "application/json" });
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
  logEl.innerHTML = "";
  rendered = 0;
  setTimeout(() => inject(), 500);
});
