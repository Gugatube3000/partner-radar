// @ts-check
// A Run holds one sourcing job: its config, the firms found so far, live metrics,
// and an append-only event log that is streamed to the UI and saved to runs/<id>.jsonl.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const RUNS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runs");
fs.mkdirSync(RUNS_DIR, { recursive: true });

/**
 * @typedef {{
 *   id: string, name: string, country: string, city: string, website: string, type: string,
 *   segment: string, aum: string, assetClasses: string, globalEquity: string, globalEquityEvidence: string, languages: string,
 *   fit: number|null, fitConfidence: number|null, why: string, bestContact: string,
 *   contactName: string, contactTitle: string, linkedin: string, email: string, emailStatus: string,
 *   emailScore: number|null, emailPattern: string, emailEvidence: string, warmIntro: string, source: string, sourceUrl: string, news: string,
 *   subject: string, body: string, gist: string, status: string, collectedAt: string, stage: string
 * }} Firm
 */

/** @param {Partial<Firm>} f @returns {Firm} */
export function newFirm(f) {
  return {
    id: "", name: "", country: "", city: "", website: "", type: "", segment: "", aum: "", assetClasses: "",
    globalEquity: "Unknown", globalEquityEvidence: "", languages: "", fit: null, fitConfidence: null,
    why: "", bestContact: "", contactName: "", contactTitle: "", linkedin: "", email: "",
    emailStatus: "", emailScore: null, emailPattern: "", emailEvidence: "", warmIntro: "", source: "", sourceUrl: "", news: "",
    subject: "", body: "", gist: "", status: "Found", collectedAt: new Date().toISOString().slice(0, 10),
    stage: "scout", ...f,
  };
}

export class Run {
  /** @param {{ mode: string, engine: string, config: any, country: any }} init */
  constructor(init) {
    this.id = crypto.randomBytes(4).toString("hex");
    this.mode = init.mode;
    this.engine = init.engine;
    this.config = init.config;
    this.country = init.country;
    this.startedAt = Date.now();
    /** @type {Map<string, Firm>} */
    this.firms = new Map();
    /** @type {any[]} */
    this.events = [];
    /** @type {Set<(e: any) => void>} */
    this.subscribers = new Set();
    this.done = false;
    this.aborted = false;
    this.controller = new AbortController();
    this.metrics = { spend: 0, calls: 0, searches: 0, latencyMs: 0, inFlight: 0, verified: 0, emails: 0, drafted: 0, meetingReady: 0, found: 0, scored: 0, tokens: 0 };
    this.taskSeq = 4400 + Math.floor(Math.random() * 500);
    this.file = path.join(RUNS_DIR, `${this.id}.jsonl`);
  }

  /** @param {string} type @param {any} data */
  emit(type, data = {}) {
    const e = { t: Date.now() - this.startedAt, type, ...data };
    this.events.push(e);
    fs.appendFile(this.file, JSON.stringify(e) + "\n", () => {});
    for (const fn of this.subscribers) fn(e);
  }

  /** @param {"info"|"ok"|"warn"|"err"} level @param {string} agent @param {string} text */
  log(level, agent, text) { this.emit("log", { level, agent, text }); }

  /** @param {Firm} firm */
  addFirm(firm) {
    this.firms.set(firm.id, firm);
    this.metrics.found = this.firms.size;
    this.emit("firm", { firm });
  }

  /** @param {string} id @param {Partial<Firm>} patch */
  updateFirm(id, patch) {
    const f = this.firms.get(id);
    if (!f) return;
    Object.assign(f, patch);
    this.emit("firm_update", { id, patch });
  }

  /** @param {string} agent @param {string} label @param {string} [firmId] */
  startTask(agent, label, firmId) {
    const id = `T-${++this.taskSeq}`;
    this.metrics.inFlight++;
    this.emit("task", { id, agent, label, firmId, state: "running" });
    this.pushMetrics();
    const t0 = Date.now();
    return {
      id,
      /** @param {{ tokens?: number, cost?: number, error?: string }} [r] */
      end: (r = {}) => {
        this.metrics.inFlight = Math.max(0, this.metrics.inFlight - 1);
        const ms = Date.now() - t0;
        this.metrics.calls++;
        this.metrics.latencyMs = this.metrics.latencyMs ? this.metrics.latencyMs * 0.8 + ms * 0.2 : ms;
        this.emit("task", { id, agent, label, firmId, state: r.error ? "error" : "done", ms, tokens: r.tokens ?? 0, cost: r.cost ?? 0, error: r.error });
        this.pushMetrics();
      },
    };
  }

  /** @param {{ cost?: number, searches?: number, tokens?: number }} u */
  addUsage(u) {
    this.metrics.spend += u.cost ?? 0;
    this.metrics.searches += u.searches ?? 0;
    this.metrics.tokens += u.tokens ?? 0;
  }

  pushMetrics() {
    const firms = [...this.firms.values()];
    this.metrics.verified = firms.filter((f) => f.emailStatus === "Verified" || f.emailStatus === "Published").length;
    this.metrics.emails = firms.filter((f) => f.email && f.emailStatus !== "No mail server").length;
    this.metrics.drafted = firms.filter((f) => f.subject).length;
    this.metrics.scored = firms.filter((f) => f.fit != null).length;
    this.metrics.meetingReady = firms.filter((f) => (f.fit ?? 0) >= 4 && f.email && ["Verified", "Published", "Inferred"].includes(f.emailStatus)).length;
    const mins = Math.max((Date.now() - this.startedAt) / 60000, 0.05);
    this.emit("metrics", { ...this.metrics, firmsPerMin: this.metrics.scored / mins });
  }

  /** @param {(e: any) => void} fn */
  subscribe(fn) {
    for (const e of this.events) fn(e);
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  stop() {
    this.aborted = true;
    this.controller.abort();
  }
}

/** Replays a saved run file at `speed`x into a fresh Run (marked as a replay). */
export function listSavedRuns() {
  return fs.readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const file = path.join(RUNS_DIR, f);
      const first = fs.readFileSync(file, "utf8").split("\n")[0];
      try {
        const e = JSON.parse(first);
        return { id: f.replace(".jsonl", ""), mode: e.mode, engine: e.engine, country: e.country?.name, firms: e.config?.firms, mtime: fs.statSync(file).mtimeMs };
      } catch { return null; }
    })
    .filter((r) => r && r.mode === "live")
    .sort((a, b) => (b?.mtime ?? 0) - (a?.mtime ?? 0));
}
