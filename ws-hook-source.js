// 由 DevTools 面板通过 chrome.devtools.inspectedWindow.eval 注入到被检查页面的主世界
(function () {
  if (window.__WS_FRAMES__) return;

  var NativeWS = window.WebSocket;
  if (!NativeWS) return;

  var MAX = 2000;
  var frames = [];
  window.__WS_FRAMES__ = frames;

  function push(direction, payload) {
    frames.push({
      ts: Date.now(),
      direction: direction,
      payload: String(payload).slice(0, 8000)
    });
    if (frames.length > MAX) frames.shift();
  }

  function WSHook(url, protocols) {
    var ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
    var target = String(url);

    ws.addEventListener("open", function () {
      push("open", target);
    });
    ws.addEventListener("close", function (e) {
      push("close", "code=" + e.code);
    });
    ws.addEventListener("message", function (e) {
      push("in", typeof e.data === "string" ? e.data : "[binary]");
    });

    var nativeSend = ws.send;
    ws.send = function (data) {
      push("out", typeof data === "string" ? data : "[binary]");
      return nativeSend.apply(this, arguments);
    };

    return ws;
  }

  WSHook.prototype = NativeWS.prototype;
  WSHook.CONNECTING = NativeWS.CONNECTING;
  WSHook.OPEN = NativeWS.OPEN;
  WSHook.CLOSING = NativeWS.CLOSING;
  WSHook.CLOSED = NativeWS.CLOSED;

  window.WebSocket = WSHook;
})();
