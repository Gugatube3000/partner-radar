import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../lib/pipeline.js";

class MemoryRun {
  constructor(config = {}, mode = "live") {
    this.config = { firms: 1, contactsPerFirm: 3, researchDepth: "balanced", types: ["Asset managers"], roles: ["CEO", "Head of Partnerships", "Head of Distribution"], minFit: 3, spendCap: 3, drafts: false, useIntegrations: false, ...config };
    this.mode = mode; this.engine = "codex-cli";
    this.country = { code: "BR", name: "Brazil", language: "Portuguese", lang: "pt", regulators: "CVM; ANBIMA" };
    this.startedAt = Date.now(); this.firms = new Map(); this.events = []; this.done = false; this.aborted = false;
    this.controller = new AbortController();
    this.metrics = { spend: 0, tokens: 0, searches: 0, inFlight: 0, verified: 0, drafted: 0, meetingReady: 0 };
  }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  log(level, agent, text) { this.emit("log", { level, agent, text }); }
  addFirm(firm) { this.firms.set(firm.id, firm); this.emit("firm", { firm }); }
  updateFirm(id, patch) { Object.assign(this.firms.get(id), patch); this.emit("firm_update", { id, patch }); }
  startTask(agent, label, firmId) { this.metrics.inFlight++; const id = this.events.length; return { id, end: (result = {}) => { this.metrics.inFlight--; this.emit("task", { agent, label, firmId, ...result }); } }; }
  addUsage(result) { this.metrics.spend += result.cost || 0; }
  pushMetrics() { const contacts = [...this.firms.values()].flatMap((firm) => firm.contacts || []); this.metrics.verified = contacts.filter((contact) => contact.emailStatus === "Verified").length; }
  stop() { this.aborted = true; this.controller.abort(new Error("Stopped")); }
}

const result = (data, cost = 0) => ({ data, cost, tokens: 10, searches: 1 });
const firm = (name = "Alpha", website = "https://alpha.biz") => ({ name, website, city: "São Paulo", type: "Asset manager", client_segment: "Retail", aum_estimate: "", source: "Regulator list", source_url: "https://regulator.gov.br/register" });
const contact = (name = "Jane Smith", email = "jane.smith@alpha.biz", extra = {}) => ({ name, title: "CEO", source_url: "https://alpha.biz/team", linkedin_url: "", email, email_type: "guess", email_pattern: "first.last", pattern_evidence: "", email_evidence_url: "", email_confidence: 0.35, ...extra });
const publicPages = async () => ({ pages: [], text: "Mock public-source evidence" });
const noDelay = async () => {};
const mxPresent = async () => "mx_present";

function answers(options) {
  if (options.name === "firms") return result({ firms: [firm()] });
  if (options.name === "profile") return result({ aum: "", asset_classes: "Equities, fixed income", summary: "Public markets manager", leadership: [] });
  if (options.name === "judge") return result({ fit_score: 5, confidence: 0.9, why: "Public markets and relevant clients", best_contact: "CEO" });
  if (options.name === "contacts") return result({ contacts: [contact(), contact("Alan Doe", "alan.doe@alpha.biz"), contact("Dana Doe", "dana.doe@alpha.biz")] });
  if (options.name === "email") return result({ subject: "Partnership", body: "Hello", english_gist: "Draft" });
  throw new Error(`Unexpected step ${options.name}`);
}

test("supplemental scout passes fill a deduplicated target and respect selected institution types", async () => {
  const run = new MemoryRun({ firms: 3, types: ["Private banks", "Wealth managers"] });
  let scout = 0;
  const prompts = [];
  const summary = await runPipeline(run, { collectPublicPages: publicPages, checkMailDomain: mxPresent, pause: noDelay, ask: async (_engine, options) => {
    prompts.push(options);
    if (options.name === "firms") {
      scout++;
      return result({ firms: scout === 1 ? [firm(), firm("Alpha Ltd", "https://www.alpha.biz/branch")] : scout === 2 ? [firm(), firm("Beta", "https://beta.biz")] : [firm("Gamma", "https://gamma.biz")] });
    }
    return answers(options);
  } });
  assert.equal(scout, 3);
  assert.equal(summary.firms, 3);
  assert.equal(summary.contacts, 9);
  assert.equal(summary.outcome, "completed");
  assert.equal(run.metrics.inFlight, 0);
  assert.match(prompts.find((options) => options.name === "firms").prompt, /Private banks, Wealth managers/);
  assert.match(prompts.find((options) => options.name === "judge").prompt, /banks, wealth managers/i);
  for (const f of run.firms.values()) {
    assert.equal(f.contacts.length, 3);
    assert.equal(f.contactName, "Jane Smith");
    assert.equal(f.emailStatus, "Guess");
    assert.equal(f.emailCheck, "mx_present");
    assert.ok(f.contacts.every((person) => person.sourceUrl && person.id && person.emailStatus !== "Verified"));
  }
});

test("supplemental finder discovers additional distinct contacts and preserves evidence", async () => {
  const run = new MemoryRun();
  let finder = 0;
  const summary = await runPipeline(run, { collectPublicPages: publicPages, checkMailDomain: mxPresent, pause: noDelay, ask: async (_engine, options) => {
    if (options.name !== "contacts") return answers(options);
    finder++;
    return result({ contacts: finder === 1 ? [contact()] : [contact(), contact("Alan Doe", "alan.doe@alpha.biz"), contact("Dana Doe", "dana.doe@alpha.biz")] });
  } });
  assert.equal(finder, 2);
  assert.equal(summary.contacts, 3);
  assert.equal(new Set([...run.firms.values()][0].contacts.map((c) => c.name)).size, 3);
});

test("finder follow-up failures retain initial contacts and report partial completion", async () => {
  const run = new MemoryRun();
  let finder = 0;
  const summary = await runPipeline(run, { collectPublicPages: publicPages, checkMailDomain: mxPresent, pause: noDelay, ask: async (_engine, options) => {
    if (options.name !== "contacts") return answers(options);
    if (++finder === 2) throw new Error("Provider timeout");
    return result({ contacts: [contact()] });
  } });
  assert.equal(summary.outcome, "partial");
  assert.equal(summary.partial, true);
  assert.equal(summary.contacts, 1);
  assert.match(summary.warnings[0], /Provider timeout/);
  assert.equal([...run.firms.values()][0].contactName, "Jane Smith");
  assert.equal(run.metrics.inFlight, 0);
});

test("fatal scouting failure cannot be reported as a successful run", async () => {
  const run = new MemoryRun();
  const summary = await runPipeline(run, { ask: async () => { throw new Error("Sign in to your subscription"); } });
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.failed, true);
  assert.match(summary.error, /Sign in/);
  assert.equal(run.firms.size, 0);
  assert.equal(run.metrics.inFlight, 0);
  assert.ok(run.events.some((event) => event.type === "error"));
});

test("per-firm model failure is visible and does not erase other results", async () => {
  const run = new MemoryRun({ firms: 2 });
  const summary = await runPipeline(run, { collectPublicPages: publicPages, checkMailDomain: mxPresent, ask: async (_engine, options) => {
    if (options.name === "firms") return result({ firms: [firm(), firm("Beta", "https://beta.biz")] });
    if (options.name === "profile" && options.ctx.firm.name === "Beta") throw new Error("Research provider offline");
    return answers(options);
  } });
  assert.equal(summary.outcome, "partial");
  assert.equal(summary.failedFirms, 1);
  assert.equal(summary.contacts, 3);
  assert.match([...run.firms.values()].find((f) => f.name === "Beta").status, /Error/);
});

test("cancelled research finishes as stopped with no leaked in-flight tasks", async () => {
  const run = new MemoryRun();
  const summary = await runPipeline(run, { ask: async () => { run.stop(); return result({ firms: [firm()] }); } });
  assert.equal(summary.outcome, "stopped");
  assert.equal(summary.stopped, true);
  assert.equal(summary.failed, false);
  assert.equal(run.metrics.inFlight, 0);
});

test("spend cap halts subsequent paid calls and leaves sourced firms available", async () => {
  const run = new MemoryRun({ spendCap: 0.1 });
  let calls = 0;
  const summary = await runPipeline(run, { collectPublicPages: publicPages, ask: async (_engine, options) => { calls++; return result(answers(options).data, 0.1); } });
  assert.equal(calls, 1);
  assert.equal(summary.outcome, "partial");
  assert.match(summary.error, /Spend cap/);
  assert.equal(summary.firms, 1);
});

test("selected integrations are called, professional additions get IDs and valid checks are retained", async () => {
  const run = new MemoryRun({ useIntegrations: true, integrations: { hunter: true, apollo: false }, contactsPerFirm: 4 });
  let enrichment = 0, mxChecks = 0;
  const summary = await runPipeline(run, { collectPublicPages: publicPages, ask: async (_engine, options) => answers(options), checkMailDomain: async () => { mxChecks++; return "mx_present"; }, enrichContacts: async (domain, contacts, options) => {
    enrichment++;
    assert.equal(domain, "alpha.biz");
    assert.deepEqual(options.integrations, { hunter: true, apollo: false });
    return [...contacts.map((c) => ({ ...c, emailStatus: "Verified", emailCheck: "valid", verificationProvider: "Hunter" })), { name: "Pat Doe", title: "Head of Product", sourceUrl: "https://alpha.biz/team", email: "pat.doe@alpha.biz", emailType: "published", emailStatus: "Published", emailCheck: "not_checked", emailScore: 95, provider: "Hunter" }];
  } });
  assert.equal(enrichment, 1);
  assert.equal(summary.contacts, 4);
  assert.equal(summary.verified, 3);
  assert.equal(mxChecks, 1);
  assert.ok([...run.firms.values()][0].contacts.at(-1).id);
});

test("demo mode generates the requested number of fictional contacts and safe reserved domains", async () => {
  const run = new MemoryRun({ firms: 3, contactsPerFirm: 5, minFit: 1, speed: 1000 }, "demo");
  const summary = await runPipeline(run, { pause: noDelay });
  assert.equal(summary.contacts, 15);
  assert.equal(summary.outcome, "completed");
  for (const f of run.firms.values()) {
    assert.match(f.website, /\.example$/);
    assert.equal(f.contacts.length, 5);
    assert.ok(f.contacts.every((c) => c.provider === "Fictional demo" && (!c.email || c.email.endsWith(".example"))));
    assert.ok(f.contacts.every((c) => c.emailStatus !== "Verified"));
  }
});

test("MX sanity checks cannot overwrite an inconclusive Hunter verification result", async () => {
  const run = new MemoryRun({ useIntegrations: true, integrations: { hunter: true, apollo: false } });
  let mxChecks = 0;
  const summary = await runPipeline(run, {
    collectPublicPages: publicPages,
    ask: async (_engine, options) => answers(options),
    checkMailDomain: async () => { mxChecks++; return "mx_present"; },
    enrichContacts: async (_domain, contacts) => contacts.map((contact, index) => ({ ...contact, emailStatus: "Unverified", emailCheck: ["unknown", "pending", "disposable"][index], verificationProvider: "Hunter" })),
  });
  assert.equal(summary.outcome, "completed");
  assert.equal(mxChecks, 0);
  assert.deepEqual([...run.firms.values()][0].contacts.map((contact) => contact.emailCheck), ["unknown", "pending", "disposable"]);
  assert.ok([...run.firms.values()][0].contacts.every((contact) => contact.verificationProvider === "Hunter" && contact.emailStatus === "Unverified"));
});
