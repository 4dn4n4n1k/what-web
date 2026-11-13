const PREFIX = "whatApi:";
const tabScans = new Map();

function domainKey(url) {
  try { return PREFIX + new URL(url).origin; } catch { return null; }
}

async function getState(key) {
  const data = await chrome.storage.local.get(key);
  return data[key] || { target: "", endpoints: [], assets: [], routes: [], updatedAt: null };
}

async function saveState(key, state) {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [key]: state });
}

function classify(url) {
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  if (/graphql/.test(path)) return "GraphQL";
  if (/\/(api|apis|rest|v[0-9]+)\b/.test(path)) return "REST";
  if (/^wss?:/i.test(url)) return "WebSocket";
  return "Other";
}

function normalizeEndpointUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = parsed.pathname.replace(/%7B/gi, "{").replace(/%7D/gi, "}")
      .replace(/\{[^/]+\}/g, "{id}")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "{uuid}")
      .replace(/\b\d{5,}\b/g, "{id}");
    const queryKeys = [...new Set([...parsed.searchParams.keys()])].sort();
    const query = queryKeys.length ? "?" + queryKeys.map(key => `${encodeURIComponent(key)}={value}`).join("&") : "";
    return `${parsed.origin}${normalizedPath}${query}`;
  } catch {
    return rawUrl;
  }
}

function endpointId(method, url) {
  return `${method.toUpperCase()} ${normalizeEndpointUrl(url)}`;
}

async function upsertEndpoint(targetUrl, item) {
  const key = domainKey(targetUrl);
  if (!key) return;
  const state = await getState(key);
  const method = (item.method || "UNKNOWN").toUpperCase();
  const normalizedUrl = item.normalizedUrl || normalizeEndpointUrl(item.url);
  const id = endpointId(method, item.url);
  const existing = state.endpoints.find(e => e.id === id || (
    (e.method || "UNKNOWN").toUpperCase() === method &&
    (e.normalizedUrl || normalizeEndpointUrl(e.url)) === normalizedUrl
  ));
  if (existing) {
    existing.sources = [...new Set([...(existing.sources || []), item.source])];
    existing.observed = existing.observed || Boolean(item.observed);
    existing.lastSeen = item.lastSeen || existing.lastSeen;
    existing.confidence = existing.observed ? "high" : (existing.confidence === "high" ? "high" : (item.confidence || existing.confidence));
    existing.resolution = existing.observed ? "observed" : (item.resolution || existing.resolution);
    existing.evidence = [...(existing.evidence || []), {
      source: item.source,
      file: item.file || null,
      line: item.line ?? null,
      column: item.column ?? null,
      expression: item.expression || null,
      resolution: item.resolution || null,
      evidenceKind: item.evidenceKind || null
    }].filter((entry, index, all) => all.findIndex(candidate =>
      candidate.source === entry.source && candidate.file === entry.file &&
      candidate.line === entry.line && candidate.expression === entry.expression
    ) === index).slice(-30);
    if (item.file) existing.files = [...new Set([...(existing.files || []), item.file])];
    if (item.observed) {
      existing.method = method;
      existing.url = item.url;
    }
  } else {
    state.endpoints.push({
      id,
      url: item.url,
      normalizedUrl,
      method,
      type: item.type || classify(item.url),
      source: item.source,
      sources: [item.source],
      observed: Boolean(item.observed),
      confidence: item.confidence || (item.observed ? "high" : "medium"),
      resolution: item.resolution || (item.observed ? "observed" : "unknown"),
      expression: item.expression || null,
      line: item.line ?? null,
      column: item.column ?? null,
      evidence: [{
        source: item.source,
        file: item.file || null,
        line: item.line ?? null,
        column: item.column ?? null,
        expression: item.expression || null,
        resolution: item.resolution || null,
        evidenceKind: item.evidenceKind || null
      }],
      file: item.file || null,
      files: item.file ? [item.file] : [],
      firstSeen: new Date().toISOString(),
      lastSeen: item.lastSeen || null
    });
  }
  await saveState(key, state);
}

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId < 0 || !/^https?:/i.test(details.url)) return;
    const scan = tabScans.get(details.tabId);
    if (!scan) return;
    if (new URL(details.url).origin === scan.origin || scan.includeThirdParty) {
      upsertEndpoint(scan.target, {
        url: details.url,
        method: details.method || "GET",
        source: "browser_network",
        observed: true,
        confidence: "high",
        lastSeen: new Date().toISOString()
      });
    }
  },
  { urls: ["http://*/*", "https://*/*"] }
);

chrome.tabs.onRemoved.addListener(tabId => tabScans.delete(tabId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id ?? message.tabId;
    if (message.type === "START_SCAN") {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      const parsed = new URL(url);
      const key = domainKey(url);
      const state = { target: parsed.origin, endpoints: [], assets: [], routes: [], updatedAt: null };
      await saveState(key, state);
      await chrome.storage.local.set({ apiHunterLastTarget: parsed.origin });
      tabScans.set(tabId, { target: url, origin: parsed.origin, includeThirdParty: Boolean(message.includeThirdParty) });
      sendResponse({ ok: true, target: parsed.origin });
      return;
    }
    if (message.type === "STOP_SCAN") {
      tabScans.delete(tabId);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "GET_SCAN_STATUS") {
      const tab = await chrome.tabs.get(tabId);
      const key = domainKey(tab.url);
      const state = key ? await getState(key) : null;
      sendResponse({ ok: true, active: tabScans.has(tabId), state });
      return;
    }
    if (message.type === "ADD_ENDPOINT") {
      await upsertEndpoint(message.target, message.endpoint);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ADD_ASSET") {
      const key = domainKey(message.target);
      const state = await getState(key);
      if (!state.assets.includes(message.asset)) state.assets.push(message.asset);
      await saveState(key, state);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "ADD_ROUTE") {
      const key = domainKey(message.target);
      const state = await getState(key);
      if (!state.routes.includes(message.route)) state.routes.push(message.route);
      await saveState(key, state);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "FETCH_ASSET") {
      try {
        const response = await fetch(message.url, { credentials: "omit", redirect: "follow", cache: "force-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        sendResponse({ ok: true, text: text.slice(0, 5_000_000), finalUrl: response.url });
      } catch (error) {
        sendResponse({ ok: false, error: String(error.message || error) });
      }
      return;
    }
  })().catch(error => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});