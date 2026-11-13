/**
 * DevTools 面板（panel）词条字典
 * 约定：中文为基准，英文缺失时自动回落中文；占位符统一用 {name}
 * 注意：WebSocket 抓包数据（payload / URL / 帧内容 / 连接标题 / 文件名）一律不做翻译
 */
I18N.register({
  zh: {
    "panel.docTitle": "wsData · WebSocket 抓包",

    "panel.clear": "清空",
    "panel.exportJson": "导出 JSON",

    "panel.connections": "连接",
    "panel.onlyWithFrames": "只看有帧",
    "panel.searchConnPlaceholder": "搜索 url / 连接 id",
    "panel.allHosts": "全部 host",
    "panel.filterAll": "全部",
    "panel.filterOpen": "连接中",
    "panel.filterClosed": "已关闭",
    "panel.dirAll": "全部",
    "panel.loadInfoEmpty": "已加载 0 / 0 条",
    "panel.loadInfo": "已加载 {shown} / {total} 条",
    "panel.loadMore": "加载更多",

    "panel.selectConnHint": "左侧选择一个连接",
    "panel.filterPayload": "过滤 payload",
    "panel.followLatest": "跟随最新",
    "panel.paused": "已暂停滚动",
    "panel.colTime": "时间",
    "panel.colDirection": "方向",
    "panel.colLength": "长度",
    "panel.colView": "查看",

    "panel.connecting": "建连中",
    "panel.frameCount": "{n} 帧",
    "panel.truncatedShort": "截断",
    "panel.inProgress": "进行中",

    "panel.openedAt": "打开 {time}",
    "panel.closedAt": "关闭 {time}",
    "panel.truncatedYes": "已截断",
    "panel.truncatedNo": "未截断",
    "panel.reading": "(读取中)",
    "panel.truncatedMarker": " · 已截断",
    "panel.view": "查看",
    "panel.frameFoot": "显示 {visible} / {total} 帧 · 缓冲上限 2000 帧",
    "panel.frameFootTruncated": " · 该连接已被截断",
    "panel.frameFootFollowing": " · 跟随最新",
    "panel.frameFootPaused": " · 已暂停滚动",

    "panel.emptyDesc": "页面里建立 WebSocket 后，连接会出现在左侧索引。",
    "panel.emptyTitleNoFrames": "该连接没有帧",
    "panel.emptyDescNoFrames": "可能在建连阶段就关闭了。",
    "panel.emptyTitleFiltered": "当前筛选条件下没有帧",
    "panel.emptyDescFiltered": "调整方向或 payload 过滤后再试。",
    "panel.hookHint": "未采集到 WS，可能是页面无 WebSocket 或注入被页面 CSP 阻止",

    "panel.frame": "帧",
    "panel.copy": "复制",
    "panel.close": "关闭",
    "panel.overlayTitle": "帧 · {time} · {dir}",
    "panel.previewLimit": " · 预览仅前 16 字节",
    "panel.noPreview": "(无预览)",
    "panel.binHint": "疑似二进制协议，建议在代码侧解码",
    "panel.textMeta": "{n} 字符 · 上限 8000"
  },
  en: {
    "panel.docTitle": "wsData · WebSocket Capture",

    "panel.clear": "Clear",
    "panel.exportJson": "Export JSON",

    "panel.connections": "Connections",
    "panel.onlyWithFrames": "With frames only",
    "panel.searchConnPlaceholder": "Search URL / connection id",
    "panel.allHosts": "All hosts",
    "panel.filterAll": "All",
    "panel.filterOpen": "Open",
    "panel.filterClosed": "Closed",
    "panel.dirAll": "All",
    "panel.loadInfoEmpty": "Loaded 0 / 0",
    "panel.loadInfo": "Loaded {shown} / {total}",
    "panel.loadMore": "Load more",

    "panel.selectConnHint": "Select a connection on the left",
    "panel.filterPayload": "Filter payload",
    "panel.followLatest": "Follow latest",
    "panel.paused": "Scrolling paused",
    "panel.colTime": "Time",
    "panel.colDirection": "Direction",
    "panel.colLength": "Length",
    "panel.colView": "View",

    "panel.connecting": "Connecting",
    "panel.frameCount": "{n} frames",
    "panel.truncatedShort": "Truncated",
    "panel.inProgress": "Open",

    "panel.openedAt": "Opened {time}",
    "panel.closedAt": "Closed {time}",
    "panel.truncatedYes": "Truncated",
    "panel.truncatedNo": "Not truncated",
    "panel.reading": "(loading)",
    "panel.truncatedMarker": " · truncated",
    "panel.view": "View",
    "panel.frameFoot": "Showing {visible} / {total} frames · buffer limit 2000",
    "panel.frameFootTruncated": " · connection truncated",
    "panel.frameFootFollowing": " · following latest",
    "panel.frameFootPaused": " · scrolling paused",

    "panel.emptyDesc": "Connections appear in the left index once a page opens a WebSocket.",
    "panel.emptyTitleNoFrames": "No frames for this connection",
    "panel.emptyDescNoFrames": "It may have closed during the handshake.",
    "panel.emptyTitleFiltered": "No frames match the current filter",
    "panel.emptyDescFiltered": "Adjust the direction or payload filter and try again.",
    "panel.hookHint": "No WS captured: the page may have no WebSocket, or injection was blocked by CSP",

    "panel.frame": "Frame",
    "panel.copy": "Copy",
    "panel.close": "Close",
    "panel.overlayTitle": "Frame · {time} · {dir}",
    "panel.previewLimit": " · preview limited to first 16 bytes",
    "panel.noPreview": "(no preview)",
    "panel.binHint": "Looks like a binary protocol; decode it in code",
    "panel.textMeta": "{n} chars · limit 8000"
  }
});
