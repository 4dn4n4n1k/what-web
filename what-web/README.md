# WHAT API v1.1

A passive Chrome Manifest V3 extension for discovering API endpoint references exposed to the browser.

## Features

- Observes browser network request URLs and methods while a scan is active.
- Instruments page `fetch()` and `XMLHttpRequest` metadata.
- Parses same-origin JavaScript with bundled Acorn and extracts request call expressions, URL constants, template literals, and concatenated paths.
- Reads accessible Source Map v3 `sourcesContent` and analyzes embedded source with AST parsing.
- Discovers initial and lazy-loaded JavaScript chunks through DOM inspection and Performance Resource Timing; records same-origin links and SPA history navigation.
- Deduplicates endpoint records using conservative path normalization and tracks file, line, column, expression, and evidence sources.
- Provides popup controls, a dashboard, clipboard copy, and JSON export.

## Important limitations

WHAT API analyzes only browser-visible material. It cannot inspect server-side source code, guarantee discovery of every endpoint, or prove that a statically referenced URL is live or accessible. Dynamic URL construction, encrypted/obfuscated bundles, inaccessible source maps, service-worker internals, and endpoints only used in unvisited application states can limit results.

The initial crawler records same-origin links; it does not automatically navigate through them or submit forms. This avoids changing application state and creating unexpected traffic. Browse the app normally while a scan is active to expose lazy-loaded routes and requests.

## Install locally

1. Download and extract `what-api-v1.1.0.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `api-hunter` folder.
6. Open a website you own or are authorized to assess.
7. Reload that page so the content scripts are injected.
8. Click WHAT API, then **Start deep scan**.
9. Browse the application normally. Reopen the popup or dashboard to inspect results.

## Permissions

- `activeTab`, `tabs`, `scripting`: identify the active tab and communicate with it.
- `storage`: persist scan results locally.
- `webRequest`: observe request metadata while a scan is active.
- HTTP/HTTPS host permissions: inspect accessible JavaScript assets and observe requests.

Acorn 8.15.0 is bundled locally under `vendor/` under its MIT license; see `vendor/ACORN-LICENSE`.

The extension does not collect cookies, authorization headers, request bodies, response bodies, or form values. JavaScript asset retrieval uses `credentials: omit`.

## Evidence labels

- `browser_network`: observed by Chrome's network event API.
- `page_runtime`: observed through page fetch/XHR instrumentation.
- `static_ast`: endpoint candidate extracted from a JavaScript AST. `static_javascript`: regex fallback used when parsing fails.

A static match is a lead, not proof of a functioning API.

## Development notes

- `background/service-worker.js`: scan state, network events, storage, asset fetching.
- `content/page-bridge-main.js`: minimal MAIN-world fetch/XHR and SPA route instrumentation.
- `vendor/acorn.js` and `engines/ast-analyzer.js`: bundled Acorn parser and AST-based endpoint analysis.
- `content/content.js`: static asset discovery, lazy chunk detection, source-map inspection, and AST orchestration.
- `popup/`: start/stop and quick exports.
- `dashboard/`: searchable endpoint inventory.

## Current v1.1 boundaries

- No endpoint fuzzing, parameter guessing, authentication bypass, or active validation.
- No automatic form submission or automated link navigation.
- No server-side source discovery.
- AST resolution is static and conservative. It does not execute application code and cannot resolve arbitrary runtime values, dynamic imports with computed paths, or all custom request abstractions.
- Third-party request capture is opt-in in the popup.

## Troubleshooting

**No endpoints appear:** reload the page after installing; start the scan; browse the application; ensure the site is HTTP/HTTPS.

**No static assets appear:** the scanner discovers script tags and same-origin script-like resources reported by `PerformanceResourceTiming`. Some applications load code through unusual mechanisms or from third-party origins that are intentionally excluded.

**Source maps are missing:** the map must be referenced by the bundle and fetchable by the extension. Private or unavailable maps are not bypassed.

**Dashboard is empty:** open the dashboard after scanning the same origin. Results are stored per origin in `chrome.storage.local`.


## Tests

Run the AST analyzer unit tests with `node tests/ast-analyzer.test.js`. The tests cover dynamic path reconstruction, request methods, Axios configuration, XHR, WebSocket/SSE discovery, and source attribution.
