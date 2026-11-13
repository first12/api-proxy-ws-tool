// MAIN world Mock 引擎：拦截页面脚本发起的 fetch / XMLHttpRequest。
// 由 mock-bridge.js（ISOLATED）或 DevTools 面板下发配置；未命中任何 mock 规则时严格透传原生实现。
(function () {
  if (window.__MOCK_VERSION__ === 4) return;
  window.__MOCK_VERSION__ = 4;

  var RM = window.RuleModel;
  try { delete window.RuleModel; } catch (e) {}
  if (!RM) {
    // 引擎只依赖匹配逻辑，且收到的表已由桥接构建好；内置一份避免对 rules-model.js 注入顺序的依赖
    try { console.warn("[Mock] RuleModel 未加载，使用内置匹配逻辑"); } catch (e) {}
    RM = (function () {
      function normalizeHost(host) {
        return String(host || "").trim().toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/\/.*$/, "")
          .replace(/:\d+$/, "");
      }
      function hostMatches(ruleHost, host) {
        var target = normalizeHost(ruleHost);
        if (!target) return false;
        var h = String(host || "").toLowerCase();
        if (target.indexOf("*.") === 0) {
          var suffix = target.slice(2);
          if (h === suffix) return false;
          if (h.slice(-(suffix.length + 1)) !== "." + suffix) return false;
          return /^[a-z0-9-]+$/.test(h.slice(0, -(suffix.length + 1)));
        }
        return h === target;
      }
      function pathMatches(pattern, pathname, caseSensitive) {
        var p = String(pattern || "");
        if (!p) return false;
        var hay = caseSensitive === false ? String(pathname).toLowerCase() : String(pathname);
        if (p.slice(-1) === "*") {
          var base = p.slice(0, -1).replace(/\/$/, "");
          var needle = caseSensitive === false ? base.toLowerCase() : base;
          return hay.indexOf(needle) === 0;
        }
        return hay === (caseSensitive === false ? p.toLowerCase() : p);
      }
      function matchRule(rule, url) {
        if (!rule || rule.enabled === false) return false;
        var m = rule.match || {};
        if (!m.host) return false;
        var u;
        try { u = new URL(String(url), location.href); } catch (e) { return false; }
        var scheme = u.protocol.replace(":", "");
        if (scheme !== "http" && scheme !== "https") return false;
        if (m.scheme && m.scheme !== "both" && m.scheme !== scheme) return false;
        if (!hostMatches(m.host, u.hostname)) return false;
        if (Array.isArray(m.excludeHosts) && m.excludeHosts.some(function (h) { return hostMatches(h, u.hostname); })) return false;
        return pathMatches(m.path, u.pathname, m.caseSensitive !== false);
      }
      function selectMockRule(url, table) {
        var list = Array.isArray(table) ? table : [];
        for (var i = 0; i < list.length; i++) {
          var rule = list[i];
          if (rule && rule.match && rule.response && matchRule(rule, url)) return rule;
        }
        return null;
      }
      return { hostMatches: hostMatches, pathMatches: pathMatches, matchRule: matchRule, selectMockRule: selectMockRule };
    })();
  }
  try { console.info("[Mock] 引擎初始化完成，等待配置下发"); } catch (e) {}

  var SOURCE = "api-proxy-mock";
  var state = {
    table: [],
    enabled: false,
    installed: false,
    origFetch: null,
    fetchDesc: null,
    xhrSaved: null
  };

  // ---------- 工具 ----------

  function abortError() {
    try { return new DOMException("The user aborted a request.", "AbortError"); }
    catch (e) { var err = new Error("The user aborted a request."); err.name = "AbortError"; return err; }
  }

  function urlOf(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    if (typeof URL !== "undefined" && input instanceof URL) return String(input);
    return String(input);
  }

  function absolute(url) {
    try { return new URL(String(url), location.href).href; } catch (e) { return String(url); }
  }

  function preview(text) {
    var s = text == null ? "" : String(text);
    return s.length > 200 ? s.slice(0, 200) + "…(" + s.length + " 字符)" : s;
  }

  function wait(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(done, ms);
      function done() { cleanup(); resolve(); }
      function onAbort() { cleanup(); reject(abortError()); }
      function cleanup() {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort);
      }
    });
  }

  function headersOf(resp) {
    var h = new Headers();
    (resp.headers || []).forEach(function (x) {
      try { h.set(x.name, x.value); } catch (e) {}
    });
    if (resp.contentType && !h.has("content-type")) {
      try { h.set("content-type", resp.contentType); } catch (e) {}
    }
    return h;
  }

  function bodyOf(resp) {
    if (resp.bodyType === "empty") return null;
    if (resp.status === 204 || resp.status === 205 || resp.status === 304) return null;
    return resp.body;
  }

  function respond(url, resp, signal) {
    if (signal && signal.aborted) return Promise.reject(abortError());
    var body = bodyOf(resp);
    return wait(resp.delayMs, signal).then(function () {
      var res = new Response(body, { status: resp.status, headers: headersOf(resp) });
      try { Object.defineProperty(res, "url", { value: absolute(url), configurable: true }); } catch (e) {}
      return res;
    });
  }

  // ---------- fetch ----------

  function hookedFetch(input, init) {
    if (!state.enabled) return state.origFetch.apply(this, arguments);
    var url = urlOf(input);
    var rule = RM.selectMockRule(url, state.table);
    if (!rule) return state.origFetch.apply(this, arguments);
    try { console.info("[Mock] fetch 命中规则", rule.id, rule.name, url); } catch (e) {}
    try { console.info("[Mock] 返回 mock 数据 → " + rule.response.status + " " + (rule.response.contentType || ""), rule.response.bodyType === "empty" ? "(空 body)" : preview(rule.response.body)); } catch (e) {}
    var signal = (init && init.signal) || (input && typeof input === "object" && input.signal) || null;
    return respond(url, rule.response, signal);
  }

  // ---------- XMLHttpRequest ----------

  var XHR_METHODS = ["open", "send", "abort"];

  function getXhrProto() {
    return window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  }

  function saveXhr() {
    var proto = getXhrProto();
    var saved = {};
    XHR_METHODS.forEach(function (name) {
      saved[name] = {
        desc: Object.getOwnPropertyDescriptor(proto, name),
        fn: proto[name]
      };
    });
    return saved;
  }

  function restoreXhr(saved) {
    var proto = getXhrProto();
    if (!proto || !saved) return;
    XHR_METHODS.forEach(function (name) {
      var item = saved[name];
      if (!item) return;
      if (item.desc) Object.defineProperty(proto, name, item.desc);
      else proto[name] = item.fn;
    });
  }

  function defineGetter(obj, name, getter) {
    try {
      Object.defineProperty(obj, name, { configurable: true, enumerable: true, get: getter });
    } catch (e) {}
  }

  function fire(xhr, type, detail) {
    try { xhr.dispatchEvent(new ProgressEvent(type, detail || {})); } catch (e) {}
  }

  function setReady(xhr, n) {
    xhr.__mockRS = n;
    fire(xhr, "readystatechange");
  }

  function ensureMockXhr(xhr) {
    if (xhr.__mockReady) return;
    var initialReady = xhr.readyState;
    xhr.__mockReady = true;
    xhr.__mockRS = typeof initialReady === "number" ? initialReady : 0;
    xhr.__mockData = null;
    defineGetter(xhr, "readyState", function () { return xhr.__mockRS; });
    defineGetter(xhr, "status", function () { return xhr.__mockData ? xhr.__mockData.status : 0; });
    defineGetter(xhr, "statusText", function () { return xhr.__mockData ? xhr.__mockData.statusText : ""; });
    defineGetter(xhr, "responseURL", function () { return xhr.__mockData ? xhr.__mockData.url : ""; });
    defineGetter(xhr, "responseText", function () { return xhr.__mockData ? xhr.__mockData.text : ""; });
    defineGetter(xhr, "responseXML", function () { return null; });
    defineGetter(xhr, "response", function () { return xhr.__mockData ? xhr.__mockData.response : ""; });
    xhr.getResponseHeader = function (name) {
      var d = xhr.__mockData;
      if (!d) return null;
      var key = String(name || "").toLowerCase();
      for (var i = 0; i < d.headers.length; i++) {
        if (d.headers[i].name.toLowerCase() === key) return d.headers[i].value;
      }
      return null;
    };
    xhr.getAllResponseHeaders = function () {
      var d = xhr.__mockData;
      if (!d) return "";
      return d.headers.map(function (h) { return h.name + ": " + h.value; }).join("\r\n") + "\r\n";
    };
  }

  function buildXhrData(resp, url) {
    var text = resp.bodyType === "empty" ? "" : resp.body;
    var headers = (resp.headers || []).slice();
    if (resp.contentType && !headers.some(function (h) { return h.name.toLowerCase() === "content-type"; })) {
      headers.push({ name: "Content-Type", value: resp.contentType });
    }
    return {
      status: resp.status,
      statusText: "",
      url: absolute(url),
      text: text,
      headers: headers,
      responseFor: function (type) {
        var rt = type || "";
        if (rt === "json") {
          try { return JSON.parse(text); } catch (e) { return null; }
        }
        if (rt === "blob") return new Blob([text], { type: resp.contentType || "" });
        if (rt === "arraybuffer") {
          var bytes = new TextEncoder().encode(text);
          return bytes.buffer;
        }
        return text;
      }
    };
  }

  function hookedOpen(method, url, async) {
    this.__mockInfo = { method: method, url: url, async: async !== false };
    var saved = state.xhrSaved && state.xhrSaved.open;
    return (saved ? saved.fn : this.open).apply(this, arguments);
  }

  function hookedSend() {
    var info = this.__mockInfo;
    if (!state.enabled || !info) {
      var saved = state.xhrSaved && state.xhrSaved.send;
      return (saved ? saved.fn : this.send).apply(this, arguments);
    }
    var rule = RM.selectMockRule(info.url, state.table);
    if (!rule) {
      var savedSend = state.xhrSaved && state.xhrSaved.send;
      return (savedSend ? savedSend.fn : this.send).apply(this, arguments);
    }
    try { console.info("[Mock] XHR 命中规则", rule.id, rule.name, info.method, info.url); } catch (e) {}
    try { console.info("[Mock] 返回 mock 数据 → " + rule.response.status + " " + (rule.response.contentType || ""), rule.response.bodyType === "empty" ? "(空 body)" : preview(rule.response.body)); } catch (e) {}

    var xhr = this;
    var resp = rule.response;
    ensureMockXhr(xhr);
    xhr.__mockPending = true;
    xhr.__mockAborted = false;
    xhr.__mockData = buildXhrData(resp, info.url);
    xhr.__mockData.response = xhr.__mockData.responseFor(xhr.responseType);

    var length = xhr.__mockData.text.length;
    fire(xhr, "loadstart", { lengthComputable: true, loaded: 0, total: length });

    function deliver() {
      if (!xhr.__mockPending || xhr.__mockAborted) return;
      xhr.__mockPending = false;
      setReady(xhr, 2);
      setReady(xhr, 3);
      fire(xhr, "progress", { lengthComputable: true, loaded: length, total: length });
      setReady(xhr, 4);
      fire(xhr, "load", { lengthComputable: true, loaded: length, total: length });
      fire(xhr, "loadend", { lengthComputable: true, loaded: length, total: length });
    }

    if (!info.async) {
      // 同步 XHR 无法延迟，立即返回
      deliver();
      return;
    }
    if (resp.delayMs) {
      xhr.__mockTimer = setTimeout(deliver, resp.delayMs);
    } else {
      deliver();
    }
  }

  function hookedAbort() {
    if (this.__mockPending) {
      this.__mockPending = false;
      this.__mockAborted = true;
      if (this.__mockTimer) { clearTimeout(this.__mockTimer); this.__mockTimer = null; }
      setReady(this, 0);
      fire(this, "abort");
      fire(this, "loadend");
      return;
    }
    var saved = state.xhrSaved && state.xhrSaved.abort;
    var out = (saved ? saved.fn : this.abort).apply(this, arguments);
    if (this.__mockReady) {
      this.__mockData = null;
      this.__mockRS = 0;
    }
    return out;
  }

  // ---------- 安装 / 还原 ----------

  function install() {
    if (state.installed) return;
    state.fetchDesc = Object.getOwnPropertyDescriptor(window, "fetch");
    state.origFetch = window.fetch;
    try {
      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: hookedFetch });
    } catch (e) {
      window.fetch = hookedFetch;
    }

    var proto = getXhrProto();
    if (proto) {
      state.xhrSaved = saveXhr();
      try {
        Object.defineProperty(proto, "open", { configurable: true, writable: true, value: hookedOpen });
        Object.defineProperty(proto, "send", { configurable: true, writable: true, value: hookedSend });
        Object.defineProperty(proto, "abort", { configurable: true, writable: true, value: hookedAbort });
      } catch (e) {
        proto.open = hookedOpen;
        proto.send = hookedSend;
        proto.abort = hookedAbort;
      }
    }
    state.installed = true;
  }

  function uninstall() {
    if (!state.installed) return;
    if (state.fetchDesc) {
      try { Object.defineProperty(window, "fetch", state.fetchDesc); }
      catch (e) { window.fetch = state.origFetch; }
    } else {
      window.fetch = state.origFetch;
    }
    restoreXhr(state.xhrSaved);
    state.xhrSaved = null;
    state.installed = false;
  }

  function applyConfig(table, on) {
    var list = Array.isArray(table) ? table : [];
    state.table = list;
    state.enabled = on !== false && list.length > 0;
    try { console.info("[Mock] 配置已应用：规则 " + list.length + " 条，拦截" + (state.enabled ? "开启" : "关闭"), list.map(function (r) { return r.match.host + r.match.path; })); } catch (e) {}
    if (state.enabled) install();
    else {
      uninstall();
      state.table = [];
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || event.data.__mockSource !== SOURCE) return;
    if (event.data.type !== "config") return;
    applyConfig(event.data.table, event.data.enabled);
  });

  if (window.__MOCK_CONFIG__) {
    applyConfig(window.__MOCK_CONFIG__.table, window.__MOCK_CONFIG__.enabled);
  }
  // 主动向桥接层要一次配置，避免注入顺序造成丢失
  try { window.postMessage({ __mockSource: SOURCE, type: "hello" }, "*"); } catch (e) {}
})();
