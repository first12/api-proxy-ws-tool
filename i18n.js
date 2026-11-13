/**
 * 轻量国际化（i18n）核心
 * 说明：
 *  1. 语言偏好存于 chrome.storage.local 的 uiLang 键，取值 auto / zh / en
 *  2. auto 时按浏览器界面语言（navigator.language）选择，非中英文环境回落中文
 *  3. 各页面通过独立字典文件调用 I18N.register 注册词条，避免改动同一文件产生冲突
 *  4. HTML 用 data-i18n / data-i18n-placeholder / data-i18n-title 标注，脚本调用 I18N.apply 填充
 *  5. 切换语言后重载当前页面，保证动态渲染的文案一并刷新
 */
(function (global) {
  "use strict";

  var SUPPORTED = ["zh", "en"];
  var STORAGE_KEY = "uiLang";
  var dict = { zh: {}, en: {} };
  var current = "zh";
  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  /** 把任意语言标记归一化为 zh / en */
  function normalizeLang(value) {
    var v = String(value || "").toLowerCase();
    if (v.indexOf("en") === 0) return "en";
    if (v.indexOf("zh") === 0) return "zh";
    return "zh";
  }

  /** 根据偏好解析最终语言 */
  function resolveLang(pref) {
    if (pref === "zh" || pref === "en") return pref;
    var navLang = (global.navigator && global.navigator.language) || "zh";
    return normalizeLang(navLang);
  }

  /** 注册字典，形如 { zh: { key: "文案" }, en: { key: "text" } } */
  function register(obj) {
    if (!obj) return;
    SUPPORTED.forEach(function (lang) {
      var part = obj[lang];
      if (part) Object.assign(dict[lang], part);
    });
  }

  /** 取词条并替换 {name} 占位符；缺失时回落到中文，再回落到 key 本身 */
  function t(key, params) {
    var table = dict[current] || {};
    var raw = table[key];
    if (raw == null) raw = dict.zh[key];
    if (raw == null) return key;
    if (!params) return raw;
    return String(raw).replace(/\{(\w+)\}/g, function (m, name) {
      return params[name] != null ? params[name] : m;
    });
  }

  /** 按 data-i18n* 属性填充指定子树（默认整个文档） */
  function apply(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return;

    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    // 允许少量内联标记的文案（字典内容受控，不含用户输入）
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var htmlKey = el.getAttribute("data-i18n-html");
      if (htmlKey) el.innerHTML = t(htmlKey);
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
    // 页面标题：<html data-i18n-doc-title="key">
    if (scope === global.document && global.document.documentElement) {
      var docKey = global.document.documentElement.getAttribute("data-i18n-doc-title");
      if (docKey) global.document.title = t(docKey);
    }
  }

  /** 切换语言并写入偏好（调用方负责 reload） */
  function setLang(pref) {
    if (!global.chrome || !global.chrome.storage) return Promise.resolve();
    var payload = {};
    payload[STORAGE_KEY] = pref;
    return global.chrome.storage.local.set(payload);
  }

  /** 读取当前偏好（auto / zh / en） */
  function getPref() {
    return new Promise(function (resolve) {
      if (!global.chrome || !global.chrome.storage) return resolve("auto");
      global.chrome.storage.local.get(STORAGE_KEY, function (res) {
        resolve((res && res[STORAGE_KEY]) || "auto");
      });
    });
  }

  // 初始化：解析语言 → 填充首屏 → 监听偏好变化（其他页面切换后同步）
  getPref().then(function (pref) {
    current = resolveLang(pref);
    readyResolve(current);
    if (global.document && global.document.readyState !== "loading") {
      apply(global.document);
    } else if (global.document) {
      global.document.addEventListener("DOMContentLoaded", function () {
        apply(global.document);
      });
    }
  });

  if (global.chrome && global.chrome.storage && global.chrome.storage.onChanged) {
    global.chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      var next = resolveLang(changes[STORAGE_KEY].newValue);
      if (next !== current) current = next;
    });
  }

  global.I18N = {
    ready: ready,
    register: register,
    t: t,
    apply: apply,
    setLang: setLang,
    getPref: getPref,
    get lang() {
      return current;
    }
  };
})(typeof window !== "undefined" ? window : self);
