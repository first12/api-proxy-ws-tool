// ISOLATED world 桥接：读 storage 里的规则，把 mock 表下发给 MAIN world。
// MAIN world 拿不到 chrome.storage，因此所有热更新都从这里转发。
(function () {
  if (window.__MOCK_BRIDGE__ === 4) return;
  window.__MOCK_BRIDGE__ = 4;

  var SOURCE = "api-proxy-mock";
  var KEY = "proxyRules";
  var STATUS_KEY = "proxySyncStatus";
  var RM = globalThis.RuleModel;

  // 调试日志开关：代码配置（置 true 输出全链路诊断日志），也可由页面临时 window.__MOCK_DEBUG__ = true 打开
  var DEBUG = window.__MOCK_DEBUG__ === true;
  function dlog() {
    if (!DEBUG) return;
    try { console.info.apply(console, ["[MockBridge]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  // MAIN world 引擎是否已就绪（以 mock-inject 发来的 hello 为准）
  var mainAlive = false;
  var fallbackTried = false;

  function push(rules) {
    var table = [];
    try {
      table = RM && RM.buildMockTable ? RM.buildMockTable(rules) : [];
    } catch (e) {
      table = [];
    }
    dlog("下发配置：mock 规则 " + table.length + " 条", table.map(function (r) { return (r.name || r.id) + " " + r.match.host + r.match.path; }));
    window.postMessage({ __mockSource: SOURCE, type: "config", enabled: table.length > 0, table: table }, "*");
  }

  // 已知 Chromium 问题：registerContentScripts 注册的 world:"MAIN" 脚本可能"注册成功但不注入"。
  // 降级路径：优先让 SW 用 chrome.scripting.executeScript(world:MAIN) 注入（不受页面 CSP 限制）；
  // SW 不可达时再用 <script> 标签兜底（可能被页面 CSP 拦截）。
  function injectMainFallback() {
    if (fallbackTried || mainAlive) return;
    fallbackTried = true;
    try { console.warn("[MockBridge] MAIN 引擎未就绪，请求 SW 执行降级注入"); } catch (e) {}
    try {
      chrome.runtime.sendMessage({ type: "mockInjectMain" }, function (reply) {
        if (chrome.runtime.lastError || !reply || reply.ok !== true) {
          try { console.warn("[MockBridge] SW 降级注入失败，改用 <script> 标签", (reply && reply.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message)); } catch (e) {}
          injectViaScriptTag();
        } else {
          // 注入完成后再主动推一次配置，不依赖引擎 hello 的回环时序
          setTimeout(reload, 100);
        }
      });
    } catch (e) {
      injectViaScriptTag();
    }
  }

  function injectViaScriptTag() {
    function append(src, onload) {
      var s = document.createElement("script");
      s.src = src;
      if (onload) s.onload = onload;
      s.onerror = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    }
    append(chrome.runtime.getURL("rules-model.js"), function () {
      var rm = document.querySelector('script[src$="rules-model.js"]');
      if (rm) rm.remove();
      append(chrome.runtime.getURL("mock-inject.js"), function () {
        var mi = document.querySelector('script[src$="mock-inject.js"]');
        if (mi) mi.remove();
      });
    });
  }

  function reload() {
    try {
      chrome.storage.local.get(KEY, function (res) {
        if (chrome.runtime.lastError) return;
        var rules = Array.isArray(res && res[KEY]) ? res[KEY] : [];
        // 权限被撤销后，已注入页面也要停止 mock。
        // 内容脚本环境没有 chrome.permissions API，改由 service worker 代查。
        var origin = location.protocol + "//" + location.hostname;
        try {
          chrome.runtime.sendMessage({ type: "mockOriginGrant", origin: origin }, function (reply) {
            var granted = chrome.runtime.lastError || !reply ? true : reply.granted !== false;
            push(granted ? rules : []);
          });
        } catch (e) {
          push(rules);
        }
      });
    } catch (e) {}
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && (changes[KEY] || changes[STATUS_KEY])) reload();
    });
  } catch (e) {}

  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || event.data.__mockSource !== SOURCE) return;
    if (event.data.type === "hello") {
      dlog("MAIN 引擎已就绪");
      mainAlive = true;
      reload();
    }
  });

  // 脚本在 document_start 运行，页面可能还没准备好监听；postMessage 由 MAIN world 的监听器异步接收
  dlog("桥接已加载", location.href);
  reload();
  // 给 MAIN world 注册注入一个短暂的确认窗口，未就绪则走 <script> 降级注入
  setTimeout(injectMainFallback, 500);
})();
