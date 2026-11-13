let currentState = null, activeTab = "endpoints";
const $ = id => document.getElementById(id);
async function load() {
  const meta = await chrome.storage.local.get("apiHunterLastTarget");
  const target = meta.apiHunterLastTarget;
  if (!target) return;
  const key = "whatApi:" + target;
  const data = await chrome.storage.local.get(key);
  currentState = data[key] || { target, endpoints: [], assets: [], routes: [] };
  render();
}
function render() {
  const s = currentState || {};
  $("target").textContent = s.target || "No scan data";
  $("updated").textContent = s.updatedAt ? `Last updated ${new Date(s.updatedAt).toLocaleString()}` : "No scan data yet.";
  $("count").textContent = (s.endpoints || []).length;
  $("observed").textContent = (s.endpoints || []).filter(e => e.observed).length;
  $("assets").textContent = (s.assets || []).length;
  renderEndpoints(); renderLists();
  const visibleCount = activeTab === "endpoints" ? (s.endpoints || []).length : activeTab === "assets" ? (s.assets || []).length : (s.routes || []).length;
  $("viewTitle").textContent = activeTab === "endpoints" ? "Discovered endpoints" : activeTab === "assets" ? "JavaScript sources" : "Application routes";
  $("viewCount").textContent = `${visibleCount} records`;
}
function renderEndpoints() {
  const q = $("search").value.toLowerCase(), source = $("source").value;
  const items = (currentState?.endpoints || []).filter(e => {
    const hay = [e.url,e.normalizedUrl,e.method,e.type,e.file,e.expression,...(e.sources||[])].join(" ").toLowerCase();
    return hay.includes(q) && (!source || (e.sources||[]).includes(source));
  });
  $("rows").innerHTML = items.length ? items.map(e => `<tr><td><span class="method">${esc(e.method)}</span></td><td title="${esc(e.url)}">${esc(e.normalizedUrl || e.url)}${e.normalizedUrl && e.normalizedUrl !== e.url ? `<br><small>Example: ${esc(e.url)}</small>` : ""}</td><td><span class="type-tag">${esc(e.type)}</span></td><td><span class="evidence">${esc((e.sources||[]).join(", "))}${e.observed ? " · observed" : ""}${e.line ? `<br><small>${esc((e.file || "").split(" :: ").pop())}:${e.line}:${(e.column ?? 0) + 1}</small>` : ""}</span></td><td><span class="confidence">${esc(e.confidence)}</span></td></tr>`).join("") : '<tr><td colspan="5" class="empty">No matching endpoints.</td></tr>';
  $("viewCount").textContent = `${items.length} records`;
}
function renderLists() {
  $("assetList").innerHTML = (currentState?.assets || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>No JavaScript assets recorded.</li>";
  $("routeList").innerHTML = (currentState?.routes || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>No routes recorded.</li>";
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => {
  activeTab = button.dataset.tab;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === button));
  $("endpointView").hidden = activeTab !== "endpoints";
  $("assetView").hidden = activeTab !== "assets";
  $("routeView").hidden = activeTab !== "routes";
  const count = activeTab === "endpoints" ? (currentState?.endpoints || []).length : activeTab === "assets" ? (currentState?.assets || []).length : (currentState?.routes || []).length;
  $("viewTitle").textContent = activeTab === "endpoints" ? "Discovered endpoints" : activeTab === "assets" ? "JavaScript sources" : "Application routes";
  $("viewCount").textContent = `${count} records`;
}));
$("search").addEventListener("input", renderEndpoints);
$("source").addEventListener("change", renderEndpoints);
$("refresh").addEventListener("click", load);
$("copyAll").addEventListener("click", async () => {
  const q = $("search").value.toLowerCase();
  const source = $("source").value;
  const lines = (currentState?.endpoints || []).filter(e => [e.url,e.normalizedUrl,e.method,e.type,e.file,e.expression,...(e.sources||[])].join(" ").toLowerCase().includes(q) && (!source || (e.sources||[]).includes(source))).map(e => `${e.method}\t${e.normalizedUrl || e.url}`);
  await navigator.clipboard.writeText(lines.join("\n"));
});
$("download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentState || {}, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download="what-api-results.json"; a.click(); URL.revokeObjectURL(url);
});
load();