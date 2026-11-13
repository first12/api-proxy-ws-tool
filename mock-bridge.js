// ISOLATED world 桥接：读 storage 里的规则，把 mock 表下发给 MAIN world。
// MAIN world 拿不到 chrome.storage，因此所有热更新都从这里转发。
(function () {
  if (window.__MOCK_BRIDGE__ === 4) return;
  window.__MOCK_BRIDGE__ = 4;

  var SOURCE = "api-proxy-mock";
  var KEY = "proxyRules";
  var STATUS_KEY = "proxySyncStatus";
  var RM = globalThis.RuleModel;

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
    try { console.info("[MockBridge] 下发配置：mock 规则 " + table.length + " 条", table.map(function (r) { return (r.name || r.id) + " " + r.match.host + r.match.path; })); } catch (e) {}
    window.postMessage({ __mockSource: SOURCE, type: "config", enabled: table.length > 0, table: table }, "*");
  }

  // 已知 Chromium 问题：registerContentScripts 注册的 world:"MAIN" 脚本可能"注册成功但不注入"。
  // 桥接脚本运行后短暂等待引擎的 hello；没等到就通过 <script> 标签把引擎补注入 MAIN world
  // （rules-model.js / mock-inject.js 均已在 web_accessible_resources 中）。
  function injectMainFallback() {
    if (fallbackTried || mainAlive) return;
    fallbackTried = true;
    try { console.warn("[MockBridge] MAIN 引擎未就绪，降级为 <script> 标签注入"); } catch (e) {}
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
      try { console.info("[MockBridge] MAIN 引擎已就绪"); } catch (e) {}
      mainAlive = true;
      reload();
    }
  });

  // 脚本在 document_start 运行，页面可能还没准备好监听；postMessage 由 MAIN world 的监听器异步接收
  try { console.info("[MockBridge] 桥接已加载", location.href); } catch (e) {}
  reload();
  // 给 MAIN world 注册注入一个短暂的确认窗口，未就绪则走 <script> 降级注入
  setTimeout(injectMainFallback, 500);
})();
