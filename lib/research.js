// @ts-check
// Public-source collection and evidence handling. Page content is untrusted data.
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

export const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function domainOf(value) {
  if (!value || typeof value !== "string") return "";
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

export function isPublicAddress(address) {
  const ip = String(address || "").toLowerCase();
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || (a === 192 && b === 88 && c === 99));
  }
  if (net.isIP(ip) === 6) {
    if (ip.startsWith("::ffff:")) {
      const mapped = ip.slice(7);
      if (net.isIP(mapped) === 4) return isPublicAddress(mapped);
      const pieces = mapped.split(":");
      if (pieces.length === 2) {
        const hi = parseInt(pieces[0], 16), lo = parseInt(pieces[1], 16);
        return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return false;
    }
    // Permit global unicast only; exclude local, multicast and documentation ranges.
    return /^[23]/.test(ip) && !ip.startsWith("2001:db8:");
  }
  return false;
}

/** Syntactic validation also used for evidence URLs, which are never automatically opened. */
export function publicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port)) || host === "localhost" ||
      /\.(localhost|local|internal|lan|home|invalid|example|test)$/.test(host) ||
      (!host.includes(".") && !net.isIP(host)) || (net.isIP(host) && !isPublicAddress(host))) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

/** Reject URLs that resolve to any private address, including redirects. */
export async function assertPublicUrl(value, { lookup = dns.lookup } = {}) {
  return (await publicTarget(value, lookup)).url;
}

async function publicTarget(value, lookup) {
  const normalized = publicUrl(value);
  if (!normalized) throw new Error("Only public HTTP(S) pages are allowed");
  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await deadline(lookup(host, { all: true }), 4000);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error("Page resolves to a private or reserved network");
  return { url: normalized, addresses };
}

function deadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Public DNS lookup timed out")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Connect only to the validated IPs. A second DNS lookup cannot rebind to localhost. */
function pinnedFetch(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const transport = new URL(url).protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "GET", agent: false, signal: options.signal, headers: options.headers,
      lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family || net.isIP(addresses[0].address));
      },
    }, (response) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value != null) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      const status = response.statusCode || 502;
      resolve(new Response([204, 205, 304].includes(status) ? null : /** @type {any} */ (Readable.toWeb(response)), { status, headers }));
    });
    request.once("error", reject);
    request.end();
  });
}

function entities(value) {
  return String(value).replace(/&#(x[\da-f]+|\d+);?/gi, (_, n) => {
    const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[n]));
}

export function extractPage(html, url) {
  const clean = String(html).replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const text = entities(clean.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const emails = [...new Set((entities(clean).match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
  const links = [];
  for (const match of clean.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { links.push({ url: new URL(entities(match[1]), url).href, label: entities(match[2].replace(/<[^>]*>/g, " ")).trim() }); } catch {}
  }
  return { url, text: text.slice(0, 22000), emails, links };
}

async function pageFetch(url, { signal, fetchImpl, lookup, allowedDomain }) {
  const scoped = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]);
  let current = url;
  for (let redirect = 0; redirect <= 4; redirect++) {
    const target = await publicTarget(current, lookup);
    scoped.throwIfAborted();
    if (domainOf(current) !== allowedDomain) throw new Error("Redirect left the official website");
    const options = { signal: scoped, redirect: "manual", headers: { "User-Agent": "PartnerRadar/2.0 PublicBusinessResearch", Accept: "text/html,text/plain;q=0.9" } };
    const response = fetchImpl ? await fetchImpl(current, options) : await pinnedFetch(current, options, target.addresses);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect has no location");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Public page returned HTTP ${response.status}`); }
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel(); throw new Error("Unsupported page type");
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    let bytes = 0, html = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 550000) break;
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    } finally { await reader.cancel(); }
    return extractPage(html, current);
  }
  throw new Error("Too many page redirects");
}

/** A small, same-domain crawl of team/contact pages. Does not submit forms or download files. */
export async function collectPublicPages(website, options = {}) {
  const { signal, depth = "balanced", onActivity = () => {}, fetchImpl = null, lookup = dns.lookup } = options;
  const initial = publicUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  if (!initial) return { pages: [], text: "" };
  const allowedDomain = domainOf(initial), pages = [], visited = new Set();
  const limit = depth === "deep" ? 7 : 4;
  const useful = /team|leadership|management|people|about|contact|press|investor|equipo|equipa|equipe|contato|contacto|nosotros|quem-somos|executive|board|direction|unternehmen|kontakt|équipe|聯絡|联系|团队|회사|연락|経営|会社|اتصل/i;
  const queue = [initial];
  let fallbackAdded = false;
  while (queue.length && pages.length < limit && visited.size < limit + 3) {
    signal?.throwIfAborted();
    const batch = queue.splice(0, Math.min(2, limit - pages.length));
    const fetched = await Promise.all(batch.map(async (url) => {
      if (visited.has(url)) return null;
      visited.add(url);
      try {
        onActivity(`read · public page ${url}`);
        return await pageFetch(url, { signal, fetchImpl, lookup, allowedDomain });
      } catch (error) {
        if (signal?.aborted) throw error;
        onActivity(`public page unavailable · ${new URL(url).pathname}`);
        return null;
      }
    }));
    for (const page of fetched.filter(Boolean)) {
      pages.push(page);
      for (const link of page.links) {
        const url = publicUrl(link.url);
        if (url && domainOf(url) === allowedDomain && useful.test(`${new URL(url).pathname} ${link.label}`) &&
          !/\.(pdf|zip|xlsx?|docx?|png|jpe?g|webp)$/i.test(new URL(url).pathname) && !visited.has(url) && !queue.includes(url)) queue.push(url);
      }
    }
    if (!fallbackAdded) {
      fallbackAdded = true;
      for (const path of ["/contact", "/about", "/team"]) {
        const url = new URL(path, initial).href;
        if (!visited.has(url) && !queue.includes(url)) queue.push(url);
      }
    }
  }
  return {
    pages,
    text: pages.map((p) => `SOURCE: ${p.url}\nPUBLIC BUSINESS EMAILS: ${p.emails.join(", ") || "None found"}\n${p.text}`).join("\n\n").slice(0, depth === "deep" ? 42000 : 25000),
  };
}

const mailCache = new Map();
/** MX presence proves only that a domain accepts mail. Network errors remain unknown.
 * @param {string} domain @param {any} [options]
 */
export async function checkMailDomain(domain, { resolveMx = dns.resolveMx, signal } = {}) {
  signal?.throwIfAborted();
  if (!domain || !publicUrl(`https://${domain}`)) return "mx_missing";
  const cached = mailCache.get(domain);
  if (resolveMx === dns.resolveMx && cached?.until > Date.now()) return cached.promise;
  const promise = Promise.race([
    resolveMx(domain).then((records) => records.some((r) => r.exchange && r.exchange !== ".") ? "mx_present" : "mx_missing"),
    new Promise((resolve) => { const timer = setTimeout(() => resolve("unknown"), 4000); timer.unref?.(); }),
  ]).catch((e) => ["ENOTFOUND", "ENODATA"].includes(e.code) ? "mx_missing" : "unknown");
  if (resolveMx === dns.resolveMx) {
    if (mailCache.size > 500) mailCache.delete(mailCache.keys().next().value);
    mailCache.set(domain, { until: Date.now() + 900000, promise });
  }
  const result = await promise;
  signal?.throwIfAborted();
  return result;
}

const CONTACT_LABEL = { published: "Published", inferred: "Inferred", guess: "Guess", none: "Not found" };
const FREE_MAIL = /(^|\.)(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|proton|mail|gmx)\./i;
const GENERIC_MAIL = /^(info|contact|support|hello|sales|marketing|press|media|office|admin|team|enquiries|inquiries|careers|recruitment|compliance|investorrelations|ir|customerservice|contato|contacto|partnerships)$/i;

export function contactId(firmId, name) {
  const key = String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(`${firmId || ""}:${key}`).digest("hex").slice(0, 16);
}

/** Normalize evidence and deduplicate named professional contacts. No guess becomes verified.
 * @param {any[]} raw @param {any} [options]
 */
export function normalizeContacts(raw, { firm, pages = [], limit = 3, demo = false } = {}) {
  const contacts = [], seenNames = new Set(), seenEmails = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const name = String(item.name || "").replace(/["“”<>]/g, "").trim().slice(0, 140);
    const key = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
    const sourceUrl = publicUrl(item.sourceUrl || item.source_url);
    if (!name || seenNames.has(key) || (!demo && !sourceUrl)) continue;
    let email = String(item.email || "").trim().toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ||
      (!demo && (FREE_MAIL.test(email.split("@")[1] || "") || GENERIC_MAIL.test(email.split("@")[0] || "")))) email = "";
    if (email && seenEmails.has(email)) email = "";
    let emailType = item.emailType || item.email_type;
    if (!["published", "inferred", "guess", "none"].includes(emailType)) emailType = email ? "guess" : "none";
    let evidence = String(item.emailEvidence || item.pattern_evidence || "").trim().slice(0, 1600);
    let evidenceUrl = publicUrl(item.emailEvidenceUrl || item.email_evidence_url);
    const publishedPage = pages.find((p) => p.emails?.includes(email));
    if (email && publishedPage) { emailType = "published"; evidenceUrl = publishedPage.url; evidence = `Address published on ${publishedPage.url}`; }
    if (email && emailType === "published" && !demo && !evidenceUrl) {
      emailType = "guess";
      evidence = "The model reported a published address without an email source URL. Review before use.";
    }
    const examples = evidence.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    if (email && emailType === "inferred" && !demo && (!evidenceUrl || !examples.some((example) => example.toLowerCase().split("@")[1] === email.split("@")[1]))) {
      emailType = "guess";
      evidence = "No public example and source URL confirm this format. Review before use.";
    }
    if (!email) emailType = "none";
    const score = Number(item.emailScore ?? (item.email_confidence == null ? NaN : Number(item.email_confidence) * 100));
    const cap = { published: 99, inferred: 85, guess: 40, none: 0 }[emailType];
    const emailScore = email ? Math.round(Math.min(cap, Number.isFinite(score) ? Math.max(0, score) : cap)) : null;
    seenNames.add(key);
    if (email) seenEmails.add(email);
    contacts.push({
      id: contactId(firm?.id, key),
      name, title: String(item.title || "").trim().slice(0, 180),
      linkedin: publicUrl(item.linkedin || item.linkedin_url), sourceUrl,
      email, emailType, emailStatus: CONTACT_LABEL[emailType], emailCheck: "not_checked", emailScore,
      emailPattern: String(item.emailPattern || item.email_pattern || "").slice(0, 120),
      emailEvidence: evidence, emailEvidenceUrl: evidenceUrl,
      sourceUrls: [...new Set([sourceUrl, evidenceUrl].filter(Boolean))], provider: String(item.provider || "Public research"),
    });
    if (contacts.length >= Math.max(1, Math.min(8, limit))) break;
  }
  return contacts;
}

export function primaryContact(contacts) {
  const rank = { Verified: 8, Published: 7, Inferred: 6, "Catch-all": 4, Unverified: 3, Guess: 2, "Not found": 1, Invalid: -1, "No mail server": -2 };
  return [...contacts].sort((a, b) => (rank[b.emailStatus] || 0) - (rank[a.emailStatus] || 0) || (b.emailScore || 0) - (a.emailScore || 0))[0] || null;
}

/** Keep only unique company names AND websites, so branches do not inflate the target. */
export function dedupeFirms(firms, existing = [], limit = Infinity, demo = false) {
  const names = new Set(existing.map((f) => firmNameKey(f.name))), domains = new Set(existing.map((f) => domainOf(f.website)).filter(Boolean)), result = [];
  for (const firm of firms || []) {
    const name = String(firm.name || "").trim(), nameKey = firmNameKey(name), domain = domainOf(firm.website);
    if (!name || names.has(nameKey) || (domain && domains.has(domain))) continue;
    names.add(nameKey); if (domain) domains.add(domain);
    result.push({ ...firm, name, website: demo ? String(firm.website || "") : publicUrl(/^https?:\/\//i.test(firm.website || "") ? firm.website : `https://${firm.website || ""}`) });
    if (result.length >= limit) break;
  }
  return result;
}

function firmNameKey(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(ltd|limited|inc|incorporated|llc|plc|sa|s\.a\.|corp|corporation)\b/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

const ROLE_KEYS = {
  ceo: ["ceo", "chief executive", "managing director", "presidente", "director general", "diretor-presidente", "country head"],
  "head of wealth": ["wealth", "private bank", "patrimon"],
  "head of partnerships": ["partner", "alliances", "business development"],
  cio: ["cio", "chief investment", "investment director"],
  "head of distribution": ["distribution", "sales", "wholesale"],
  "head of business development": ["business development", "commercial", "development", "negócios"],
  "head of product": ["product", "solutions", "strategy"],
  "head of institutional sales": ["institutional", "sales", "client"],
};

export function pickContacts(leaders, best, roles, limit = 3) {
  const wants = [best, ...(roles || [])].filter(Boolean).map((r) => r.toLowerCase()), result = [], names = new Set();
  for (const want of wants) {
    for (const leader of leaders || []) {
      if (names.has(String(leader.name).toLowerCase()) || !(ROLE_KEYS[want] || [want]).some((k) => String(leader.title || "").toLowerCase().includes(k))) continue;
      names.add(String(leader.name).toLowerCase()); result.push(leader);
      if (result.length >= limit) return result;
    }
  }
  return result;
}
