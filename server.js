// @ts-check
// Partner Radar - local server. Serves the dashboard, runs the agent pipeline,
// streams progress over Server-Sent Events and hands back the Excel sheet.
import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { dirname as _dirname, join as _join } from "node:path";
import { fileURLToPath as _f2p } from "node:url";

// Load optional .env (Hunter key etc.) without needing a recent Node flag.
{
  const envFile = _join(_dirname(_f2p(import.meta.url)), ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(#.*)?$/);
      if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRIES, getCountry } from "./lib/countries.js";
import { Run, RUNS_DIR, listSavedRuns } from "./lib/run.js";
import { runPipeline } from "./lib/pipeline.js";
import { buildWorkbook } from "./lib/excel.js";
import { detectEngines, ENGINE_LABELS, MODELS } from "./lib/llm.js";

const PORT = Number(process.env.PORT) || 4747;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(ROOT, "public")));
app.use("/vendor/three", express.static(path.join(ROOT, "node_modules/three")));

/** @type {Map<string, Run>} */
const runs = new Map();

let budgetCache = { at: 0, value: /** @type {any} */ (null) };
async function openRouterBudget() {
  if (!process.env.OPENROUTER_API_KEY) return null;
  if (Date.now() - budgetCache.at < 30000) return budgetCache.value;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
    const d = (await r.json()).data;
    budgetCache = { at: Date.now(), value: { limit: d.limit, remaining: d.limit_remaining, usage: d.usage } };
  } catch { /* offline */ }
  return budgetCache.value;
}

app.get("/api/status", async (_req, res) => {
  const engines = detectEngines();
  res.json({
    engines: Object.entries(engines).map(([id, ok]) => ({ id, ok, label: ENGINE_LABELS[id], model: MODELS[id].brain, judge: MODELS[id].judge })),
    extras: { firecrawl: !!process.env.FIRECRAWL_API_KEY, hunter: !!process.env.HUNTER_API_KEY, jev: !!process.env.TYPESAFE_API_KEY || engines.openrouter },
    budget: await openRouterBudget(),
    countries: COUNTRIES,
    replays: listSavedRuns().slice(0, 8),
  });
});

const ROLES = ["CEO", "Head of Wealth", "Head of Partnerships", "CIO", "Head of Distribution"];
const TYPES = ["Private banks", "Wealth managers", "Brokerages", "Asset managers", "Digital investment platforms", "Insurers"];

app.post("/api/runs", (req, res) => {
  const b = req.body ?? {};
  const engines = detectEngines();
  const mode = b.mode === "live" ? "live" : "demo";
  const engine = mode === "live" ? String(b.engine || "") : "demo";
  if (mode === "live" && !engines[engine]) return res.status(400).json({ error: `Engine ${engine} is not available on this machine` });
  const config = {
    types: (Array.isArray(b.types) ? b.types : []).filter((t) => TYPES.includes(t)).slice(0, 6),
    segments: (Array.isArray(b.segments) ? b.segments : ["Retail", "Affluent"]).map(String).slice(0, 4),
    roles: (Array.isArray(b.roles) ? b.roles : ["CEO"]).filter((r) => ROLES.includes(r)),
    minAum: String(b.minAum || "Any"),
    firms: Math.max(3, Math.min(40, Number(b.firms) || 15)),
    minFit: Math.max(1, Math.min(5, Number(b.minFit) || 3)),
    exclude: String(b.exclude || "").slice(0, 2000),
    template: String(b.template || "").slice(0, 4000),
    sender: String(b.sender || "").slice(0, 120),
    localLanguage: b.localLanguage !== false,
    personalize: b.personalize !== false,
    spendCap: Math.max(0.5, Math.min(20, Number(b.spendCap) || 3)),
    speed: Math.max(0.5, Math.min(8, Number(b.speed) || 1)),
    drafts: b.drafts === true,
    claudeModel: b.claudeModel === "opus" ? "opus" : "sonnet",
  };
  config.types = ["Asset managers"];
  if (!config.roles.length) config.roles = ["CEO", "Head of Partnerships", "Head of Distribution"];
  const country = getCountry(String(b.country || "BR"));
  const run = new Run({ mode, engine, config, country });
  runs.set(run.id, run);
  run.emit("run", { id: run.id, mode, engine, config, country, model: mode === "live" ? MODELS[engine]?.brain : "demo", judge: mode === "live" ? MODELS[engine]?.judge : "demo" });
  runPipeline(run).catch((e) => run.emit("error", { message: String(e?.message || e) }));
  res.json({ id: run.id });
});

app.post("/api/replay/:id", (req, res) => {
  const file = path.join(RUNS_DIR, `${path.basename(req.params.id)}.jsonl`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Run not found" });
  const events = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const first = events[0];
  const speed = Math.max(1, Math.min(20, Number(req.query.speed) || 4));
  const run = new Run({ mode: "replay", engine: first.engine, config: first.config, country: first.country });
  runs.set(run.id, run);
  run.emit("run", { ...first, id: run.id, mode: "replay", replayOf: req.params.id, speed });
  (async () => {
    let last = 0;
    for (const e of events.slice(1)) {
      if (run.aborted) break;
      const wait = Math.min(4000, (e.t - last) / speed);
      last = e.t;
      if (wait > 4) await new Promise((r) => setTimeout(r, wait));
      const { t, type, ...data } = e;
      if (type === "firm") run.firms.set(data.firm.id, { ...data.firm });
      if (type === "firm_update") Object.assign(run.firms.get(data.id) ?? {}, data.patch);
      if (type === "metrics") Object.assign(run.metrics, data);
      run.emit(type, data);
    }
    run.done = true;
  })();
  res.json({ id: run.id });
});

app.get("/api/runs/:id/events", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const off = run.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { off(); clearInterval(ping); });
});

app.post("/api/runs/:id/stop", (req, res) => {
  runs.get(req.params.id)?.stop();
  res.json({ ok: true });
});

app.get("/api/runs/:id/excel", async (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).end();
  const wb = await buildWorkbook(run);
  const name = `Partner-Radar_${run.country.name.replace(/\s+/g, "-")}_${new Date().toISOString().slice(0, 10)}${run.mode === "demo" ? "_DEMO" : ""}.xlsx`;
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"` });
  await wb.xlsx.write(res);
  res.end();
});

app.listen(PORT, HOST, () => {
  const e = detectEngines();
  console.log(`\n  PARTNER RADAR  →  http://localhost:${PORT}\n`);
  console.log(`  engines: ${Object.entries(e).map(([k, v]) => `${k} ${v ? "✓" : "·"}`).join("   ")}`);
  console.log(`  extras:  hunter ${process.env.HUNTER_API_KEY ? "✓" : "·"}   firecrawl ${process.env.FIRECRAWL_API_KEY ? "✓" : "·"}   jev ${process.env.TYPESAFE_API_KEY || e.openrouter ? "✓" : "·"}\n`);
});
