// ISOLATED world 桥接：读 storage 里的规则，把 mock 表下发给 MAIN world。
// MAIN world 拿不到 chrome.storage，因此所有热更新都从这里转发。
(function () {
  if (window.__MOCK_BRIDGE__ === 4) return;
  window.__MOCK_BRIDGE__ = 4;

  var SOURCE = "api-proxy-mock";
  var KEY = "proxyRules";
  var STATUS_KEY = "proxySyncStatus";
  var RM = globalThis.RuleModel;

  function push(rules) {
    var table = [];
    try {
      table = RM && RM.buildMockTable ? RM.buildMockTable(rules) : [];
    } catch (e) {
      table = [];
    }
    window.postMessage({ __mockSource: SOURCE, type: "config", enabled: table.length > 0, table: table }, "*");
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
    if (event.data.type === "hello") reload();
  });

  // 脚本在 document_start 运行，页面可能还没准备好监听；postMessage 由 MAIN world 的监听器异步接收
  reload();
})();
