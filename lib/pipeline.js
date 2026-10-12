// @ts-check
// The agent loop: SCOUT maps the market, then each firm flows through
// ANALYST -> JUDGE -> FINDER (+ verify) -> WRITER, several firms at a time.
import { ask, MODELS } from "./llm.js";
import { newFirm } from "./run.js";
import { demoAsk, demoEmail } from "./demo.js";
import { TypeSafeClient, noul, score, choice } from "@typesafe-ai/sdk";
import dns from "node:dns/promises";

const SYSTEM = `You are an agent in Partner Radar, a research pipeline for the strategic partnerships team of a global asset manager.
The team looks for local financial institutions (banks, wealth managers, brokerages, platforms) in markets it cannot enter alone.
The partnership: the local firm offers our global equity solution and investor-education materials, localized for its clients; both firms share the new revenue.
Be factual and specific. Use only information from public sources. Never invent people, email addresses, numbers or URLs - use an empty string when something is unknown.`;

export const RUBRIC = `Who we want: asset managers that invest in public markets (equities and/or fixed income, multi-asset). If they already run equity or fixed income money, adding a global equity strategy for their clients is a natural next step, so that's a good meeting. Already offering some global or international equity is fine, not a negative.
Who we can't work with: firms whose business is only real estate, private equity, venture, infrastructure, private credit or other private / real assets.
Size is relative to the country: a firm with only ~US$100M is usually too small; prefer firms that matter in their local market.
5 = public-markets asset manager (equities and/or fixed income), meaningful size for its market, decisions made locally.
4 = public-markets manager, but smaller or part of a bigger group.
3 = mixed: some public-markets business but mostly something else, or size unclear.
2 = mostly private assets, or very small for its market.
1 = only real estate / private equity / infrastructure / private credit, or not an asset manager.`;

const str = { type: "string" };
const SCHEMAS = {
  firms: {
    type: "object", additionalProperties: false, required: ["firms"],
    properties: {
      firms: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["name", "website", "city", "type", "client_segment", "aum_estimate", "source", "source_url"],
          properties: { name: str, website: str, city: str, type: str, client_segment: str, aum_estimate: str, source: str, source_url: str },
        },
      },
    },
  },
  profile: {
    type: "object", additionalProperties: false,
    required: ["aum", "asset_classes", "client_segment", "offers_global_equity", "global_equity_evidence", "languages", "summary", "recent_news", "leadership"],
    properties: {
      aum: str, asset_classes: str, client_segment: str, offers_global_equity: { type: "string", enum: ["Yes", "No", "Unknown"] },
      global_equity_evidence: str, languages: str, summary: str, recent_news: str,
      leadership: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["name", "title", "linkedin_url", "source_url"], properties: { name: str, title: str, linkedin_url: str, source_url: str } },
      },
    },
  },
  judge: {
    type: "object", additionalProperties: false, required: ["fit_score", "confidence", "why", "best_contact"],
    properties: { fit_score: { type: "integer", enum: [1, 2, 3, 4, 5] }, confidence: { type: "number" }, why: str, best_contact: str },
  },
  contact: {
    type: "object", additionalProperties: false,
    required: ["name", "title", "linkedin_url", "source_url", "email", "email_type", "email_pattern", "pattern_evidence", "email_confidence"],
    properties: {
      name: str, title: str, linkedin_url: str, source_url: str, email: str,
      email_type: { type: "string", enum: ["published", "inferred", "guess", "none"] },
      email_pattern: str, pattern_evidence: str, email_confidence: { type: "number" },
    },
  },
  email: {
    type: "object", additionalProperties: false, required: ["subject", "body", "english_gist"],
    properties: { subject: str, body: str, english_gist: str },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const domainOf = (url) => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * @param {import("./run.js").Run} run
 */
export async function runPipeline(run) {
  const cfg = run.config;
  const country = run.country;
  const demo = run.mode === "demo";
  const speed = demo ? Math.max(0.2, Number(cfg.speed) || 1) : 1;
  const concurrency = demo ? 4 : run.engine === "codex-cli" ? 3 : 4;
  const cap = Number(cfg.spendCap) || 3;
  const jevDirect = !demo && !!process.env.TYPESAFE_API_KEY;
  const judgeModel = run.engine === "openrouter" ? MODELS.openrouter.judge : undefined;

  /** @param {string} agent @param {string} label @param {string|undefined} firmId @param {any} opts */
  async function step(agent, label, firmId, opts) {
    if (run.aborted) throw new Error("Stopped");
    if (!demo && run.metrics.spend >= cap) throw new Error(`Spend cap $${cap.toFixed(2)} reached`);
    const task = run.startTask(agent, label, firmId);
    try {
      const r = demo
        ? await (async () => {
          const act = { firms: [`search · "${country.name} asset managers regulator list"`, `read · ${country.regulators.split(";")[0]}`], profile: ["read · company website", "read · about / team page"], judge: [], contact: ["search · leadership team", "search · email format"], email: [] }[opts.name] || [];
          act.forEach((t, k) => setTimeout(() => run.emit("activity", { agent, firmId, task: task.id, text: t }), (300 + k * 700) / speed));
          return demoAsk(opts.name, { ...opts.ctx, country, cfg, speed });
        })()
        : await ask(/** @type {any} */ (run.engine), {
          system: SYSTEM, ...opts, model: opts.model || (run.engine === "claude-cli" ? cfg.claudeModel : undefined), signal: run.controller.signal,
          onActivity: (text) => run.emit("activity", { agent, firmId, task: task.id, text }),
        });
      run.addUsage(r);
      task.end({ tokens: r.tokens, cost: r.cost });
      return r.data;
    } catch (e) {
      task.end({ error: String(/** @type {any} */ (e)?.message || e) });
      throw e;
    }
  }

  run.emit("stage", { stage: "brief", state: "done" });
  run.emit("stage", { stage: "scout", state: "active" });
  run.emit("agent", { agent: "scout", status: "running" });
  run.log("info", "scout", `Mapping ${cfg.types.join(", ").toLowerCase()} in ${country.name}`);
  run.log("info", "scout", `Reading first: ${country.regulators}`);

  // ------------------------------------------------------------ SCOUT
  let found = [];
  try {
    const data = await step("scout", `map ${country.code} market`, undefined, {
      name: "firms", schema: SCHEMAS.firms, web: 8, effort: run.engine.endsWith("-cli") ? "low" : "medium",
      ctx: { n: cfg.firms },
      prompt: `Find up to ${cfg.firms} asset managers in ${country.name} that invest in public markets (equities, fixed income or multi-asset funds).
Start with these public lists: ${country.regulators}. Then search the web for firms those lists miss.
Skip firms that only do real estate, private equity, infrastructure or private credit, and skip ones that are very small for this market (roughly under US$100M).
Exclude: ${cfg.exclude?.trim() || "none"}.
For each firm: name, website (homepage URL), city, type (e.g. "Asset manager", "Asset manager (bank-owned)"), client_segment (who they manage money for), aum_estimate (with currency, or ""), source ("Regulator list", "Association list" or "Web search") and source_url.`,
    });
    found = (data.firms || []).filter((f) => f.name).slice(0, cfg.firms);
  } catch (e) {
    run.log("err", "scout", String(/** @type {any} */ (e)?.message || e));
    run.emit("error", { message: String(/** @type {any} */ (e)?.message || e) });
    return finish();
  }
  const seen = new Set();
  for (const f of found) {
    const key = domainOf(f.website) || slug(f.name);
    if (seen.has(key)) continue;
    seen.add(key);
    run.addFirm(newFirm({
      id: slug(f.name).slice(0, 40) || `firm-${seen.size}`, name: f.name, country: country.name, city: f.city,
      website: f.website, type: f.type, segment: f.client_segment, aum: f.aum_estimate,
      source: f.source || "Web search", sourceUrl: f.source_url, stage: "analyst",
    }));
    await sleep(demo ? 160 / speed : 60);
  }
  run.log("ok", "scout", `${run.firms.size} institutions mapped`);
  run.emit("agent", { agent: "scout", status: "done" });
  run.emit("stage", { stage: "scout", state: "done" });
  run.pushMetrics();

  // ------------------------------------------------------------ per-firm chain
  const queue = [...run.firms.values()];
  const stagesSeen = new Set();
  const enter = (stage, agent) => {
    if (stagesSeen.has(stage)) return;
    stagesSeen.add(stage);
    run.emit("stage", { stage, state: "active" });
    if (agent) run.emit("agent", { agent, status: "running" });
  };

  async function processFirm(firm) {
    try {
      // ANALYST
      enter("analyst", "analyst");
      run.updateFirm(firm.id, { stage: "analyst" });
      let pageText = "";
      if (!demo && process.env.FIRECRAWL_API_KEY && firm.website) {
        const t = run.startTask("analyst", `firecrawl · ${domainOf(firm.website)}`, firm.id);
        pageText = await firecrawl(firm.website);
        t.end(pageText ? {} : { error: "scrape failed" });
      }
      const p = await step("analyst", `read ${domainOf(firm.website) || firm.name}`, firm.id, {
        name: "profile", schema: SCHEMAS.profile, web: pageText ? 2 : 4, effort: "low",
        ctx: { firm },
        prompt: `${pageText ? `Their website, scraped just now:
<<<
${pageText}
>>>

` : ""}Research ${firm.name} (${firm.website || "website unknown"}) in ${country.name}.
Report: assets under management; the asset classes they manage (e.g. local equities, fixed income, multi-asset, real estate, private equity); client segment (retail funds, institutional, wealth...); whether they already offer global or international equity (Yes / No / Unknown, with a short evidence quote); languages they serve clients in; a two-sentence summary; one notable news item from the last 12 months (or ""); and the leadership team with exact titles, LinkedIn URLs when public, and the source URL.
Check the firm's own about / team / leadership pages first.`,
      });
      run.updateFirm(firm.id, {
        aum: p.aum || firm.aum, assetClasses: /^(test|n\/?a|unknown|none|-)?$/i.test(String(p.asset_classes || "").trim()) ? "" : p.asset_classes, segment: p.client_segment || firm.segment, globalEquity: p.offers_global_equity,
        globalEquityEvidence: p.global_equity_evidence, languages: p.languages, news: p.recent_news, stage: "judge",
      });
      run.log("info", "analyst", `${firm.name}: ${String(p.summary || "profile captured").slice(0, 110)}`);

      // JUDGE
      enter("judge", "judge");
      const j = await judge(firm, p);
      run.updateFirm(firm.id, { fit: j.fit, fitConfidence: j.confidence, why: j.why, bestContact: j.best, stage: "finder" });
      run.emit("judge", { firmId: firm.id, fit: j.fit, confidence: j.confidence });
      run.log(j.fit >= 4 ? "ok" : "info", "judge", `${firm.name} → fit ${j.fit}/5 (${Math.round(j.confidence * 100)}%) · ${j.why.slice(0, 90)}`);
      run.pushMetrics();
      if (j.fit < (Number(cfg.minFit) || 3)) {
        run.updateFirm(firm.id, { status: "Not a fit", stage: "done" });
        return;
      }

      // FINDER
      enter("finder", "finder");
      const target = pickContact(p.leadership || [], j.best, cfg.roles);
      const c = await step("finder", `find ${j.best || "decision-maker"}`, firm.id, {
        name: "contact", schema: SCHEMAS.contact, web: 4, effort: "medium",
        ctx: { firm, target },
        prompt: `Firm: ${firm.name} (${firm.website}) in ${country.name}. Email domain: ${domainOf(firm.website) || "find it"}.
${target ? `Known leader: ${target.name}, ${target.title}.` : `Find the current ${j.best || cfg.roles[0]} (or the closest of: ${cfg.roles.join(", ")}).`}
1) PERSON: name, exact title, LinkedIn URL and source URL.
2) EMAIL for that person, in this order:
   a. If their own address is published on a public page, use it. email_type = "published", pattern_evidence = where you saw it.
   b. Otherwise find the firm's email FORMAT from real public examples. First work out which domain their people actually email from (it can differ from the website, e.g. a parent bank's domain). Then search the web for "@thatdomain" in quotes, and check the firm's contact / team / press / investor-relations pages, regulator or fund PDFs and email-format directories. Build this person's address with that format. email_type = "inferred", email_pattern = the format (e.g. "first.last", "flast", "first", "first_last"), pattern_evidence = one example address and where you saw it.
   c. If you find no examples at all, use the most likely format for this kind of firm in ${country.name} (usually first.last). email_type = "guess", pattern_evidence = "".
   d. If you can't even find the person or domain: email = "", email_type = "none".
   Lowercase, remove accents, and handle local naming (e.g. two surnames) the way the firm's other addresses do.
   email_confidence: 0-1 (published ~0.95, inferred from a clear pattern ~0.75, guess ~0.35).
Never present a guess as published.`,
      });
      const label = { published: "Published", inferred: "Inferred", guess: "Guess", none: "Not found" };
      let email = (c.email || "").trim().toLowerCase();
      let emailStatus = email ? label[c.email_type] || "Guess" : "Not found";
      let emailScore = c.email_confidence != null ? Math.round(Math.max(0, Math.min(1, Number(c.email_confidence))) * 100) : null;
      let emailPattern = c.email_pattern || "", emailEvidence = c.pattern_evidence || "";
      enter("verify");
      if (demo) {
        ({ email, emailStatus, emailScore, emailPattern, emailEvidence } = demoEmail(firm, c.name, speed));
        await sleep(300 / speed);
      } else {
        if (process.env.HUNTER_API_KEY && c.name) {
          const h = await hunter(domainOf(firm.website), c.name, email);
          if (h && h.email) ({ email, emailStatus, emailScore } = { ...h, emailScore: h.emailScore ?? emailScore });
        }
        if (email && !(await hasMailServer(email.split("@")[1]))) emailStatus = "No mail server";
      }
      c.name = String(c.name || "").replace(/["“”]/g, "").trim();
      run.updateFirm(firm.id, {
        contactName: c.name, contactTitle: c.title, linkedin: c.linkedin_url, email, emailStatus, emailScore,
        emailPattern, emailEvidence, stage: "writer",
      });
      run.log(["Verified", "Published", "Inferred"].includes(emailStatus) ? "ok" : "warn", "finder", `${firm.name}: ${c.name || "no contact"} · ${email || "no email"} · ${emailStatus}${emailPattern ? ` (${emailPattern})` : ""}`);
      run.pushMetrics();
      if (!c.name) { run.updateFirm(firm.id, { status: "No contact", stage: "done" }); return; }
      if (!cfg.drafts) { run.updateFirm(firm.id, { status: "Ready to review", stage: "done" }); return; }

      // WRITER
      enter("writer", "writer");
      const first = c.name.split(/\s+/)[0];
      const m = await step("writer", `draft · ${country.language}`, firm.id, {
        name: "email", schema: SCHEMAS.email, effort: "low",
        ctx: { firm, contact: c, first },
        prompt: `Write a short outreach email from our strategic partnerships team.
Recipient: ${c.name}, ${c.title} at ${firm.name} (${country.name}).
What we know: ${p.summary} Global equity offering today: ${p.offers_global_equity}. ${j.why}
Language: ${cfg.localLanguage ? country.language : "English"}.
Follow this template's structure and intent, filling the {{tokens}}:
---
${cfg.template}
---
Tokens: {{first_name}}=${first}, {{firm}}=${firm.name}, {{country}}=${country.name}, {{language}}=${country.language}, {{sender}}=${cfg.sender || "[Your name]"}, {{why}}=one specific reason this firm fits.
${cfg.personalize ? "Open with one specific, accurate detail about their firm." : ""}
Keep it under 130 words. Plain and warm. Do not mention investment returns, performance or guarantees.
Also give a one-sentence English gist.`,
      });
      run.updateFirm(firm.id, { subject: m.subject, body: m.body, gist: m.english_gist, status: "Ready to review", stage: "done" });
      run.log("ok", "writer", `${firm.name}: draft ready · "${String(m.subject || "").slice(0, 60)}"`);
      run.pushMetrics();
    } catch (e) {
      const msg = String(/** @type {any} */ (e)?.message || e);
      run.updateFirm(firm.id, { status: `Error: ${msg.slice(0, 80)}`, stage: "done" });
      if (msg !== "Stopped") run.log("err", "pipeline", `${firm.name}: ${msg.slice(0, 140)}`);
    }
  }

  /** @param {any} firm @param {any} p */
  async function judge(firm, p) {
    const roles = cfg.roles.length ? cfg.roles : ["CEO"];
    if (jevDirect) {
      const task = run.startTask("judge", "jev · systemOne", firm.id);
      try {
        const client = new TypeSafeClient();
        const res = await client.systemOne({
          state: { firm: firm.name, country: country.name, profile: p },
          questions: {
            retail: noul("Does this firm manage public-market assets (equities or fixed income)?"),
            fit: score("How strong a partner is this firm for a global equity + investor-education partnership with revenue sharing?", [
              "No fit: only real estate / private equity / private assets, or not an asset manager",
              "Weak: mostly private assets, or very small for its market",
              "Possible: mixed, or size unclear",
              "Good: public-markets manager, but smaller or part of a bigger group",
              "Strong: public-markets asset manager (equities and/or fixed income), meaningful size, decides locally",
            ]),
            contact: choice("Who should we contact first about a partnership?", Object.fromEntries(roles.map((r) => [r, null]))),
          },
        });
        const fit = Math.max(1, Math.min(5, Math.round(res.answers.fit.score) + 1));
        task.end({ tokens: res.usage.input_tokens });
        const why = `Jev: public markets p=${res.answers.retail.noul.toFixed(2)}; asset classes: ${p.asset_classes || "unknown"}.`;
        return { fit, confidence: res.answers.fit.confidence, why, best: String(res.answers.contact.choice) };
      } catch (e) {
        task.end({ error: String(/** @type {any} */ (e)?.message || e) });
        run.log("warn", "judge", "Jev unavailable, falling back to the main model");
      }
    }
    const d = await step("judge", run.engine === "openrouter" ? "jev-router · score" : "score fit", firm.id, {
      name: "judge", schema: SCHEMAS.judge, effort: "low", model: judgeModel,
      ctx: { firm, profile: p },
      prompt: `Score this firm as a partner for a global equity + investor-education partnership with revenue sharing.
${RUBRIC}
Firm: ${firm.name}, ${firm.type}, ${country.name}.
Profile: ${JSON.stringify(p)}
Return fit_score (1-5), confidence (0-1), a one-sentence why, and best_contact chosen from: ${roles.join(", ")}.`,
    });
    const fit = Math.max(1, Math.min(5, Math.round(Number(d.fit_score ?? d.fit ?? 3)) || 3));
    const conf = Number(d.confidence);
    return { fit, confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf > 1 ? conf / 100 : conf)) : 0.5, why: String(d.why || ""), best: String(d.best_contact || roles[0]) };
  }

  // run the per-firm chains with a small worker pool
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (next < queue.length && !run.aborted) await processFirm(queue[next++]);
  }));
  for (const a of ["analyst", "judge", "finder", ...(cfg.drafts ? ["writer"] : [])]) run.emit("agent", { agent: a, status: "done" });
  for (const s of ["analyst", "judge", "finder", "verify", ...(cfg.drafts ? ["writer"] : [])]) run.emit("stage", { stage: s, state: "done" });
  return finish();

  function finish() {
    run.emit("stage", { stage: "excel", state: "done" });
    run.pushMetrics();
    run.done = true;
    const firms = [...run.firms.values()];
    run.emit("done", {
      summary: {
        firms: firms.length, scored: firms.filter((f) => f.fit != null).length,
        strong: firms.filter((f) => (f.fit ?? 0) >= 4).length, verified: run.metrics.verified,
        drafted: run.metrics.drafted, meetingReady: run.metrics.meetingReady, spend: run.metrics.spend,
        seconds: Math.round((Date.now() - run.startedAt) / 1000), stopped: run.aborted,
      },
    });
    run.log("ok", "pipeline", run.aborted ? "Run stopped. Partial sheet ready." : "Run complete. Excel ready.");
  }
}

/** @param {{name:string,title:string,linkedin_url:string,source_url:string}[]} leaders @param {string} best @param {string[]} roles */
function pickContact(leaders, best, roles) {
  const want = [best, ...roles].filter(Boolean).map((r) => r.toLowerCase());
  const keys = { ceo: ["ceo", "chief executive", "managing director", "presidente", "director general", "diretor-presidente", "country head"], "head of wealth": ["wealth", "private bank", "patrimon"], "head of partnerships": ["partner", "alliances", "business development", "distribution"], cio: ["cio", "chief investment"], "head of distribution": ["distribution", "sales"] };
  for (const w of want) {
    const ks = keys[w] || [w];
    const hit = leaders.find((l) => ks.some((k) => l.title.toLowerCase().includes(k)));
    if (hit) return hit;
  }
  return null;
}

/** Free sanity check: does the email's domain accept mail at all (MX record)? */
async function hasMailServer(domain) {
  if (!domain) return false;
  try { return (await dns.resolveMx(domain)).length > 0; } catch (e) {
    const code = /** @type {any} */ (e)?.code;
    return !(code === "ENOTFOUND" || code === "ENODATA");
  }
}

/** Firecrawl: homepage as clean markdown (first 12k chars). */
async function firecrawl(url) {
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    const j = await r.json();
    return String(j?.data?.markdown || "").slice(0, 12000);
  } catch { return ""; }
}

/** Hunter.io: find + verify. Returns null when Hunter can't help. */
async function hunter(domain, fullName, known) {
  if (!domain) return null;
  const key = process.env.HUNTER_API_KEY;
  try {
    let email = known;
    let score = null;
    if (!email) {
      const [first, ...rest] = fullName.split(/\s+/);
      const u = new URL("https://api.hunter.io/v2/email-finder");
      u.search = new URLSearchParams({ domain, first_name: first, last_name: rest.join(" "), api_key: String(key) }).toString();
      const d = (await (await fetch(u)).json()).data;
      if (!d?.email) return { email: "", emailStatus: "Not found", emailScore: null };
      email = d.email;
      score = d.score ?? null;
    }
    const v = new URL("https://api.hunter.io/v2/email-verifier");
    v.search = new URLSearchParams({ email, api_key: String(key) }).toString();
    const vd = (await (await fetch(v)).json()).data;
    const map = { valid: "Verified", accept_all: "Catch-all", invalid: "Invalid" };
    return { email, emailStatus: map[vd?.status] || "Unverified", emailScore: vd?.score ?? score };
  } catch {
    return null;
  }
}
