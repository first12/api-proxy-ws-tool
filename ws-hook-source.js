// 由 DevTools 面板经 web_accessible_resources 以 <script> 注入被检查页面主世界。
// 注入即执行（自执行 IIFE），不需要面板读取源码再 eval，也没有 fetch / 远程代码。
(function () {
  // 版本号用于兼容旧版注入（旧版没有连接分组/二进制支持，会覆盖后再注入）
  if (window.__WS_FRAMES__ && window.__WS_CONNECTIONS__ && window.__WS_VERSION__ === 3) return;

  var NativeWS = window.WebSocket;
  if (!NativeWS) return;

  // 上限集中定义
  var MAX_TOTAL_FRAMES = 2000;    // 整页帧数上限（不按连接计：连接数不受页面控制）
  var MAX_PAYLOAD = 8000;         // 文本帧 payload 字符上限
  var MAX_BINARY_BYTES = 262144;  // 单帧二进制读取上限 256KB，同时约束 2000 帧总量的内存
  var PREVIEW_BYTES = 16;         // 超限时只保留前 16 字节预览
  var TEXT_RATIO = 0.9;           // 可打印字符占比阈值，低于此值按二进制处理

  var frames = [];
  var connections = [];
  var connSeq = 0;
  var frameSeq = 0;

  window.__WS_VERSION__ = 3;
  window.__WS_FRAMES__ = frames;
  window.__WS_CONNECTIONS__ = connections;

  function findConn(id) {
    for (var i = 0; i < connections.length; i++) {
      if (connections[i].id === id) return connections[i];
    }
    return null;
  }

  function frameBySeq(seq) {
    for (var i = frames.length - 1; i >= 0; i--) {
      if (frames[i].seq === seq) return frames[i];
    }
    return null;
  }

  function trim() {
    if (frames.length > MAX_TOTAL_FRAMES) {
      var dropped = frames.shift();
      var owner = findConn(dropped.connId);
      if (owner) owner.truncated = true;
    }
  }

  function base64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function utf8Length(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
    try {
      return unescape(encodeURIComponent(str)).length;
    } catch (e) {
      return str.length;
    }
  }

  // 能按 UTF-8 完整解码且可打印比例达标 → 视为文本
  function decodeIfText(bytes) {
    if (typeof TextDecoder === "undefined") return null;
    var text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return null;
    }
    if (!text.length) return "";

    var printable = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) { printable++; continue; }
      if (c >= 32 && c !== 127) printable++;
    }
    return printable / text.length >= TEXT_RATIO ? text : null;
  }

  // 文本帧：同步入列，顺序与调用顺序一致
  function pushText(conn, direction, data) {
    var payload = String(data);
    var cut = payload.length > MAX_PAYLOAD;
    frames.push({
      seq: ++frameSeq,
      ts: Date.now(),
      connId: conn.id,
      url: conn.url,
      direction: direction,
      kind: "text",
      byteLength: utf8Length(payload),
      previewBase64: null,
      truncated: cut,
      pending: false,
      payload: cut ? payload.slice(0, MAX_PAYLOAD) : payload
    });
    conn.frameCount++;
    trim();
  }

  // 二进制帧：先占位（占住 seq，保证与文本帧的先后顺序），异步读到字节后按 seq 回填
  function pushBinaryPlaceholder(conn, direction, byteLength) {
    var frame = {
      seq: ++frameSeq,
      ts: Date.now(),
      connId: conn.id,
      url: conn.url,
      direction: direction,
      kind: "binary",
      byteLength: byteLength,
      previewBase64: null,
      truncated: false,
      pending: true,
      payload: ""
    };
    frames.push(frame);
    conn.frameCount++;
    trim();
    return frame;
  }

  function fillBinary(seq, bytes, totalBytes, truncated) {
    var frame = frameBySeq(seq);
    if (!frame) return; // 已被总量上限裁剪：直接丢弃，不影响其他帧

    var text = null;
    if (bytes && !truncated) text = decodeIfText(bytes);

    frame.byteLength = totalBytes;
    frame.truncated = truncated;

    if (text !== null) {
      var cut = text.length > MAX_PAYLOAD;
      frame.kind = "text";
      frame.payload = cut ? text.slice(0, MAX_PAYLOAD) : text;
      frame.previewBase64 = null;
      frame.truncated = truncated || cut;
    } else {
      frame.kind = "binary";
      frame.payload = "";
      var preview = bytes || null;
      if (preview) preview = preview.subarray(0, truncated ? PREVIEW_BYTES : preview.length);
      frame.previewBase64 = preview ? base64(preview) : null;
    }

    frame.pending = false;
  }

  // 统一取字节：Blob / ArrayBuffer / TypedArray / DataView；字符串不走这里
  // 只取前 MAX_BINARY_BYTES，超出标记 truncated，避免大帧打爆内存
  function readBytes(data, cb) {
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      var size = data.size;
      var truncated = size > MAX_BINARY_BYTES;
      var part = truncated ? data.slice(0, MAX_BINARY_BYTES) : data;
      if (typeof part.arrayBuffer !== "function") {
        cb(null, size, true);
        return;
      }
      // 异步读取只做“回填”，不在此处 push 新帧
      part.arrayBuffer().then(function (buf) {
        cb(new Uint8Array(buf), size, truncated);
      }, function () {
        cb(null, size, true);
      });
      return;
    }

    if (data instanceof ArrayBuffer) {
      var len = Math.min(data.byteLength, MAX_BINARY_BYTES);
      cb(new Uint8Array(data, 0, len), data.byteLength, data.byteLength > MAX_BINARY_BYTES);
      return;
    }

    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) {
      var viewLen = Math.min(data.byteLength, MAX_BINARY_BYTES);
      cb(new Uint8Array(data.buffer, data.byteOffset, viewLen), data.byteLength, data.byteLength > MAX_BINARY_BYTES);
      return;
    }

    cb(null, 0, true);
  }

  // send 与 message 共用入口：字符串同步、二进制先占位后回填
  function record(conn, direction, data) {
    if (typeof data === "string") {
      pushText(conn, direction, data);
      return;
    }

    var sizeHint = 0;
    if (typeof Blob !== "undefined" && data instanceof Blob) sizeHint = data.size;
    else if (data instanceof ArrayBuffer) sizeHint = data.byteLength;
    else if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(data)) sizeHint = data.byteLength;

    var frame = pushBinaryPlaceholder(conn, direction, sizeHint);
    var seq = frame.seq;
    readBytes(data, function (bytes, totalBytes, truncated) {
      fillBinary(seq, bytes, totalBytes, truncated);
    });
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
      pushText(conn, "open", target);
    });
    ws.addEventListener("close", function (e) {
      conn.closedAt = Date.now();
      conn.closeCode = e.code;
      pushText(conn, "close", "code=" + e.code);
    });
    // binaryType 只影响浏览器给 Blob 还是 ArrayBuffer，两种都由 readBytes 统一取字节
    ws.addEventListener("message", function (e) {
      record(conn, "in", e.data);
    });

    var nativeSend = ws.send;
    ws.send = function (data) {
      record(conn, "out", data);
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
