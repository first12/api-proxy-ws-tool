/**
 * 弹窗（popup）词条字典
 * 约定：中文为基准，英文缺失时自动回落中文；占位符统一用 {name}
 * 技术名词（host / Cookie / DNR / Mock / WebSocket / URL）保留原样
 */
I18N.register({
  zh: {
    "popup.docTitle": "接口代理",
    "popup.appTitle": "接口代理",
    "popup.statRules": "规则",
    "popup.statActive": "生效",
    "popup.statPending": "待授权",
    "popup.syncIdle": "尚未同步",
    "popup.allAuthorized": "所有规则的域名都已授权。",
    "popup.hint": "规则配置、请求头与 Mock 在「打开配置页」中维护；wsData 在 DevTools 的「wsData」标签里。",
    "popup.openOptions": "打开配置页",
    "popup.resync": "重新同步",
    "popup.syncFailed": "同步失败：{msg}",
    "popup.syncDone": "已生成 {n} 条 DNR 规则",
    "popup.syncPending": " · {n} 条待授权",
    "popup.syncNever": "尚未同步，修改规则后会自动编译",
    "popup.rowPending": "待授权",
    "popup.grant": "授权",
    "popup.grantDenied": "未获得 {host} 的授权，可再次点击重试",
    "popup.initFailed": "初始化失败：{msg}"
  },
  en: {
    "popup.docTitle": "API Proxy",
    "popup.appTitle": "API Proxy",
    "popup.statRules": "Rules",
    "popup.statActive": "Active",
    "popup.statPending": "Pending",
    "popup.syncIdle": "Not synced yet",
    "popup.allAuthorized": "All rule domains are authorized.",
    "popup.hint": "Rule settings, request headers and Mock are managed in \"Open settings\"; wsData lives in the \"wsData\" tab of DevTools.",
    "popup.openOptions": "Open settings",
    "popup.resync": "Resync",
    "popup.syncFailed": "Sync failed: {msg}",
    "popup.syncDone": "{n} DNR rules generated",
    "popup.syncPending": " · {n} pending authorization",
    "popup.syncNever": "Not synced yet; rules recompile automatically after changes",
    "popup.rowPending": "Pending",
    "popup.grant": "Authorize",
    "popup.grantDenied": "Permission for {host} was not granted. Click again to retry.",
    "popup.initFailed": "Initialization failed: {msg}"
  }
});
