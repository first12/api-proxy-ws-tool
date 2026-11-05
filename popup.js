let rules = [];
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

async function render() {
  const res = await chrome.storage.local.get("proxyRules");
  rules = res.proxyRules || [];
  const wrap = $("#ruleList");
  wrap.innerHTML = "";
  rules.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "rule-item";
    const modeText = item.proxyMode === "pathReplace" ? "路径替换" : "完整URL";
    div.innerHTML = `
      <div>host: ${item.host} | path:${item.pathPattern}</div>
      <div>类型:${item.type} | ${item.type==='proxy' ? modeText : 'Mock'} | ${item.enable ? "✅启用" : "❌关闭"}</div>
      <button data-i="${idx}" class="del">删除</button>
      <button data-i="${idx}" class="toggle">开关</button>
    `;
    wrap.appendChild(div);
  })
  $$(".del").forEach(b=>b.onclick=async e=>{
    const i = +e.target.dataset.i;
    rules.splice(i,1);
    await chrome.storage.local.set({proxyRules:rules});
    render();
  })
  $$(".toggle").forEach(b=>b.onclick=async e=>{
    const i = +e.target.dataset.i;
    rules[i].enable = !rules[i].enable;
    await chrome.storage.local.set({proxyRules:rules});
    render();
  })
}

$("#addBtn").onclick = async ()=>{
  const ruleType = $("#ruleType").value;
  const proxyMode = $("input[name='proxyMode']:checked").value;
  const rule = {
    host: $("#host").value.trim(),
    pathPattern: $("#path").value.trim(),
    type: ruleType,
    proxyMode,
    proxyPathPrefix: $("#proxyPathPrefix").value.trim(),
    proxyTarget: $("#proxyTarget").value.trim(),
    mockBody: $("#mockBody").value.trim(),
    enable: true
  }
  rules.push(rule);
  await chrome.storage.local.set({proxyRules:rules});
  render();
  $("#host").value = "";
  $("#path").value = "";
  $("#proxyPathPrefix").value = "";
  $("#proxyTarget").value = "";
  $("#mockBody").value = "";
}

$("#ruleType").onchange = toggleForm;
$$("input[name='proxyMode']").forEach(radio=>radio.onchange = toggleForm);

toggleForm();
render();