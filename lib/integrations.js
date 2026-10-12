// @ts-check
// Optional data services. Keys stay on this local server and are never returned to the browser.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { personLinkedin } from "./research.js";

const ENV_FILE = process.env.PARTNER_RADAR_ENV_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
export const INTEGRATIONS = {
  hunter: { id: "hunter", label: "Hunter", env: "HUNTER_API_KEY", description: "Find business emails by company and person, then check deliverability. Uses your Hunter credits.", setupUrl: "https://hunter.io/api-keys", docsUrl: "https://hunter.io/api-documentation/v2", mcpUrl: "https://hunter.io/mcp" },
  apollo: { id: "apollo", label: "Apollo", env: "APOLLO_API_KEY", description: "Enrich known decision-makers with work emails. API access and credits depend on your Apollo account.", setupUrl: "https://developer.apollo.io/#/keys", docsUrl: "https://docs.apollo.io/reference/people-enrichment", mcpUrl: "https://docs.apollo.io/docs/apollo-mcp" },
  firecrawl: { id: "firecrawl", label: "Firecrawl", env: "FIRECRAWL_API_KEY", description: "Read company websites for public contact evidence. Uses your Firecrawl credits.", setupUrl: "https://www.firecrawl.dev/app/api-keys", docsUrl: "https://docs.firecrawl.dev", mcpUrl: "https://docs.firecrawl.dev/mcp-server" },
};
const tests = new Map();
const cache = new Map();
const blocked = new Map();

export function integrationStatus() {
  return { integrations: Object.values(INTEGRATIONS).map(({ env, ...item }) => ({ ...item, connected: !!process.env[env], status: process.env[env] ? tests.get(item.id)?.status || "configured" : "not_configured", message: tests.get(item.id)?.message || "" })) };
}

/** Persist only known key fields, keeping all other .env configuration intact. */
export function saveIntegration(id, value) {
  if (!Object.hasOwn(INTEGRATIONS, id)) throw new Error("Unknown integration");
  const item = INTEGRATIONS[id];
  const key = String(value || "").trim();
  if (key && (!/^[A-Za-z0-9_.:-]{8,512}$/.test(key) || key === "test-api-key")) throw new Error("Enter a real API key without spaces or quotes");
  const original = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const lines = original.split(/\r?\n/).filter((line) => !new RegExp(`^\\s*(?:export\\s+)?${item.env}\\s*=`).test(line));
  while (lines.at(-1) === "") lines.pop();
  if (key) lines.push(`${item.env}=${key}`);
  const temp = `${ENV_FILE}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, lines.join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(temp, ENV_FILE);
  if (key) process.env[item.env] = key; else delete process.env[item.env];
  tests.delete(id); cache.clear(); blocked.delete(id);
  return integrationStatus();
}

function signalFor(signal) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000); }
function scrub(message) {
  let clean = String(message);
  for (const item of Object.values(INTEGRATIONS)) { const key = process.env[item.env]; if (key) clean = clean.split(key).join("[redacted]"); }
  return clean.slice(0, 250);
}

/** @param {string} id @param {string} endpoint @param {any} [options] */
async function request(id, endpoint, options = {}) {
  const item = INTEGRATIONS[id], key = process.env[item.env];
  if (!key) return null;
  const failure = blocked.get(id);
  if (!options.test && failure?.until > Date.now()) throw new Error(failure.message);
  const params = options.params || {};
  const fingerprint = crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
  const cacheKey = `${id}:${fingerprint}:${endpoint}:${JSON.stringify(params)}`;
  const hit = cache.get(cacheKey);
  if (!options.test && hit?.until > Date.now()) return hit.value;
  const base = id === "hunter" ? "https://api.hunter.io/v2/" : id === "apollo" ? "https://api.apollo.io/api/v1/" : "https://api.firecrawl.dev/v2/";
  const url = new URL(endpoint, base);
  const headers = { "Content-Type": "application/json", ...(id === "apollo" ? { "x-api-key": key } : { Authorization: `Bearer ${key}` }) };
  if (id === "hunter") for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const response = await fetch(url, { method: options.method || (id === "hunter" || options.test ? "GET" : "POST"), headers, signal: signalFor(options.signal), ...(id !== "hunter" && !options.test ? { body: JSON.stringify(params) } : {}) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`${item.label}: returned an invalid response`); }
  if (!response.ok || data.errors) {
    const hint = response.status === 401 ? "API key rejected" : response.status === 403 ? "your account lacks access to this endpoint" : response.status === 402 ? "credits exhausted" : response.status === 429 ? "rate or credit limit reached" : `request failed (${response.status})`;
    const message = `${item.label}: ${hint}`;
    if ([401, 402, 403, 429].includes(response.status)) blocked.set(id, { until: Date.now() + 60000, message });
    throw new Error(message);
  }
  if (!options.test) {
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { until: Date.now() + 300000, value: data });
  }
  return data;
}

export async function testIntegration(id) {
  if (!Object.hasOwn(INTEGRATIONS, id)) throw new Error("Unknown integration");
  if (!process.env[INTEGRATIONS[id].env]) throw new Error("Connect an API key first");
  const endpoint = id === "hunter" ? "account" : id === "apollo" ? "auth/health" : "team/credit-usage";
  try {
    const result = await request(id, endpoint, { test: true, method: "GET" });
    if (id === "apollo" && (result?.healthy !== true || result?.is_logged_in !== true)) throw new Error("Apollo: API key could not be validated");
    if (id !== "apollo" && (!result?.data || typeof result.data !== "object" || result.success === false)) throw new Error(`${INTEGRATIONS[id].label}: connection response could not be validated`);
    const value = { ok: true, status: "ready", message: `${INTEGRATIONS[id].label} connection checked. Discovery calls may use account credits.` };
    tests.set(id, value); blocked.delete(id); return value;
  } catch (error) {
    const value = { ok: false, status: "error", message: scrub(error?.message || error) };
    tests.set(id, value); return value;
  }
}

const emailValid = (email) => typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const companyEmail = (email, domain) => emailValid(email) && !/^(info|contact|support|hello|sales|marketing|press|media|office|admin|team|enquiries|inquiries|careers|recruitment|compliance|investorrelations|ir|customerservice|contato|contacto|partnerships)$/i.test(email.split("@")[0]) && !/(^|\.)(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|proton|gmx)\./i.test(domain) && email.split("@")[1].toLowerCase().replace(/^www\./, "") === domain.toLowerCase().replace(/^www\./, "");
const normalizeName = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const publicUrl = (url) => { try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : ""; } catch { return ""; } };
function hunterContact(data, original = {}) {
  const urls = (data.sources || []).map((source) => publicUrl(source.uri || source.url)).filter(Boolean);
  const verification = data.verification?.status;
  const email = data.email || data.value || original.email || "";
  const preserve = email.toLowerCase() === String(original.email || "").toLowerCase() && original.emailType === "published";
  const score = data.score ?? data.confidence;
  // A provider profile can add a LinkedIn without discarding an independent email check.
  const sameCheckedEmail = email.toLowerCase() === String(original.email || "").toLowerCase() && original.verificationProvider && original.emailCheck && original.emailCheck !== "not_checked";
  const keepEmail = emailValid(original.email) && (["Verified", "Published"].includes(original.emailStatus) || sameCheckedEmail) && !verification;
  const emailFields = keepEmail ? {} : { email, emailType: urls.length || preserve ? "published" : "inferred", emailStatus: verification === "valid" ? "Verified" : verification === "accept_all" ? "Catch-all" : verification === "invalid" ? "Invalid" : urls.length || preserve ? "Published" : "Inferred", emailCheck: verification || "not_checked", emailScore: score != null && Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Number(score))) : null, emailEvidence: urls.length ? `Hunter public sources: ${urls.join("; ")}` : preserve ? original.emailEvidence : "Hunter email finder; not a published address", emailEvidenceUrl: urls[0] || (preserve ? original.emailEvidenceUrl : "") || "", provider: "Hunter", verificationProvider: verification ? "Hunter" : "" };
  // Hunter documents linkedin on Domain Search and linkedin_url on Email Finder.
  // Its email sources do not establish that phone_number is a public business line.
  return { ...original, ...emailFields, name: original.name || [data.first_name, data.last_name].filter(Boolean).join(" "), title: original.title || data.position || "", linkedin: personLinkedin(original.linkedin) || personLinkedin(data.linkedin_url) || personLinkedin(data.linkedin), sourceUrl: original.sourceUrl || urls[0] || "", sourceUrls: [...new Set([...(original.sourceUrls || []), ...urls])], checkedAt: original.checkedAt || new Date().toISOString() };
}

function relevantRole(title, roles = []) {
  const text = String(title || "");
  if (/(chief|founder|partner|director|president|head|investment|distribution|wealth|business development|managing|institutional sales|\b(?:ceo|cio|coo|cfo|md)\b)/i.test(text)) return true;
  return roles.some((role) => {
    const words = String(role).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2 && !["the", "and", "head", "chief", "officer"].includes(word));
    return words.length > 0 && words.every((word) => text.toLowerCase().includes(word));
  });
}

/** Fetch named professional contacts; never request personal emails or phone numbers. */
export async function enrichContacts(domain, contacts, options = {}) {
  let output = contacts.map((contact) => ({ ...contact }));
  const limit = Math.max(1, Math.min(8, options.limit || 3));
  const enabled = options.integrations || { hunter: true, apollo: true };
  const activity = options.onActivity || (() => {});
  async function attempt(id, callback) {
    if (!enabled[id] || !process.env[INTEGRATIONS[id].env]) return;
    options.signal?.throwIfAborted();
    try { await callback(); } catch (error) { if (options.signal?.aborted) throw error; activity(`warning · ${scrub(error?.message || error)}`); }
  }
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return output.slice(0, limit);
  await attempt("hunter", async () => {
    activity(`Hunter · searching professional contacts at ${domain}`);
    const result = await request("hunter", "domain-search", { params: { domain, type: "personal", limit: Math.min(100, limit * 4) }, signal: options.signal });
    for (const candidate of result?.data?.emails || []) {
      if (!candidate.first_name || !candidate.last_name || !companyEmail(candidate.value, domain)) continue;
      // Domain search is intentionally restricted to named business contacts in relevant roles.
      if (!relevantRole(candidate.position, options.roles || [])) continue;
      const match = output.findIndex((person) => normalizeName(person.name) === normalizeName(`${candidate.first_name} ${candidate.last_name}`));
      const enriched = hunterContact(candidate, match >= 0 ? output[match] : {});
      if (match >= 0) output[match] = enriched; else if (output.length < limit && enriched.sourceUrl) output.push(enriched);
    }
    for (let index = 0; index < Math.min(output.length, limit); index++) {
      const contact = output[index];
      if (contact.email && !["Guess", "Inferred", "Unverified", "Invalid"].includes(contact.emailStatus) && personLinkedin(contact.linkedin)) continue;
      if (!contact.name?.trim().includes(" ")) continue;
      activity(`Hunter · email finder for ${contact.name}`);
      const result = await request("hunter", "email-finder", { params: { domain, full_name: contact.name }, signal: options.signal });
      const returnedName = [result?.data?.first_name, result?.data?.last_name].filter(Boolean).join(" ");
      if (companyEmail(result?.data?.email, domain) && (!returnedName || normalizeName(returnedName) === normalizeName(contact.name))) output[index] = hunterContact(result.data, contact);
    }
  });
  for (let index = 0; index < Math.min(output.length, limit); index++) {
    const contact = output[index];
    const keepEmail = emailValid(contact.email) && ["Published", "Verified"].includes(contact.emailStatus);
    if (keepEmail && personLinkedin(contact.linkedin)) continue;
    await attempt("apollo", async () => {
      if (!contact.name?.trim()) return;
      activity(`Apollo · looking up professional profile for ${contact.name}`);
      const linkedin = personLinkedin(contact.linkedin);
      const result = await request("apollo", "people/match", { params: { name: contact.name, domain, ...(linkedin ? { linkedin_url: linkedin } : {}), reveal_personal_emails: false, reveal_phone_number: false }, signal: options.signal });
      const person = result?.person;
      if (!person || ["none", "low"].includes(result.match_confidence || person.match_confidence)) return;
      if (normalizeName(person.name || [person.first_name, person.last_name].filter(Boolean).join(" ")) !== normalizeName(contact.name)) return;
      const orgDomain = person.organization?.primary_domain || "";
      if (orgDomain && orgDomain.replace(/^www\./, "").toLowerCase() !== domain.toLowerCase()) return;
      const foundEmail = companyEmail(person.email, domain);
      // A company-domain email or the matching organization is required even for profile-only data.
      if (!foundEmail && !orgDomain) return;
      const sameCheckedEmail = foundEmail && person.email.toLowerCase() === String(contact.email || "").toLowerCase() && contact.verificationProvider && contact.emailCheck && contact.emailCheck !== "not_checked";
      const emailFields = keepEmail || sameCheckedEmail || !foundEmail ? {} : { email: person.email, emailType: "inferred", emailStatus: "Unverified", emailCheck: "not_checked", emailEvidence: `Apollo professional enrichment; provider email status: ${person.email_status || "unknown"}. Deliverability has not been independently checked.`, emailEvidenceUrl: "", provider: "Apollo", verificationProvider: "" };
      output[index] = { ...contact, ...emailFields, title: contact.title || person.title || "", linkedin: linkedin || personLinkedin(person.linkedin_url), checkedAt: contact.checkedAt || new Date().toISOString() };
    });
  }
  const deduped = [...new Map(output.map((contact) => [normalizeName(contact.name) || contact.email?.toLowerCase(), contact])).values()].slice(0, limit);
  if (enabled.hunter && process.env.HUNTER_API_KEY) for (const contact of deduped) {
    if (!emailValid(contact.email) || contact.emailStatus === "Verified") continue;
    await attempt("hunter", async () => {
      activity(`Hunter · verifying ${contact.email}`);
      const result = await request("hunter", "email-verifier", { params: { email: contact.email }, signal: options.signal });
      const check = result?.data;
      const state = check?.status || check?.result;
      contact.emailCheck = state === "deliverable" ? "valid" : state === "undeliverable" ? "invalid" : state || "unknown";
      if (Number.isFinite(Number(check?.score)) && check?.score != null) contact.emailScore = Number(check.score);
      contact.emailStatus = state === "valid" || state === "deliverable" ? "Verified" : state === "accept_all" ? "Catch-all" : state === "invalid" || state === "undeliverable" ? "Invalid" : contact.emailType === "published" ? "Published" : "Unverified";
      contact.verificationProvider = "Hunter";
      contact.emailEvidence = `${contact.emailEvidence || ""}${contact.emailEvidence ? " · " : ""}Hunter verifier: ${state || "unknown"}`;
    });
  }
  return deduped;
}
