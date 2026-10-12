// @ts-check
import "./lib/env.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRIES, getCountry } from "./lib/countries.js";
import { Run, listSavedRuns, loadSavedRun } from "./lib/run.js";
import { runPipeline } from "./lib/pipeline.js";
import { buildWorkbook, buildCsv } from "./lib/excel.js";
import { getEngineStatuses, MODELS } from "./lib/llm.js";
import { integrationStatus, saveIntegration, testIntegration } from "./lib/integrations.js";
import { getMcpStatus, setupMcp } from "./lib/mcp.js";
import { estimateRun } from "./lib/estimate.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const ROLES = ["CEO", "Head of Wealth", "Head of Partnerships", "CIO", "Head of Distribution", "Head of Investments", "Business Development"];
export const TYPES = ["Private banks", "Wealth managers", "Brokerages", "Asset managers", "Digital investment platforms", "Insurers", "Family offices"];
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
export function normalizeConfig(body) {
  const selected = (value, allowed, defaults) => Array.isArray(value) ? [...new Set(value.filter((item) => allowed.includes(item)))] : defaults;
  const types = selected(body.types, TYPES, ["Asset managers"]), roles = selected(body.roles, ROLES, ["CEO", "Head of Partnerships", "Head of Distribution"]);
  return {
    types: types.length ? types : ["Asset managers"], roles: roles.length ? roles : ["CEO", "CIO", "Head of Distribution"],
    segments: selected(body.segments, ["Retail", "Affluent", "HNW", "Institutional"], []), minAum: String(body.minAum || "auto").slice(0, 80),
    firms: Math.round(bounded(body.firms ?? 15, 15, 3, 100)), contactsPerFirm: Math.round(bounded(body.contactsPerFirm ?? 3, 3, 1, 8)),
    researchDepth: body.researchDepth === "deep" ? "deep" : "balanced", minFit: Math.round(bounded(body.minFit ?? 3, 3, 1, 5)),
    exclude: String(body.exclude || "").slice(0, 2000), template: String(body.template || "").slice(0, 4000), sender: String(body.sender || "").slice(0, 120),
    researchBrief: String(body.researchBrief || "").trim().slice(0, 2000),
    localLanguage: body.localLanguage !== false, personalize: body.personalize !== false, spendCap: bounded(body.spendCap ?? 3, 3, 0.5, 20),
    speed: bounded(body.speed ?? 1, 1, 0.5, 20), drafts: body.drafts === true, claudeModel: body.claudeModel === "opus" ? "opus" : "sonnet",
    useIntegrations: body.useIntegrations !== false,
    integrations: Object.fromEntries(integrationStatus().integrations.map((item) => [item.id, item.connected && body.useIntegrations !== false])),
  };
}
export function createApp() {
  const app = express();
  /** @type {Map<string, Run>} */
  const runs = new Map();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (req.get("sec-fetch-site") === "cross-site" || (origin && origin !== `${req.protocol}://${req.get("host")}`)) return res.status(403).json({ error: "Use Partner Radar from its local dashboard" });
    next();
  });
  app.use(express.json({ limit: "200kb" }));
  app.use(express.static(path.join(ROOT, "public")));
  function findRun(id) { if (runs.has(id)) return runs.get(id); const saved = loadSavedRun(id); if (saved) runs.set(id, saved); return saved; }
  app.get("/api/status", async (req, res) => {
    const statuses = await getEngineStatuses({ refresh: req.query.refresh === "1" });
    res.json({ engines: Array.isArray(statuses) ? statuses : Object.entries(statuses).map(([id, item]) => ({ id, ...item })), extras: { hunter: !!process.env.HUNTER_API_KEY, apollo: !!process.env.APOLLO_API_KEY, firecrawl: !!process.env.FIRECRAWL_API_KEY }, countries: COUNTRIES, replays: listSavedRuns().slice(0, 12) });
  });
  app.get("/api/integrations", (_req, res) => res.json(integrationStatus()));
  app.put("/api/integrations/:id", (req, res) => { try { res.json(saveIntegration(req.params.id, req.body?.apiKey)); } catch (error) { res.status(400).json({ error: error.message }); } });
  app.delete("/api/integrations/:id", (req, res) => { try { res.json(saveIntegration(req.params.id, "")); } catch (error) { res.status(400).json({ error: error.message }); } });
  app.post("/api/integrations/:id/test", async (req, res) => { try { res.json(await testIntegration(req.params.id)); } catch (error) { res.status(400).json({ error: error.message }); } });
  app.get("/api/mcp", async (_req, res) => res.json(await getMcpStatus()));
  const estimate = (req, res) => { const body = req.method === "GET" ? { ...req.query, drafts: req.query.drafts === "true" || req.query.drafts === "1" } : req.body || {}; const config = normalizeConfig(body); res.json(estimateRun(config, String(body.engine || "codex-cli"), body.mode === "demo" ? "demo" : "live")); };
  app.get("/api/estimate", estimate);
  app.post("/api/estimate", estimate);
  app.post("/api/mcp/:provider/:id/setup", async (req, res) => { try { res.json(await setupMcp(req.params.provider, req.params.id)); } catch (error) { res.status(400).json({ error: error.message }); } });
  app.post("/api/runs", async (req, res) => {
    const body = req.body || {};
    if (body.mode && !["live", "demo"].includes(body.mode)) return res.status(400).json({ error: "Choose live or demo mode" });
    const mode = body.mode === "demo" ? "demo" : "live", engine = mode === "live" ? String(body.engine || "") : "demo";
    const countryCode = String(body.country || "BR").toUpperCase();
    if (!COUNTRIES.some((country) => country.code === countryCode)) return res.status(400).json({ error: "Select a valid country" });
    if ([...runs.values()].filter((run) => !run.done).length >= 2) return res.status(409).json({ error: "Two runs are already active. Stop or finish one first." });
    if (mode === "live") {
      const statuses = await getEngineStatuses();
      const status = Array.isArray(statuses) ? statuses.find((item) => item.id === engine) : statuses[engine];
      if (!status?.ok) return res.status(400).json({ error: status?.message || "Select an installed and signed-in provider" });
    }
    if ([...runs.values()].filter((run) => !run.done).length >= 2) return res.status(409).json({ error: "Two runs are already active. Stop or finish one first." });
    const config = normalizeConfig(body), country = getCountry(countryCode), run = new Run({ mode, engine, config, country });
    runs.set(run.id, run);
    const model = mode === "demo" ? "demo" : engine === "claude-cli" ? config.claudeModel : MODELS[engine]?.brain || "Provider default";
    run.emit("run", { id: run.id, mode, engine, config, country, model, judge: model, estimate: run.estimate });
    runPipeline(run).catch((error) => { run.log("err", "pipeline", String(error?.message || error)); run.done = true; run.emit("done", { failed: !run.aborted, stopped: run.aborted, state: run.aborted ? "stopped" : "failed", outcome: run.aborted ? "stopped" : "failed", partial: !!run.firms.size, error: String(error?.message || error), firms: run.firms.size }); });
    res.json({ id: run.id });
  });
  app.get("/api/runs/:id", (req, res) => { const run = findRun(req.params.id); if (!run) return res.status(404).json({ error: "Run not found" }); res.json(run.snapshot()); });
  app.post("/api/replay/:id", (req, res) => {
    const original = findRun(req.params.id);
    if (!original) return res.status(404).json({ error: "Run not found" });
    if (!original.done) return res.status(409).json({ error: "This run is still active" });
    const events = [...original.events], speed = bounded(req.query.speed ?? 4, 4, 1, 20), run = new Run({ mode: "replay", engine: original.engine, config: original.config, country: original.country });
    runs.set(run.id, run); run.emit("run", { ...events[0], id: run.id, mode: "replay", replayOf: original.id, speed });
    (async () => {
      let last = 0;
      for (const event of events.slice(1)) {
        if (run.aborted) break;
        const wait = Math.max(0, Math.min(1000, (event.t - last) / speed)); last = event.t;
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        const { t, seq, type, ...data } = event;
        if (type === "firm") run.firms.set(data.firm.id, { ...data.firm });
        if (type === "firm_update") Object.assign(run.firms.get(data.id) || {}, data.patch);
        if (type === "metrics") Object.assign(run.metrics, data);
        run.emit(type, data);
      }
      run.done = true; if (run.aborted) run.emit("done", { stopped: true, state: "stopped" });
    })().catch((error) => { run.done = true; run.emit("done", { failed: true, error: error.message }); });
    res.json({ id: run.id });
  });
  app.get("/api/runs/:id/events", (req, res) => {
    const run = findRun(req.params.id); if (!run) return res.status(404).json({ error: "Run not found" });
    const after = Number(req.get("last-event-id") || 0);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }); res.flushHeaders();
    const off = run.subscribe((event) => res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`), Number.isFinite(after) ? after : 0);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000); req.on("close", () => { off(); clearInterval(ping); });
  });
  app.post("/api/runs/:id/stop", (req, res) => { const run = runs.get(req.params.id); if (!run) return res.status(404).json({ error: "Run not found" }); run.stop(); res.json({ ok: true }); });
  const exportName = (run, extension) => `Partner-Radar_${run.country.code}_${new Date().toISOString().slice(0, 10)}${run.mode === "demo" ? "_DEMO" : ""}.${extension}`;
  app.get("/api/runs/:id/excel", async (req, res) => { const run = findRun(req.params.id); if (!run) return res.status(404).json({ error: "Run not found" }); res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${exportName(run, "xlsx")}"` }); await (await buildWorkbook(run)).xlsx.write(res); res.end(); });
  app.get("/api/runs/:id/csv", (req, res) => { const run = findRun(req.params.id); if (!run) return res.status(404).json({ error: "Run not found" }); res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${exportName(run, "csv")}"` }); res.send(buildCsv(run)); });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status === 400 ? "Invalid JSON request" : "Request could not be completed" }));
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4747, host = process.env.HOST || "127.0.0.1";
  const server = createApp().listen(port, host, () => console.log(`\n  PARTNER RADAR → http://localhost:${port}\n  Choose Codex or Claude, then connect optional data sources in the dashboard.\n`));
  server.on("error", (error) => { console.error(`Could not start Partner Radar: ${error.message}`); process.exitCode = 1; });
}
