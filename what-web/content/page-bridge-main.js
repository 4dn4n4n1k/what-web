(() => {
  const EVENT = "__WHAT_API_RUNTIME__";
  const emit = payload => window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));

  // Observe metadata only. Request bodies, headers, cookies and response bodies are not collected.
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    try {
      const input = args[0];
      const raw = typeof input === "string" ? input : input?.url;
      const method = args[1]?.method || input?.method || "GET";
      if (raw) emit({ kind: "request", url: new URL(raw, location.href).href, method });
    } catch {}
    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try { emit({ kind: "request", url: new URL(url, location.href).href, method: method || "GET" }); } catch {}
    return originalOpen.call(this, method, url, ...rest);
  };

  const reportRoute = () => emit({ kind: "route", url: location.href });
  for (const name of ["pushState", "replaceState"]) {
    const original = history[name];
    history[name] = function(...args) {
      const result = original.apply(this, args);
      queueMicrotask(reportRoute);
      return result;
    };
  }
  addEventListener("popstate", reportRoute);
})();