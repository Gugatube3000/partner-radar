import { createBrain } from "/brain.js";
import { AGENTS } from "/mascots.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const params = new URLSearchParams(location.search);
let NOWRITER = true;
function setWriter(on) { NOWRITER = !on; document.body.classList.toggle("nowriter", !on); }
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const STATIONS = [["brief", "BRIEF"], ["scout", "SCOUT"], ["analyst", "ANALYST"], ["judge", "JUDGE"], ["finder", "FINDER"], ["verify", "VERIFY"], ["writer", "WRITER"], ["excel", "EXCEL"]];
const TYPES = ["Private banks", "Wealth managers", "Brokerages", "Asset managers", "Digital investment platforms", "Insurers"];
const SEGMENTS = ["Retail", "Affluent", "HNW"];
const ROLES = ["CEO", "Head of Wealth", "Head of Partnerships", "CIO", "Head of Distribution"];
const CARD_AGENTS = ["scout", "analyst", "finder", "writer"];
const LANE_AGENTS = ["scout", "analyst", "judge", "finder", "writer"];
const DEFAULT_TEMPLATE = `Hi {{first_name}},

{{firm}} serves investors who want to diversify beyond {{country}}. We have a global equity solution and client education materials we can adapt for your clients, in {{language}}.

The idea is a partnership where both firms gain a new revenue stream. Do you have 20 minutes next week?

Best,
{{sender}}`;

const S = {
  status: null, mode: "demo", runId: null, es: null, t0: 0, running: false, firms: new Map(), rows: new Map(),
  stats: {}, orbit: [], judged: 0, judgeMs: 0, errors: 0, tasks: 0, gauge: { thr: 0, lat: 0 }, target: { thr: 0, lat: 0 },
  laneCounts: { running: 0, done: 0 }, metrics: {},
};

// ------------------------------------------------------------------ brain
const brain = createBrain($("#brain"), { onReady: () => { $("#cortexState").textContent = "ONLINE"; } });
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
    card.innerHTML = `<div class="ahead"><div class="avatar">${A.svg}</div><div><div class="aname">${A.name}</div><div class="arole">${A.role}</div></div><span class="astat">IDLE</span></div>
      <div class="abody"><div class="spark">${"<i></i>".repeat(14)}</div><div class="alines"><div class="mute">awaiting brief</div></div></div>
      <div class="afoot"><span>DONE <b class="fd">0</b></span><span>IN <b class="fi">0</b></span><span>AVG <b class="fa">—</b></span><span>UTIL <b class="fu">0%</b></span></div>`;
    box.append(card);
    S.stats[a] = { done: 0, inflight: 0, ms: 0, bars: Array(14).fill(2), lines: [] };
  }
  S.stats.judge = { done: 0, inflight: 0, ms: 0, bars: [], lines: [] };
}
function buildLanes() {
  const box = $("#lanes");
  box.innerHTML = "";
  for (const a of LANE_AGENTS) {
    const lane = el("div", "lane", `<span class="ln">${AGENTS[a].name}</span><div class="lc"></div><span class="ld">0</span>`);
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
    c.onclick = () => { c.classList.toggle("on"); store.set(key, values(id).join("|")); };
    box.append(c);
  }
}
const values = (id) => [...document.querySelectorAll(`${id} .chip.on`)].map((c) => c.textContent);

async function loadStatus() {
  S.status = await (await fetch("/api/status")).json();
  const st = S.status;
  const sel = $("#country");
  if (!sel.options.length) {
    const groups = {};
    for (const c of st.countries) (groups[c.region] ??= []).push(c);
    for (const [region, list] of Object.entries(groups)) {
      const og = document.createElement("optgroup");
      og.label = region;
      for (const c of list) og.append(new Option(`${c.flag}  ${c.name} · ${c.language}`, c.code));
      sel.append(og);
    }
    sel.value = params.get("country") || store.get("country", "BR");
    sel.onchange = () => { store.set("country", sel.value); updateTargetTag(); };
  }
  const eng = $("#engine");
  eng.innerHTML = "";
  const preferred = ["claude-cli", "openrouter", "anthropic", "codex-cli"];
  for (const id of preferred) {
    const e = st.engines.find((x) => x.id === id);
    if (!e) continue;
    const o = new Option(`${e.ok ? "●" : "○"} ${e.label}${e.ok ? "" : " — not set up"}`, e.id);
    o.disabled = !e.ok;
    eng.append(o);
  }
  eng.value = store.get("engine", "") && st.engines.find((e) => e.id === store.get("engine", ""))?.ok ? store.get("engine", "") : (preferred.find((id) => st.engines.find((e) => e.id === id)?.ok) || "");
  // Always the Claude plan unless ?engine=... asks for something else.
  const forced = params.get("engine");
  eng.value = forced && st.engines.find((e) => e.id === forced)?.ok ? forced : "claude-cli";
  const rb = $("#replayBox");
  rb.innerHTML = "";
  if (st.replays?.length) {
    const r = st.replays[0];
    const btn = el("button", "", `⟲ REPLAY LAST LIVE RUN · ${esc(r.country)} · 4×`);
    btn.type = "button";
    btn.onclick = () => startReplay(r.id);
    rb.append(btn);
  }
  updateTargetTag();
  updateLaunch();
}

function updateTargetTag() {
  const c = S.status?.countries.find((x) => x.code === $("#country").value);
  if (c) $("#targetTag").innerHTML = `TARGET · <b>${c.flag} ${esc(c.name.toUpperCase())}</b><br>${esc(c.language.toUpperCase())}`;
}
function updateLaunch() {
  const btn = $("#launch");
  const eng = S.status?.engines.find((e) => e.id === $("#engine").value);
  const cli = $("#engine").value === "claude-cli";
  $("#modelRow").style.display = cli ? "" : "none";
  const note = $("#engineNote");
  note.classList.toggle("bad", !eng?.ok);
  note.textContent = !S.status ? "Checking Claude Code…" : eng?.ok ? (cli ? "Runs on your Claude plan · no API key" : `Engine: ${eng.label}`) : "Claude Code not found. Install it and sign in (see README), then restart.";
  $("#launchSub").textContent = eng?.ok ? (cli ? "runs on your Claude plan" : eng.label) : "Claude Code needed";
  btn.disabled = S.running || !eng?.ok;
}

function initForm() {
  $("#template").value = store.get("template", DEFAULT_TEMPLATE);
  $("#template").oninput = () => store.set("template", $("#template").value);
  $("#sender").value = store.get("sender", "");
  $("#sender").oninput = () => store.set("sender", $("#sender").value);
  const firms = $("#firms");
  firms.value = params.get("firms") || store.get("firms", "8");
  $("#firmsVal").textContent = firms.value;
  firms.oninput = () => { $("#firmsVal").textContent = firms.value; store.set("firms", firms.value); };
  const dr = $("#drafts");
  dr.checked = !params.has("nowriter") && store.get("drafts", "0") === "1";
  setWriter(dr.checked);
  dr.onchange = () => { store.set("drafts", dr.checked ? "1" : "0"); setWriter(dr.checked); };
  $("#claudeModel").value = store.get("claudeModel", "sonnet");
  $("#claudeModel").onchange = () => store.set("claudeModel", $("#claudeModel").value);
  $("#launch").onclick = launch;
  $("#stop").onclick = () => S.runId && fetch(`/api/runs/${S.runId}/stop`, { method: "POST" });
  $("#lbMax").onclick = () => { const on = document.body.classList.toggle("board-max"); $("#lbMax").textContent = on ? "⤡ BACK" : "⤢ EXPAND"; if (!on) setTimeout(buildRing, 50); };
  $("#drawer").onclick = (e) => { if (e.target === $("#drawer")) closeDrawer(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  $("#dl").onclick = () => { if (S.runId && $("#dl").classList.contains("ready")) location.href = `/api/runs/${S.runId}/excel`; };
}

// ------------------------------------------------------------------ run lifecycle
function resetRunUI() {
  S.firms.clear(); S.rows.clear(); S.orbit = []; S.judged = 0; S.judgeMs = 0; S.errors = 0; S.tasks = 0;
  S.laneCounts = { running: 0, done: 0 }; S.target = { thr: 0, lat: 0 };
  $("#rows").innerHTML = '<div class="empty" id="lbEmpty">Ranked by fit as the crew works. Click a row for the details.</div>'; $("#log").innerHTML = "";
  for (const id of ["#lbFound", "#lbScored", "#lbStrong", "#lbEmails"]) $(id).textContent = "0";
  document.querySelectorAll(".st").forEach((n) => n.classList.remove("active", "done"));
  document.querySelectorAll(".lane .lc").forEach((n) => (n.innerHTML = ""));
  document.querySelectorAll(".lane .ld").forEach((n) => (n.textContent = "0"));
  buildAgents();
  $("#dl").classList.remove("ready"); $("#dl").disabled = true;
  $("#banner").classList.remove("win");
  for (const id of ["#hFpm", "#hInf", "#hFound", "#hVer", "#hStrong", "#tTasks", "#tErr", "#bReady", "#bTotal"]) $(id).textContent = "0";
  $("#result").textContent = "RESULT · AWAITING SIGNAL";
}

async function launch() {
  const body = {
    mode: params.has("demo") ? "demo" : "live", engine: $("#engine").value, country: $("#country").value,
    types: ["Asset managers"], segments: [], roles: ["CEO", "Head of Partnerships", "Head of Distribution"],
    minAum: "auto", firms: Number($("#firms").value), minFit: Number($("#minFit").value),
    exclude: $("#exclude").value, template: $("#template").value, sender: $("#sender").value,
    localLanguage: $("#localLanguage").checked, personalize: $("#personalize").checked,
    speed: Number(params.get("speed")) || 1,
    drafts: $("#drafts").checked, claudeModel: $("#claudeModel").value,
  };
  const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) { logLine({ level: "err", agent: "pipeline", text: j.error || "Could not start" }); return; }
  connect(j.id);
}
async function startReplay(id) {
  const j = await (await fetch(`/api/replay/${id}?speed=${params.get("speed") || 4}`, { method: "POST" })).json();
  if (j.id) connect(j.id);
}

function connect(id) {
  S.es?.close();
  resetRunUI();
  S.runId = id; S.t0 = performance.now(); S.running = true;
  $("#stop").disabled = false;
  $(".track").classList.add("running");
  $("#loopState").textContent = "RUNNING";
  updateLaunch();
  brain.setEnergy(1);
  setTicker("scout", "starting up…");
  const es = new EventSource(`/api/runs/${id}/events`);
  S.es = es;
  es.onmessage = (m) => handle(JSON.parse(m.data));
}

function handle(e) {
  if (NOWRITER && (e.agent === "writer" || (e.type === "stage" && e.stage === "writer"))) return;
  switch (e.type) {
    case "run": {
      const pill = $("#modePill");
      pill.className = `pill ${e.mode}`;
      pill.textContent = e.mode === "demo" ? "DEMO · FICTIONAL DATA" : e.mode === "replay" ? `REPLAY · ${e.speed}×` : "LIVE · CLAUDE PLAN";
      const eng = S.status?.engines.find((x) => x.id === e.engine);
      $("#engineLabel").textContent = e.mode === "demo" ? "DEMO ENGINE" : (eng?.label || e.engine).toUpperCase();
      $("#coreModel").textContent = e.mode === "demo" ? "JEV (SIMULATED)" : e.engine === "openrouter" ? "JEV ROUTER" : e.engine === "claude-cli" ? "CLAUDE JUDGE" : String(e.judge || "").toUpperCase();
      $("#stackLabel").innerHTML = e.mode === "demo" ? "DEMO <em>·</em> FICTIONAL DATA" : e.engine === "openrouter" ? "JEV <em>+</em> CLAUDE OPUS 5.5" : e.engine === "claude-cli" ? `CLAUDE ${String(e.config.claudeModel || "").toUpperCase()} <em>·</em> YOUR CLAUDE PLAN` : esc(String(e.model || "").toUpperCase());
      setWriter(!!e.config.drafts);
      $("#telemetryMode").textContent = e.mode === "replay" ? "replay" : "live";
      $("#targetTag").innerHTML = `TARGET · <b>${e.country.flag} ${esc(e.country.name.toUpperCase())}</b><br>${esc(e.country.language.toUpperCase())} · ${e.config.firms} FIRMS`;
      break;
    }
    case "stage": setStation(e.stage, e.state); break;
    case "agent": setAgent(e.agent, e.status); break;
    case "task": onTask(e); break;
    case "firm": addFirm(e.firm); break;
    case "firm_update": updateFirm(e.id, e.patch); break;
    case "judge": {
      const f = S.firms.get(e.firmId);
      const r = $("#result");
      r.textContent = `RESULT · ${(f?.name || "").toUpperCase().slice(0, 22)} · FIT ${e.fit}/5 · ${Number(e.confidence).toFixed(2)}`;
      r.classList.add("flash"); setTimeout(() => r.classList.remove("flash"), 400);
      break;
    }
    case "metrics": onMetrics(e); break;
    case "activity": onActivity(e); break;
    case "log": logLine(e); break;
    case "error": logLine({ level: "err", agent: "pipeline", text: e.message }); break;
    case "done": onDone(e); break;
  }
}

function setAgent(a, status) {
  const card = document.querySelector(`.agent[data-agent="${a}"]`);
  if (card) {
    card.classList.toggle("running", status === "running");
    card.classList.toggle("done", status === "done");
    card.querySelector(".astat").textContent = status.toUpperCase();
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
  } else {
    st.inflight = Math.max(0, st.inflight - 1);
    S.laneCounts.running = Math.max(0, S.laneCounts.running - 1);
    S.tasks++;
    if (e.state === "error") { S.errors++; $("#tErr").textContent = S.errors; }
    else { st.done++; S.laneCounts.done++; }
    st.ms += e.ms || 0;
    st.bars.push(Math.min(34, 4 + (e.ms || 0) / 120)); st.bars = st.bars.slice(-14);
    const tsec = ((performance.now() - S.t0) / 1000).toFixed(1);
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
  $("#laneStats").textContent = `${S.laneCounts.running} run · ${S.laneCounts.done} done · ${S.errors} err`;
  if (CARD_AGENTS.includes(a)) renderCard(a);
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
  logLine({ level: "info", agent: a, text: `▸ ${label}` });
  const st = S.stats[a];
  if (st) {
    const tsec = ((performance.now() - S.t0) / 1000).toFixed(1);
    st.lines.unshift(`<span class="t">t+${tsec}</span> <span class="act">${esc(e.text)}</span>`);
    st.lines = st.lines.slice(0, 3);
    if (CARD_AGENTS.includes(a)) renderCard(a);
  }
  if (/^search|^read/.test(e.text)) brain.pulse(AGENTS[a]?.color || "#2cf5b5");
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
  S.firms.set(f.id, { ...f, angle: hashAngle(f.id), seq: S.firms.size });
  $("#lbEmpty")?.remove();
  const row = el("div", "tr");
  row.dataset.id = f.id;
  row.onclick = () => openDrawer(f.id);
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
  if ($("#drawer").dataset.id === id && !$("#drawer").hidden) openDrawer(id);
}
function rankAll() {
  const list = [...S.firms.values()].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || (b.fitConfidence ?? 0) - (a.fitConfidence ?? 0) || a.seq - b.seq);
  list.forEach((f, i) => { const r = S.rows.get(f.id); if (r) { r.style.order = String(i); const n = r.querySelector(".rk"); if (n) n.textContent = String(i + 1).padStart(2, "0"); } });
}
function boardStats() {
  const all = [...S.firms.values()];
  $("#lbFound").textContent = all.length;
  $("#lbScored").textContent = all.filter((f) => f.fit != null).length;
  $("#lbStrong").textContent = all.filter((f) => (f.fit ?? 0) >= 4).length;
  $("#lbEmails").textContent = all.filter((f) => f.email && f.emailStatus !== "No mail server").length;
  rankAll();
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
  const person = f.contactName ? `<span class="c2"><span>${esc(f.contactName)}</span><span class="sub" title="${esc(f.contactTitle)}">${esc(f.contactTitle)}</span></span>`
    : `<span class="mute">${f.status === "Not a fit" ? "skipped" : f.fit == null ? "…" : "finding…"}</span>`;
  const email = f.email ? `<span class="c2"><span class="em" title="${esc(f.email)}">${esc(f.email)}</span><span class="sub">${chip(f.emailStatus)}<span class="pat">${esc(f.emailPattern || "")}</span></span></span>`
    : `<span class="c2"><span class="em none">${f.emailStatus ? "no email" : f.status === "Not a fit" ? "—" : "…"}</span><span class="sub">${f.emailStatus ? chip(f.emailStatus) : ""}</span></span>`;
  const copy = f.email ? `<button class="copy" title="Copy email">⧉</button>` : "<span></span>";
  row.innerHTML = `<span class="mute rk">··</span>${firm}${inv}<span>${fitCell}</span>${person}${email}${copy}`;
  const cb = row.querySelector(".copy");
  if (cb) cb.onclick = (ev) => { ev.stopPropagation(); navigator.clipboard?.writeText(f.email).then(() => { cb.classList.add("done"); cb.textContent = "✓"; setTimeout(() => { cb.classList.remove("done"); cb.textContent = "⧉"; }, 1200); }).catch(() => {}); };
  rankAll();
}
const link = (u, t) => /^https?:\/\//.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t || u)}</a>` : esc(t || u || "—");
function openDrawer(id) {
  const f = S.firms.get(id);
  if (!f) return;
  const d = $("#drawer");
  d.dataset.id = id;
  const conf = f.fitConfidence != null ? `${Math.round(f.fitConfidence * 100)}% sure` : "";
  const ekey = { Verified: "checked by Hunter", Published: "seen on a public page", Inferred: "built from the firm's email pattern", Guess: "common format, no example found - check before sending", "No mail server": "the domain doesn't accept email" }[f.emailStatus] || "";
  $("#drawerCard").innerHTML = `<button class="dr-close" title="Close">✕</button>
    <div class="dr-top"><div><div class="dr-name">${esc(f.name)}</div><div class="dr-sub">${esc([f.type, f.city, f.country].filter(Boolean).join(" · "))} · ${link(f.website)}</div></div>
      <div class="dr-fit"><b class="fitn ${(f.fit ?? 0) >= 4 ? "" : f.fit === 3 ? "mid" : "low"}">${f.fit ?? "–"}<small style="font-size:13px">/5</small></b><span>FIT ${esc(conf)}</span></div></div>
    <div class="dr-sec"><div class="dr-k">WHY</div><div class="dr-v">${esc(f.why || "Scoring…")}</div></div>
    <div class="dr-sec dr-grid">
      <div><div class="dr-k">ASSETS UNDER MANAGEMENT</div><div class="dr-v">${esc(f.aum || "—")}</div></div>
      <div><div class="dr-k">INVESTS IN</div><div class="dr-v">${esc(f.assetClasses || "—")}</div></div>
      <div><div class="dr-k">CLIENTS</div><div class="dr-v">${esc(f.segment || "—")}</div></div>
      <div><div class="dr-k">GLOBAL EQUITY TODAY</div><div class="dr-v">${esc(f.globalEquity || "—")}${f.globalEquityEvidence ? ` · ${esc(f.globalEquityEvidence)}` : ""}</div></div>
    </div>
    <div class="dr-sec"><div class="dr-k">DECISION-MAKER</div><div class="dr-v">${esc(f.contactName || "—")}${f.contactTitle ? ` · ${esc(f.contactTitle)}` : ""}${f.linkedin ? ` · ${link(f.linkedin, "LinkedIn")}` : ""}</div></div>
    <div class="dr-sec"><div class="dr-k">EMAIL</div><div class="dr-v">${f.email ? `<span class="dr-email">${esc(f.email)}</span>${chip(f.emailStatus)}${f.emailScore != null ? `${esc(String(f.emailScore))}% confidence` : ""}` : "—"}
      ${ekey ? `<br><span class="mute">${esc(ekey)}</span>` : ""}${f.emailPattern ? `<br>Pattern: <b>${esc(f.emailPattern)}</b>` : ""}${f.emailEvidence ? `<br>Evidence: ${esc(f.emailEvidence)}` : ""}</div></div>
    ${f.news ? `<div class="dr-sec"><div class="dr-k">RECENT NEWS</div><div class="dr-v">${esc(f.news)}</div></div>` : ""}
    <div class="dr-sec"><div class="dr-k">SOURCE</div><div class="dr-v">${esc(f.source || "")} ${f.sourceUrl ? `· ${link(f.sourceUrl, "link")}` : ""}</div></div>`;
  $("#drawerCard .dr-close").onclick = closeDrawer;
  d.hidden = false;
}
function closeDrawer() { $("#drawer").hidden = true; }
function hashAngle(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 3600) / 3600 * Math.PI * 2; }

function onMetrics(m) {
  S.metrics = m;
  $("#hFpm").textContent = Number(m.firmsPerMin || 0).toFixed(1);
  $("#hInf").textContent = m.inFlight ?? 0;
  $("#hVer").textContent = m.emails ?? m.verified ?? 0;
  $("#hStrong").textContent = [...S.firms.values()].filter((f) => (f.fit ?? 0) >= 4).length;
  $("#bReady").textContent = m.meetingReady ?? 0;
  S.target.thr = Number(m.firmsPerMin || 0);
  S.target.lat = Number(m.latencyMs || 0) / 1000;
}

function onDone(e) {
  S.running = false;
  clearTimeout(tickerIdle);
  setTicker(null, e.summary?.stopped ? "stopped" : `done · ${e.summary?.firms ?? 0} firms · ${S.metrics.emails ?? 0} emails · Excel ready`, false);
  $("#stop").disabled = true;
  $(".track").classList.remove("running");
  $("#loopState").textContent = e.summary?.stopped ? "STOPPED" : "COMPLETE";
  document.querySelectorAll(".st").forEach((n) => { n.classList.remove("active"); n.classList.add("done"); });
  $("#dl").classList.add("ready"); $("#dl").disabled = false;
  $("#banner").classList.add("win");
  brain.setEnergy(0.35);
  for (let i = 0; i < 8; i++) setTimeout(() => brain.pulse(["#2cf5b5", "#ffb23f", "#b48cff", "#5aa9ff"][i % 4]), i * 140);
  CARD_AGENTS.forEach((a) => setAgent(a, "done"));
  updateLaunch();
  setTimeout(loadStatus, 1500);
}

function logLine(e) {
  const box = $("#log");
  const A = AGENTS[e.agent];
  const t = S.t0 ? ((performance.now() - S.t0) / 1000).toFixed(1) : "0.0";
  const line = el("div", e.level, `<span class="t">t+${t.padStart(5, " ")}</span> <span class="ag" style="color:${A?.color || "var(--g)"}">${(A?.name || e.agent.toUpperCase()).padEnd(6, " ")}</span> ${esc(e.text)}`);
  box.append(line);
  while (box.children.length > 60) box.firstChild.remove();
}

// ------------------------------------------------------------------ ring + orbit labels
const ring = { cx: 0, cy: 0, r: 0 };
function buildRing() {
  const stage = $("#stage");
  const w = stage.clientWidth, h = stage.clientHeight;
  ring.cx = w / 2; ring.cy = h / 2; ring.r = Math.min(w, h) * 0.5 * 0.8;
  const { cx, cy, r } = ring;
  let ticks = "";
  for (let d = 0; d < 360; d += 3) {
    const major = d % 15 === 0, a = (d * Math.PI) / 180, l = major ? 9 : 4;
    ticks += `<line class="tick${major ? " major" : ""}" x1="${cx + Math.cos(a) * r}" y1="${cy + Math.sin(a) * r}" x2="${cx + Math.cos(a) * (r - l)}" y2="${cy + Math.sin(a) * (r - l)}"/>`;
    if (d % 30 === 0) ticks += `<text x="${cx + Math.cos(a) * (r + 12)}" y="${cy + Math.sin(a) * (r + 12) + 3}" text-anchor="middle">${d}°</text>`;
  }
  const links = { scout: 225, analyst: 315, finder: 135, writer: 45 };
  let linkPaths = "";
  const srect = stage.getBoundingClientRect();
  for (const [a, deg] of Object.entries(links)) {
    const card = document.querySelector(`.agent[data-agent="${a}"]`);
    if (!card) continue;
    const b = card.getBoundingClientRect();
    const x = (deg === 225 || deg === 135 ? b.right : b.left) - srect.left;
    const y = (deg === 225 || deg === 315 ? b.bottom : b.top) - srect.top;
    const ar = (deg * Math.PI) / 180, px = cx + Math.cos(ar) * r, py = cy + Math.sin(ar) * r;
    linkPaths += `<path class="link" data-agent="${a}" d="M${x} ${y} L${(x + px) / 2} ${y} L${px} ${py}"/><circle cx="${px}" cy="${py}" r="2.5" fill="${AGENTS[a].color}" opacity=".8"/>`;
  }
  $("#ring").setAttribute("viewBox", `0 0 ${w} ${h}`);
  $("#ring").innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(60,255,196,0.28)"/>
    <g class="spin" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="${r - 16}" fill="none" stroke="rgba(60,255,196,0.16)" stroke-dasharray="2 7"/>
      <path d="M${cx + r - 16} ${cy} A ${r - 16} ${r - 16} 0 0 1 ${cx} ${cy + r - 16}" fill="none" stroke="rgba(60,255,196,0.55)" stroke-width="1.5"/></g>
    <g class="spin rev" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="${r + 26}" fill="none" stroke="rgba(60,255,196,0.1)" stroke-dasharray="14 10"/></g>
    ${ticks}${linkPaths}`;
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
  drawRadar(dt);
  S.orbit.forEach((o, i) => {
    o.angle += dt * 0.12;
    const n = document.getElementById(`ol-${i}`);
    if (n) { n.style.left = `${ring.cx + Math.cos(o.angle) * ring.r}px`; n.style.top = `${ring.cy + Math.sin(o.angle) * ring.r}px`; n.style.opacity = String(Math.max(0.35, 1 - (now - o.born) / 20000)); }
  });
  if (S.running) $("#tElapsed").textContent = ((now - S.t0) / 1000).toFixed(1);
  requestAnimationFrame(tick);
}
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("en-GB"); }, 1000);

// ------------------------------------------------------------------ boot
async function boot() {
  const lines = [
    "> init agent loop ................ ok",
    "> crew: ATLAS · SAGE · JEV · HOUND",
    "> engine: claude code ............ " + (S.status.engines.find((e) => e.id === "claude-cli")?.ok ? "signed in" : "NOT FOUND"),
    "> judge core ..................... linked",
    "> loading cortex mesh ............ 94 slices",
    "> ready.",
  ];
  const log = $("#bootlog");
  if (params.has("noboot")) { $("#boot").classList.add("gone"); return; }
  for (const l of lines) {
    log.textContent += l + "\n";
    $("#bootbar").style.width = `${Math.max(brain.progress(), lines.indexOf(l) / lines.length) * 100}%`;
    await new Promise((r) => setTimeout(r, 260));
  }
  $("#bootbar").style.width = "100%";
  await new Promise((r) => setTimeout(r, 250));
  $("#boot").classList.add("gone");
}


(async function main() {
  buildStations(); buildAgents(); buildLanes(); initForm();
  await loadStatus();
  buildRing();
  new ResizeObserver(buildRing).observe($("#stage"));
  requestAnimationFrame(tick);
  await boot();
  if (params.get("autorun") === "demo" || params.get("autorun") === "live") setTimeout(launch, 300);
  if (params.get("replay")) setTimeout(() => startReplay(params.get("replay")), 300);
})();
