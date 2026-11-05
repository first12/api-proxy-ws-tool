# 接口代理 & WS 抓包导出工具（api-proxy-ws-tool）

一个 Chrome（Manifest V3）浏览器扩展，面向前端 / 测试 / 联调场景，提供两大能力：

1. **HTTP 接口转发代理**：按「域名 + 路径」匹配请求并重定向到测试环境或其他地址（基于 `declarativeNetRequest`）。
2. **WebSocket 抓包导出**：通过 DevTools 面板捕获页面中所有 WebSocket 连接的收发消息，按连接分组实时展示，并一键导出为结构化 JSON。

[English Documentation](./README_EN.md)

## 功能特性

- **HTTP 请求转发**
  - 规则维度：域名（host）+ 接口路径（支持 `*` 通配）
  - 两种转发模式：
    - **路径替换**：仅替换 URL 路径，自动继承原 query 参数（推荐）
    - **完整目标 URL**：整条请求重定向到指定地址
  - 规则可随时启用 / 停用 / 删除，配置存储在本地（`chrome.storage.local`）
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
   ```

2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目根目录
5. 扩展「接口代理&WS抓包导出工具」出现在扩展列表中即安装成功

## 使用说明

### HTTP 接口转发

1. 点击浏览器工具栏中的扩展图标，打开配置弹窗
2. 填写规则：
   - **域名 host**：如 `10.114.0.11` 或 `example.com`
   - **接口路径**：如 `/da-digital/api/sessions`，支持通配如 `/api/*`
   - **类型**：选择「转发代理」
   - **转发模式**：
     - 路径替换：填写「替换后路径」，如 `/da-digital-test/api/sessions`
     - 完整目标 URL：填写完整目标地址，如 `http://test-env/api/sessions?a=1`
3. 点击「添加规则」，规则立即生效（保存后自动同步为浏览器动态重定向规则）

### WebSocket 抓包导出

1. 在目标页面上按 `F12` 打开开发者工具
2. 切换到 **【WS抓包】** 面板（面板随页面加载自动注入钩子）
3. 面板中会按连接分组实时展示 WS 消息：
   - `in` = 收到消息（服务器 → 页面）
   - `out` = 发送消息（页面 → 服务器）
   - `open` / `close` = 连接打开 / 关闭事件
4. 工具栏按钮：
   - **清空**：清空面板与页面内已捕获的数据
   - **导出JSON**：下载按连接分组的数据文件

### 导出 JSON 格式示例

```json
{
  "exportedAt": "2026-01-01T08:00:00.000Z",
  "page": "https://example.com/demo",
  "connections": [
    {
      "id": "ws-1",
      "url": "wss://example.com/socket",
      "openedAt": "2026-01-01T08:00:01.000Z",
      "closedAt": null,
      "closeCode": null,
      "truncated": false,
      "frameCount": 2,
      "frames": [
        { "direction": "open", "timestamp": "2026-01-01T08:00:01.000Z", "ts": 1767244801000, "payload": "wss://example.com/socket" },
        { "direction": "in", "timestamp": "2026-01-01T08:00:02.000Z", "ts": 1767244802000, "payload": "{\"type\":\"hello\"}" }
      ]
    }
  ]
}
```

## 目录结构

```
├── manifest.json          # 扩展清单（MV3）
├── sw.js                  # Service Worker：把规则同步成 DNR 动态重定向规则
├── popup.html / popup.js  # 扩展弹窗：代理规则的增删改与开关
├── devtools.html / devtools.js        # DevTools 入口，注册【WS抓包】面板
├── devtools-panel.html / devtools-panel.js  # 面板 UI：轮询展示、清空、导出
└── ws-hook-source.js      # 注入页面的 WebSocket 钩子源码（主世界）
```

## 已知限制

- **Mock 规则不生效**：MV3 普通扩展无法通过 `webRequestBlocking` 返回自定义响应体，`declarativeNetRequest` 只能改请求目标。因此当前版本中「Mock返回」类型的规则不会被应用（保留字段以备后续版本）。
- **WebSocket 只读**：WS 面板仅用于查看与导出，不能修改或转发 WebSocket 消息（浏览器扩展无法在后台劫持 WS）。
- 页面在钩子注入之前建立的 WS 连接无法被捕获（刷新页面后重连即可）。

## 开源版本说明

- **版本**：v0.4（开源社区版）
- **开源协议**：[MIT License](./LICENSE)（本仓库随代码附送，任何人可自由使用、修改与分发，需保留版权声明）
- **更新方式**：本扩展为纯前端实现（原生 HTML / CSS / JS），无需构建工具，拉取最新代码后在 `chrome://extensions/` 点击「重新加载」即可升级。
- **反馈与贡献**：欢迎通过 Gitee 仓库的 Issue 反馈问题或提交 Pull Request 改进功能。
- **隐私说明**：本扩展不上传任何数据；代理规则保存在本地 `chrome.storage.local`，WS 抓包数据仅存在于被检查页面内存与本地导出文件中。

## License

[MIT](./LICENSE)
