(() => {
  "use strict";

  const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  const API_HINT = /(?:^|\/)(?:api|apis|rest|graphql|gql|rpc|internal|auth|oauth|admin|v\d+)(?:\/|$)|\/(?:graphql|graphiql)(?:$|\/)/i;
  const ABSOLUTE_API = /^https?:\/\/[^/]+\/(?:api|apis|rest|graphql|gql|rpc|v\d+|internal|auth|admin)(?:\/|$)/i;

  function memberName(node) {
    if (!node || node.type !== "MemberExpression") return "";
    if (!node.computed && node.property.type === "Identifier") return node.property.name;
    if (node.computed && node.property.type === "Literal") return String(node.property.value);
    return "";
  }

  function identifierPlaceholder(node) {
    if (!node) return "{dynamic}";
    if (node.type === "Identifier") return `{${node.name}}`;
    if (node.type === "MemberExpression") {
      const left = identifierPlaceholder(node.object).replace(/[{}]/g, "");
      const right = memberName(node) || "property";
      return `{${left}.${right}}`;
    }
    return "{dynamic}";
  }

  function staticValue(node, env, depth = 0) {
    if (!node || depth > 20) return { value: null, complete: false };
    switch (node.type) {
      case "Literal":
        return typeof node.value === "string" || typeof node.value === "number"
          ? { value: String(node.value), complete: true }
          : { value: null, complete: false };
      case "Identifier":
        if (env.has(node.name)) return { ...env.get(node.name) };
        if (node.name === "undefined") return { value: "", complete: true };
        return { value: identifierPlaceholder(node), complete: false };
      case "TemplateLiteral": {
        let value = "";
        let complete = true;
        for (let i = 0; i < node.quasis.length; i++) {
          value += node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
          if (i < node.expressions.length) {
            const part = staticValue(node.expressions[i], env, depth + 1);
            value += part.value ?? identifierPlaceholder(node.expressions[i]);
            complete = complete && part.complete;
          }
        }
        return { value, complete };
      }
      case "BinaryExpression":
        if (node.operator === "+") {
          const left = staticValue(node.left, env, depth + 1);
          const right = staticValue(node.right, env, depth + 1);
          if (left.value !== null && right.value !== null) {
            return { value: left.value + right.value, complete: left.complete && right.complete };
          }
        }
        return { value: null, complete: false };
      case "ParenthesizedExpression":
        return staticValue(node.expression, env, depth + 1);
      case "ChainExpression":
        return staticValue(node.expression, env, depth + 1);
      case "ConditionalExpression": {
        const a = staticValue(node.consequent, env, depth + 1);
        const b = staticValue(node.alternate, env, depth + 1);
        if (a.value === b.value && a.value !== null) return { value: a.value, complete: a.complete && b.complete };
        return { value: null, complete: false };
      }
      case "CallExpression":
      case "NewExpression":
        if (node.callee.type === "Identifier" && node.callee.name === "String" && node.arguments.length === 1) {
          return staticValue(node.arguments[0], env, depth + 1);
        }
        if (node.callee.type === "Identifier" && node.callee.name === "URL" && node.arguments.length) {
          const input = staticValue(node.arguments[0], env, depth + 1);
          if (input.value === null) return { value: null, complete: false };
          const base = node.arguments[1] ? staticValue(node.arguments[1], env, depth + 1) : null;
          if (base?.value && /^https?:\/\//i.test(base.value)) {
            try { return { value: new URL(input.value, base.value).href, complete: input.complete && base.complete }; } catch {}
          }
          return input;
        }
        return { value: null, complete: false };
      default:
        return { value: null, complete: false };
    }
  }

  function isCandidate(value) {
    if (typeof value !== "string" || value.length < 2 || value.length > 2048) return false;
    const clean = value.trim();
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(clean)) return false;
    if (/\.(?:png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|css|map)(?:\?|$)/i.test(clean)) return false;
    return clean.startsWith("/") || /^https?:\/\//i.test(clean) || /^wss?:\/\//i.test(clean) ||
      API_HINT.test(clean) || ABSOLUTE_API.test(clean);
  }

  function absoluteUrl(value, pageOrigin) {
    try {
      const parsed = new URL(value, pageOrigin);
      if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) return null;
      if (/\.(?:js|mjs|css|map|png|jpe?g|svg|woff2?)(?:\?|$)/i.test(parsed.pathname)) return null;
      return parsed.href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
    } catch { return null; }
  }

  function methodFromOptions(node, env) {
    if (!node || node.type !== "ObjectExpression") return "UNKNOWN";
    for (const property of node.properties) {
      if (property.type !== "Property") continue;
      const key = property.key.name ?? property.key.value;
      if (String(key).toLowerCase() === "method") {
        const result = staticValue(property.value, env);
        const method = String(result.value || "").toUpperCase();
        if (HTTP_METHODS.has(method)) return method;
      }
    }
    return "UNKNOWN";
  }

  function analyze(source, assetUrl, pageOrigin) {
    const findings = [];
    const env = new Map();
    const objectEnv = new Map();
    const instanceBaseUrls = new Map();
    const requestExpressionNodes = new WeakSet();
    let ast;
    let parseError = null;

    try {
      ast = globalThis.acorn.parse(source, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        allowHashBang: true,
        allowAwaitOutsideFunction: true
      });
    } catch (moduleError) {
      try {
        ast = globalThis.acorn.parse(source, {
          ecmaVersion: "latest",
          sourceType: "script",
          locations: true,
          allowHashBang: true,
          allowReturnOutsideFunction: true
        });
      } catch (scriptError) {
        parseError = scriptError.message || moduleError.message;
      }
    }
    if (!ast) return { findings, parseError };

    function add(valueResult, method, node, evidenceKind = "request_call") {
      if (!valueResult || !valueResult.value || !isCandidate(valueResult.value)) return;
      const url = absoluteUrl(valueResult.value, pageOrigin);
      if (!url) return;
      const loc = node?.loc?.start || { line: null, column: null };
      const expression = node ? source.slice(node.start, node.end).slice(0, 500) : valueResult.value;
      findings.push({
        url,
        method: method || "UNKNOWN",
        source: "static_ast",
        observed: false,
        confidence: valueResult.complete ? "medium" : "low",
        resolution: valueResult.complete ? "static" : "partial",
        expression,
        file: assetUrl,
        line: loc.line,
        column: loc.column,
        evidenceKind
      });
    }

    function getRequestDetails(node) {
      const callee = node.callee;
      const name = memberName(callee);
      const objectName = callee?.object?.name || "";
      const args = node.arguments || [];

      // fetch(url, { method })
      if ((callee.type === "Identifier" && callee.name === "fetch") || name === "fetch") {
        if (args.length) {
          const configuredMethod = methodFromOptions(args[1], env);
          return { urlNode: args[0], method: configuredMethod === "UNKNOWN" ? "GET" : configuredMethod };
        }
      }

      // XMLHttpRequest.open(method, url)
      if (name === "open" && args.length >= 2) {
        const methodValue = staticValue(args[0], env);
        const method = String(methodValue.value || "").toUpperCase();
        return { urlNode: args[1], method: HTTP_METHODS.has(method) ? method : "UNKNOWN" };
      }

      // axios.get(url), client.post(url), instance.delete(url)
      if (HTTP_METHODS.has(name.toUpperCase()) && args.length && (objectName.toLowerCase().includes("axios") || name)) {
        return { urlNode: args[0], method: name.toUpperCase() };
      }

      // axios({ url, method }) and client.request({ url, method })
      const isRequestCall = name === "request" || (callee.type === "Identifier" && /^(axios|request)$/i.test(callee.name));
      if (isRequestCall && args[0]) {
        const configNode = args[0].type === "ObjectExpression"
          ? args[0]
          : args[0].type === "Identifier" ? objectEnv.get(args[0].name) : null;
        if (configNode) {
          let urlNode = null;
          for (const property of configNode.properties) {
            if (property.type !== "Property") continue;
            const key = property.key.name ?? property.key.value;
            if (["url", "uri"].includes(String(key).toLowerCase())) urlNode = property.value;
          }
          if (urlNode) return { urlNode, method: methodFromOptions(configNode, env) };
        }
      }

      return null;
    }

    function markExpression(node) {
      if (!node || typeof node !== "object" || requestExpressionNodes.has(node)) return;
      requestExpressionNodes.add(node);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(child => { if (child && typeof child.type === "string") markExpression(child); });
        else if (value && typeof value.type === "string") markExpression(value);
      }
    }

    function walk(node, parent = null) {
      if (!node || typeof node !== "object") return;

      if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
        const value = staticValue(node.init, env);
        if (value.value !== null) env.set(node.id.name, value);
        if (node.init.type === "ObjectExpression") objectEnv.set(node.id.name, node.init);
        if (node.init.type === "CallExpression" && memberName(node.init.callee) === "create") {
          const config = node.init.arguments?.[0];
          if (config?.type === "ObjectExpression") {
            for (const property of config.properties) {
              if (property.type !== "Property") continue;
              const key = property.key.name ?? property.key.value;
              if (String(key).toLowerCase() === "baseurl") {
                const base = staticValue(property.value, env);
                if (base.value !== null) instanceBaseUrls.set(node.id.name, base);
              }
            }
          }
        }
      }

      if (node.type === "AssignmentExpression" && node.operator === "=" && node.left.type === "Identifier") {
        const value = staticValue(node.right, env);
        if (value.value !== null) env.set(node.left.name, value);
      }

      if (node.type === "CallExpression" || node.type === "NewExpression") {
        let details = node.type === "CallExpression" ? getRequestDetails(node) : null;
        if (node.type === "NewExpression" && node.callee.type === "Identifier" && node.arguments?.length) {
          if (node.callee.name === "WebSocket") details = { urlNode: node.arguments[0], method: "WEBSOCKET" };
          if (node.callee.name === "EventSource") details = { urlNode: node.arguments[0], method: "SSE" };
        }
        if (details) {
          markExpression(details.urlNode);
          let result = staticValue(details.urlNode, env);
          const owner = node.callee?.object?.name;
          const base = owner ? instanceBaseUrls.get(owner) : null;
          if (base?.value && result.value && !/^https?:\/\//i.test(result.value)) {
            result = { value: `${base.value.replace(/\/$/, "")}/${result.value.replace(/^\//, "")}`, complete: base.complete && result.complete };
          }
          add(result, details.method, details.urlNode);
        }
      }

      // Keep standalone endpoint-like literals as leads, but avoid duplicating
      // literals already represented by variable/config declarations or request calls.
      if (node.type === "Literal" && typeof node.value === "string" &&
          !requestExpressionNodes.has(node) &&
          parent?.type !== "VariableDeclarator" &&
          parent?.type !== "Property" &&
          parent?.type !== "CallExpression" &&
          isCandidate(node.value)) {
        add({ value: node.value, complete: true }, "UNKNOWN", node, "endpoint_literal");
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === "loc" || key === "start" || key === "end") continue;
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child.type === "string") walk(child, node);
        } else if (value && typeof value.type === "string") {
          walk(value, node);
        }
      }
    }

    walk(ast);

    // Collapse identical method+URL findings from multiple AST paths in this file.
    const deduped = new Map();
    for (const finding of findings) {
      const key = `${finding.method} ${finding.url}`;
      if (!deduped.has(key)) deduped.set(key, finding);
      else {
        const existing = deduped.get(key);
        if (existing.evidenceKind === "endpoint_literal" && finding.evidenceKind === "request_call") {
          deduped.set(key, finding);
        }
      }
    }
    return { findings: [...deduped.values()], parseError: null };
  }

  globalThis.WHATAPI_AST = { analyze };
})();
