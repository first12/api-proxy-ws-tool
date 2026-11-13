/**
 * 规则模型（rules-model.js）与 Service Worker 词条字典
 * 约定：
 *  1. 中文为基准，英文缺失时自动回落中文；占位符统一用 {name}
 *  2. 本文件是普通脚本（非 ES Module），依赖全局 I18N
 *  3. 加载顺序：需要先在页面与 Service Worker 中加载 i18n.js，再加载本文件
 *     （options 页：i18n.js → i18n-model.js → rules-model.js；
 *       Service Worker：importScripts("i18n.js", "i18n-model.js", "rules-model.js")）
 *  4. rules-model.js 在 Node 单测环境下没有 I18N，会直接回落为 key 字符串，属预期行为
 */
I18N.register({
  zh: {
    // ---------- host 校验 ----------
    "model.hostEmpty": "host 不能为空，且不能包含协议或路径，例如 192.168.1.100",
    "model.hostProtocol": "host 不能包含协议或路径，例如 192.168.1.100",
    "model.hostCharset": "host 只允许字母、数字、. 和 -，左侧通配写法为 *.example.com",

    // ---------- 路径 / 目标校验 ----------
    "model.pathEmpty": "路径不能为空，例如 /api/sessions",
    "model.pathSlash": "路径必须以 / 开头，例如 /api/sessions",
    "model.pathNoQuery": "路径里不能带查询参数",
    "model.pathWildcard": "* 只能作为末尾通配，例如 /api/*",
    "model.targetPathSlash": "替换后的前缀必须以 / 开头",
    "model.targetUrlAbsolute": "完整目标地址必须是 http:// 或 https:// 开头的绝对地址",
    "model.targetUrlQueryConflict": "目标地址已包含参数，保留原 query 会产生重复参数",

    // ---------- Mock 校验 ----------
    "model.mockStatusRange": "Mock 状态码需在 200–599（页面 Response 不接受其它值）",
    "model.mockDelayRange": "延迟需为 0–10000 的整数（毫秒）",
    "model.mockBodyJson": "body 不是合法 JSON：{msg}",
    "model.mockBodyEmpty": "纯文本响应体不能为空；不需要 body 请选择「空 body」",
    "model.mockHeaderNameInvalid": "第 {index} 个响应头名称不合法",
    "model.mockHeaderForbidden": "{name} 不能由页面脚本设置",
    "model.mockHeaderDuplicate": "响应头 {name} 重复",
    "model.mockContentType": "需要 Content-Type（JSON 建议 application/json）",
    "model.selfLoop": "重定向后的地址仍会命中本规则，会导致循环",
    "model.mockHeadersIgnored": "Mock 请求不会发出，请求头不会生效；请改配到 Mock 响应头",
    "model.redirectHeadersIgnored": "该类型通过重定向实现，浏览器不会给重定向后的请求追加请求头；请拆分规则或改用其他方式",

    // ---------- 请求头校验 ----------
    "model.headersRequired": "「仅请求头」类型至少需要配置一条请求头",
    "model.headerNameMissing": "第 {index} 个请求头缺少名称",
    "model.headerNameInvalid": "请求头名称 {name} 不是合法的 header token",
    "model.headerForbidden": "{name} 由浏览器控制，不能通过此工具修改",
    "model.headerDuplicate": "请求头 {name} 重复",
    "model.headerValueEmpty": "请求头 {name} 的值为空",
    "model.headerAppendNotAllowed": "{name} 不在 Chrome 的 append 白名单内，请改用 set",
    "model.cookieAppendOnly": "Chrome 不会应用 Cookie 的 set/remove，仅支持 append",

    // ---------- 规则与编译 ----------
    "model.duplicateRule": "与「{name}」完全重复",
    "model.tooManyRules": "超出 {max} 条规则上限",
    "model.websocketOnly": "规则资源类型只剩 websocket，请求头部分不生效",

    // ---------- Service Worker ----------
    "model.noScripting": "当前环境没有 chrome.scripting",
    "model.clearFailed": "清理失败：{msg}"
  },
  en: {
    // ---------- host validation ----------
    "model.hostEmpty": "Host is required and must not include a scheme or path, e.g. 192.168.1.100",
    "model.hostProtocol": "Host must not include a scheme or path, e.g. 192.168.1.100",
    "model.hostCharset": "Host may only contain letters, digits, . and -; use *.example.com for wildcards",

    // ---------- path / target validation ----------
    "model.pathEmpty": "Path is required, e.g. /api/sessions",
    "model.pathSlash": "Path must start with /, e.g. /api/sessions",
    "model.pathNoQuery": "Path must not contain query parameters",
    "model.pathWildcard": "* is only allowed as a trailing wildcard, e.g. /api/*",
    "model.targetPathSlash": "The replacement prefix must start with /",
    "model.targetUrlAbsolute": "The target URL must be an absolute http:// or https:// address",
    "model.targetUrlQueryConflict": "The target URL already has a query; keeping the original query would duplicate parameters",

    // ---------- mock validation ----------
    "model.mockStatusRange": "Mock status must be between 200 and 599 (the page Response API rejects other values)",
    "model.mockDelayRange": "Delay must be an integer between 0 and 10000 (ms)",
    "model.mockBodyJson": "Body is not valid JSON: {msg}",
    "model.mockBodyEmpty": "A plain-text body cannot be empty; choose \"Empty body\" if you don't need one",
    "model.mockHeaderNameInvalid": "Response header #{index} has an invalid name",
    "model.mockHeaderForbidden": "{name} cannot be set by page scripts",
    "model.mockHeaderDuplicate": "Duplicate response header: {name}",
    "model.mockContentType": "Content-Type is required (application/json is recommended for JSON)",
    "model.selfLoop": "The redirected URL still matches this rule and would cause a loop",
    "model.mockHeadersIgnored": "Mock requests are never sent, so request headers have no effect; configure mock response headers instead",
    "model.redirectHeadersIgnored": "This type is implemented via redirect, and browsers do not append request headers to redirected requests; split the rule or use another approach",

    // ---------- request header validation ----------
    "model.headersRequired": "The \"Headers only\" type requires at least one request header",
    "model.headerNameMissing": "Request header #{index} is missing a name",
    "model.headerNameInvalid": "Request header name {name} is not a valid header token",
    "model.headerForbidden": "{name} is controlled by the browser and cannot be modified by this tool",
    "model.headerDuplicate": "Duplicate request header: {name}",
    "model.headerValueEmpty": "Request header {name} has an empty value",
    "model.headerAppendNotAllowed": "{name} is not in Chrome's append allowlist; use set instead",
    "model.cookieAppendOnly": "Chrome ignores set/remove for Cookie; only append is supported",

    // ---------- rules & compilation ----------
    "model.duplicateRule": "Exact duplicate of \"{name}\"",
    "model.tooManyRules": "Exceeds the limit of {max} rules",
    "model.websocketOnly": "Only the websocket resource type remains, so the header part has no effect",

    // ---------- service worker ----------
    "model.noScripting": "chrome.scripting is not available in this environment",
    "model.clearFailed": "cleanup failed: {msg}"
  }
});
