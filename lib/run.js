// @ts-check
// A Run holds one sourcing job: its config, the firms found so far, live metrics,
// and an append-only event log that is streamed to the UI and saved to runs/<id>.jsonl.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const RUNS_DIR = process.env.PARTNER_RADAR_RUNS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "runs");
fs.mkdirSync(RUNS_DIR, { recursive: true });

/**
 * @typedef {{
 *   id: string, name: string, country: string, city: string, website: string, type: string,
 *   segment: string, aum: string, assetClasses: string, globalEquity: string, globalEquityEvidence: string, languages: string,
 *   fit: number|null, fitConfidence: number|null, why: string, bestContact: string,
 *   contactName: string, contactTitle: string, linkedin: string, email: string, emailStatus: string,
 *   emailScore: number|null, emailPattern: string, emailEvidence: string, warmIntro: string, source: string, sourceUrl: string, news: string,
 *   subject: string, body: string, gist: string, status: string, collectedAt: string, stage: string,
 *   contacts: any[], emailCheck: string, contactSourceUrl: string
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
    stage: "scout", contacts: [], emailCheck: "not_checked", contactSourceUrl: "", ...f,
  };
}

export class Run {
  /** @param {{ mode: string, engine: string, config: any, country: any }} init */
  constructor(init) {
    this.id = crypto.randomBytes(8).toString("hex");
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
    this.metrics = { spend: 0, calls: 0, searches: 0, latencyMs: 0, inFlight: 0, verified: 0, published: 0, contacts: 0, emails: 0, drafted: 0, meetingReady: 0, found: 0, scored: 0, tokens: 0 };
    this.taskSeq = 4400 + Math.floor(Math.random() * 500);
    this.file = path.join(RUNS_DIR, `${this.id}.jsonl`);
  }

  /** @param {string} type @param {any} data */
  emit(type, data = {}) {
    const e = { ...data, t: Date.now() - this.startedAt, type, seq: this.events.length + 1 };
    this.events.push(e);
    fs.appendFileSync(this.file, JSON.stringify(e) + "\n");
    for (const fn of this.subscribers) { try { fn(e); } catch { /* disconnected client */ } }
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
    let ended = false;
    return {
      id,
      /** @param {{ tokens?: number, cost?: number, error?: string }} [r] */
      end: (r = {}) => {
        if (ended) return;
        ended = true;
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
    const contacts = firms.flatMap((f) => f.contacts?.length ? f.contacts : f.contactName || f.email ? [{ name: f.contactName, email: f.email, emailStatus: f.emailStatus }] : []);
    const emails = [...new Map(contacts.filter((c) => c.email && !["No mail server", "Invalid"].includes(c.emailStatus)).map((c) => [c.email.toLowerCase(), c])).values()];
    this.metrics.contacts = contacts.filter((c) => c.name).length;
    this.metrics.verified = emails.filter((c) => c.emailStatus === "Verified").length;
    this.metrics.published = emails.filter((c) => c.emailStatus === "Published").length;
    this.metrics.emails = emails.length;
    this.metrics.drafted = firms.filter((f) => f.subject).length;
    this.metrics.scored = firms.filter((f) => f.fit != null).length;
    this.metrics.meetingReady = firms.filter((f) => (f.fit ?? 0) >= 4 && (f.contacts?.length ? f.contacts : [{ email: f.email, emailStatus: f.emailStatus }]).some((c) => c.email && ["Verified", "Published"].includes(c.emailStatus))).length;
    const mins = Math.max((Date.now() - this.startedAt) / 60000, 0.05);
    this.emit("metrics", { ...this.metrics, firmsPerMin: this.metrics.scored / mins });
  }

  /** @param {(e: any) => void} fn */
  subscribe(fn, after = 0) {
    for (const e of this.events) if (e.seq > after) fn(e);
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  stop() {
    if (this.done || this.aborted) return;
    this.aborted = true;
    this.controller.abort();
  }

  snapshot() {
    return { id: this.id, mode: this.mode, engine: this.engine, country: this.country, config: this.config, startedAt: this.startedAt, done: this.done, aborted: this.aborted, metrics: this.metrics, firms: [...this.firms.values()] };
  }
}

/** Restore saved data for exports and refresh after a server restart. No new AI calls. */
export function loadSavedRun(id) {
  if (!/^[a-f0-9]{8,16}$/.test(id)) return null;
  const file = path.join(RUNS_DIR, `${id}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const events = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const first = events.find((e) => e.type === "run");
  if (!first?.country || !first.config) return null;
  const run = new Run(first);
  run.id = id;
  run.file = file;
  run.startedAt = fs.statSync(file).birthtimeMs;
  run.events = events.map((e, i) => ({ ...e, seq: i + 1 }));
  for (const e of events) {
    if (e.type === "firm") run.firms.set(e.firm.id, newFirm(e.firm));
    if (e.type === "firm_update") Object.assign(run.firms.get(e.id) ?? {}, e.patch);
    if (e.type === "metrics") Object.assign(run.metrics, e);
  }
  run.done = true;
  if (!events.some((e) => e.type === "done")) {
    run.aborted = true;
    run.events.push({ type: "done", seq: run.events.length + 1, t: events.at(-1)?.t || 0, stopped: true, message: "Server stopped before this run completed. Saved partial results are available." });
  }
  return run;
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
