# API Proxy & WebSocket Capture Tool (api-proxy-ws-tool)

A Chrome (Manifest V3) browser extension for frontend development, QA, and API debugging, providing three capabilities:

1. **HTTP API Forwarding**: Match requests by "host + path" and forward them to a test environment or any other address (powered by `declarativeNetRequest`).
2. **Local Mock Responses**: Return a custom status code, headers and JSON body for endpoints that are not ready yet, with an optional delay.
3. **WebSocket Capture & Export**: Capture all WebSocket traffic of the inspected page via a DevTools panel, display it grouped by connection in real time, and export it as structured JSON.

[中文文档](./README.md)

## Features

- **HTTP Request Forwarding**
  - Rule dimensions: host + API path (supports `*` wildcards)
  - Four rule types:
    - **Path Replace**: rewrite only the URL path, query string is preserved automatically (recommended)
    - **Full Target URL**: redirect the entire request to a given address
    - **Local Mock**: skip the real request and return a custom status code, headers and JSON body, with an optional delay
    - **Headers Only**: keep the request address unchanged and only add / modify / remove request headers
  - **Domain authorization**: a rule takes effect only after its domain is authorized. Unauthorized rules show as "Pending authorization" and the permission can be revoked at any time
  - Rules can be enabled / disabled / deleted at any time; configuration is stored locally (`chrome.storage.local`)
- **Request Header Editing**
  - Supports `set` / `append` / `remove`
  - Headers the browser refuses to modify (such as `host`, `content-length`, `origin`) and `cookie` with `set` / `remove` are rejected at compile time
  - Headers must be configured with the "Headers Only" type: forwarding rules are implemented as redirects, and the browser does not apply header rules to the redirected request, so combining both is blocked on save
- **WebSocket Capture (DevTools Panel)**
  - Captures `open` / `close` / incoming (`in`) / outgoing (`out`) events of every WS connection on the page
  - Frames are grouped by connection instance (multiple concurrent connections to the same URL are listed separately)
  - Binary frames are recorded as `[binary]`; each payload is truncated to 8000 characters
  - A page keeps at most 2000 frames in total (oldest frames are dropped and marked as `truncated`)
  - One-click JSON export: includes connection metadata (URL, open/close timestamps, close code) and all frame details
- The hook is re-injected automatically after page navigation / reload — no manual action needed

## Installation

1. Download or clone this repository:

   ```bash
   git clone https://gitee.com/first12/api-proxy-ws-tool.git
   # or
   git clone https://github.com/first12/api-proxy-ws-tool.git
   ```

2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right corner)
4. Click **Load unpacked** and select the project root directory
5. The extension "API Proxy & WS Capture Tool" appears in the list — installation is complete

## Usage

### Interface language

The top-right corner of the settings page offers **System / 中文 / English**. Changing it reloads the page and applies the same language to the settings page, the popup and the DevTools panel. The default "System" follows the browser UI language and falls back to Chinese for other locales.

### Authorize a domain

Rules only apply to authorized domains. After the first rule for a domain is added, the list shows "Pending authorization":

1. Click **Authorize this domain**; the browser shows a host permission prompt — choose **Allow**
2. The rule status changes to "Active" (mock rules show "Mock active")
3. If you deny the prompt, the rule stays pending and you can retry later; the permission can also be revoked from the extension details page at any time

### HTTP API Forwarding

1. Click the extension icon in the browser toolbar to open the configuration popup, or open the options page from the extension details page for the full configuration UI
2. Fill in a rule:
   - **Host**: e.g. `192.168.1.100` or `www.example.com`
   - **API path**: e.g. `/api/user/list`, wildcards like `/api/*` are supported
   - **Type**, one of four:
     - **Path Replace**: enter the new path, e.g. `/proxy/api/user/list`
     - **Full Target URL**: enter the complete target, e.g. `https://example.com/api/user/list?a=1`
     - **Local Mock**: enter the status code, headers and JSON body, with an optional delay
     - **Headers Only**: enter the headers to set / append / remove without changing the request address
3. Click **Add rule** and authorize the domain — it takes effect immediately (saved rules are synced into browser dynamic redirect rules automatically)

### WebSocket Capture & Export

1. Press `F12` on the target page to open DevTools
2. Switch to the **wsData** panel (the hook is injected automatically as the page loads)
3. WS messages are displayed in real time, grouped by connection:
   - `in` = message received (server → page)
   - `out` = message sent (page → server)
   - `open` / `close` = connection opened / closed
4. Toolbar buttons:
   - **Clear**: clear both the panel and the captured data in the page
   - **Export JSON**: download the grouped data file

### Exported JSON Example

Each frame carries `direction` (`open` / `out` / `in` / `close`), `timestamp`, `ts`, `kind`, `byteLength`, `truncated`, `pending` and `payload`; `truncated: true` means the frame exceeded the per-frame limit and was cut.

A complete desensitized sample lives in [docs/examples/ws-export-sample.json](docs/examples/ws-export-sample.json):

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

> Domains, session IDs and payloads in the sample are fictional; `previewBase64` / `pending` are reserved for large and streaming frames.

## Project Structure

```
├── manifest.json          # Extension manifest (MV3)
├── sw.js                  # Service Worker: DNR rule sync, mock script registration
├── rules-model.js         # Rule model: migrate / validate / match / build mock table (shared)
├── popup.html / popup.js  # Extension popup: manage proxy rules
├── options.html / options.js  # Rule options page: list, permissions, import/export
├── mock-bridge.js         # ISOLATED bridge: pushes the mock table to the page, injects the engine when needed
├── mock-inject.js         # MAIN-world mock engine: intercepts page fetch / XHR
├── devtools.html / devtools.js        # DevTools entry, registers the wsData panel
├── devtools-panel.html / devtools-panel.js  # Panel UI: polling display, clear, export
├── ws-hook-source.js      # WebSocket hook source injected into the page (main world)
├── privacy.html           # Privacy policy page (hosted on GitHub Pages)
├── _locales/              # i18n resources (zh_CN, en) for name and description
└── docs/examples/         # Desensitized sample data (rules and WS exports)
```

## Known Limitations

- **Mock covers page-script requests only**: mock works by intercepting `fetch` / `XMLHttpRequest` inside the page, so it applies to requests issued by page JavaScript; document navigation and `<img>` / `<script>` resource requests bypass mock (use a forwarding rule for those). Response bodies are user-supplied and must match the business shape your app expects.
- **WebSocket is read-only**: the WS panel is for viewing and exporting only; it cannot modify or forward WebSocket messages (browser extensions cannot hijack WS in the background).
- **Request headers cannot be combined with forwarding**: the browser does not apply header rules to requests produced by a redirect, so create a separate "Headers Only" rule instead; `cookie` supports `append` only, and sensitive headers such as `host` / `content-length` / `origin` cannot be modified.
- WS connections established before the hook is injected cannot be captured (reload the page to reconnect).

## Open Source Edition Notes

- **Version**: v0.7 (open-source community edition)
- **License**: [MIT License](./LICENSE) — anyone may freely use, modify, and distribute this project, provided the copyright notice is retained.
- **Upgrading**: the extension is pure frontend code (vanilla HTML / CSS / JS) with no build step — pull the latest code and click "Reload" on `chrome://extensions/` to upgrade.
- **Feedback & Contribution**: issues and pull requests are welcome via [Gitee](https://gitee.com/first12/api-proxy-ws-tool/issues) or [GitHub](https://github.com/first12/api-proxy-ws-tool/issues).
- **Privacy**: the extension uploads nothing. Proxy rules are stored in local `chrome.storage.local`; captured WS data lives only in the inspected page's memory and in your locally exported files. See the full policy at [privacy.html](https://first12.github.io/api-proxy-ws-tool/privacy.html).

## License

[MIT](./LICENSE)
