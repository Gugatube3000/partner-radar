import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { estimateRun, estimateRemaining, historicalTimings, formatDurationRange } from "../lib/estimate.js";
const cold = { samples: 0, durations: {} };
test("planning estimate is a range, with extra time for larger/deeper/multi-contact/drafted research", () => {
  const base = estimateRun({ firms: 8, contactsPerFirm: 1 }, "codex-cli", "live", cold);
  assert.ok(base.highMinutes > base.lowMinutes && base.lowMinutes > 0);
  assert.ok(base.estimatedCalls >= 25); assert.equal(base.concurrency, 2); assert.match(base.basis, /planning/);
  for (const config of [{ firms: 30, contactsPerFirm: 1 }, { firms: 8, contactsPerFirm: 8 }, { firms: 8, contactsPerFirm: 1, researchDepth: "deep" }, { firms: 8, contactsPerFirm: 1, drafts: true }]) {
    assert.ok(estimateRun(config, "codex-cli", "live", cold).highSeconds > base.highSeconds);
  }
  assert.ok(estimateRun({ firms: 8, claudeModel: "opus" }, "claude-cli", "live", cold).highSeconds > estimateRun({ firms: 8, claudeModel: "sonnet" }, "claude-cli", "live", cold).highSeconds);
});
test("demo estimate is short and makes no model calls", () => {
  const estimate = estimateRun({ firms: 8, contactsPerFirm: 3, speed: 2 }, "demo", "demo", cold);
  assert.equal(estimate.estimatedCalls, 0); assert.equal(estimate.historicalSamples, 0); assert.ok(estimate.highSeconds < 20); assert.match(estimate.label, /seconds/);
});
test("local calibration ignores demos, failed calls, other engines and malformed history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-estimate-test-"));
  const log = (id, first, events) => fs.writeFileSync(path.join(dir, id + ".jsonl"), [JSON.stringify(first), ...events.map(JSON.stringify)].join("\n"));
  const events = [20000, 30000, 40000].map((ms) => ({ type: "task", agent: "analyst", state: "done", ms }));
  try {
    log("aaaaaaaa", { mode: "live", engine: "codex-cli" }, [...events, { type: "task", agent: "analyst", state: "error", ms: 500000 }]);
    log("bbbbbbbb", { mode: "demo", engine: "codex-cli" }, events); log("cccccccc", { mode: "live", engine: "claude-cli" }, events);
    fs.writeFileSync(path.join(dir, "dddddddd.jsonl"), "broken\n");
    const history = historicalTimings("codex-cli", dir); assert.equal(history.samples, 3); assert.equal(history.durations.analyst, 30);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("remaining estimate follows finished stages and becomes zero when stopped or complete", () => {
  const config = { firms: 3, contactsPerFirm: 3 }, estimate = estimateRun(config, "codex-cli", "live", cold);
  const run = { config, engine: "codex-cli", mode: "live", estimate, startedAt: Date.now(), done: false, aborted: false, metrics: { calls: 0, latencyMs: 0 }, firms: new Map([["one", { stage: "analyst" }], ["two", { stage: "analyst" }], ["three", { stage: "analyst" }]]) };
  const start = estimateRemaining(run); run.firms.get("one").stage = "done"; run.firms.get("two").stage = "writer";
  const later = estimateRemaining(run); assert.ok(later.etaHighMinutes < start.etaHighMinutes); assert.equal(later.completedFirms, 1); assert.ok(later.progressPercent > start.progressPercent);
  run.aborted = true; assert.equal(estimateRemaining(run).etaHighMinutes, 0);
  run.aborted = false; run.done = true; assert.equal(estimateRemaining(run).progressPercent, 100);
});
test("duration formatting handles seconds, minutes and long sessions", () => {
  assert.match(formatDurationRange(2, 8), /seconds/); assert.match(formatDurationRange(180, 420), /minutes/); assert.match(formatDurationRange(7200, 9000), /hours/);
});
test("the last firm's sequential stages are not divided across unavailable workers", () => {
  const config = { firms: 3, contactsPerFirm: 3 }, estimate = estimateRun(config, "codex-cli", "live", cold);
  const run = { config, engine: "codex-cli", mode: "live", estimate, startedAt: Date.now(), done: false, aborted: false, metrics: { calls: 0, latencyMs: 0 }, firms: new Map([["one", { stage: "done" }], ["two", { stage: "done" }], ["three", { stage: "analyst" }]]) };
  const remaining = estimateRemaining(run);
  const sequentialMinutes = (estimate.stages.analyst + estimate.stages.judge + estimate.stages.finder + estimate.stages.writer) / 60;
  assert.ok(remaining.etaHighMinutes >= sequentialMinutes); assert.equal(remaining.completedFirms, 2);
});
