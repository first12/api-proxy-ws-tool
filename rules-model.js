// 规则模型：迁移 / 校验 / 编译为 declarativeNetRequest 规则。
// 纯函数、无 chrome API 依赖，可被 options.js / popup.js / sw.js 共用，也可在 node 里单测。
(function () {
  const DEFAULT_RESOURCE_TYPES = ["xmlhttprequest", "other"];
  const MAX_RULES = 250;
  const MAX_DNR_RULES = 500;

  // 4.9.8 禁用头分级（保守策略）
  const FORBIDDEN_HEADERS = ["host", "content-length", "origin", "set-cookie", "connection", "te", "trailer", "transfer-encoding", "upgrade", "keep-alive"];
  const FORBIDDEN_PREFIXES = ["sec-", "proxy-", "access-control-request-"];
  // Chrome append 白名单（H-10）
  const APPENDABLE_HEADERS = ["accept", "accept-encoding", "accept-language", "access-control-request-headers", "cache-control", "connection", "content-language", "cookie", "forwarded", "if-match", "if-none-match", "keep-alive", "range", "te", "trailer", "transfer-encoding", "upgrade", "user-agent", "via", "want-digest", "x-forwarded-for"];

  function now() { return Date.now(); }

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function normalizeHost(host) {
    return String(host || "").trim().toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  }

  function nextRuleId(existing) {
    let id;
    do { id = "r" + now().toString(36) + Math.random().toString(36).slice(2, 6); } while (existing.has(id));
    return id;
  }

  // 读旧结构（type/proxyMode/host/pathPattern/enable）→ 新结构
  function migrateRule(old, index) {
    if (isPlainObject(old.match) && isPlainObject(old.action)) {
      return Object.assign({
        id: String(old.id || "r" + index),
        name: old.name || "",
        enabled: old.enabled !== false,
        order: Number.isInteger(old.order) ? old.order : index
      }, old);
    }

    const kind = old.type === "mock" ? "mock" : (old.proxyMode === "fullUrl" ? "url" : "prefix");
    return {
      id: old.id != null ? "r" + old.id : "r" + index,
      name: old.name || "",
      enabled: old.enable !== false,
      order: Number.isInteger(old.order) ? old.order : index,
      match: {
        scheme: "both",
        host: normalizeHost(old.host),
        path: old.pathPattern || "",
        caseSensitive: true,
        excludeHosts: []
      },
      action: {
        kind,
        targetPath: old.proxyPathPrefix || "",
        targetUrl: old.proxyTarget || "",
        keepQuery: true,
        headers: [],
        mock: Object.assign(defaultMock(), {
          bodyType: old.mockBody && old.mockBody.trim() ? "json" : "empty",
          body: old.mockBody || ""
        })
      },
      scope: { resourceTypes: DEFAULT_RESOURCE_TYPES.slice() },
      notes: "",
      meta: { migratedFrom: old.id != null ? old.id : null, migratedAt: now() }
    };
  }

  function migrateRules(list) {
    const src = Array.isArray(list) ? list : [];
    const rules = src.map((r, i) => migrateRule(r, i));
    const changed = src.some((r, i) => !isPlainObject(r.match) || !isPlainObject(r.action));
    // order 归一：去重后按原顺序重排，避免历史数据出现并列 order
    rules.sort((a, b) => (a.order - b.order));
    rules.forEach((r, i) => { r.order = i; });
    return { rules, changed };
  }

  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ---------- Mock：与编译共用同一份匹配逻辑 ----------

  const FORBIDDEN_RESPONSE_HEADERS = ["set-cookie", "content-length", "transfer-encoding", "connection", "keep-alive"];

  function defaultMock() {
    return { status: 200, headers: [], bodyType: "json", contentType: "application/json", body: "{}", delayMs: 0 };
  }

  // 兼容旧结构 {status, contentType, body}；补齐 bodyType/headers/delayMs
  function normalizeMock(mock) {
    const m = isPlainObject(mock) ? mock : {};
    const rawStatus = Number(m.status);
    const status = Number.isFinite(rawStatus) ? Math.round(rawStatus) : 200;
    const body = m.body == null ? "" : String(m.body);
    let bodyType = m.bodyType;
    if (bodyType !== "json" && bodyType !== "text" && bodyType !== "empty") {
      if (!body.trim()) bodyType = "empty";
      else bodyType = /json/i.test(String(m.contentType || "")) ? "json" : "text";
    }
    const contentType = String(m.contentType || (bodyType === "json" ? "application/json" : bodyType === "text" ? "text/plain" : ""));
    const headers = [];
    if (Array.isArray(m.headers)) {
      m.headers.forEach((h) => {
        if (!h) return;
        const name = String(h.name || "").trim();
        if (!name) return;
        headers.push({ name, value: String(h.value == null ? "" : h.value) });
      });
    } else if (isPlainObject(m.headers)) {
      Object.keys(m.headers).forEach((name) => headers.push({ name, value: String(m.headers[name]) }));
    }
    const rawDelay = Number(m.delayMs);
    const delayMs = Number.isFinite(rawDelay) ? Math.min(10000, Math.max(0, Math.round(rawDelay))) : 0;
    return { status, headers, bodyType, contentType, body, delayMs };
  }

  // 编译给页面用的最小 mock 表（不发 targetPath 等无关字段）
  function buildMockTable(rules) {
    return (Array.isArray(rules) ? rules : [])
      .filter((r) => r && r.enabled !== false && r.action && r.action.kind === "mock")
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((r) => ({ id: r.id, order: r.order || 0, name: r.name || "", match: r.match || {}, response: normalizeMock(r.action.mock) }));
  }

  function hostMatches(ruleHost, host) {
    const target = normalizeHost(ruleHost);
    if (!target) return false;
    const h = String(host || "").toLowerCase();
    if (target.indexOf("*.") === 0) {
      const suffix = target.slice(2);
      if (h === suffix) return false;
      if (h.slice(-(suffix.length + 1)) !== "." + suffix) return false;
      const label = h.slice(0, -(suffix.length + 1));
      return /^[a-z0-9-]+$/.test(label);
    }
    return h === target;
  }

  function pathMatches(pattern, pathname, caseSensitive) {
    const p = String(pattern || "");
    if (!p) return false;
    const hay = caseSensitive === false ? String(pathname).toLowerCase() : String(pathname);
    if (p.slice(-1) === "*") {
      const base = p.slice(0, -1).replace(/\/$/, "");
      const needle = caseSensitive === false ? base.toLowerCase() : base;
      return hay.indexOf(needle) === 0;
    }
    return hay === (caseSensitive === false ? p.toLowerCase() : p);
  }

  function matchRule(rule, url) {
    if (!rule || rule.enabled === false) return false;
    const m = rule.match || {};
    if (!m.host) return false;
    let u;
    try {
      u = new URL(String(url), (typeof location !== "undefined" && location.href) || "http://localhost/");
    } catch (e) {
      return false;
    }
    const scheme = u.protocol.replace(":", "");
    if (scheme !== "http" && scheme !== "https") return false;
    if (m.scheme && m.scheme !== "both" && m.scheme !== scheme) return false;
    if (!hostMatches(m.host, u.hostname)) return false;
    if (Array.isArray(m.excludeHosts) && m.excludeHosts.some((h) => hostMatches(h, u.hostname))) return false;
    return pathMatches(m.path, u.pathname, m.caseSensitive !== false);
  }

  // 按 order 顺序，命中第一条即返回
  function selectMockRule(url, table) {
    const list = Array.isArray(table) ? table : [];
    for (const rule of list) {
      if (rule && rule.match && rule.response && matchRule(rule, url)) return rule;
    }
    return null;
  }

  function headerIsForbidden(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return true;
    if (FORBIDDEN_HEADERS.indexOf(n) >= 0) return true;
    return FORBIDDEN_PREFIXES.some((p) => n.indexOf(p) === 0);
  }

  function validateHost(host) {
    const h = String(host || "").trim();
    if (!h) return "host 不能为空，且不能包含协议或路径，例如 10.114.0.11";
    if (/^(https?:)?\/\//i.test(h) || h.indexOf("/") >= 0 || h.indexOf(" ") >= 0) {
      return "host 不能包含协议或路径，例如 10.114.0.11";
    }
    if (!/^(\*\.)?[a-z0-9.-]+$/.test(h.toLowerCase())) return "host 只允许字母、数字、. 和 -，左侧通配写法为 *.example.com";
    return null;
  }

  // 返回 [{ field, message }]，field 用于抽屉里定位输入框
  function validateRule(rule, allRules) {
    const errors = [];
    const m = rule.match || {};
    const a = rule.action || {};
    const hostErr = validateHost(m.host);
    if (hostErr) errors.push({ field: "host", message: hostErr });

    const path = String(m.path || "");
    if (!path) {
      errors.push({ field: "path", message: "路径不能为空，例如 /api/sessions" });
    } else if (path.charAt(0) !== "/") {
      errors.push({ field: "path", message: "路径必须以 / 开头，例如 /api/sessions" });
    } else {
      if (path.indexOf("?") >= 0 || path.indexOf("#") >= 0) {
        errors.push({ field: "path", message: "路径里不能带查询参数" });
      } else if (path.indexOf("*") >= 0 && (path.indexOf("*") !== path.length - 1 || path.indexOf("**") >= 0)) {
        errors.push({ field: "path", message: "* 只能作为末尾通配，例如 /api/*" });
      }
    }

    if (a.kind === "prefix") {
      if (!a.targetPath || a.targetPath.charAt(0) !== "/") {
        errors.push({ field: "targetPath", message: "替换后的前缀必须以 / 开头" });
      }
    } else if (a.kind === "url") {
      const t = String(a.targetUrl || "");
      if (!/^https?:\/\/[^/\s]+/i.test(t)) {
        errors.push({ field: "targetUrl", message: "完整目标地址必须是 http:// 或 https:// 开头的绝对地址" });
      } else if (a.keepQuery && t.indexOf("?") >= 0) {
        errors.push({ field: "targetUrl", message: "目标地址已包含参数，保留原 query 会产生重复参数" });
      }
    } else if (a.kind === "mock") {
      const mk = normalizeMock(a.mock);
      if (mk.status < 200 || mk.status > 599) {
        errors.push({ field: "mockStatus", message: "Mock 状态码需在 200–599（页面 Response 不接受其它值）" });
      }
      const rawDelay = a.mock ? a.mock.delayMs : undefined;
      const hasDelay = rawDelay !== undefined && rawDelay !== null && rawDelay !== "";
      if (hasDelay && (!Number.isFinite(Number(rawDelay)) || Number(rawDelay) < 0 || Number(rawDelay) > 10000)) {
        errors.push({ field: "mockDelay", message: "延迟需为 0–10000 的整数（毫秒）" });
      }
      if (mk.bodyType === "json") {
        try {
          JSON.parse(mk.body);
        } catch (e) {
          errors.push({ field: "mockBody", message: "body 不是合法 JSON：" + e.message });
        }
      } else if (mk.bodyType === "text" && !mk.body.trim()) {
        errors.push({ field: "mockBody", message: "纯文本响应体不能为空；不需要 body 请选择「空 body」" });
      }
      const seenResp = {};
      mk.headers.forEach((h, i) => {
        const name = String(h.name || "").trim();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
          errors.push({ field: "mockHeaders", message: "第 " + (i + 1) + " 个响应头名称不合法" });
          return;
        }
        const lower = name.toLowerCase();
        if (FORBIDDEN_RESPONSE_HEADERS.indexOf(lower) >= 0) {
          errors.push({ field: "mockHeaders", message: name + " 不能由页面脚本设置" });
        }
        if (seenResp[lower]) errors.push({ field: "mockHeaders", message: "响应头 " + name + " 重复" });
        seenResp[lower] = true;
      });
      if (mk.bodyType !== "empty" && !mk.contentType && !mk.headers.some((h) => h.name.toLowerCase() === "content-type")) {
        errors.push({ field: "mockType", message: "需要 Content-Type（JSON 建议 application/json）" });
      }
    }

    // 自环：重定向后仍命中本规则
    if (a.kind === "prefix" && !errors.some((e) => e.field === "targetPath") && !errors.some((e) => e.field === "path")) {
      const base = path.replace(/\*$/, "");
      if (base && String(a.targetPath).replace(/\*$/, "").indexOf(base) === 0) {
        errors.push({ field: "targetPath", message: "重定向后的地址仍会命中本规则，会导致循环" });
      }
    }

    const headers = Array.isArray(a.headers) ? a.headers : [];
    if (a.kind === "mock" && headers.length) {
      errors.push({ field: "headers", message: "Mock 请求不会发出，请求头不会生效；请改配到 Mock 响应头" });
    }
    const seen = {};
    headers.forEach((h, i) => {
      const name = String(h.name || "").trim();
      const op = h.operation || "set";
      if (!name) {
        errors.push({ field: "headers", message: "第 " + (i + 1) + " 个请求头缺少名称" });
        return;
      }
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
        errors.push({ field: "headers", message: "请求头名称 " + name + " 不是合法的 header token" });
      }
      if (headerIsForbidden(name)) {
        errors.push({ field: "headers", message: name + " 由浏览器控制，不能通过此工具修改" });
      }
      const lower = name.toLowerCase();
      if (seen[lower]) errors.push({ field: "headers", message: "请求头 " + name + " 重复" });
      seen[lower] = true;
      if (op !== "remove" && !String(h.value || "").length) {
        errors.push({ field: "headers", message: "请求头 " + name + " 的值为空" });
      }
      if (op === "append" && APPENDABLE_HEADERS.indexOf(lower) < 0) {
        errors.push({ field: "headers", message: name + " 不在 Chrome 的 append 白名单内，请改用 set" });
      }
    });

    if (allRules) {
      const dup = allRules.find((r) => r.id !== rule.id && r.enabled !== false
        && r.match && rule.match
        && normalizeHost(r.match.host) === normalizeHost(rule.match.host)
        && String(r.match.path) === String(rule.match.path)
        && (r.match.scheme || "both") === (rule.match.scheme || "both"));
      if (dup) errors.push({ field: "host", message: "与「" + (dup.name || dup.match.host + dup.match.path) + "」完全重复" });
    }

    return errors;
  }

  // 编译一条规则；granted = { https: bool, http: bool }
  // 返回 { rules: [dnr...], errors: [string], skipped: string|null }
  function compileRule(rule, index, granted) {
    const errors = [];
    const m = rule.match || {};
    const a = rule.action || {};
    const host = normalizeHost(m.host);
    const path = String(m.path || "");

    const vErrors = validateRule(rule, null);
    if (vErrors.length && vErrors.some((e) => e.field !== "headers")) {
      return { rules: [], errors: vErrors.map((e) => e.message), skipped: "invalid" };
    }

    if (index >= MAX_RULES) return { rules: [], errors: ["超出 " + MAX_RULES + " 条规则上限"], skipped: "limit" };

    if (a.kind === "mock") {
      // Mock 由页面侧拦截实现，v0.7 仍未落地，不生成 DNR，避免"看起来生效"
      return { rules: [], errors: [], skipped: "mock" };
    }

    const grant = granted || { https: true, http: true };
    const scheme = m.scheme === "http" ? "http" : m.scheme === "https" ? "https" : "both";
    let schemeExpr = "";
    if (scheme === "https" && grant.https) schemeExpr = "https";
    else if (scheme === "http" && grant.http) schemeExpr = "http";
    else if (scheme === "both") {
      if (grant.https && grant.http) schemeExpr = "https?";
      else if (grant.https) schemeExpr = "https";
      else if (grant.http) schemeExpr = "http";
    }
    if (!schemeExpr) return { rules: [], errors: [], skipped: "no-permission" };

    const hostExpr = host.indexOf("*.") === 0
      ? "[a-z0-9-]+\\." + escapeRegex(host.slice(2))
      : escapeRegex(host);

    const tailCapture = /\*$/.test(path);
    // 与文档 4.6 示例一致：/v1/* → 前缀 /v1 + (.*)，后缀保留以 / 开头
    const basePath = tailCapture ? path.slice(0, -1).replace(/\/$/, "") : path;
    const pathExpr = escapeRegex(basePath);

    let suffixGroup;
    let filter;
    // 第 1 组是 scheme，路径后缀统一用第 2 组（\2）回填
    if (tailCapture) {
      if (a.keepQuery !== false) {
        filter = pathExpr + "(.*)$";
        suffixGroup = "\\2";
      } else {
        filter = pathExpr + "([^?]*)(?:\\?(?:.*))?$";
        suffixGroup = "\\2";
      }
    } else if (a.keepQuery !== false) {
      filter = pathExpr + "(\\?(?:.*))?$";
      suffixGroup = "\\2";
    } else {
      filter = pathExpr + "$";
      suffixGroup = "";
    }

    const regexFilter = "^(" + schemeExpr + ")://" + hostExpr + filter;
    const priority = 1000000 - index * 10;
    const dnr = [];

    if (a.kind === "url") {
      dnr.push({
        id: 1000 + index,
        priority,
        action: { type: "redirect", redirect: { url: String(a.targetUrl) } },
        condition: { regexFilter, isUrlFilterCaseSensitive: m.caseSensitive !== false, resourceTypes: resourceTypesOf(rule) }
      });
    } else {
      const targetPath = String(a.targetPath || "");
      const substitution = "\\1://" + host + targetPath + suffixGroup;
      dnr.push({
        id: 1000 + index,
        priority,
        action: { type: "redirect", redirect: { regexSubstitution: substitution } },
        condition: { regexFilter, isUrlFilterCaseSensitive: m.caseSensitive !== false, resourceTypes: resourceTypesOf(rule) }
      });
    }

    const headers = (Array.isArray(a.headers) ? a.headers : []).filter((h) => String(h.name || "").trim());
    if (headers.length) {
      const rt = resourceTypesOf(rule).filter((t) => t !== "websocket");
      const badHeader = validateRule(rule, null).filter((e) => e.field === "headers");
      if (badHeader.length) {
        errors.push(...badHeader.map((e) => e.message));
      } else if (!rt.length) {
        errors.push("规则资源类型只剩 websocket，请求头部分不生效");
      } else {
        dnr.push({
          id: 2000 + index,
          priority,
          action: {
            type: "modifyHeaders",
            requestHeaders: headers.map((h) => {
              const item = { header: String(h.name).trim(), operation: h.operation || "set" };
              if (item.operation !== "remove") item.value = String(h.value || "");
              return item;
            })
          },
          condition: { regexFilter, isUrlFilterCaseSensitive: m.caseSensitive !== false, resourceTypes: rt }
        });
      }
    }

    return { rules: dnr, errors, skipped: null };
  }

  function resourceTypesOf(rule) {
    const rt = (rule.scope && Array.isArray(rule.scope.resourceTypes)) ? rule.scope.resourceTypes : DEFAULT_RESOURCE_TYPES;
    return rt.slice();
  }

  // 编译全部：按 order 升序，超过上限或非法/未授权/ mock 的单独归类
  function compileRules(rules, grantedMap) {
    const out = { rules: [], skippedNoPermission: [], skippedOther: [], failed: [], warnings: [] };
    const sorted = (Array.isArray(rules) ? rules : []).filter((r) => r.enabled !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    let index = 0;
    sorted.forEach((rule) => {
      const granted = grantedMap ? grantedMap[normalizeHost(rule.match && rule.match.host)] : null;
      const res = compileRule(rule, index, granted || { https: false, http: false });
      if (res.skipped === "no-permission") {
        out.skippedNoPermission.push({ id: rule.id, name: rule.name || "" });
        return;
      }
      if (res.skipped === "mock") {
        out.skippedOther.push({ id: rule.id, reason: "mock" });
        index += 1;
        return;
      }
      if (res.skipped) {
        out.failed.push({ id: rule.id, errors: res.errors });
        index += 1;
        return;
      }
      res.errors.forEach((e) => out.warnings.push({ id: rule.id, message: e }));
      out.rules.push(...res.rules);
      index += 1;
    });

    out.totalGenerated = out.rules.length;
    if (out.rules.length > MAX_DNR_RULES) out.rules = out.rules.slice(0, MAX_DNR_RULES);
    return out;
  }

  const api = {
    DEFAULT_RESOURCE_TYPES, MAX_RULES, MAX_DNR_RULES, FORBIDDEN_HEADERS, APPENDABLE_HEADERS,
    normalizeHost, migrateRule, migrateRules, validateRule, compileRule, compileRules,
    nextRuleId, headerIsForbidden, escapeRegex,
    defaultMock, normalizeMock, buildMockTable, matchRule, selectMockRule, hostMatches, pathMatches, FORBIDDEN_RESPONSE_HEADERS
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.RuleModel = api;
})();
