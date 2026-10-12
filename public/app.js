import { createBrain } from "/brain.js";
import { AGENTS } from "/mascots.js";
import { ActivityStore, activityRecord, taskState } from "/activity.js";
import { safeHttpUrl, contactsForFirm, hasUsableEmail, hasEmailEvidence, summarizeFirms, matchesFirm, selectedEngine, estimateRange, phoneLabel, contactCoverage } from "/ui-utils.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const params = new URLSearchParams(location.search);
if (params.has("noboot")) $("#boot").classList.add("gone");
let NOWRITER = true;
function setWriter(on) { NOWRITER = !on; document.body.classList.toggle("nowriter", !on); }
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const STATIONS = [["brief", "Plan"], ["scout", "Discover"], ["analyst", "Investigate"], ["judge", "Score"], ["finder", "Contacts"], ["verify", "Verify"], ["writer", "Draft"], ["excel", "Export"]];
const TYPES = ["Asset managers", "Wealth managers", "Private banks", "Brokerages", "Digital investment platforms", "Insurers", "Family offices"];
const SEGMENTS = ["Retail", "Affluent", "HNW"];
const ROLES = ["CEO", "CIO", "Head of Partnerships", "Head of Distribution", "Head of Wealth", "Head of Investments", "Business Development"];
const CARD_AGENTS = ["scout", "analyst", "judge", "finder", "writer"];
const LANE_AGENTS = ["scout", "analyst", "judge", "finder", "writer"];
const AGENT_LABELS = { scout: ["Atlas", "Market discovery"], analyst: ["Sage", "Investment evidence"], judge: ["Jev", "Partnership fit"], finder: ["Hound", "People & contact evidence"], writer: ["Quill", "Personal outreach drafts"] };
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const DEFAULT_TEMPLATE = `Hi {{first_name}},

{{firm}} serves investors who want to diversify beyond {{country}}. We have a global equity solution and client education materials we can adapt for your clients, in {{language}}.

The idea is a partnership where both firms gain a new revenue stream. Do you have 20 minutes next week?

Best,
{{sender}}`;

const S = {
  status: null, mode: "demo", runId: null, es: null, t0: 0, running: false, firms: new Map(), rows: new Map(),
  stats: {}, orbit: [], judged: 0, judgeMs: 0, errors: 0, tasks: 0, gauge: { thr: 0, lat: 0 }, target: { thr: 0, lat: 0 },
  laneCounts: { running: 0, done: 0 }, metrics: {}, lastSeq: 0, starting: false, integrations: [], mcp: null,
  activeTasks: new Map(), sourceActions: 0,
};
const activity = new ActivityStore(180);

// ------------------------------------------------------------------ brain
let brain;
try { brain = createBrain($("#brain"), { onReady: () => { $("#cortexState").textContent = "Ready"; } }); }
catch { brain = { setEnergy() {}, pulse() {}, progress: () => 1 }; $("#cortexState").textContent = "Ready"; }
brain.setEnergy(0.15);

// ------------------------------------------------------------------ static UI
function buildStations() {
  const box = $("#stations");
  box.innerHTML = '<div class="flow"></div>';
  for (const [, label] of STATIONS) box.append(el("div", "st", `<i></i><span>${label}</span>`));
  [...box.querySelectorAll(".st")].forEach((n, i) => (n.dataset.st = STATIONS[i][0]));
}
function setStation(stage, state) {
  const n = document.querySelector(`.st[data-st="${stage}"]`);
  if (!n) return;
  n.classList.remove("active", "done");
  n.classList.add(state === "done" ? "done" : "active");
}

function buildAgents() {
  const box = $("#agents");
  box.innerHTML = "";
  for (const a of CARD_AGENTS) {
    const A = AGENTS[a];
    const card = el("div", `agent a-${a}`);
    card.style.setProperty("--c", A.color);
    card.dataset.agent = a;
    card.innerHTML = `<div class="ahead"><div class="avatar" aria-hidden="true">${A.svg}</div><div><div class="aname">${AGENT_LABELS[a][0]}</div><div class="arole">${AGENT_LABELS[a][1]}</div></div><span class="astat">Ready</span></div>
      <div class="abody"><div class="spark">${"<i></i>".repeat(14)}</div><div class="alines"><div class="mute">Waiting for your direction</div></div></div>
      <div class="afoot"><span>Completed <b class="fd">0</b></span><span>Active <b class="fi">0</b></span><span>Average <b class="fa">—</b></span><span>Utilization <b class="fu">0%</b></span></div>`;
    box.append(card);
    S.stats[a] = { done: 0, inflight: 0, ms: 0, bars: Array(14).fill(2), lines: [] };
  }
  S.stats.judge = { done: 0, inflight: 0, ms: 0, bars: [], lines: [] };
}
function buildLanes() {
  const box = $("#lanes");
  box.innerHTML = "";
  for (const a of LANE_AGENTS) {
    const lane = el("div", "lane", `<span class="ln">${AGENT_LABELS[a][0]}</span><div class="lc"></div><span class="ld">0</span>`);
    lane.style.setProperty("--c", AGENTS[a].color);
    lane.dataset.agent = a;
    box.append(lane);
  }
}

function chipGroup(id, options, selected, key) {
  const box = $(id);
  const saved = (store.get(key, "") || "").split("|").filter(Boolean);
  const on = new Set(saved.length ? saved : selected);
  for (const o of options) {
    const c = el("button", `chip${on.has(o) ? " on" : ""}`, esc(o));
    c.type = "button";
    c.setAttribute("aria-pressed", String(on.has(o)));
    c.onclick = () => { c.classList.toggle("on"); c.setAttribute("aria-pressed", String(c.classList.contains("on"))); store.set(key, values(id).join("|")); updateBriefFeedback(); scheduleEstimate(); };
    box.append(c);
  }
}
const values = (id) => [...document.querySelectorAll(`${id} .chip.on`)].map((c) => c.textContent);

async function loadStatus() {
  const refresh = $("#refreshStatus");
  refresh.disabled = true;
  try {
  const response = await fetch("/api/status?refresh=1");
  if (!response.ok) throw new Error("Cannot check providers. Confirm the local server is running.");
  S.status = await response.json();
  const st = S.status;
  const sel = $("#country");
  renderCountries(sel.value || params.get("country") || store.get("country", "BR"));
  const eng = $("#engine");
  const chosen = selectedEngine(eng.value || store.get("engine", ""), params.get("engine"), st.engines);
  eng.innerHTML = '<option value="">Select Codex or Claude…</option>';
  const preferred = ["codex-cli", "claude-cli", "openrouter", "anthropic"];
  for (const id of preferred) {
    const e = st.engines.find((x) => x.id === id);
    if (!e) continue;
    const label = id === "codex-cli" ? "Codex · ChatGPT subscription" : id === "claude-cli" ? "Claude · Claude subscription" : `${e.label} · API credits`;
    const o = new Option(`${e.ok ? "●" : "○"} ${label}`, e.id);
    eng.append(o);
  }
  eng.value = chosen;
  const rb = $("#replayBox");
  rb.innerHTML = "";
  if (st.replays?.length) {
    const r = st.replays[0];
    const btn = el("button", "", `Review last saved run · ${esc(r.country)}`);
    btn.type = "button";
    btn.onclick = () => startReplay(r.id);
    rb.append(btn);
  }
  updateTargetTag();
  updateLaunch();
  } catch (error) {
    $("#engineNote").textContent = error.message;
    $("#engineNote").classList.add("bad");
    $("#launch").disabled = $("#runMode").value !== "demo" || S.running;
  } finally { refresh.disabled = false; }
}

function renderCountries(selected) {
  const countries = S.status?.countries || [];
  const query = $("#countrySearch").value.trim().toLowerCase();
  const matches = countries.filter((country) => `${country.name} ${country.code}`.toLowerCase().includes(query));
  const sel = $("#country");
  sel.innerHTML = "";
  const groups = new Map();
  const current = countries.find((country) => country.code === selected);
  if (current && !matches.includes(current)) groups.set("Selected country", [current]);
  for (const country of matches) {
    if (!groups.has(country.region)) groups.set(country.region, []);
    groups.get(country.region).push(country);
  }
  for (const [region, list] of groups) {
    const og = document.createElement("optgroup"); og.label = region;
    for (const country of list) og.append(new Option(`${country.flag} ${country.name} (${country.code})`, country.code));
    sel.append(og);
  }
  sel.value = current?.code || matches[0]?.code || "";
  $("#countryCount").textContent = query ? `${matches.length} ${matches.length === 1 ? "match" : "matches"} · ${countries.length} countries & territories available` : `${countries.length} countries & territories · flags included`;
}

function updateTargetTag() {
  if (S.runId && S.runCountry) return;
  const c = S.status?.countries.find((x) => x.code === $("#country").value);
  if (c) $("#targetTag").innerHTML = `<b>${c.flag} ${esc(c.name)}</b><br>${esc(c.language)} sources`;
}
function updateLaunch() {
  const btn = $("#launch");
  const eng = S.status?.engines.find((e) => e.id === $("#engine").value);
  const cli = $("#engine").value === "claude-cli";
  const demo = $("#runMode").value === "demo";
  $("#modelRow").hidden = !cli;
  const note = $("#engineNote");
  note.classList.toggle("bad", !!eng && !eng.ok);
  note.textContent = !S.status ? "Checking providers…" : !eng ? "Choose the subscription you want to use. Your choice is saved on this browser." : eng.message || (eng.ok ? `${eng.label} ready` : "Install and sign in, then refresh connection status.");
  $("#launchSub").textContent = S.starting ? "starting…" : demo ? "fictional demo · no account needed" : eng?.ok ? (cli ? "uses your Claude subscription" : eng.id === "codex-cli" ? "uses your ChatGPT subscription" : eng.label) : "select and connect a provider";
  btn.disabled = S.running || S.starting || (!demo && !eng?.ok) || !$("#country").value;
  $("#providerInstructions").innerHTML = eng ? `${eng.setup?.install ? `<div class="field-help">Install</div>${commandLine(eng.setup.install)}` : ""}${eng.setup?.login ? `<div class="field-help">Sign in with your subscription</div>${commandLine(eng.setup.login)}` : ""}${eng.authStatus ? `<div class="field-help">Status: ${esc(eng.authStatus)}. Refresh after signing in.</div>` : ""}` : '<div class="field-help">Select a provider to see its installation and sign-in steps.</div>';
  wireCommandCopies($("#providerInstructions"));
  scheduleEstimate();
}

function commandLine(command) {
  const url = safeHttpUrl(command);
  return url ? link(url, "Open official setup instructions") : `<div class="command-line"><code>${esc(command)}</code><button type="button" class="command-copy" data-command="${esc(command)}" title="Copy command">Copy</button></div>`;
}
function wireCommandCopies(host) {
  host.querySelectorAll(".command-copy").forEach((button) => { button.onclick = async () => { try { await navigator.clipboard.writeText(button.dataset.command); button.textContent = "Copied"; } catch { button.textContent = "Select command to copy"; } }; });
}

function initForm() {
  $("#activityFilter").onchange = renderActivity;
  $("#activitySearch").oninput = renderActivity;
  $("#activityPause").onclick = () => { activity.follow = !activity.follow; updateActivityFollow(); renderActivity(); };
  $("#liveActivity").addEventListener("scroll", () => {
    const box = $("#liveActivity");
    if (activity.follow && box.scrollHeight - box.scrollTop - box.clientHeight > 50) { activity.follow = false; updateActivityFollow(); }
  }, { passive: true });
  chipGroup("#types", TYPES, ["Asset managers"], "types");
  chipGroup("#roles", ROLES, ["CEO", "CIO", "Head of Partnerships", "Head of Distribution"], "roles");
  $("#countrySearch").oninput = () => renderCountries($("#country").value || store.get("country", "BR"));
  $("#country").onchange = () => { store.set("country", $("#country").value); updateTargetTag(); updateLaunch(); };
  $("#engine").onchange = () => { store.set("engine", $("#engine").value); updateLaunch(); renderMcp(); };
  $("#refreshStatus").onclick = async () => { await loadStatus(); await loadConnections(); };
  $("#runMode").value = params.has("demo") || params.get("autorun") === "demo" ? "demo" : store.get("runMode", "live");
  $("#runMode").onchange = () => { store.set("runMode", $("#runMode").value); updateLaunch(); };
  for (const id of ["contactsPerFirm", "researchDepth", "exclude", "researchBrief"]) {
    const input = $(`#${id}`); input.value = store.get(id, input.value);
    input.oninput = () => { store.set(id, input.value); updateBriefFeedback(); scheduleEstimate(); };
  }
  $("#researchBrief").value = $("#researchBrief").value.slice(0, 2000);
  $("#researchBrief").maxLength = 2000;
  const briefPresets = {
    "Wealth partnerships": { types: ["Wealth managers"], roles: ["Head of Partnerships", "Head of Distribution", "Head of Wealth"] },
    "Digital platforms": { types: ["Digital investment platforms"], roles: ["Business Development", "Head of Partnerships", "CEO"] },
    "Institutional investors": { types: ["Asset managers", "Family offices"], roles: ["CIO", "Head of Investments"] },
  };
  document.querySelectorAll("[data-brief]").forEach((button) => { button.onclick = () => {
    const input = $("#researchBrief"); input.value = button.dataset.brief; store.set("researchBrief", input.value);
    const preset = briefPresets[button.textContent];
    if (preset) for (const key of ["types", "roles"]) {
      document.querySelectorAll(`#${key} .chip`).forEach((chip) => { const on = preset[key].includes(chip.textContent); chip.classList.toggle("on", on); chip.setAttribute("aria-pressed", String(on)); });
      store.set(key, values(`#${key}`).join("|"));
    }
    input.focus(); updateBriefFeedback(); scheduleEstimate();
  }; });
  updateBriefFeedback();
  for (const id of ["leadSearch", "emailFilter", "fitFilter"]) $(`#${id}`).oninput = filterBoard;
  $("#template").value = store.get("template", DEFAULT_TEMPLATE);
  $("#template").oninput = () => store.set("template", $("#template").value);
  $("#sender").value = store.get("sender", "");
  $("#sender").oninput = () => store.set("sender", $("#sender").value);
  const firms = $("#firms");
  firms.value = params.get("firms") || store.get("firms", "8");
  $("#firmsVal").textContent = firms.value;
  firms.oninput = () => { $("#firmsVal").textContent = firms.value; store.set("firms", firms.value); scheduleEstimate(); };
  const dr = $("#drafts");
  dr.checked = !params.has("nowriter") && store.get("drafts", "0") === "1";
  setWriter(dr.checked);
  dr.onchange = () => { store.set("drafts", dr.checked ? "1" : "0"); setWriter(dr.checked); scheduleEstimate(); };
  $("#claudeModel").value = store.get("claudeModel", "sonnet");
  $("#claudeModel").onchange = () => { store.set("claudeModel", $("#claudeModel").value); scheduleEstimate(); };
  $("#useIntegrations").checked = store.get("useIntegrations", "1") === "1";
  $("#useIntegrations").onchange = () => { store.set("useIntegrations", $("#useIntegrations").checked ? "1" : "0"); scheduleEstimate(); };
  $("#launch").onclick = launch;
  $("#stop").onclick = async () => {
    if (!S.runId) return;
    $("#stop").disabled = true;
    try { const response = await fetch(`/api/runs/${encodeURIComponent(S.runId)}/stop`, { method: "POST" }); if (!response.ok) throw new Error("Could not stop this run. Check the server connection."); }
    catch (error) { showFormMessage(error.message); $("#stop").disabled = !S.running; }
  };
  $("#lbMax").onclick = () => { const on = document.body.classList.toggle("board-max"); $("#lbMax").textContent = on ? "Back to research" : "Focus results"; $("#lbMax").setAttribute("aria-pressed", String(on)); if (!on) setTimeout(buildRing, 50); $("#resultsHeading").scrollIntoView({ block: "start" }); };
  $("#drawer").onclick = (e) => { if (e.target === $("#drawer")) closeDrawer(); };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
    if (e.key === "Tab" && !$("#drawer").hidden) {
      const items = [...$("#drawerCard").querySelectorAll('button, a[href], input, [tabindex="0"]')];
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#drawerCard"))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $("#dl").onclick = () => { if (S.runId && $("#dl").classList.contains("ready")) location.href = `/api/runs/${S.runId}/excel`; };
  $("#dlCsv").onclick = () => { if (S.runId && !$("#dlCsv").disabled) location.href = `/api/runs/${encodeURIComponent(S.runId)}/csv`; };
  scheduleEstimate();
}

function showFormMessage(message = "") { $("#formMessage").textContent = message; $("#formMessage").hidden = !message; }

function updateBriefFeedback() {
  const length = $("#researchBrief").value.trim().length;
  $("#briefFeedback").textContent = length ? `Your brief will guide every research stage. ${length.toLocaleString()} / 2,000 characters.` : "The team will research investment firms and partnership decision-makers.";
  $("#targetingSummary").textContent = `Searching: ${values("#types").join(", ") || "Choose at least one firm type"}. ${values("#roles").length} target roles selected.`;
}

function researchConfig() {
  return {
    mode: $("#runMode").value, engine: $("#engine").value, country: $("#country").value,
    types: values("#types"), segments: [], roles: values("#roles"),
    minAum: "auto", firms: Number($("#firms").value), minFit: Number($("#minFit").value),
    contactsPerFirm: Number($("#contactsPerFirm").value), researchDepth: $("#researchDepth").value,
    researchBrief: $("#researchBrief").value.trim(),
    exclude: $("#exclude").value, template: $("#template").value, sender: $("#sender").value,
    localLanguage: $("#localLanguage").checked, personalize: $("#personalize").checked,
    speed: Number(params.get("speed")) || 1,
    drafts: $("#drafts").checked, claudeModel: $("#claudeModel").value,
    useIntegrations: $("#useIntegrations").checked,
  };
}

let estimateTimer = null, estimateController = null;
function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(updateEstimate, 220);
}
async function updateEstimate() {
  estimateController?.abort();
  const controller = new AbortController(); estimateController = controller;
  try {
    const response = await fetch("/api/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(researchConfig()), signal: controller.signal });
    if (!response.ok) throw new Error("Estimate unavailable");
    const estimate = await response.json();
    if (controller.signal.aborted) return;
    $("#estimateValue").textContent = estimate.label || estimateRange(estimate.lowMinutes, estimate.highMinutes);
    $("#estimateBasis").textContent = `${estimate.basis || "Based on your research scope."} Actual time may vary.`;
  } catch (error) {
    if (error.name === "AbortError") return;
    $("#estimateValue").textContent = "Estimate unavailable";
    $("#estimateBasis").textContent = "You can still start research. Recheck your local server connection for a time estimate.";
  }
}

function showResearchPlan(event) {
  const plan = event.plan || event;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  $("#researchPlan").hidden = !steps.length;
  $("#planSummary").textContent = plan.brief ? "Your specific brief guides discovery, partnership scoring, and contact research." : "The team checks investment focus, evaluates partnership fit, then researches people and contact evidence.";
  $("#planDetail").innerHTML = `${plan.brief ? `<p>${esc(plan.brief)}</p>` : ""}<ul>${steps.map((step) => `<li><strong>${esc(step.title || AGENT_LABELS[step.agent]?.[1] || "Research")}</strong>${step.detail ? `: ${esc(step.detail)}` : ""}</li>`).join("")}</ul>`;
}

function updateProgress(metrics = {}) {
  const total = Number(metrics.totalFirms || S.requestedFirms || 0), completed = Number(metrics.completedFirms || 0);
  const percent = Math.max(0, Math.min(100, Number(metrics.progressPercent || 0)));
  $("#researchProgress").style.width = `${percent}%`;
  $("#progressHeading").textContent = completed ? `${completed} of ${total} firms researched` : S.firms.size ? "Investigating your shortlist" : "Discovering firms in your market";
  $("#progressDetail").textContent = completed ? "Results arrive as each firm is researched. Review contact evidence in the shortlist below." : "Searching relevant sources, checking investment focus, and identifying decision-makers.";
  $("#liveEta").textContent = S.mode === "demo" ? "Fictional demo in progress" : S.mode === "replay" ? "Reviewing a saved run" : Number.isFinite(Number(metrics.etaHighMinutes)) ? `${estimateRange(metrics.etaLowMinutes, metrics.etaHighMinutes)} remaining · approx.` : "Estimating remaining time…";
}

async function loadConnections() {
  try {
    const [integrations, mcp] = await Promise.all([fetch("/api/integrations"), fetch("/api/mcp")]);
    if (integrations.ok) { const data = await integrations.json(); S.integrations = Array.isArray(data) ? data : data.integrations || []; }
    if (mcp.ok) S.mcp = await mcp.json();
    renderIntegrations(); renderMcp();
  } catch { $("#integrationMessage").textContent = "Connection status unavailable. Use Refresh connection status to retry."; }
}

function renderIntegrations() {
  const box = $("#integrationsList"); box.innerHTML = "";
  for (const integration of S.integrations) {
    const item = el("div", "integration-item");
    item.innerHTML = `<div class="connection-head"><strong>${esc(integration.label || integration.name || integration.id)}</strong><span class="connection-status ${integration.status === "ready" ? "ok" : integration.status === "error" ? "bad" : ""}">${integration.status === "ready" ? "Tested" : integration.status === "error" ? "Check key" : integration.connected ? "Key saved · untested" : "Optional · no key"}</span></div>${integration.description ? `<div class="field-help">${esc(integration.description)}</div>` : ""}<div class="connection-links">${link(integration.setupUrl || integration.keyUrl, "Get an API key")}${integration.docsUrl ? ` · ${link(integration.docsUrl, "Setup guide")}` : ""}</div><label class="sr-only" for="key-${esc(integration.id)}">${esc(integration.label || integration.id)} API key</label><input id="key-${esc(integration.id)}" type="password" autocomplete="off" placeholder="Paste API key to connect" spellcheck="false"><div class="connection-actions"><button type="button" class="connect-key quiet-btn">${integration.connected ? "Replace key" : "Connect"}</button><button type="button" class="test-key quiet-btn" ${integration.connected ? "" : "disabled"}>Test</button><button type="button" class="remove-key quiet-btn" ${integration.connected ? "" : "disabled"}>Disconnect</button></div><div class="connection-message" role="status" aria-live="polite">${esc(integration.message || "")}</div>`;
    const input = item.querySelector("input");
    const request = async (method, suffix = "", apiKey) => {
      const message = item.querySelector(".connection-message");
      item.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      message.textContent = "Checking…";
      try {
        const response = await fetch(`/api/integrations/${encodeURIComponent(integration.id)}${suffix}`, { method, headers: { "Content-Type": "application/json" }, ...(apiKey ? { body: JSON.stringify({ apiKey }) } : {}) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Connection failed. Check the service key and try again.");
        input.value = "";
        await loadConnections();
        $("#integrationMessage").textContent = result.message || `${integration.label || integration.id}: ${method === "DELETE" ? "disconnected" : suffix ? "connection tested" : "key saved locally"}.`;
      } catch (error) { message.textContent = error.message; item.querySelectorAll("button").forEach((button) => { button.disabled = false; }); }
    };
    item.querySelector(".connect-key").onclick = () => {
      const key = input.value.trim();
      if (!key) { item.querySelector(".connection-message").textContent = "Paste a service API key first."; input.focus(); return; }
      request("PUT", "", key);
    };
    item.querySelector(".test-key").onclick = () => request("POST", "/test");
    item.querySelector(".remove-key").onclick = () => request("DELETE");
    box.append(item);
  }
}

function renderMcp() {
  const box = $("#mcpList"); box.innerHTML = '<div class="connection-head"><strong>Provider MCP tools</strong></div><div class="field-help">Register Hunter or Apollo with Codex or Claude, then complete the service sign-in. Registration alone does not confirm authentication.</div>';
  if (S.mcp?.message) box.append(el("div", "field-help", esc(S.mcp.message)));
  const engine = $("#engine").value;
  const provider = (S.mcp?.providers || []).find((entry) => entry.id === engine);
  if (provider?.servers?.length) box.append(el("div", "field-help", provider.servers.map((server) => esc(typeof server === "string" ? server : `${server.name || server.id}: ${server.status || "registered"}`)).join("<br>")));
  const tools = S.mcp?.integrations || S.mcp?.setup || [
    { id: "hunter", label: "Hunter", url: "https://hunter.io/mcp" },
    { id: "apollo", label: "Apollo", url: "https://docs.apollo.io/docs/apollo-mcp" },
  ];
  for (const tool of tools) {
    if (!["hunter", "apollo"].includes(tool.id)) continue;
    const item = el("div", "mcp-item");
    const command = engine === "claude-cli" ? tool.claudeCommand : tool.command;
    item.innerHTML = `${link(tool.docsUrl || tool.url || tool.setupUrl, `${tool.label || tool.id} MCP setup`)}<button type="button" class="quiet-btn" ${["codex-cli", "claude-cli"].includes(engine) ? "" : "disabled"}>Add to ${engine === "codex-cli" ? "Codex" : engine === "claude-cli" ? "Claude" : "selected provider"}</button>${command && engine ? `<details class="setup"><summary>Manual setup command</summary>${commandLine(command)}</details>` : ""}<div class="connection-message" role="status"></div>`;
    const button = item.querySelector("button");
    button.onclick = async () => {
      button.disabled = true;
      try {
        const response = await fetch(`/api/mcp/${encodeURIComponent(engine)}/${encodeURIComponent(tool.id)}/setup`, { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "MCP registration failed.");
        const message = item.querySelector(".connection-message");
        message.innerHTML = `${esc(result.message || "MCP server registered. Complete the service sign-in before research.")}${result.authCommand ? commandLine(result.authCommand) : ""}`;
        wireCommandCopies(message);
      } catch (error) { item.querySelector(".connection-message").textContent = error.message; }
      finally { button.disabled = false; }
    };
    box.append(item);
    wireCommandCopies(item);
  }
  box.append(el("div", "connection-links", `${link("https://claude.ai/directory/connectors/apollo", "Apollo for Claude")} · ${link("https://chatgpt.com/apps/apollo-io/asdk_app_69bd664f2a908191a3a0a47eca8559d1", "Apollo for ChatGPT")}`));
}

// ------------------------------------------------------------------ run lifecycle
function resetRunUI() {
  activity.clear(); S.activeTasks.clear(); S.sourceActions = 0; updateActivityFollow(); renderActivity();
  $("#activeAgentCount").textContent = "0"; $("#sourceActionCount").textContent = "0";
  brain.reset?.();
  S.firms.clear(); S.rows.clear(); S.orbit = []; S.judged = 0; S.judgeMs = 0; S.errors = 0; S.tasks = 0;
  S.laneCounts = { running: 0, done: 0 }; S.target = { thr: 0, lat: 0 }; S.metrics = {}; S.lastSeq = 0;
  $("#rows").innerHTML = '<div class="empty" id="lbEmpty">Ranked by fit as the crew works. Click a row for the details.</div>'; $("#log").innerHTML = "";
  for (const id of ["#lbFound", "#lbScored", "#lbStrong", "#lbContacts", "#lbEmails"]) $(id).textContent = "0";
  document.querySelectorAll(".st").forEach((n) => n.classList.remove("active", "done"));
  document.querySelectorAll(".lane .lc").forEach((n) => (n.innerHTML = ""));
  document.querySelectorAll(".lane .ld").forEach((n) => (n.textContent = "0"));
  buildAgents();
  $("#dl").classList.remove("ready"); $("#dl").disabled = true;
  $("#dlCsv").disabled = true;
  $("#filterEmpty").hidden = true;
  $("#banner").classList.remove("win");
  for (const id of ["#hFpm", "#hInf", "#hFound", "#hVer", "#hStrong", "#tTasks", "#tErr", "#bReady", "#bTotal"]) $(id).textContent = "0";
  $("#result").textContent = "Waiting for research evidence";
  $("#researchProgress").style.width = "0%";
  $("#researchPlan").hidden = true;
}

async function launch() {
  if (S.running || S.starting) return;
  showFormMessage();
  if (!values("#types").length || !values("#roles").length) { showFormMessage("Select at least one firm type and decision-maker role."); return; }
  const body = researchConfig();
  S.starting = true; updateLaunch();
  try {
    const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Could not start research.");
    connect(j.id);
  } catch (error) { showFormMessage(error.message); logLine({ level: "err", agent: "pipeline", text: error.message }); }
  finally { S.starting = false; updateLaunch(); }
}
async function startReplay(id) {
  if (S.running || S.starting) return;
  S.starting = true; updateLaunch(); showFormMessage();
  try {
    const response = await fetch(`/api/replay/${encodeURIComponent(id)}?speed=${Number(params.get("speed")) || 4}`, { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error(result.error || "Could not load this saved run.");
    connect(result.id);
  } catch (error) { showFormMessage(error.message); }
  finally { S.starting = false; updateLaunch(); }
}

function connect(id, startedAt = Date.now()) {
  S.es?.close();
  resetRunUI();
  S.runId = id; S.t0 = performance.now() - Math.max(0, Date.now() - startedAt); S.running = true;
  document.body.classList.add("research-running"); $("#cortexState").textContent = "Researching";
  store.set("lastRun", id);
  $("#stop").disabled = false;
  $(".track").classList.add("running");
  $("#loopState").textContent = "Researching";
  updateLaunch();
  brain.setEnergy(1);
  setTicker("scout", "starting up…");
  $("#progressHeading").textContent = "Starting your research";
  $("#progressDetail").textContent = "Your research team is preparing its approach and checking source coverage.";
  $("#liveEta").textContent = "Estimating remaining time…";
  const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
  S.es = es;
  es.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      const seq = Number(event.seq || message.lastEventId || 0);
      if (seq && seq <= S.lastSeq) return;
      if (seq) S.lastSeq = seq;
      handle(event);
    } catch (error) { logLine({ level: "err", agent: "pipeline", text: `Could not display a progress event: ${error.message}` }); }
  };
  es.onopen = () => { if (S.running) { $("#loopState").textContent = "Researching"; showFormMessage(); } };
  es.onerror = async () => {
    if (!S.running || S.es !== es) return;
    $("#loopState").textContent = "Reconnecting";
    showFormMessage("Connection interrupted. Reconnecting to your research…");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
      if (response.status === 404 && S.es === es) {
        es.close(); S.running = false; $("#stop").disabled = true; $(".track").classList.remove("running");
        finishMotion("unavailable");
        $("#loopState").textContent = "Unavailable";
        showFormMessage("This run is no longer available on the server. Start a new run or replay a saved one."); updateLaunch();
      }
    } catch { /* EventSource continues retrying while the server is offline. */ }
  };
}

async function restoreLastRun() {
  const id = store.get("lastRun", "");
  if (!id || params.get("autorun") || params.get("replay")) return;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
    if (response.ok) { const snapshot = await response.json(); connect(id, snapshot.startedAt); }
  } catch { /* An offline server must not prevent the dashboard from opening. */ }
}

function handle(e) {
  if (NOWRITER && (e.agent === "writer" || (e.type === "stage" && e.stage === "writer"))) return;
  const firm = S.firms.get(e.firmId);
  const record = activityRecord(e, firm?.name || "");
  if (activity.add(record)) { renderActivity(); if (["search", "read"].includes(record.kind)) { S.sourceActions++; $("#sourceActionCount").textContent = S.sourceActions; } }
  switch (e.type) {
    case "run": {
      const pill = $("#modePill");
      pill.className = `pill ${e.mode}`;
      pill.textContent = e.mode === "demo" ? "Fictional demo" : e.mode === "replay" ? `Saved run · ${e.speed}×` : `Live research · ${e.engine === "codex-cli" ? "Codex" : e.engine === "claude-cli" ? "Claude" : "API"}`;
      const eng = S.status?.engines.find((x) => x.id === e.engine);
      $("#engineLabel").textContent = e.mode === "demo" ? "DEMO ENGINE" : (eng?.label || e.engine).toUpperCase();
      $("#coreModel").textContent = e.mode === "demo" ? "Demo engine" : e.engine === "codex-cli" ? "Codex" : e.engine === "claude-cli" ? "Claude" : String(e.judge || "AI research team");
      $("#stackLabel").textContent = e.mode === "demo" ? "Fictional demo" : e.engine === "codex-cli" ? "Codex research team" : e.engine === "claude-cli" ? "Claude research team" : String(eng?.label || e.engine);
      S.mode = e.mode;
      S.runCountry = e.country;
      S.requestedFirms = Number(e.config.firms);
      const activeServices = Object.entries(e.config.integrations || {}).filter(([, configured]) => configured).map(([name]) => name);
      $("#integrationMessage").textContent = activeServices.length ? `Configured for this run: ${activeServices.join(", ")}. Each contact shows the sources actually used.` : "This run uses public web research. Optional API connections can expand coverage.";
      setWriter(!!e.config.drafts);
      $("#telemetryMode").textContent = e.mode;
      $("#targetTag").innerHTML = `<b>${e.country.flag} ${esc(e.country.name)}</b><br>${esc(e.country.language)} · ${e.config.firms} firms`;
      if (e.estimate) $("#liveEta").textContent = e.mode === "demo" ? `Demo: ${e.estimate.label}` : `${e.estimate.label} remaining · approx.`;
      break;
    }
    case "research_plan": showResearchPlan(e); break;
    case "stage": setStation(e.stage, e.state); break;
    case "agent": setAgent(e.agent, e.status); break;
    case "task": onTask(e); break;
    case "firm": addFirm(e.firm); brain.transfer?.("scout", "result"); break;
    case "firm_update": updateFirm(e.id, e.patch); break;
    case "judge": {
      const f = S.firms.get(e.firmId);
      const r = $("#result");
      r.textContent = `${f?.name || "Firm researched"} · Partnership fit ${e.fit}/5`;
      r.classList.add("flash"); setTimeout(() => r.classList.remove("flash"), 400);
      break;
    }
    case "metrics": onMetrics(e); break;
    case "activity": onActivity(e); break;
    case "log": logLine(e); break;
    case "error": showFormMessage(e.message); logLine({ level: "err", agent: "pipeline", text: e.message }); break;
    case "done": onDone(e); break;
  }
}

function setAgent(a, status) {
  brain.setAgent?.(a, status === "running", AGENTS[a]?.color);
  const card = document.querySelector(`.agent[data-agent="${a}"]`);
  if (card) {
    card.classList.toggle("running", status === "running");
    card.classList.toggle("done", status === "done");
    card.classList.toggle("error", status === "error"); card.classList.toggle("stopped", status === "stopped");
    card.querySelector(".astat").textContent = ({ running: "Working", done: "Done", error: "Issue", stopped: "Stopped", idle: "Ready", waiting: "Waiting" })[status] || status;
  }
  const link = document.querySelector(`#ring .link[data-agent="${a}"]`);
  if (link) {
    link.classList.toggle("on", status === "running");
    link.style.stroke = status === "running" ? AGENTS[a].color : "";
  }
}

function onTask(e) {
  const a = e.agent in AGENTS ? e.agent : "judge";
  const st = S.stats[a] || (S.stats[a] = { done: 0, inflight: 0, ms: 0, bars: [], lines: [] });
  const lane = document.querySelector(`.lane[data-agent="${a}"]`);
  S.activeTasks = taskState(S.activeTasks, e);
  $("#activeAgentCount").textContent = new Set([...S.activeTasks.values()].map((task) => task.agent)).size;
  if (e.state === "running") {
    st.inflight++;
    S.laneCounts.running++;
    if (lane) {
      const tk = el("span", "tk running", e.id.replace("T-", ""));
      tk.id = `tk-${e.id}`;
      tk.title = e.label;
      lane.querySelector(".lc").prepend(tk);
      const lc = lane.querySelector(".lc");
      while (lc.children.length > 9) lc.lastChild.remove();
    }
    if (CARD_AGENTS.includes(a)) setAgent(a, "running");
    st.lines.unshift(esc(e.label)); st.lines = st.lines.slice(0, 3);
    brain.transfer?.(a, "task");
  } else {
    st.inflight = Math.max(0, st.inflight - 1);
    S.laneCounts.running = Math.max(0, S.laneCounts.running - 1);
    S.tasks++;
    if (e.state === "error") { S.errors++; $("#tErr").textContent = S.errors; }
    else { st.done++; S.laneCounts.done++; }
    st.ms += e.ms || 0;
    st.bars.push(Math.min(34, 4 + (e.ms || 0) / 120)); st.bars = st.bars.slice(-14);
    const tsec = Number((e.t ?? (performance.now() - S.t0)) / 1000).toFixed(1);
    st.lines.unshift(`<span class="t">t+${tsec}</span> ${esc(e.label)} · ${e.state === "error" ? '<span style="color:var(--red)">err</span>' : "ok"}`);
    st.lines = st.lines.slice(0, 3);
    const tk = document.getElementById(`tk-${e.id}`);
    if (tk) { tk.classList.remove("running"); tk.classList.add(e.state === "error" ? "error" : "done"); }
    if (lane) lane.querySelector(".ld").textContent = st.done;
    $("#tTasks").textContent = S.tasks;
    if (e.state !== "error") {
      brain.pulse(AGENTS[a].color);
      const tok = e.cost ? `$${e.cost < 0.01 ? e.cost.toFixed(3) : e.cost.toFixed(2)}` : e.tokens ? `${(e.tokens / 1000).toFixed(1)}k tok` : `${((e.ms || 0) / 1000).toFixed(1)}s`;
      S.orbit.push({ text: `${e.id} · ${AGENTS[a].name} · ${tok}`, color: AGENTS[a].color, angle: Math.random() * Math.PI * 2, born: performance.now() });
      S.orbit = S.orbit.slice(-6);
      renderOrbitLabels();
    }
    if (a === "judge") { S.judged++; S.judgeMs += e.ms || 0; $("#coreStats").textContent = `${S.judged} scored · ${(S.judgeMs / S.judged / 1000).toFixed(2)}s avg`; }
  }
  $("#laneStats").textContent = `${S.laneCounts.running} active · ${S.laneCounts.done} done · ${S.errors} issues`;
  if (CARD_AGENTS.includes(a)) renderCard(a);
  if (e.state !== "running" && CARD_AGENTS.includes(a) && !st.inflight) setAgent(a, e.state === "error" ? "error" : "waiting");
}

let tickerIdle = null;
function setTicker(agent, text, live = true) {
  const A = AGENTS[agent];
  $("#tickerText").innerHTML = A ? `<span class="ag" style="color:${A.color}">${A.name}</span> ${esc(text)}` : esc(text);
  const t = $("#ticker");
  t.classList.toggle("live", live);
  t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 350);
}
function onActivity(e) {
  const a = e.agent in AGENTS ? e.agent : "judge";
  const f = e.firmId ? S.firms.get(e.firmId) : null;
  const label = f ? `${e.text} (${f.name.split(" (")[0].slice(0, 26)})` : e.text;
  setTicker(a, label);
  logLine({ level: "info", agent: a, text: `▸ ${label}`, t: e.t });
  const st = S.stats[a];
  if (st) {
    const tsec = Number((e.t ?? (performance.now() - S.t0)) / 1000).toFixed(1);
    st.lines.unshift(`<span class="t">t+${tsec}</span> <span class="act">${esc(e.text)}</span>`);
    st.lines = st.lines.slice(0, 3);
    if (CARD_AGENTS.includes(a)) renderCard(a);
  }
  if (/^search|^read/.test(e.text)) brain.pulse(AGENTS[a]?.color || "#2cf5b5");
  brain.transfer?.(a, /^search/i.test(e.text) ? "search" : /^read/i.test(e.text) ? "read" : "activity");
  clearTimeout(tickerIdle);
  tickerIdle = setTimeout(() => { if (S.running) setTicker(a, "thinking…"); }, 6000);
}

function renderCard(a) {
  const card = document.querySelector(`.agent[data-agent="${a}"]`);
  if (!card) return;
  const st = S.stats[a];
  card.querySelectorAll(".spark i").forEach((b, i) => (b.style.height = `${st.bars[i] ?? 2}px`));
  if (st.lines.length) card.querySelector(".alines").innerHTML = st.lines.map((l) => `<div>${l}</div>`).join("");
  card.querySelector(".fd").textContent = st.done;
  card.querySelector(".fi").textContent = st.inflight;
  card.querySelector(".fa").textContent = st.done ? `${(st.ms / st.done / 1000).toFixed(1)}s` : "—";
  const elapsed = Math.max(1, performance.now() - S.t0);
  card.querySelector(".fu").textContent = `${Math.min(99, Math.round((st.ms / elapsed) * 100 / 4))}%`;
}

// ------------------------------------------------------------------ lead table + radar data
function addFirm(f) {
  if (S.firms.has(f.id)) { updateFirm(f.id, f); return; }
  S.firms.set(f.id, { ...f, angle: hashAngle(f.id), seq: S.firms.size });
  $("#lbEmpty")?.remove();
  const row = el("div", "tr");
  row.dataset.id = f.id;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `Open details for ${f.name}`);
  row.onclick = () => openDrawer(f.id);
  row.onkeydown = (event) => { if (event.target === row && ["Enter", " "].includes(event.key)) { event.preventDefault(); openDrawer(f.id); } };
  $("#rows").append(row);
  S.rows.set(f.id, row);
  renderRow(f.id);
  boardStats();
  $("#bTotal").textContent = S.firms.size;
  $("#hFound").textContent = S.firms.size;
}
function updateFirm(id, patch) {
  const f = S.firms.get(id);
  if (!f) return;
  Object.assign(f, patch);
  if (patch.fit != null) f.blip = performance.now();
  renderRow(id);
  const row = S.rows.get(id);
  row?.classList.add("flash"); setTimeout(() => row?.classList.remove("flash"), 500);
  boardStats();
  if ($("#drawer").dataset.id === id && !$("#drawer").hidden) openDrawer(id, true);
}
function rankAll() {
  const list = [...S.firms.values()].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || (b.fitConfidence ?? 0) - (a.fitConfidence ?? 0) || a.seq - b.seq);
  list.forEach((f, i) => { const r = S.rows.get(f.id); if (r) { r.style.order = String(i); const n = r.querySelector(".rk"); if (n) n.textContent = String(i + 1).padStart(2, "0"); } });
}
function boardStats() {
  const all = [...S.firms.values()];
  const totals = summarizeFirms(all);
  $("#lbFound").textContent = all.length;
  $("#lbScored").textContent = all.filter((f) => f.fit != null).length;
  $("#lbStrong").textContent = all.filter((f) => (f.fit ?? 0) >= 4).length;
  $("#lbContacts").textContent = totals.contacts;
  $("#lbEmails").textContent = totals.emails;
  $("#hVer").textContent = totals.emails;
  $("#hStrong").textContent = all.filter((f) => (f.fit ?? 0) >= 4).length;
  rankAll();
  filterBoard();
}
function filterBoard() {
  const filters = { search: $("#leadSearch").value, email: $("#emailFilter").value, fit: $("#fitFilter").value };
  let visible = 0;
  for (const firm of S.firms.values()) {
    const match = matchesFirm(firm, filters);
    const row = S.rows.get(firm.id); if (row) row.hidden = !match;
    if (match) visible++;
  }
  $("#resultCount").textContent = `${visible} of ${S.firms.size} firms`;
  $("#filterEmpty").hidden = !S.firms.size || !!visible;
}
const shortAum = (s) => { const m = String(s || "").match(/(US\$|R\$|\$|MX\$|€|£)?\s?[\d.,]+\s?(trillion|billion|million|bn|tn|mn|B|M|T)\b/i); return m ? m[0].replace(/\s+/g, " ") : ""; };
const chip = (st) => `<span class="chip-e ${esc(String(st || "pending").split(" ")[0])}">${esc(String(st || "pending").toUpperCase())}</span>`;
function renderRow(id) {
  const f = S.firms.get(id), row = S.rows.get(id);
  if (!f || !row) return;
  const fit = f.fit ?? 0;
  row.classList.toggle("strong", fit >= 4);
  const pips = `<span class="pips ${fit >= 5 ? "f5" : fit && fit < 3 ? "low" : ""}">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= fit ? "on" : ""}"></i>`).join("")}</span>`;
  const fitCell = f.fit == null ? '<span class="mute">scoring…</span>' : `<span class="fitbox">${pips}<span class="fitn ${fit >= 4 ? "" : fit === 3 ? "mid" : "low"}">${fit}</span></span>`;
  const aum = shortAum(f.aum);
  const firm = `<span class="c2"><span class="firm" title="${esc(f.name)}">${esc(f.name)}</span><span class="sub">${esc([f.city, aum].filter(Boolean).join(" · ") || f.type || "")}</span></span>`;
  const inv = `<span class="c2"><span title="${esc(f.assetClasses || "")}">${esc(f.assetClasses || (f.fit == null ? "reading…" : "—"))}</span><span class="sub">${esc(f.globalEquity && f.globalEquity !== "Unknown" ? `global equity: ${f.globalEquity.toLowerCase()}` : "")}</span></span>`;
  const contacts = contactsForFirm(f);
  const primary = contacts.find(hasEmailEvidence) || contacts.find(hasUsableEmail) || contacts[0];
  const emails = [...new Set(contacts.filter(hasUsableEmail).map((contact) => contact.email))];
  const person = primary?.name ? `<span class="c2"><span>${esc(primary.name)}${contacts.length > 1 ? ` <span class="more-people">+${contacts.length - 1}</span>` : ""}</span><span class="sub" title="${esc(primary.title)}">${esc(primary.title)}</span></span>`
    : `<span class="mute">${f.status === "Not a fit" ? "skipped" : f.stage === "done" ? "No contact found" : f.fit == null ? "…" : "finding…"}</span>`;
  const email = primary?.email ? `<span class="c2"><span class="em" title="${esc(primary.email)}">${esc(primary.email)}</span><span class="sub">${chip(primary.emailStatus)}${emails.length > 1 ? `<span class="pat">+${emails.length - 1} emails</span>` : ""}</span></span>`
    : `<span class="c2"><span class="em none">${f.status === "Not a fit" ? "—" : primary?.emailFallbackReason ? "Needs name/domain" : f.stage === "done" ? "Needs contact research" : "…"}</span></span>`;
  const copy = emails.length ? `<button class="copy" title="Copy ${emails.length > 1 ? "all firm emails" : "email"}" aria-label="Copy ${emails.length > 1 ? "all firm emails" : "email"}">⧉</button>` : "<span></span>";
  row.innerHTML = `<span class="mute rk">··</span>${firm}${inv}<span>${fitCell}</span>${person}${email}${copy}`;
  const cb = row.querySelector(".copy");
  if (cb) cb.onclick = async (ev) => { ev.stopPropagation(); try { await navigator.clipboard.writeText(emails.join("\n")); cb.classList.add("done"); cb.textContent = "✓"; setTimeout(() => { cb.classList.remove("done"); cb.textContent = "⧉"; }, 1200); } catch { showFormMessage("Clipboard unavailable. Open the firm details to select and copy its emails."); } };
  rankAll();
}
const link = (u, t) => { const url = safeHttpUrl(u); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t || url)}</a>` : esc(t || u || "—"); };
let drawerReturnFocus = null;
function renderContact(contact, index) {
  const explanations = { Verified: "Verified by an email verification service. Delivery is not guaranteed.", Published: "Found on a public source. Review the linked evidence.", Inferred: "Inferred from an observed firm email pattern. Not verified.", Guess: "Guessed address. Confirm independently before outreach.", "No mail server": "The domain has no usable mail server.", "Not found": "No email found from the available sources." };
  const checks = { not_checked: "Not checked", mx_present: "Mail server exists; this mailbox has not been verified", mx_missing: "No mail server", unknown: "Verification inconclusive", valid: "Service reports mailbox valid", accept_all: "Catch-all domain; individual mailbox not confirmed", invalid: "Service reports invalid" };
  const sources = [...new Set([contact.sourceUrl, contact.emailEvidenceUrl, contact.phoneSourceUrl, ...(contact.sourceUrls || [])].filter((url) => safeHttpUrl(url)))];
  const roleEvidence = { official_page: "Role evidence found on an official source", public_source: "Role evidence found on a public source", needs_review: "Current role needs independent review", demo: "Fictional demo contact" };
  const checked = contact.checkedAt && Number.isFinite(Date.parse(contact.checkedAt)) ? new Date(contact.checkedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const phone = contact.phone ? `<div class="contact-phone"><strong>${esc(contact.phone)}</strong><span class="phone-type">${phoneLabel(contact.phoneType)}</span>${contact.phoneSourceUrl ? link(contact.phoneSourceUrl, "Phone source") : '<span class="field-help">Phone source not supplied</span>'}</div>` : '<div class="contact-quality">Professional phone number not found.</div>';
  return `<article class="contact-card"><div class="contact-head"><strong>${esc(contact.name || `Contact ${index + 1}`)}</strong>${contact.linkedin ? link(contact.linkedin, "Contact LinkedIn") : ""}</div><div class="dr-v">${esc(contact.title || "Role not found")}</div>${contact.roleEvidenceStatus ? `<div class="contact-quality">${esc(roleEvidence[contact.roleEvidenceStatus] || contact.roleEvidenceStatus)}${checked ? ` · Researched ${esc(checked)}` : ""}</div>` : ""}<div class="contact-email">${contact.email ? `<span class="dr-email">${esc(contact.email)}</span>${chip(contact.emailStatus)}` : '<span class="mute">Needs name or company domain</span>'}</div><div class="field-help">${esc(contact.emailFallbackReason || explanations[contact.emailStatus] || "Review the source and verification status before outreach.")}</div>${contact.emailCheck ? `<div class="field-help">Check: ${esc(checks[contact.emailCheck] || contact.emailCheck)}${contact.verificationProvider ? ` · ${esc(contact.verificationProvider)}` : ""}</div>` : ""}${phone}${contact.emailPattern ? `<div class="field-help">${contact.emailStatus === "Guess" ? "Assumed email pattern:" : "Company email pattern:"} ${esc(contact.emailPattern)}</div>` : ""}${contact.emailEvidence ? `<div class="dr-v contact-evidence">${esc(contact.emailEvidence)}</div>` : ""}${contact.provider ? `<div class="field-help">Contact source: ${esc(contact.provider)}</div>` : ""}${sources.length ? `<div class="contact-sources">${sources.map((url, i) => link(url, `Source ${i + 1}`)).join(" · ")}</div>` : ""}</article>`;
}
function openDrawer(id, updating = false) {
  const f = S.firms.get(id);
  if (!f) return;
  const d = $("#drawer");
  const card = $("#drawerCard");
  const scrollTop = card.scrollTop;
  if (!updating) drawerReturnFocus = document.activeElement;
  d.dataset.id = id;
  const conf = f.fitConfidence != null ? `${Math.round(f.fitConfidence * 100)}% model confidence` : "";
  const contacts = contactsForFirm(f);
  const coverage = contactCoverage([f]);
  card.innerHTML = `<button class="dr-close" title="Close" aria-label="Close firm details">✕</button>
    <div class="dr-top"><div><div class="dr-name">${esc(f.name)}</div><div class="dr-sub">${esc([f.type, f.city, f.country].filter(Boolean).join(" · "))} · ${link(f.website)}</div></div>
      <div class="dr-fit"><b class="fitn ${(f.fit ?? 0) >= 4 ? "" : f.fit === 3 ? "mid" : "low"}">${f.fit ?? "–"}<small style="font-size:13px">/5</small></b><span>Partnership fit${conf ? ` · ${esc(conf)}` : ""}</span></div></div>
    ${f.summary ? `<div class="dr-v">${esc(f.summary)}</div>` : ""}
    <div class="dr-sec"><div class="dr-k">Why this firm</div><div class="dr-v">${esc(f.why || "Scoring…")}</div></div>
    <div class="dr-sec dr-grid">
      <div><div class="dr-k">ASSETS UNDER MANAGEMENT</div><div class="dr-v">${esc(f.aum || "—")}</div></div>
      <div><div class="dr-k">INVESTS IN</div><div class="dr-v">${esc(f.assetClasses || "—")}</div></div>
      <div><div class="dr-k">CLIENTS</div><div class="dr-v">${esc(f.segment || "—")}</div></div>
      <div><div class="dr-k">GLOBAL EQUITY TODAY</div><div class="dr-v">${esc(f.globalEquity || "—")}${f.globalEquityEvidence ? ` · ${esc(f.globalEquityEvidence)}` : ""}</div></div>
    </div>
    <div class="dr-sec"><div class="dr-k">Decision-makers · ${contacts.length}</div><div class="contact-quality">${coverage.evidenceEmails} emails with published or verified evidence · ${coverage.linkedin} contact LinkedIn profiles · ${coverage.directPhones} direct numbers · ${coverage.companyPhones} company numbers</div>${contacts.length ? contacts.map(renderContact).join("") : '<div class="dr-v">No contacts found yet.</div>'}</div>
    ${f.researchWarnings?.length || f.nextAction ? `<div class="quality-summary">${f.researchWarnings?.length ? `<strong>Research gaps</strong><ul>${f.researchWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}${f.nextAction ? `<strong>Suggested next step</strong><p>${esc(f.nextAction)}</p>` : ""}</div>` : ""}
    ${f.body || f.draft || f.subject || f.emailDraft ? `<div class="dr-sec"><div class="dr-k">OUTREACH DRAFT</div><div class="dr-v draft-text">${esc(f.subject || "")}${f.subject ? "\n\n" : ""}${esc(f.body || f.draft || f.emailDraft || "")}</div></div>` : ""}
    ${f.news ? `<div class="dr-sec"><div class="dr-k">RECENT NEWS</div><div class="dr-v">${esc(f.news)}</div></div>` : ""}
    <div class="dr-sec"><div class="dr-k">SOURCE</div><div class="dr-v">${esc(f.source || "")} ${f.sourceUrl ? `· ${link(f.sourceUrl, "link")}` : ""}</div></div>`;
  $("#drawerCard .dr-close").onclick = closeDrawer;
  d.hidden = false;
  document.body.classList.add("drawer-open");
  card.scrollTop = updating ? scrollTop : 0;
  if (!updating) card.focus();
}
function closeDrawer() { const wasOpen = !$("#drawer").hidden; $("#drawer").hidden = true; document.body.classList.remove("drawer-open"); if (wasOpen) drawerReturnFocus?.focus(); }
function hashAngle(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 3600) / 3600 * Math.PI * 2; }

function onMetrics(m) {
  S.metrics = m;
  $("#hFpm").textContent = Number(m.firmsPerMin || 0).toFixed(1);
  $("#hInf").textContent = m.inFlight ?? 0;
  $("#hVer").textContent = summarizeFirms([...S.firms.values()]).emails;
  $("#hStrong").textContent = [...S.firms.values()].filter((f) => (f.fit ?? 0) >= 4).length;
  $("#bReady").textContent = [...S.firms.values()].filter((firm) => (firm.fit ?? 0) >= 4 && contactsForFirm(firm).some(hasEmailEvidence)).length;
  S.target.thr = Number(m.firmsPerMin || 0);
  S.target.lat = Number(m.latencyMs || 0) / 1000;
  if (S.running) updateProgress(m);
}

function onDone(e) {
  const summary = e.summary || e;
  const partial = summary.partial && !summary.stopped && !summary.failed || summary.outcome === "partial" || summary.state === "partial";
  S.running = false;
  finishMotion(summary.failed ? "failed" : summary.stopped ? "stopped" : "complete");
  S.es?.close();
  clearTimeout(tickerIdle);
  const totals = summarizeFirms([...S.firms.values()]);
  setTicker(null, summary.failed ? `research failed · ${totals.firms ? "partial results available" : "no firms found"}` : summary.stopped ? "stopped · partial results available" : `${partial ? "partial results" : "done"} · ${totals.firms} firms · ${totals.contacts} people · ${totals.emails} emails · export ready`, false);
  $("#stop").disabled = true;
  $(".track").classList.remove("running");
  $("#loopState").textContent = summary.failed ? "Failed" : summary.stopped ? "Stopped" : partial ? "Partial results" : "Complete";
  $("#modePill").className = `pill ${S.mode === "demo" ? "demo" : S.mode === "replay" ? "replay" : ""}`;
  $("#modePill").textContent = `${S.mode === "demo" ? "Demo" : S.mode === "replay" ? "Saved run" : "Live research"} · ${$("#loopState").textContent}`;
  $("#progressHeading").textContent = summary.failed ? "Research needs attention" : summary.stopped ? "Research stopped" : partial ? "Your partial shortlist is ready" : "Your shortlist is ready";
  const coverage = contactCoverage([...S.firms.values()]);
  $("#progressDetail").textContent = `${totals.firms} firms · ${totals.contacts} people · ${coverage.evidenceEmails} evidence-backed emails · ${coverage.linkedin} contact LinkedIn profiles · ${coverage.directPhones + coverage.companyPhones} phone numbers. ${summary.failed || summary.stopped || partial ? "Review the research gaps and partial results." : "Review the evidence, then download your results."}`;
  $("#liveEta").textContent = `Finished in ${Math.max(1, Math.round(Number(summary.seconds || (performance.now() - S.t0) / 1000)))} seconds`;
  if (!summary.failed && !summary.stopped && !partial) $("#researchProgress").style.width = "100%";
  $("#tElapsed").textContent = Number(summary.seconds ?? (e.t || 0) / 1000).toFixed(1);
  const outcomeMessage = summary.error || summary.message || (partial ? `Partial results: ${summary.failedFirms || 0} firms had research errors. Review the event log and exported evidence.` : "");
  if (outcomeMessage || summary.warnings?.length) showFormMessage([outcomeMessage, ...(summary.warnings || [])].filter(Boolean).join(" "));
  document.querySelectorAll(".st").forEach((n) => { n.classList.remove("active"); if (!summary.failed && !summary.stopped && !partial) n.classList.add("done"); });
  $("#dl").classList.add("ready"); $("#dl").disabled = false;
  $("#dlCsv").disabled = false;
  $("#banner").classList.toggle("win", !summary.failed && !summary.stopped && !partial);
  brain.setEnergy(0.35);
  CARD_AGENTS.forEach((a) => setAgent(a, summary.failed ? "error" : summary.stopped ? "stopped" : S.stats[a]?.done ? "done" : "idle"));
  updateLaunch();
  setTimeout(loadStatus, 1500);
}

function updateActivityFollow() {
  $("#activityPause").textContent = activity.follow ? "Pause follow" : "Follow latest";
  $("#activityPause").setAttribute("aria-pressed", String(!activity.follow));
}
function renderActivity() {
  const box = $("#liveActivity"), previousTop = box.scrollTop;
  const records = activity.filtered($("#activityFilter").value, $("#activitySearch").value);
  $("#activityCount").textContent = `${activity.total} events`;
  box.innerHTML = records.length ? records.map((record) => {
    const name = AGENT_LABELS[record.agent]?.[0] || "System";
    const color = AGENTS[record.agent]?.color || "#b8aaff";
    const icon = { search: "⌕", read: "↗", result: "✓", issue: "!", task: "◈", progress: "·" }[record.kind];
    const stamp = `${Math.floor(record.t / 60000).toString().padStart(2, "0")}:${Math.floor(record.t / 1000 % 60).toString().padStart(2, "0")}`;
    const status = record.status === "running" ? "Started" : record.status === "done" ? "Done" : ["error", "err"].includes(record.status) ? "Issue" : record.status === "stopped" ? "Stopped" : "";
    return `<div class="activity-entry kind-${record.kind}"><span class="activity-icon" style="--event-color:${color}">${icon}</span><div><div class="event-meta"><b style="color:${color}">${name}</b><time>${stamp}</time>${status ? `<span>${status}</span>` : ""}</div><div class="event-text">${esc(record.text)}</div>${record.firm && !record.text.includes(record.firm) ? `<div class="event-firm">${esc(record.firm)}</div>` : ""}${record.url ? `<a href="${esc(record.url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ""}</div></div>`;
  }).join("") : `<div class="activity-empty">${activity.total ? "No events match these filters." : "Searches, page reads and results will appear here."}</div>`;
  box.scrollTop = activity.follow ? box.scrollHeight : previousTop;
}
function finishMotion(state) {
  document.body.classList.remove("research-running");
  S.activeTasks.clear(); S.laneCounts.running = 0;
  $("#activeAgentCount").textContent = "0"; $("#hInf").textContent = "0";
  $("#cortexState").textContent = state === "complete" ? "Complete" : state === "stopped" ? "Stopped" : "Attention";
  for (const agent of CARD_AGENTS) {
    if (S.stats[agent]) S.stats[agent].inflight = 0;
    brain.setAgent?.(agent, false, AGENTS[agent].color); renderCard(agent);
  }
  document.querySelectorAll(".tk.running").forEach((token) => { token.classList.remove("running"); token.classList.add("error"); });
  $("#laneStats").textContent = `0 active · ${S.laneCounts.done} done · ${S.errors} issues`;
  brain.setEnergy(0.15); brain.finish?.();
}
function logLine(e) {
  const box = $("#log");
  const A = AGENTS[e.agent];
  const t = e.t != null ? (Number(e.t) / 1000).toFixed(1) : S.t0 ? ((performance.now() - S.t0) / 1000).toFixed(1) : "0.0";
  const line = el("div", e.level, `<span class="t">t+${t.padStart(5, " ")}</span> <span class="ag" style="color:${A?.color || "var(--g)"}">${(A?.name || e.agent.toUpperCase()).padEnd(6, " ")}</span> ${esc(e.text)}`);
  box.append(line);
  while (box.children.length > 60) box.firstChild.remove();
}

// ------------------------------------------------------------------ ring + orbit labels
const ring = { cx: 0, cy: 0, r: 0 };
function buildRing() {
  const stage = $("#signalView");
  const w = stage.clientWidth, h = stage.clientHeight;
  ring.cx = w * .62; ring.cy = h * .51; ring.r = Math.min(h * .35, w * .275) + 15;
  const { cx, cy, r } = ring;
  let ticks = "";
  for (let d = 0; d < 360; d += 3) {
    const major = d % 15 === 0, a = (d * Math.PI) / 180, l = major ? 9 : 4;
    ticks += `<line class="tick${major ? " major" : ""}" x1="${cx + Math.cos(a) * r}" y1="${cy + Math.sin(a) * r}" x2="${cx + Math.cos(a) * (r - l)}" y2="${cy + Math.sin(a) * (r - l)}"/>`;
    if (d % 30 === 0) ticks += `<text x="${cx + Math.cos(a) * (r + 12)}" y="${cy + Math.sin(a) * (r + 12) + 3}" text-anchor="middle">${d}°</text>`;
  }
  $("#ring").setAttribute("viewBox", `0 0 ${w} ${h}`);
  $("#ring").innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(168,149,235,.13)"/>${ticks}`;
  for (const a of CARD_AGENTS) if (S.stats[a]?.inflight) setAgent(a, "running");
}
function renderOrbitLabels() {
  const box = $("#orbitLabels");
  box.innerHTML = S.orbit.map((o, i) => `<div class="olab" id="ol-${i}" style="color:${o.color};border-color:${o.color}66">${esc(o.text)}</div>`).join("");
}

// ------------------------------------------------------------------ gauges
function gauge(id, title, unit, max) {
  const host = $(id);
  const W = 140, H = 112, cx = W / 2, cy = 70, r = 44, a0 = (200 * Math.PI) / 180, a1 = (-20 * Math.PI) / 180;
  const pt = (a, rr) => [cx + Math.cos(a) * rr, cy - Math.sin(a) * rr];
  let ticks = "";
  for (let i = 0; i <= 10; i++) {
    const a = a0 + (a1 - a0) * (i / 10), [x1, y1] = pt(a, r + 2), [x2, y2] = pt(a, r + (i % 5 === 0 ? 9 : 5));
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(60,255,196,${i % 5 === 0 ? 0.7 : 0.35})"/>`;
  }
  const [sx, sy] = pt(a0, r), [ex, ey] = pt(a1, r);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <text x="8" y="13" fill="#5f8f83" font-size="8" letter-spacing="1.2">${title}</text>
    <path d="M${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}" fill="none" stroke="rgba(60,255,196,0.12)" stroke-width="6"/>
    <path class="val" d="" fill="none" stroke="#2cf5b5" stroke-width="6" style="filter:drop-shadow(0 0 4px #2cf5b5)"/>
    ${ticks}
    <line class="needle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 6}" stroke="#ffb23f" stroke-width="1.6"/>
    <circle cx="${cx}" cy="${cy}" r="3" fill="#ffb23f"/>
    <text class="num" x="${cx}" y="${cy + 24}" text-anchor="middle" fill="#e8fff8" font-size="16" font-weight="700">0.0</text>
    <text x="${cx}" y="${cy + 35}" text-anchor="middle" fill="#5f8f83" font-size="7.5" letter-spacing="1">${unit}</text></svg>`;
  const val = host.querySelector(".val"), needle = host.querySelector(".needle"), num = host.querySelector(".num");
  return (v) => {
    const f = Math.max(0, Math.min(1, v / max)), a = a0 + (a1 - a0) * f, [x, y] = pt(a, r);
    val.setAttribute("d", f > 0.002 ? `M${sx} ${sy} A ${r} ${r} 0 ${a0 - a > Math.PI ? 1 : 0} 1 ${x} ${y}` : "");
    const [nx, ny] = pt(a, r - 6);
    needle.setAttribute("x2", nx); needle.setAttribute("y2", ny);
    num.textContent = v.toFixed(1);
  };
}

// ------------------------------------------------------------------ radar
const radar = $("#radar");
const rctx = radar.getContext("2d");
let sweep = 0;
function drawRadar(dt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = radar.clientWidth, h = radar.clientHeight;
  if (w < 40 || h < 40) return;
  if (radar.width !== w * dpr) { radar.width = w * dpr; radar.height = h * dpr; }
  rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2 - 6, R = Math.min(w, h) / 2 - 18;
  rctx.strokeStyle = "rgba(60,255,196,0.16)"; rctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) { rctx.beginPath(); rctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); rctx.stroke(); }
  rctx.beginPath(); rctx.moveTo(cx - R, cy); rctx.lineTo(cx + R, cy); rctx.moveTo(cx, cy - R); rctx.lineTo(cx, cy + R); rctx.stroke();
  rctx.fillStyle = "rgba(95,143,131,0.7)"; rctx.font = "8px monospace";
  ["5", "4", "3", "2"].forEach((t, i) => rctx.fillText(t, cx + 3, cy - (R * i) / 4 - 3));
  sweep = (sweep + dt * (S.running ? 1.6 : 0.6)) % (Math.PI * 2);
  if (rctx.createConicGradient) {
    const g = rctx.createConicGradient(sweep - 0.9, cx, cy);
    g.addColorStop(0, "rgba(44,245,181,0)"); g.addColorStop(0.143, "rgba(44,245,181,0.28)"); g.addColorStop(0.144, "rgba(44,245,181,0)");
    rctx.fillStyle = g; rctx.beginPath(); rctx.arc(cx, cy, R, 0, Math.PI * 2); rctx.fill();
  }
  rctx.strokeStyle = "rgba(120,255,215,0.8)"; rctx.beginPath(); rctx.moveTo(cx, cy); rctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); rctx.stroke();
  for (const f of S.firms.values()) {
    const fit = f.fit ?? 0;
    const rr = fit ? ((5 - fit) / 4) * R * 0.86 + R * 0.07 : R * 0.96;
    const x = cx + Math.cos(f.angle) * rr, y = cy + Math.sin(f.angle) * rr;
    let d = (sweep - f.angle) % (Math.PI * 2); if (d < 0) d += Math.PI * 2;
    const lit = Math.max(0.25, 1 - d / 2.4);
    const col = /Verified|Published/.test(f.emailStatus) ? "44,245,181" : f.emailStatus === "Inferred" ? "92,214,255" : /Guess|Catch|Unverified/.test(f.emailStatus) ? "255,178,63" : /Not|Invalid|No mail/.test(f.emailStatus) ? "255,92,112" : fit ? "190,240,225" : "86,112,106";
    rctx.fillStyle = `rgba(${col},${lit})`;
    rctx.shadowColor = `rgba(${col},1)`; rctx.shadowBlur = 8 * lit;
    rctx.beginPath(); rctx.arc(x, y, fit >= 4 ? 3.4 : 2.4, 0, Math.PI * 2); rctx.fill();
    if (f.blip && performance.now() - f.blip < 900) {
      const k = (performance.now() - f.blip) / 900;
      rctx.strokeStyle = `rgba(${col},${1 - k})`; rctx.beginPath(); rctx.arc(x, y, 3 + k * 14, 0, Math.PI * 2); rctx.stroke();
    }
    rctx.shadowBlur = 0;
  }
}

// ------------------------------------------------------------------ main loop
const setThr = gauge("#gThr", "THROUGHPUT", "FIRMS / MIN", 12);
const setLat = gauge("#gLat", "LATENCY", "SEC / CALL", 30);
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  S.gauge.thr += (S.target.thr - S.gauge.thr) * Math.min(1, dt * 3);
  S.gauge.lat += (S.target.lat - S.gauge.lat) * Math.min(1, dt * 3);
  setThr(S.gauge.thr); setLat(S.gauge.lat);
  if (!document.hidden) drawRadar(reducedMotion.matches || !S.running ? 0 : dt);
  S.orbit.forEach((o, i) => {
    if (!reducedMotion.matches && S.running) o.angle += dt * 0.12;
    const n = document.getElementById(`ol-${i}`);
    if (n) { n.style.left = `${ring.cx + Math.cos(o.angle) * ring.r}px`; n.style.top = `${ring.cy + Math.sin(o.angle) * ring.r}px`; n.style.opacity = String(Math.max(0.35, 1 - (now - o.born) / 20000)); }
  });
  if (S.running) $("#tElapsed").textContent = ((now - S.t0) / 1000).toFixed(1);
  setTimeout(() => requestAnimationFrame(tick), document.hidden ? 2000 : S.running ? 40 : 800);
}
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("en-GB"); }, 1000);

// ------------------------------------------------------------------ boot
async function boot() {
  $("#boot").classList.add("gone");
}


(async function main() {
  buildStations(); buildAgents(); buildLanes(); initForm();
  loadConnections();
  await loadStatus();
  renderMcp();
  buildRing();
  new ResizeObserver(buildRing).observe($("#signalView"));
  requestAnimationFrame(tick);
  await boot();
  await restoreLastRun();
  if (params.get("autorun") === "demo" || params.get("autorun") === "live") setTimeout(launch, 300);
  if (params.get("replay")) setTimeout(() => startReplay(params.get("replay")), 300);
})();
