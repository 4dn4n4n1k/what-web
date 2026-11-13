const $ = id => document.getElementById(id);
let tabId, target, state = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  target = tab?.url || "";
  $("target").textContent = target ? new URL(target).origin : "Unsupported page";
  if (!/^https?:/.test(target)) {
    $("start").disabled = true;
    $("message").textContent = "Open a regular website to scan.";
    return;
  }
  await refresh();
}
async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: "GET_SCAN_STATUS", tabId });
  state = result?.state;
  const endpoints = state?.endpoints || [];
  $("total").textContent = endpoints.length;
  $("observed").textContent = endpoints.filter(e => e.observed).length;
  $("static").textContent = endpoints.filter(e => (e.sources || []).some(source => ["static_ast", "static_javascript"].includes(source))).length;
  $("status").textContent = result?.active ? "Scanning" : "Ready";
  $("start").disabled = Boolean(result?.active);
  $("stop").disabled = !result?.active;
}
$("start").addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "START_SCAN", tabId, includeThirdParty: $("thirdParty").checked });
  if (!result?.ok) { $("message").textContent = result?.error || "Could not start scan."; return; }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "CONTENT_START_SCAN" });
    $("message").textContent = "Scan started. Browse the application to discover more routes.";
  } catch {
    $("message").textContent = "Reload the page, then start the scan again.";
  }
  await refresh();
});
$("stop").addEventListener("click", async () => {
  await chrome.tabs.sendMessage(tabId, { type: "CONTENT_STOP_SCAN" }).catch(() => {});
  await chrome.runtime.sendMessage({ type: "STOP_SCAN", tabId });
  await refresh();
});
$("copy").addEventListener("click", async () => {
  await refresh();
  const lines = (state?.endpoints || []).map(e => `${e.method}\t${e.normalizedUrl || e.url}`);
  await navigator.clipboard.writeText(lines.join("\n"));
  $("message").textContent = `${lines.length} endpoint records copied.`;
});
$("export").addEventListener("click", async () => {
  await refresh();
  const blob = new Blob([JSON.stringify(state || {}, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "what-api-results.json"; a.click();
  URL.revokeObjectURL(url);
});
$("dashboard").addEventListener("click", () => chrome.runtime.openOptionsPage());
init();