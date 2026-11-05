let rules = [];
let editingId = null;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toggleForm() {
  const type = $("#ruleType").value;
  if (type === "mock") {
    $("#proxyConfigWrap").style.display = "none";
    $("#mockBody").style.display = "block";
  } else {
    $("#proxyConfigWrap").style.display = "block";
    $("#mockBody").style.display = "none";
  }

  const mode = $("input[name='proxyMode']:checked").value;
  if (mode === "pathReplace") {
    $("#pathReplaceRow").style.display = "block";
    $("#fullUrlRow").style.display = "none";
  } else {
    $("#pathReplaceRow").style.display = "none";
    $("#fullUrlRow").style.display = "block";
  }
}

function showError(msg) {
  const el = $("#formError");
  el.textContent = msg;
  el.style.display = "block";
}

function hideError() {
  const el = $("#formError");
  el.textContent = "";
  el.style.display = "none";
}

function nextId(list) {
  let max = 0;
  list.forEach((r) => {
    if (Number.isInteger(r.id) && r.id > max) max = r.id;
  });
  return max + 1;
}

// 读旧结构（无 id）→ 补 id → 写回；写回失败只在内存补全，不影响本次会话编辑
async function loadRules() {
  const res = await chrome.storage.local.get("proxyRules");
  rules = Array.isArray(res.proxyRules) ? res.proxyRules : [];

  const missing = rules.some((r) => !Number.isInteger(r.id));
  if (missing) {
    let max = 0;
    rules.forEach((r) => {
      if (Number.isInteger(r.id) && r.id > max) max = r.id;
    });
    rules.forEach((r) => {
      if (!Number.isInteger(r.id)) r.id = ++max;
    });
    try {
      await chrome.storage.local.set({ proxyRules: rules });
    } catch (e) {
      console.warn("[ProxyPlugin] 规则 id 迁移写回失败，仅内存补全", e);
    }
  }
}

async function persist() {
  try {
    await chrome.storage.local.set({ proxyRules: rules });
    return true;
  } catch (e) {
    showError("保存失败：" + e.message);
    return false;
  }
}

async function render() {
  await loadRules();
  const wrap = $("#ruleList");
  wrap.innerHTML = "";

  if (!rules.length) {
    wrap.innerHTML = '<div class="hint">暂无规则</div>';
    return;
  }

  rules.forEach((item) => {
    const div = document.createElement("div");
    div.className = "rule-item" + (item.id === editingId ? " editing" : "");
    const modeText = item.proxyMode === "pathReplace" ? "路径替换" : "完整URL";
    div.innerHTML = `
      <div>host: ${item.host} | path:${item.pathPattern}</div>
      <div>类型:${item.type} | ${item.type === "proxy" ? modeText : "Mock"} | ${item.enable ? "✅启用" : "❌关闭"}${item.id === editingId ? ' | <b>编辑中</b>' : ""}</div>
      <button data-id="${item.id}" class="edit">编辑</button>
      <button data-id="${item.id}" class="del">删除</button>
      <button data-id="${item.id}" class="toggle">开关</button>
    `;
    wrap.appendChild(div);
  });

  wrap.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) return;

    if (btn.classList.contains("edit")) {
      startEdit(rules[idx]);
    } else if (btn.classList.contains("del")) {
      await deleteRule(id);
    } else if (btn.classList.contains("toggle")) {
      rules[idx].enable = !rules[idx].enable;
      if (await persist()) render();
    }
  };
}

function startEdit(rule) {
  editingId = rule.id;
  $("#host").value = rule.host || "";
  $("#path").value = rule.pathPattern || "";
  $("#ruleType").value = rule.type === "mock" ? "mock" : "proxy";

  const mode = rule.proxyMode === "fullUrl" ? "fullUrl" : "pathReplace";
  $$("input[name='proxyMode']").forEach((r) => {
    r.checked = r.value === mode;
  });

  $("#proxyPathPrefix").value = rule.proxyPathPrefix || "";
  $("#proxyTarget").value = rule.proxyTarget || "";
  $("#mockBody").value = rule.mockBody || "";
  toggleForm();

  $("#formTitle").textContent = "编辑规则 #" + rule.id;
  $("#addBtn").textContent = "保存修改";
  $("#cancelBtn").style.display = "inline-block";
  hideError();
  render();
  $("#host").scrollIntoView({ block: "nearest" });
}

function resetForm() {
  editingId = null;
  $("#host").value = "";
  $("#path").value = "";
  $("#ruleType").value = "proxy";
  $$("input[name='proxyMode']").forEach((r) => {
    r.checked = r.value === "pathReplace";
  });
  $("#proxyPathPrefix").value = "";
  $("#proxyTarget").value = "";
  $("#mockBody").value = "";
  $("#formTitle").textContent = "新增规则";
  $("#addBtn").textContent = "添加规则";
  $("#cancelBtn").style.display = "none";
  hideError();
  toggleForm();
}

async function deleteRule(id) {
  rules = rules.filter((r) => r.id !== id);
  // 正在编辑的规则被删除：退出编辑态，避免保存到已删除的条目
  if (editingId === id) resetForm();
  if (await persist()) render();
}

function collectForm() {
  return {
    host: $("#host").value.trim(),
    pathPattern: $("#path").value.trim(),
    type: $("#ruleType").value,
    proxyMode: $("input[name='proxyMode']:checked").value,
    proxyPathPrefix: $("#proxyPathPrefix").value.trim(),
    proxyTarget: $("#proxyTarget").value.trim(),
    mockBody: $("#mockBody").value.trim()
  };
}

function validate(data, selfId) {
  if (!data.host) return "请填写域名 host";
  if (!data.pathPattern) return "请填写接口路径";

  if (data.type === "proxy") {
    if (data.proxyMode === "pathReplace") {
      if (!data.proxyPathPrefix) return "路径替换模式下需填写替换后的路径";
    } else {
      if (!data.proxyTarget) return "完整目标URL模式下需填写目标地址";
      try {
        new URL(data.proxyTarget);
      } catch (e) {
        return "完整目标地址不是合法 URL";
      }
    }
  } else {
    if (!data.mockBody) return "Mock 模式下需填写 Mock JSON";
    try {
      JSON.parse(data.mockBody);
    } catch (e) {
      return "Mock JSON 不是合法 JSON";
    }
  }

  // 无 method 字段，重复判定用 host + pathPattern；编辑时排除自身
  const dup = rules.find((r) => r.id !== selfId && r.host === data.host && r.pathPattern === data.pathPattern);
  if (dup) return "已存在相同匹配地址的规则 #" + dup.id + "（host + path 相同）";

  return null;
}

$("#addBtn").onclick = async () => {
  const data = collectForm();
  const err = validate(data, editingId);
  if (err) {
    showError(err);
    return;
  }
  hideError();

  if (editingId !== null) {
    const idx = rules.findIndex((r) => r.id === editingId);
    if (idx < 0) {
      resetForm();
      showError("原规则已不存在，请重新添加");
      render();
      return;
    }
    // 更新同一条：保留 id 与 enable
    rules[idx] = Object.assign({}, rules[idx], data);
  } else {
    rules.push(Object.assign({ id: nextId(rules), enable: true }, data));
  }

  if (!(await persist())) return;
  resetForm();
  render();
};

$("#cancelBtn").onclick = () => {
  resetForm();
  render();
};

$("#ruleType").onchange = toggleForm;
$$("input[name='proxyMode']").forEach(radio => radio.onchange = toggleForm);

toggleForm();
render();
