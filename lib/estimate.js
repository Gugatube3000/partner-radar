// @ts-check
// Planning ranges, calibrated with successful local task timings when available.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DEFAULT_SECONDS = { scout: 55, analyst: 45, judge: 18, finder: 65, writer: 22 };
const median = (values) => { const ordered = [...values].sort((a, b) => a - b); return ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0; };
const finite = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
let historyCache = new Map();

/** Inspect only local timing metadata; personal records never leave this computer. */
export function historicalTimings(engine, directory = process.env.PARTNER_RADAR_RUNS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runs")) {
  const key = `${directory}:${engine}`;
  const cached = historyCache.get(key);
  if (cached?.until > Date.now()) return cached.value;
  const samples = Object.fromEntries(Object.keys(DEFAULT_SECONDS).map((name) => [name, []]));
  try {
    const files = fs.readdirSync(directory).filter((name) => /^[a-f0-9]{8,16}\.jsonl$/.test(name))
      .map((name) => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime).slice(0, 20);
    for (const { name } of files) {
      const file = path.join(directory, name);
      if (fs.statSync(file).size > 8000000) continue;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
      let first;
      try { first = JSON.parse(lines[0]); } catch { continue; }
      if (first.mode !== "live" || first.engine !== engine) continue;
      for (const line of lines.slice(1)) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === "task" && event.state === "done" && Object.hasOwn(samples, event.agent) && event.ms >= 2000 && event.ms <= 600000) samples[event.agent].push(event.ms / 1000);
      }
    }
  } catch { /* A first launch or unavailable history uses planning assumptions. */ }
  const count = Object.values(samples).reduce((sum, values) => sum + values.length, 0);
  const value = { samples: count, durations: Object.fromEntries(Object.entries(samples).filter(([, values]) => values.length >= 3).map(([agent, values]) => [agent, median(values)])) };
  historyCache.set(key, { until: Date.now() + 60000, value });
  return value;
}

export function formatDurationRange(lowSeconds, highSeconds) {
  if (highSeconds < 90) return `About ${Math.max(1, Math.round(lowSeconds))}–${Math.max(2, Math.round(highSeconds))} seconds`;
  const low = Math.max(1, Math.floor(lowSeconds / 60)), high = Math.max(low + 1, Math.ceil(highSeconds / 60));
  if (high >= 120) return `About ${(low / 60).toFixed(1)}–${(high / 60).toFixed(1)} hours`;
  return `About ${low}–${high} minutes`;
}

/** @param {any} config @param {string} [engine] @param {string} [mode] @param {any} [timings] */
export function estimateRun(config = {}, engine = "codex-cli", mode = "live", timings = historicalTimings(engine)) {
  const firms = Math.round(finite(config.firms ?? 8, 8, 3, 100)), people = Math.round(finite(config.contactsPerFirm ?? 3, 3, 1, 8));
  const deep = config.researchDepth === "deep", demo = mode === "demo";
  const concurrency = demo ? 4 : ["codex-cli", "claude-cli"].includes(engine) ? 2 : 4;
  const depthFactor = deep ? 1.45 : 1;
  const modelFactor = engine === "claude-cli" && config.claudeModel === "opus" ? 1.35 : 1;
  const durations = Object.fromEntries(Object.entries(DEFAULT_SECONDS).map(([agent, seconds]) => [agent, (timings.durations?.[agent] || seconds * modelFactor) * (agent === "judge" || agent === "writer" ? 1 : depthFactor)]));
  const additionalPasses = 0.25 + (people - 1) * 0.12 + (deep ? 0.2 : 0);
  const scoutPasses = deep ? 2.2 : 1.5;
  const stages = { analyst: durations.analyst + (deep ? 20 : 12), judge: durations.judge, finder: durations.finder * (1 + additionalPasses) + people * (config.integrations?.hunter ? 8 : 2), writer: config.drafts ? durations.writer : 0 };
  const perFirm = Object.values(stages).reduce((sum, seconds) => sum + seconds, 0);
  const demoFirmSeconds = 2.4 + 0.37 + 1.6 + 0.25 + (config.drafts ? 1.4 : 0);
  const seconds = demo ? (3.8 + Math.ceil(firms / 4) * demoFirmSeconds) / finite(config.speed ?? 1, 1, 0.5, 20) : durations.scout * scoutPasses + Math.ceil(firms / concurrency) * perFirm;
  const lowSeconds = Math.max(demo ? 1 : 30, seconds * (demo ? 0.8 : 0.65));
  const highSeconds = Math.max(lowSeconds + (demo ? 1 : 45), seconds * (demo ? 1.5 : 1.65));
  return {
    lowSeconds: Math.round(lowSeconds), highSeconds: Math.round(highSeconds), lowMinutes: +(lowSeconds / 60).toFixed(1), highMinutes: +(highSeconds / 60).toFixed(1),
    label: formatDurationRange(lowSeconds, highSeconds), estimatedCalls: demo ? 0 : Math.ceil(scoutPasses + firms * (3 + additionalPasses + (config.drafts ? 1 : 0))), concurrency,
    historicalSamples: demo ? 0 : timings.samples || 0,
    basis: demo ? "Fictional demo; no subscription or data-service calls." : timings.samples >= 6 && Object.keys(timings.durations || {}).length ? `Approximate range informed by ${timings.samples} successful calls in local run history. Sources and plan limits can change the time.` : "Approximate planning range. It will update as work finishes; slow websites, missing evidence or plan limits can add time.",
    stages, scoutSeconds: durations.scout * scoutPasses, estimatedSeconds: seconds, people, firms,
  };
}

/** Remaining work follows actual pipeline stages rather than a promised countdown. */
export function estimateRemaining(run, now = Date.now()) {
  const firms = [...run.firms.values()];
  const completedFirms = firms.filter((firm) => firm.stage === "done").length;
  const totalFirms = firms.length || run.config.firms || 0;
  if (run.done || run.aborted) return { etaLowMinutes: 0, etaHighMinutes: 0, completedFirms, totalFirms, progressPercent: run.done && !run.aborted ? 100 : totalFirms ? Math.round(100 * completedFirms / totalFirms) : 0 };
  const estimate = run.estimate || estimateRun(run.config, run.engine, run.mode);
  if (run.mode === "demo" || run.mode === "replay") {
    const remaining = Math.max(0, estimate.estimatedSeconds - (now - run.startedAt) / 1000);
    return { etaLowMinutes: +(remaining * 0.65 / 60).toFixed(1), etaHighMinutes: +(Math.max(remaining * 1.65, firms.some((firm) => firm.stage !== "done") ? 1 : 0) / 60).toFixed(1), completedFirms, totalFirms, progressPercent: totalFirms ? Math.min(99, Math.round(100 * completedFirms / totalFirms)) : 0 };
  }
  const stages = ["analyst", "judge", "finder", "verify", "writer"];
  const weights = { analyst: estimate.stages.analyst, judge: estimate.stages.judge, finder: estimate.stages.finder * 0.85, verify: estimate.stages.finder * 0.15, writer: estimate.stages.writer };
  let work = firms.length ? 0 : Math.max(estimate.scoutSeconds * 0.25, estimate.estimatedSeconds - (now - run.startedAt) / 1000);
  let all = 0;
  const remainingByFirm = [];
  for (const firm of firms) {
    all += Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    if (firm.stage === "done") continue;
    const current = Math.max(0, stages.indexOf(firm.stage));
    let firmWork = 0;
    for (let index = current; index < stages.length; index++) firmWork += weights[stages[index]];
    remainingByFirm.push(firmWork);
    work += firmWork;
  }
  const observed = run.metrics.latencyMs / 1000;
  const reference = (estimate.stages.analyst + estimate.stages.judge + estimate.stages.finder) / 3;
  const pace = run.metrics.calls >= 4 && observed >= 2 ? Math.min(2.5, Math.max(0.6, observed / reference)) : 1;
  const parallelism = Math.min(estimate.concurrency, Math.max(1, remainingByFirm.length));
  const seconds = firms.length ? Math.max(work / parallelism, ...remainingByFirm, 0) * pace : work;
  return { etaLowMinutes: Math.max(0.1, +(seconds * 0.65 / 60).toFixed(1)), etaHighMinutes: Math.max(0.5, +(seconds * 1.65 / 60).toFixed(1)), completedFirms, totalFirms, progressPercent: all ? Math.min(99, Math.max(0, Math.round(100 * (1 - work / all)))) : 0 };
}
