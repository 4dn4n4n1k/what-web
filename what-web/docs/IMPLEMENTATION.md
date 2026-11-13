# Implementation details and next development steps

## Scan lifecycle

1. User clicks Start in the popup.
2. The service worker creates a fresh per-origin scan record and registers the active tab in memory.
3. The isolated content script begins script/link discovery.
4. The MAIN-world bridge observes fetch/XHR URL and method metadata and SPA history changes.
5. `webRequest.onBeforeRequest` independently records browser-observed requests while the tab is registered as scanning.
6. The content script requests same-origin script assets through the service worker. The worker fetches assets without credentials.
7. Static extraction identifies candidate URLs and referenced source maps.
8. The service worker deduplicates and stores endpoint evidence in `chrome.storage.local`.

## Endpoint record

Each endpoint has:
- `id`: method + normalized URL identity key
- `url`: absolute URL candidate
- `method`: observed method, inferred hint, or UNKNOWN
- `type`: REST, GraphQL, WebSocket, or Other
- `sources`: one or more evidence sources
- `observed`: whether runtime/network evidence exists
- `confidence`: heuristic confidence label
- `files`: JavaScript files containing the candidate
- `normalizedUrl`: conservative route template used for grouping similar identifier URLs
- `line`, `column`, `expression`: source location and expression evidence when AST analysis is available
- `firstSeen`, `lastSeen`: timestamps where available

## v1.1 AST and lazy-chunk implementation

### 1. AST-based static analysis
Acorn is bundled locally under `vendor/` and loaded before `engines/ast-analyzer.js`. The analyzer parses JavaScript and inspects:
- CallExpressions for fetch, axios, client methods and request wrappers
- TemplateLiteral expressions and static string fragments
- Object properties such as baseURL, url, endpoint, path
- Request configuration objects and Axios `baseURL` instances

Do not execute extracted application code.

### 2. Endpoint normalization
The service worker preserves the original URL and adds `normalizedUrl`, replacing UUIDs, long numeric path segments, and query values with placeholders. This is intentionally conservative.
The raw URL is retained separately. Normalization currently targets UUIDs, long numeric path segments, named template placeholders, and query values. This is heuristic grouping, not proof that two routes are semantically identical.

### 3. Resource timing discovery
The content script uses `performance.getEntriesByType("resource")` plus a `PerformanceObserver` to find script chunks added by bundlers, including dynamically imported chunks. Only same-origin HTTP(S) script-like resources are fetched, with asset-count and source-size limits.

### 4. Crawl controls
Add a user-configured same-origin route queue with maximum depth, maximum pages, and explicit per-route consent. Do not submit forms or mutate state. Respect application scope and user authorization.

### 5. Evidence and confidence
Keep observed evidence distinct from static candidates. Avoid representing a heuristic score as proof of endpoint existence.

### 6. Test plan
- Static HTML page with fetch and XHR calls.
- SPA using history.pushState.
- App with lazy-loaded JS chunks.
- Bundle with accessible source map and sourcesContent.
- Cross-origin API call with third-party capture disabled/enabled.
- Duplicate URL discovered through multiple engines.
- Large or malformed JS and source map files.
- Tab close during scan and service-worker restart.
