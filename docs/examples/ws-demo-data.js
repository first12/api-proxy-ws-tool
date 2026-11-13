/*
 * wsData 面板截图用演示数据（全部脱敏，无真实业务信息）
 *
 * 用法：
 *   1. 打开任意页面（建议 https://example.com/），按 F12 打开开发者工具；
 *   2. 在 Console 里粘贴本文件全部内容并回车；
 *   3. 切换到顶部「wsData」面板，即可看到 3 条连接与 15 帧演示数据；
 *   4. 点「导出JSON」得到的是扩展真实导出逻辑生成的文件，可直接用于第三张截图。
 *
 * 说明：
 *   - 只覆盖 window.__WS_FRAMES__ / window.__WS_CONNECTIONS__ / window.__WS_VERSION__，
 *     不改动页面其它内容，也不发起网络请求；
 *   - 设置 __WS_VERSION__ = 3 是为了让扩展的注入钩子跳过覆盖，保证数据不被清掉；
 *   - 刷新页面即恢复真实抓包，无残留。
 */
(function () {
  "use strict";

  // 固定时间基准，保证每次截图的相对时间、排序完全一致
  var BASE = Date.parse("2026-11-13T19:42:03+08:00");

  var encoder = new TextEncoder();
  function utf8Length(text) {
    return encoder.encode(String(text)).length;
  }

  // 帧计划：按连接分组书写，生成前会按 at 全局排序，保证 seq 与时间一致
  // at 为相对 BASE 的毫秒偏移；dir: open / out / in / close；kind 缺省为 text
  var specs = [
    // ---- 连接 1：订单推送，已正常关闭 ----
    { conn: "ws-1", url: "wss://api.example.com/ws/order?client_type=web", at: 0, dir: "open" },
    {
      conn: "ws-1", at: 110, dir: "out",
      payload: '{"action":"SUBSCRIBE","topic":"order.status","session_id":"sess-demo-0001"}'
    },
    {
      conn: "ws-1", at: 340, dir: "in",
      payload: '{"action":"SUBSCRIBED","topic":"order.status","ok":true}'
    },
    {
      conn: "ws-1", at: 15020, dir: "in",
      payload: '{"event":"order.updated","order_id":"ORD-20261113-0001","status":"PAID","amount":128.00}'
    },
    { conn: "ws-1", at: 58500, dir: "close", code: 1000 },

    // ---- 连接 2：聊天室，仍在进行中 ----
    { conn: "ws-2", url: "wss://api.example.com/ws/chat?room_id=1001", at: 2400, dir: "open" },
    {
      conn: "ws-2", at: 2520, dir: "out",
      payload: '{"type":"join","room_id":"1001","user":"tester"}'
    },
    {
      conn: "ws-2", at: 2680, dir: "in",
      payload: '{"type":"joined","online":3}'
    },
    {
      conn: "ws-2", at: 6100, dir: "out",
      payload: '{"type":"msg","text":"联调测试消息"}'
    },
    {
      conn: "ws-2", at: 6420, dir: "in",
      payload: '{"type":"msg","from":"support","text":"收到"}'
    },
    {
      conn: "ws-2", at: 12800, dir: "in",
      payload: '{"type":"typing","from":"support"}'
    },

    // ---- 连接 3：内网通知服务，仍在进行中；含一帧二进制，用于展示二进制渲染 ----
    { conn: "ws-3", url: "wss://192.168.1.100:8080/ws/notify", at: 4900, dir: "open" },
    {
      conn: "ws-3", at: 5100, dir: "out",
      payload: '{"type":"ping","seq":1}'
    },
    {
      conn: "ws-3", at: 5320, dir: "in",
      payload: '{"type":"pong","seq":1,"server_time":1763034128000}'
    },
    {
      conn: "ws-3", at: 9800, dir: "in", kind: "binary",
      byteLength: 128, previewBase64: "AAECAwQFBgcICQoLDA0ODw=="
    }
  ];

  // 全局按时间排序：真实实现中 seq 就是帧的全局先后顺序
  specs.sort(function (a, b) { return a.at - b.at; });

  // 按首次出现顺序建立连接元数据
  var connMap = {};
  var order = [];
  specs.forEach(function (s) {
    if (!connMap[s.conn]) {
      connMap[s.conn] = {
        id: s.conn,
        url: s.url,
        openedAt: null,
        closedAt: null,
        closeCode: null,
        frameCount: 0,
        truncated: false
      };
      order.push(s.conn);
    }
  });

  var frames = [];
  var seq = 0;

  specs.forEach(function (s) {
    var conn = connMap[s.conn];
    var ts = BASE + s.at;

    var payload;
    if (s.dir === "open") payload = conn.url;
    else if (s.dir === "close") payload = "code=" + s.code;
    else payload = s.payload || "";

    frames.push({
      seq: ++seq,
      ts: ts,
      connId: conn.id,
      url: conn.url,
      direction: s.dir,
      kind: s.kind || "text",
      byteLength: s.kind === "binary" ? s.byteLength : utf8Length(payload),
      previewBase64: s.kind === "binary" ? s.previewBase64 : null,
      truncated: false,
      pending: false,
      payload: s.kind === "binary" ? "" : payload
    });

    conn.frameCount++;

    if (s.dir === "open") conn.openedAt = ts;
    if (s.dir === "close") {
      conn.closedAt = ts;
      conn.closeCode = s.code;
    }
  });

  var connections = order.map(function (id) { return connMap[id]; });

  // 版本号设为 3：扩展注入的钩子检测到该值会直接返回，不会覆盖演示数据
  window.__WS_VERSION__ = 3;
  window.__WS_FRAMES__ = frames;
  window.__WS_CONNECTIONS__ = connections;

  // 便于在 Console 里确认写入结果
  console.log("[wsData demo] 已写入 " + connections.length + " 条连接 / " + frames.length + " 帧");
})();
