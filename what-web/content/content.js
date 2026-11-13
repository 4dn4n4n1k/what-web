(() => {
  const MAX_ASSETS = 180;
  const MAX_CRAWL_LINKS = 300;
  const MAX_SOURCE_LENGTH = 5_000_000;
  const seenAssets = new Set();
  const seenLinks = new Set();
  let scanning = false;
  let targetOrigin = location.origin;
  let resourceObserver = null;

  const send = message => chrome.runtime.sendMessage(message).catch(() => {});
  const sendAsync = message => new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
  const toAbsolute = value => { try { return new URL(value, location.href).href; } catch { return null; } };

  function looksLikeEndpoint(value) {
    if (typeof value !== "string" || value.length < 2 || value.length > 2048) return false;
    const s = value.trim();
    if (/^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(s)) return false;
    if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|css)(\?|$)/i.test(s)) return false;
    return /(^https?:\/\/|^wss?:\/\/|^\/|api|graphql|\/v[0-9]+\/)/i.test(s);
  }

  function normalizeCandidate(raw) {
    const cleaned = String(raw).replace(/^[\s"'`]+|[\s"'`,;)}\]]+$/g, "");
    if (!looksLikeEndpoint(cleaned)) return null;
    try {
      const absolute = new URL(cleaned, location.origin);
      if (!["http:", "https:", "ws:", "wss:"].includes(absolute.protocol)) return null;
      if (/\.(js|mjs|css|map|png|jpe?g|svg|woff2?)(\?|$)/i.test(absolute.pathname)) return null;
      return absolute.href;
    } catch { return null; }
  }

  // Conservative fallback for bundles Acorn cannot parse (e.g. unsupported syntax).
  function extractStrings(source) {
    const patterns = [
      /(?:https?:\/\/|wss?:\/\/)[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi,
      /(?:["'`])((?:\/|\.\.\/)(?:api|apis|rest|graphql|v\d+|internal|auth|admin)[^"'`\s]*)["'`]/gi,
      /(?:baseURL|baseUrl|apiUrl|API_URL|API_BASE_URL)\s*[:=]\s*["'`]([^"'`]+)["'`]/g
    ];
    const found = new Set();
    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(source)) !== null) {
        const candidate = normalizeCandidate(match[1] || match[0]);
        if (candidate) found.add(candidate);
        if (found.size >= 1500) break;
      }
    }
    return [...found];
  }

  async function inspectSource(assetUrl, source) {
    if (typeof source !== "string" || !source.length) return;
    const boundedSource = source.slice(0, MAX_SOURCE_LENGTH);
    let astResult = null;

    if (globalThis.WHATAPI_AST?.analyze) {
      try {
        astResult = globalThis.WHATAPI_AST.analyze(boundedSource, assetUrl, targetOrigin);
      } catch (error) {
        console.debug("[WHAT API] AST analysis failed:", error);
      }
    }

    if (astResult && !astResult.parseError) {
      for (const finding of astResult.findings) {
        send({
          type: "ADD_ENDPOINT",
          target: location.href,
          endpoint: finding
        });
      }
    } else {
      for (const url of extractStrings(boundedSource)) {
        send({
          type: "ADD_ENDPOINT",
          target: location.href,
          endpoint: {
            url,
            method: "UNKNOWN",
            source: "static_javascript",
            observed: false,
            confidence: "low",
            resolution: "regex_fallback",
            file: assetUrl
          }
        });
      }
    }

    const mapMatch = boundedSource.match(/\/\/[#@]\s*sourceMappingURL\s*=\s*([^\s]+)/);
    if (mapMatch) {
      try {
        const mapUrl = new URL(mapMatch[1], assetUrl).href;
        if (mapUrl.startsWith("http")) await inspectSourceMap(mapUrl, assetUrl);
      } catch {}
    }
  }

  async function inspectSourceMap(mapUrl, parentAsset) {
    const result = await sendAsync({ type: "FETCH_ASSET", url: mapUrl });
    if (!result?.ok) return;
    try {
      const map = JSON.parse(result.text);
      if (Array.isArray(map.sourcesContent)) {
        for (let i = 0; i < map.sourcesContent.length; i++) {
          const content = map.sourcesContent[i];
          if (typeof content === "string" && content.length) {
            const sourceName = map.sources?.[i] || "source";
            await inspectSource(`${parentAsset} :: ${sourceName}`, content.slice(0, 2_000_000));
          }
        }
      }
    } catch (error) {
      console.debug("[WHAT API] Source map could not be parsed:", error);
    }
  }

  function isScriptResource(resource) {
    if (!resource?.name) return false;
    try {
      const url = new URL(resource.name);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      const scriptPath = /\.(?:m?js)(?:$|[?#])/i.test(url.href);
      return resource.initiatorType === "script" || scriptPath;
    } catch { return false; }
  }

  function discoverResourceTiming() {
    if (!scanning) return;
    for (const resource of performance.getEntriesByType("resource")) {
      if (!isScriptResource(resource)) continue;
      try {
        const url = new URL(resource.name);
        if (url.origin !== targetOrigin) continue;
        inspectAsset(url.href);
      } catch {}
    }
  }

  function startResourceObserver() {
    if (resourceObserver || !("PerformanceObserver" in window)) return;
    try {
      resourceObserver = new PerformanceObserver(list => {
        if (!scanning) return;
        for (const entry of list.getEntries()) {
          if (!isScriptResource(entry)) continue;
          try {
            const url = new URL(entry.name);
            if (url.origin === targetOrigin) inspectAsset(url.href);
          } catch {}
        }
      });
      resourceObserver.observe({ type: "resource", buffered: true });
    } catch {}
  }

  async function inspectAsset(assetUrl) {
    if (!assetUrl || seenAssets.has(assetUrl) || seenAssets.size >= MAX_ASSETS) return;
    let parsed;
    try { parsed = new URL(assetUrl); } catch { return; }
    if (parsed.origin !== targetOrigin || !/^https?:$/.test(parsed.protocol)) return;

    seenAssets.add(assetUrl);
    send({ type: "ADD_ASSET", target: location.href, asset: assetUrl });
    const result = await sendAsync({ type: "FETCH_ASSET", url: assetUrl });
    if (result?.ok && typeof result.text === "string") {
      await inspectSource(result.finalUrl || assetUrl, result.text);
    }
  }

  function discoverScripts() {
    document.querySelectorAll("script[src]").forEach(script => {
      const url = toAbsolute(script.src);
      if (!url) return;
      try { if (new URL(url).origin === targetOrigin) inspectAsset(url); } catch {}
    });
    discoverResourceTiming();
  }

  function discoverLinks() {
    document.querySelectorAll("a[href]").forEach(anchor => {
      const url = toAbsolute(anchor.getAttribute("href"));
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.origin !== targetOrigin || seenLinks.has(parsed.href)) return;
        if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3)$/i.test(parsed.pathname)) return;
        if (seenLinks.size < MAX_CRAWL_LINKS) {
          seenLinks.add(parsed.href);
          send({ type: "ADD_ROUTE", target: location.href, route: parsed.href });
        }
      } catch {}
    });
  }

  function onRuntimeEvent(event) {
    if (!scanning || !event.detail) return;
    const detail = event.detail;
    if (detail.kind === "request" && detail.url) {
      let parsed;
      try { parsed = new URL(detail.url); } catch { return; }
      if (parsed.origin !== targetOrigin) return;
      send({
        type: "ADD_ENDPOINT",
        target: location.href,
        endpoint: {
          url: parsed.href,
          method: detail.method || "GET",
          source: "page_runtime",
          observed: true,
          confidence: "high",
          resolution: "observed",
          lastSeen: new Date().toISOString()
        }
      });
    }
    if (detail.kind === "route") {
      try {
        const route = new URL(detail.url);
        if (route.origin === targetOrigin) send({ type: "ADD_ROUTE", target: location.href, route: route.href });
      } catch {}
    }
  }

  window.addEventListener("__WHAT_API_RUNTIME__", onRuntimeEvent);
  const mutationObserver = new MutationObserver(() => {
    if (!scanning) return;
    discoverScripts();
    discoverLinks();
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  startResourceObserver();

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "CONTENT_START_SCAN") {
      scanning = true;
      targetOrigin = location.origin;
      seenAssets.clear();
      seenLinks.clear();
      discoverScripts();
      discoverLinks();
      startResourceObserver();
      respond({ ok: true, scripts: document.querySelectorAll("script[src]").length, resources: performance.getEntriesByType("resource").length });
    } else if (message.type === "CONTENT_STOP_SCAN") {
      scanning = false;
      if (resourceObserver) {
        resourceObserver.disconnect();
        resourceObserver = null;
      }
      respond({ ok: true });
    } else if (message.type === "CONTENT_RESCAN") {
      discoverScripts();
      discoverLinks();
      respond({ ok: true });
    }
    return true;
  });
})();