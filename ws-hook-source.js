// 由 DevTools 面板通过 chrome.devtools.inspectedWindow.eval 注入到被检查页面的主世界
(function () {
  // 版本号用于兼容旧版注入（旧版没有连接分组，会覆盖后再注入）
  if (window.__WS_FRAMES__ && window.__WS_CONNECTIONS__ && window.__WS_VERSION__ === 2) return;

  var NativeWS = window.WebSocket;
  if (!NativeWS) return;

  // 总量上限：按整页帧数计，而不是按连接计。
  // 理由：连接数不受页面控制（同 URL 可能有任意多条并发连接），按连接限流会让总内存随连接数无界增长。
  var MAX_TOTAL_FRAMES = 2000;
  var MAX_PAYLOAD = 8000;

  var frames = [];
  var connections = [];
  var connSeq = 0;
  var frameSeq = 0;

  window.__WS_VERSION__ = 2;
  window.__WS_FRAMES__ = frames;
  window.__WS_CONNECTIONS__ = connections;

  function findConn(id) {
    for (var i = 0; i < connections.length; i++) {
      if (connections[i].id === id) return connections[i];
    }
    return null;
  }

  function push(conn, direction, payload) {
    frames.push({
      seq: ++frameSeq,
      ts: Date.now(),
      connId: conn.id,
      url: conn.url,
      direction: direction,
      payload: String(payload).slice(0, MAX_PAYLOAD)
    });
    conn.frameCount++;

    if (frames.length > MAX_TOTAL_FRAMES) {
      var dropped = frames.shift();
      var owner = findConn(dropped.connId);
      if (owner) owner.truncated = true;
    }
  }

  function WSHook(url, protocols) {
    var ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
    var target = String(url);

    // 同一 URL 可能有多条并发连接，因此按连接实例分配 id，不按 url 合并
    var conn = {
      id: "ws-" + (++connSeq),
      url: target,
      openedAt: null,
      closedAt: null,
      closeCode: null,
      frameCount: 0,
      truncated: false
    };
    connections.push(conn);

    ws.addEventListener("open", function () {
      conn.openedAt = Date.now();
      push(conn, "open", target);
    });
    ws.addEventListener("close", function (e) {
      conn.closedAt = Date.now();
      conn.closeCode = e.code;
      push(conn, "close", "code=" + e.code);
    });
    ws.addEventListener("message", function (e) {
      push(conn, "in", typeof e.data === "string" ? e.data : "[binary]");
    });

    var nativeSend = ws.send;
    ws.send = function (data) {
      push(conn, "out", typeof data === "string" ? data : "[binary]");
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
