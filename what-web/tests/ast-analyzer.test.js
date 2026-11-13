const assert = require("node:assert/strict");
const acorn = require("../vendor/acorn.js");

globalThis.acorn = acorn;
require("../engines/ast-analyzer.js");

const source = [
  'const API_BASE = "/api/v2";',
  'const userPath = `${API_BASE}/users/${userId}`;',
  'fetch(userPath);',
  'fetch(new URL("/api/v2/metrics", location.origin));',
  'fetch("/api/v2/search", { method: "POST" });',
  'axios.post(API_BASE + "/auth/login", { username });',
  'const requestConfig = { url: "/api/v1/orders", method: "GET" };',
  'axios(requestConfig);',
  'const xhr = new XMLHttpRequest();',
  'xhr.open("DELETE", "/api/v2/users/123456");',
  'const api = axios.create({ baseURL: "/api/v3" });',
  'api.get("/reports");',
  'new WebSocket("wss://stream.example.test/api/events");',
  'new EventSource("/api/updates");'
].join("\n");

const result = globalThis.WHATAPI_AST.analyze(
  source,
  "https://example.test/assets/app.js",
  "https://example.test"
);

assert.equal(result.parseError, null);
const byUrl = (fragment, method) => result.findings.find(item =>
  item.url.includes(fragment) && (!method || item.method === method)
);

assert.ok(byUrl("/api/v2/users/{userId}", "GET"), "resolves template literal and variable");
assert.ok(byUrl("/api/v2/metrics", "GET"), "resolves URL constructor path");
assert.ok(byUrl("/api/v2/search", "POST"), "reads fetch method option");
assert.ok(byUrl("/api/v2/auth/login", "POST"), "resolves concatenated base URL");
assert.ok(byUrl("/api/v1/orders", "GET"), "resolves Axios config variable");
assert.ok(byUrl("/api/v2/users/123456", "DELETE"), "detects XMLHttpRequest.open");
assert.ok(byUrl("/api/v3/reports", "GET"), "applies axios.create baseURL");
assert.ok(byUrl("wss://stream.example.test/api/events", "WEBSOCKET"), "detects WebSocket constructor");
assert.ok(byUrl("/api/updates", "SSE"), "detects EventSource constructor");
assert.ok(result.findings.every(item => item.file && Number.isInteger(item.line) && Number.isInteger(item.column)),
  "attaches source file and location");
assert.ok(result.findings.every(item => !item.url.includes("%7B")), "keeps route placeholders readable");

const unsupported = globalThis.WHATAPI_AST.analyze(
  "const view = <Widget />;",
  "https://example.test/assets/view.js",
  "https://example.test"
);
assert.ok(unsupported.parseError, "reports syntax that Acorn cannot parse for regex fallback");

console.log(`WHAT API AST tests passed (${result.findings.length} findings).`);
