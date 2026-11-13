# WHAT API tests

Run the AST analyzer unit tests from the project root:

```bash
node tests/ast-analyzer.test.js
```

The test suite covers:
- Template literal and identifier resolution
- String concatenation
- Fetch method options
- Axios request configuration and `axios.create({ baseURL })`
- XMLHttpRequest method and URL extraction
- WebSocket and EventSource endpoint discovery
- Source file and line/column attribution
- Unsupported syntax reporting for the regex fallback path
