# WHAT API v1.1.1

**Browser-based API discovery and endpoint intelligence for Chrome.**

WHAT API is a Chrome Manifest V3 extension that passively discovers API endpoint references exposed by a web application. It combines browser-observed requests with static JavaScript analysis and accessible OpenAPI/Swagger specifications, then consolidates the evidence into a searchable endpoint inventory.

> **Use only on websites and applications you own or are explicitly authorized to assess.** WHAT API is a discovery tool, not an exploitation or vulnerability-testing tool.

---

## Contents

- [Highlights](#highlights)
- [How discovery works](#how-discovery-works)
- [Evidence and confidence](#evidence-and-confidence)
- [Dashboard metrics](#dashboard-metrics)
- [Installation](#installation)
- [Using WHAT API](#using-what-api)
- [Permissions and privacy](#permissions-and-privacy)
- [Project structure](#project-structure)
- [Development and tests](#development-and-tests)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Version history](#version-history)

## Highlights

### Runtime discovery
- Observes browser network request URLs and HTTP methods while a scan is active.
- Instruments page `fetch()` and `XMLHttpRequest` calls to capture request metadata.
- Supports optional third-party request capture.

### Static JavaScript analysis
- Runs AST analysis and regex candidate extraction together. Regex is a complementary pass, not only a fallback for parser errors.
- Uses the bundled Acorn parser to inspect JavaScript syntax without executing application code.
- Detects recognized `fetch`, Axios, XHR, WebSocket, and EventSource patterns.
- Extracts endpoint-like strings from configuration objects and constants, including references not connected to a request call.
- Reconstructs statically resolvable template literals and string concatenations.
- Records source file, line, column, expression, and evidence type when available.

### Asset and source-map discovery
- Inspects same-origin script elements.
- Uses Performance Resource Timing to discover same-origin JavaScript resources, including many lazy-loaded chunks.
- Watches DOM changes for newly inserted scripts.
- Analyzes accessible Source Map v3 `sourcesContent` entries.
- Records asset fetch and analysis diagnostics.

### OpenAPI and Swagger discovery
- Identifies likely OpenAPI/Swagger specification URLs referenced by the page or discovered resources.
- Parses accessible JSON OpenAPI/Swagger documents.
- Extracts supported HTTP operations from the specification's `paths` object.
- Retains operation IDs, summaries, tags, methods, and resolved server/path URLs when available.

### Endpoint inventory and export
- Consolidates findings from multiple discovery engines.
- Keeps known HTTP methods distinct.
- Merges `UNKNOWN`-method candidate evidence into a matching known-method endpoint where appropriate.
- Preserves raw URL examples alongside normalized endpoint templates.
- Provides a popup, full dashboard, search/filter controls, clipboard copy, and JSON export.

---

## How discovery works

A scan uses several complementary sources:

1. **Browser network events** record requests Chrome observes for the active tab while scanning is enabled.
2. **Page runtime instrumentation** observes URL and method metadata passed to `fetch()` and `XMLHttpRequest`.
3. **Static AST analysis** parses accessible JavaScript and examines recognized request patterns and endpoint-related expressions.
4. **Regex extraction** independently collects additional endpoint-like string candidates that AST heuristics may not recognize.
5. **OpenAPI parsing** extracts operations from accessible JSON specifications.
6. **Resource discovery** finds script assets and selected resources referenced or loaded by the page.
7. **Reconciliation** merges evidence while retaining source attribution and raw URL examples.

The extension does not execute downloaded JavaScript to discover endpoints. Static results are inferred from source text and must be treated as leads until corroborated.

## Evidence and confidence

Evidence labels identify how a finding was obtained:

| Evidence source | Meaning |
|---|---|
| `browser_network` | Request observed through Chrome's network event API |
| `page_runtime` | URL/method observed through page `fetch()` or XHR instrumentation |
| `static_ast` | Candidate extracted by AST analysis |
| `static_regex` | Candidate extracted by the complementary regex pass |
| `openapi_spec` | Operation extracted from an accessible OpenAPI/Swagger document |

A finding may contain multiple evidence sources. An observed request is stronger evidence that the browser made that request, but it does **not** establish that the endpoint is vulnerable or that another user can access it.

Static and OpenAPI findings do not prove that an endpoint is currently reachable, enabled, or authorized for use.

### Raw and normalized endpoints

WHAT API stores a normalized endpoint template to group likely instances, while retaining raw URL examples where available.

For example:

```text
Raw examples:
GET https://example.test/api/users/10001
GET https://example.test/api/users/10002

Normalized template:
GET https://example.test/api/users/{id}
```

Different known HTTP methods remain separate operations. Normalization is heuristic; inspect raw examples and evidence before drawing conclusions.

---

## Dashboard metrics

The Discovery Coverage panel helps explain which engines contributed findings.

| Metric | Meaning |
|---|---|
| Assets analyzed | JavaScript sources successfully submitted to the analysis pipeline |
| AST findings | Findings emitted by the AST analyzer |
| Regex candidates | Candidate URLs extracted by the regex pass |
| OpenAPI operations | Operations extracted from parsed OpenAPI/Swagger documents |
| Analysis failures | Failures recorded by the analysis pipeline |

These are engine-level counters, not necessarily counts of unique final endpoints. One endpoint can be found by multiple engines, and multiple candidates can be deduplicated into one inventory entry.

A zero counter should not automatically be interpreted as proof that a website has no endpoints. It can also mean the relevant resource was not discovered, fetched, parsed, or instrumented. Compare the asset count, engine counters, and evidence labels when diagnosing a scan.

---

## Installation

1. Download and extract `what-api-v1.1.1.zip`.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the extracted **`what-api`** directory (the directory containing `manifest.json`).
6. Open a website you own or are authorized to assess.
7. Reload the website so the extension's content scripts are injected.
8. Click the WHAT API toolbar icon and select **Start deep scan**.
9. Browse the application normally to trigger lazy-loaded routes and requests.
10. Open the dashboard to review findings and export results.

If updating from an earlier build, export any scan results you want to keep before removing the old extension. Loading the unpacked extension from a different directory can change its extension ID. Scan data is stored locally by origin.

## Using WHAT API

### Start a scan
- Open the target site in a normal HTTP or HTTPS tab.
- Click the WHAT API extension icon.
- Optionally enable **Include third-party requests**.
- Select **Start deep scan**.

### Improve coverage
- Start the scan after the page has loaded to inspect the current page state, then browse normally.
- Navigate through relevant application sections and use normal UI controls.
- Open routes that load additional JavaScript chunks.
- Do not submit forms or perform state-changing actions unless they are explicitly within the authorized test scope.

### Review and export
- Use the dashboard's Endpoints, JavaScript Sources, and Routes views.
- Filter by evidence source and search for endpoint paths or methods.
- Use **Copy visible** for the filtered endpoint list.
- Use **Export JSON** to preserve the full scan state and evidence.

---

## Permissions and privacy

The extension requests these Chrome permissions:

| Permission | Purpose |
|---|---|
| `activeTab` | Work with the active tab after user interaction |
| `tabs` | Identify the active tab and its URL |
| `scripting` | Extension scripting capability |
| `storage` | Store scan results locally |
| `webRequest` | Observe request metadata for an active scan |
| HTTP/HTTPS host access | Run content scripts, observe eligible traffic, and retrieve accessible assets |

### Data handling
- Scan results are stored in `chrome.storage.local`.
- Asset retrieval uses `credentials: "omit"`.
- The extension is designed not to collect cookies, authorization headers, request bodies, response bodies, or form values.
- Runtime instrumentation records request URL and method metadata only.
- Third-party request capture is opt-in.
- The extension does not send scan results to a remote backend.

The bundled Acorn parser is included under `vendor/` with its license in `vendor/ACORN-LICENSE`.

---

## Project structure

```text
what-api/
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── content.js
│   └── page-bridge-main.js
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js
├── engines/
│   ├── ast-analyzer.js
│   └── openapi-parser.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── vendor/
│   ├── acorn.js
│   └── ACORN-LICENSE
├── tests/
│   ├── ast-analyzer.test.js
│   ├── openapi-parser.test.js
│   └── README.md
├── docs/
│   └── IMPLEMENTATION.md
└── README.md
```

### Main modules

- `background/service-worker.js` — scan state, network event handling, endpoint reconciliation, local storage, and asset fetching.
- `content/page-bridge-main.js` — page-context observation of `fetch()`, XHR, and SPA history changes.
- `content/content.js` — script/resource discovery, source-map processing, AST/regex orchestration, and OpenAPI discovery.
- `engines/ast-analyzer.js` — AST-based JavaScript endpoint analysis.
- `engines/openapi-parser.js` — OpenAPI/Swagger `paths` parser.
- `dashboard/` — endpoint inventory and discovery diagnostics.
- `popup/` — scan controls and quick export.

---

## Development and tests

WHAT API v1.1.1 is a dependency-light Chrome extension. The Acorn parser is bundled locally, so the extension does not need to download a parser at runtime.

### Run unit tests

Requires Node.js.

From the extracted `what-api` directory:

```bash
node tests/ast-analyzer.test.js
node tests/openapi-parser.test.js
```

The AST tests cover representative cases including:
- Template literals and variable resolution
- URL construction and string concatenation
- Fetch method options
- Axios methods and configuration
- XHR method detection
- WebSocket and EventSource construction
- Endpoint-like strings in object properties and constants
- Source location attribution
- Unsupported syntax reporting for fallback behavior

The OpenAPI parser tests cover:
- OpenAPI `paths` extraction
- Multiple HTTP methods
- Server URL resolution
- Operation IDs and metadata
- Missing `paths` handling

These unit tests validate the parser modules. They are not a substitute for end-to-end testing in Chrome against real applications.

### Suggested manual test matrix

| Test | Expected observation |
|---|---|
| Static page with inline endpoint strings | Static AST and/or regex candidates |
| Page using `fetch()` | Runtime request evidence |
| Page using XHR | Runtime request evidence |
| SPA navigation | Route records and subsequent requests |
| Lazy-loaded JavaScript chunk | Newly discovered asset and static analysis |
| Accessible source map | Findings from embedded source content |
| Accessible OpenAPI JSON | Operations extracted from `paths` |
| Third-party API call | Captured only when third-party capture is enabled |
| Duplicate URL from multiple engines | One consolidated entry with multiple evidence sources |

---

## Known limitations

- WHAT API can inspect only material exposed to the browser. It cannot inspect server-side source code or guarantee discovery of every API endpoint.
- It does not automatically navigate through every discovered link. Browse the application normally to trigger route-specific requests and lazy-loaded assets.
- It does not submit forms, replay requests, fuzz endpoints, guess parameters, bypass authentication, or validate vulnerabilities.
- JavaScript parsing and expression resolution are static and conservative. Arbitrary runtime values, heavily obfuscated bundles, computed imports, and custom request abstractions may not be resolved.
- Source maps must be referenced and accessible. The extension does not bypass access controls to obtain private source maps.
- OpenAPI discovery depends on the specification being referenced or otherwise discovered and accessible to the extension. The parser currently extracts operations from JSON documents with a `paths` object; YAML specifications are not parsed by this version.
- Browser network observation is limited to requests Chrome exposes to the extension and the active scan lifecycle.
- Service-worker internal traffic, browser extensions' own requests, and some cross-origin or opaque resource behavior may not be visible.
- Endpoint normalization is heuristic. Review raw examples and source evidence before treating two routes as equivalent.

---

## Troubleshooting

### No endpoints appear
- Confirm the page uses HTTP or HTTPS.
- Reload the page after installing or reloading the extension.
- Start a new scan and browse the application normally.
- Check whether the site makes API calls in the current application state.

### Observed endpoints appear, but JavaScript assets are zero
- Check that the page contains same-origin JavaScript resources.
- Reload the page and start scanning again.
- Browse the application to trigger lazy-loaded chunks.
- Inspect the JavaScript Sources and Discovery Coverage panels.
- Remember that third-party script assets are not included in the same-origin static asset scan.

### AST findings are zero
- Check whether assets were successfully analyzed.
- The source may contain no recognized endpoint patterns, may be obfuscated, or may use a custom request abstraction.
- Compare AST findings with regex candidates and inspect the source file manually.

### Regex candidates are zero
- Confirm that JavaScript assets were analyzed.
- The source may not contain endpoint-like literal strings.
- Dynamically generated URLs may not appear as complete strings in the source.

### OpenAPI operations are zero
- Confirm that the application references or loads an OpenAPI/Swagger JSON document.
- Confirm that the document is accessible and contains a `paths` object.
- This version does not parse YAML OpenAPI specifications.

### Dashboard is empty or stale
- Confirm that the dashboard is showing the same origin that was scanned.
- Refresh the dashboard.
- Check that the scan was started in the active tab.
- Export results before removing or reinstalling the extension.

---

## Version history

### v1.1.1 — Discovery coverage restoration
- Runs AST and regex extraction together.
- Retains endpoint-like literals in configuration objects and constants.
- Adds JSON OpenAPI/Swagger operation extraction.
- Preserves raw URL examples alongside normalized endpoint templates.
- Adds discovery coverage diagnostics.
- Improves script/resource discovery and source attribution.

### v1.1.0 — AST analysis
- Introduced bundled Acorn-based JavaScript parsing.
- Added static endpoint expression analysis.
- Added template literal and concatenation reconstruction.
- Added request-method and source-location attribution.
- Added lazy-loaded resource and source-map analysis.

### v1.0.0 — Initial release
- Added Chrome Manifest V3 extension foundation.
- Added browser network observation and page runtime instrumentation.
- Added initial JavaScript string extraction.
- Added endpoint inventory, clipboard copy, and JSON export.

---

**WHAT API v1.1.1**  
Passive API discovery for authorized application security testing.
