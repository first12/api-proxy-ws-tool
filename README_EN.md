# API Proxy & WebSocket Capture Tool (api-proxy-ws-tool)

A Chrome (Manifest V3) browser extension for frontend development, QA, and API debugging, providing two major capabilities:

1. **HTTP API Proxy**: Match requests by "host + path" and redirect them to a test environment or any other address (powered by `declarativeNetRequest`).
2. **WebSocket Capture & Export**: Capture all WebSocket traffic of the inspected page via a DevTools panel, display it grouped by connection in real time, and export it as structured JSON.

[中文文档](./README.md)

## Features

- **HTTP Request Proxy**
  - Rule dimensions: host + API path (supports `*` wildcards)
  - Two redirect modes:
    - **Path Replace**: rewrite only the URL path, query string is preserved automatically (recommended)
    - **Full Target URL**: redirect the entire request to a given address
  - Rules can be enabled / disabled / deleted at any time; configuration is stored locally (`chrome.storage.local`)
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
   ```

2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right corner)
4. Click **Load unpacked** and select the project root directory
5. The extension "API Proxy & WS Capture Tool" appears in the list — installation is complete

## Usage

### HTTP API Proxy

1. Click the extension icon in the browser toolbar to open the configuration popup
2. Fill in a rule:
   - **Host**: e.g. `10.114.0.11` or `example.com`
   - **API path**: e.g. `/da-digital/api/sessions`, wildcards like `/api/*` are supported
   - **Type**: choose "Proxy"
   - **Redirect mode**:
     - Path Replace: enter the new path, e.g. `/da-digital-test/api/sessions`
     - Full Target URL: enter the complete target, e.g. `http://test-env/api/sessions?a=1`
3. Click **Add rule** — it takes effect immediately (saved rules are synced into browser dynamic redirect rules automatically)

### WebSocket Capture & Export

1. Press `F12` on the target page to open DevTools
2. Switch to the **WS Capture** panel (the hook is injected automatically as the page loads)
3. WS messages are displayed in real time, grouped by connection:
   - `in` = message received (server → page)
   - `out` = message sent (page → server)
   - `open` / `close` = connection opened / closed
4. Toolbar buttons:
   - **Clear**: clear both the panel and the captured data in the page
   - **Export JSON**: download the grouped data file

### Exported JSON Example

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

## Project Structure

```
├── manifest.json          # Extension manifest (MV3)
├── sw.js                  # Service Worker: syncs rules into DNR dynamic redirects
├── popup.html / popup.js  # Extension popup: manage proxy rules
├── devtools.html / devtools.js        # DevTools entry, registers the WS Capture panel
├── devtools-panel.html / devtools-panel.js  # Panel UI: polling display, clear, export
└── ws-hook-source.js      # WebSocket hook source injected into the page (main world)
```

## Known Limitations

- **Mock rules are not applied**: a regular MV3 extension cannot return custom response bodies (no `webRequestBlocking`), and `declarativeNetRequest` can only change the request target. Therefore "Mock" type rules currently have no effect (the field is kept for future versions).
- **WebSocket is read-only**: the WS panel is for viewing and exporting only; it cannot modify or forward WebSocket messages (browser extensions cannot hijack WS in the background).
- WS connections established before the hook is injected cannot be captured (reload the page to reconnect).

## Open Source Edition Notes

- **Version**: v0.4 (open-source community edition)
- **License**: [MIT License](./LICENSE) — anyone may freely use, modify, and distribute this project, provided the copyright notice is retained.
- **Upgrading**: the extension is pure frontend code (vanilla HTML / CSS / JS) with no build step — pull the latest code and click "Reload" on `chrome://extensions/` to upgrade.
- **Feedback & Contribution**: issues and pull requests are welcome via the Gitee repository.
- **Privacy**: the extension uploads nothing. Proxy rules are stored in local `chrome.storage.local`; captured WS data lives only in the inspected page's memory and in your locally exported files.

## License

[MIT](./LICENSE)
