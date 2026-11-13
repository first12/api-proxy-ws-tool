# 接口代理 & WS 抓包导出工具（api-proxy-ws-tool）

一个 Chrome（Manifest V3）浏览器扩展，面向前端 / 测试 / 联调场景，提供三项能力：

1. **HTTP 接口转发**：按「域名 + 路径」匹配请求并转发到测试环境或其他地址（基于 `declarativeNetRequest`）。
2. **本地 Mock 响应**：为尚未就绪的接口返回自定义状态码、响应头与 JSON 响应，可设置延迟。
3. **WebSocket 抓包导出**：通过 DevTools 面板捕获页面中所有 WebSocket 连接的收发消息，按连接分组实时展示，并一键导出为结构化 JSON。

[English Documentation](./README_EN.md)

## 功能特性

- **HTTP 请求转发**
  - 规则维度：域名（host）+ 接口路径（支持 `*` 通配）
  - 四种规则类型：
    - **路径替换**：仅替换 URL 路径，自动继承原 query 参数（推荐）
    - **完整目标 URL**：整条请求重定向到指定地址
    - **本地 Mock**：不发出真实请求，直接返回自定义状态码、响应头与 JSON 响应，可设置延迟
    - **仅请求头**：不改请求地址，只对匹配的请求增删改请求头
  - **域名授权**：规则需对目标域名授权后才生效，未授权时列表显示「待授权」，授权后可随时撤销
  - 规则可随时启用 / 停用 / 删除，配置存储在本地（`chrome.storage.local`）
- **请求头编辑**
  - 支持 `set` / `append` / `remove` 三种操作
  - 编译期拦截浏览器不允许修改的头（如 `host`、`content-length`、`origin`），以及 `cookie` 的 `set` / `remove`
  - 请求头需使用「仅请求头」类型单独配置：转发类规则通过重定向实现，浏览器不会给重定向后的请求追加请求头，两者同时配置会在保存时被拦截
- **WebSocket 抓包（DevTools 面板）**
  - 捕获页面上所有 WS 连接的 `open` / `close` / 收到消息（in）/ 发送消息（out）事件
  - 按连接实例分组展示（同一 URL 的多条并发连接也会分开）
  - 二进制帧记录为 `[binary]`，单帧内容最多保留 8000 字符
  - 单页帧总量上限 2000 条（超出后丢弃最旧的帧并标记 truncated）
  - 一键导出 JSON：包含连接元信息（URL、开关时间、关闭码）与全部帧明细
- 页面导航 / 刷新后自动重新注入钩子，无需手动操作

## 安装

1. 下载或克隆本仓库：

   ```bash
   git clone https://gitee.com/first12/api-proxy-ws-tool.git
   # 或
   git clone https://github.com/first12/api-proxy-ws-tool.git
   ```

2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目根目录
5. 扩展「接口代理&WS抓包导出工具」出现在扩展列表中即安装成功

## 使用说明

### 界面语言

配置页右上角提供语言选择：**跟随系统 / 中文 / English**。选择后页面自动重载，配置页、弹窗与 DevTools 面板统一使用该语言。默认「跟随系统」按浏览器界面语言选择，非中英文环境回落中文。

### 授权域名

规则只对已授权的域名生效。首次添加某域名的规则后，列表中该域名显示「待授权」：

1. 点击「授权此域名」，浏览器弹出主机权限确认框，选择「允许」
2. 授权后规则状态变为「生效」（Mock 规则显示「Mock 生效」）
3. 拒绝授权则规则保持「待授权」，可再次点击重试；也可在扩展详情页随时撤销权限

### HTTP 接口转发

1. 点击浏览器工具栏中的扩展图标，打开配置弹窗；或从扩展详情页进入「扩展选项」打开完整配置页
2. 填写规则：
   - **域名 host**：如 `192.168.1.100` 或 `www.example.com`
   - **接口路径**：如 `/api/user/list`，支持通配如 `/api/*`
   - **类型**：四选一
     - **路径替换**：填写「替换后路径」，如 `/proxy/api/user/list`
     - **完整目标 URL**：填写完整目标地址，如 `https://example.com/api/user/list?a=1`
     - **本地 Mock**：填写状态码、响应头与 JSON 响应体，可设置延迟
     - **仅请求头**：填写要增删改的请求头，不改变请求地址
3. 点击「添加规则」并完成域名授权，规则立即生效（保存后自动同步为浏览器动态重定向规则）

### WebSocket 抓包导出

1. 在目标页面上按 `F12` 打开开发者工具
2. 切换到 **【wsData】** 面板（面板随页面加载自动注入钩子）
3. 面板中会按连接分组实时展示 WS 消息：
   - `in` = 收到消息（服务器 → 页面）
   - `out` = 发送消息（页面 → 服务器）
   - `open` / `close` = 连接打开 / 关闭事件
4. 工具栏按钮：
   - **清空**：清空面板与页面内已捕获的数据
   - **导出JSON**：下载按连接分组的数据文件

### 导出 JSON 格式示例

每帧包含 `direction`（`open` / `out` / `in` / `close`）、`timestamp`、`ts`、`kind`、`byteLength`、`truncated`、`pending` 与 `payload` 字段；`truncated: true` 表示该帧超过单帧上限被截断。

完整脱敏示例见 [docs/examples/ws-export-sample.json](docs/examples/ws-export-sample.json)：

```json
{
  "exportedAt": "2026-01-01T08:00:00.000Z",
  "page": "https://example.com/demo",
  "connections": [
    {
      "id": "ws-1",
      "url": "wss://example.com/ws/chat?client_type=web",
      "openedAt": "2026-01-01T08:00:01.000Z",
      "closedAt": null,
      "closeCode": null,
      "truncated": false,
      "frameCount": 3,
      "frames": [
        { "direction": "open", "timestamp": "2026-01-01T08:00:01.000Z", "ts": 1767244801000, "kind": "text", "byteLength": 41, "truncated": false, "payload": "wss://example.com/ws/chat?client_type=web" },
        { "direction": "out", "timestamp": "2026-01-01T08:00:01.120Z", "ts": 1767244801120, "kind": "text", "byteLength": 74, "truncated": false, "payload": "{\"action\":\"SUBSCRIBE\",\"session_id\":\"session-demo-0001\"}" },
        { "direction": "in", "timestamp": "2026-01-01T08:00:01.240Z", "ts": 1767244801240, "kind": "text", "byteLength": 96, "truncated": false, "payload": "{\"action\":\"SUBSCRIBED\",\"session_id\":\"session-demo-0001\",\"ok\":true}" }
      ]
    }
  ]
}
```

> 示例中的域名、会话 ID 与报文均为虚构数据，`previewBase64` / `pending` 字段为长帧与流式帧保留。

## 目录结构

```
├── manifest.json          # 扩展清单（MV3）
├── sw.js                  # Service Worker：DNR 规则同步、mock 注入脚本注册
├── rules-model.js         # 规则模型：迁移 / 校验 / 匹配 / mock 表构建（options、sw、桥接共用）
├── popup.html / popup.js  # 扩展弹窗：代理规则的增删改与开关
├── options.html / options.js  # 规则配置页：列表、授权、导入导出
├── mock-bridge.js         # ISOLATED 桥接：把 mock 表下发到页面，必要时降级注入引擎
├── mock-inject.js         # MAIN world Mock 引擎：拦截页面 fetch / XHR
├── devtools.html / devtools.js        # DevTools 入口，注册【wsData】面板
├── devtools-panel.html / devtools-panel.js  # 面板 UI：轮询展示、清空、导出
├── ws-hook-source.js      # 注入页面的 WebSocket 钩子源码（主世界）
├── privacy.html           # 隐私政策页（GitHub Pages 托管）
└── docs/examples/         # 脱敏示例数据（规则与 WS 导出）
```

## 已知限制

- **Mock 仅覆盖页面脚本发起的请求**：mock 通过页面内 `fetch` / `XMLHttpRequest` 拦截实现，因此只作用于页面 JS 发起的请求；文档导航、`<img>` / `<script>` 等资源类请求不经过 mock（这类请求请使用转发规则）。返回内容必须由用户自行填写，结构需符合业务预期。
- **WebSocket 只读**：WS 面板仅用于查看与导出，不能修改或转发 WebSocket 消息（浏览器扩展无法在后台劫持 WS）。
- **请求头不能与转发叠加**：浏览器不会给重定向产生的新请求应用请求头规则，因此需要改请求头时请单独建一条「仅请求头」规则；`cookie` 只支持 `append`，`host` / `content-length` / `origin` 等敏感头不允许修改。
- 页面在钩子注入之前建立的 WS 连接无法被捕获（刷新页面后重连即可）。

## 开源版本说明

- **版本**：v0.7（开源社区版）
- **开源协议**：[MIT License](./LICENSE)（本仓库随代码附送，任何人可自由使用、修改与分发，需保留版权声明）
- **更新方式**：本扩展为纯前端实现（原生 HTML / CSS / JS），无需构建工具，拉取最新代码后在 `chrome://extensions/` 点击「重新加载」即可升级。
- **反馈与贡献**：欢迎通过 [Gitee](https://gitee.com/first12/api-proxy-ws-tool/issues) 或 [GitHub](https://github.com/first12/api-proxy-ws-tool/issues) 的 Issue 反馈问题或提交 Pull Request。
- **隐私说明**：本扩展不上传任何数据；代理规则保存在本地 `chrome.storage.local`，WS 抓包数据仅存在于被检查页面内存与本地导出文件中。完整政策见 [privacy.html](https://first12.github.io/api-proxy-ws-tool/privacy.html)。

## License

[MIT](./LICENSE)
