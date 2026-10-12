// Deterministic business-email fallback after public research and enrichment.
import { domainOf, publicUrl } from "./research.js";

const FREE_DOMAIN = /(^|\.)(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|proton|mail|gmx)\./i;
const SHARED = /^(info|contact|support|hello|sales|marketing|press|media|office|admin|team|enquiries|inquiries|careers|recruitment|compliance|investorrelations|ir|customerservice|contato|contacto|partnerships)$/i;
const FORMATS = ["first.last", "flast", "firstlast", "first", "first_last", "first-last", "firstl", "first.l", "last.first", "lastf", "f.last", "last"];
const normalize = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

function nameParts(name) {
  const words = normalize(name).replace(/^(?:(?:mr|mrs|ms|miss|dr|prof)\.?\s+)+/, "").replace(/\s+(?:jr|sr|ii|iii|iv|esq|cfa|cpa)\.?$/, "").trim().split(/\s+/).map((word) => word.replace(/^([a-z])\.$/, "$1"));
  // Use a researched Latin spelling; do not invent transliterations or initials.
  if (!words.length || /\b(unknown|anonymous|unavailable|tbd)\b/.test(words.join(" ")) || words.some((word) => !/^[a-z]+(?:['’.-][a-z]+)*$/.test(word))) return null;
  const first = words[0].replace(/[^a-z]/g, ""), last = words.length > 1 ? words.at(-1).replace(/[^a-z]/g, "") : "";
  return first.length >= 2 || first.length === 1 && last ? { first, last, f: first[0], l: last[0] || "" } : null;
}
function localPart(name, format) {
  const parts = nameParts(name);
  if (!parts || format !== "first" && !parts.last) return "";
  if (parts.first.length === 1 && !["flast", "f.last", "lastf"].includes(format)) return "";
  return format.replace(/first|last|f|l/g, (token) => parts[token]);
}
function businessEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const [local, domain] = email.split("@");
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) &&
    !SHARED.test(local) && !FREE_DOMAIN.test(domain) && publicUrl(`https://${domain}`) ? email : "";
}
function canonicalFormat(value) {
  return FORMATS.find((format) => format === String(value || "").toLowerCase().replace(/@.*$/, "").trim()) || "";
}

/** Fill missing emails, or improve guesses using observed formats; keep verifier results.
 * @param {any[]} contacts @param {{firm:any,pages?:any[]}} options
 */
export function fillEmailCandidates(contacts, { firm, pages = [] }) {
  const domain = domainOf(firm?.website);
  const companyDomain = domain && publicUrl(`https://${domain}`) && !FREE_DOMAIN.test(domain) ? domain : "";
  const patterns = new Map();
  function observe(format, email, url) {
    if (!format || !businessEmail(email) || !publicUrl(url)) return;
    const key = `${format}@${email.split("@")[1]}`;
    const previous = patterns.get(key);
    if (previous) { previous.examples.add(email); return; }
    patterns.set(key, { format, domain: email.split("@")[1], example: email, url, examples: new Set([email]) });
  }
  for (const contact of contacts) {
    const email = businessEmail(contact.email);
    if (!email || ["invalid", "mx_missing"].includes(contact.emailCheck)) continue;
    if (["Published", "Verified"].includes(contact.emailStatus) && contact.emailEvidenceUrl) {
      for (const format of FORMATS) if (localPart(contact.name, format) === email.split("@")[0]) observe(format, email, contact.emailEvidenceUrl);
    }
    // Reuse a documented format even when its public example belongs to another employee.
    if (contact.emailType === "inferred" && contact.emailEvidenceUrl) {
      const format = canonicalFormat(contact.emailPattern);
      const examples = String(contact.emailEvidence || "").match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
      for (const example of examples) if (example.toLowerCase().split("@")[1] === email.split("@")[1] && localPart(contact.name, format) === email.split("@")[0]) observe(format, example.toLowerCase(), contact.emailEvidenceUrl);
    }
  }
  const published = new Map();
  for (const page of pages) {
    if (!publicUrl(page.url) || domainOf(page.url) !== companyDomain) continue;
    const text = normalize(page.text);
    for (const contact of contacts) for (const format of FORMATS) {
      const local = localPart(contact.name, format);
      if (!local || SHARED.test(local)) continue;
      for (const raw of page.emails || []) {
        const email = businessEmail(raw);
        if (!email || email.split("@")[0] !== local) continue;
        const at = text.indexOf(normalize(contact.name));
        // Bind an example to this employee using nearby name-and-email evidence.
        if (at < 0 || !text.slice(Math.max(0, at - 100), at + 350).includes(email)) continue;
        observe(format, email, page.url);
        if (!published.has(contact.name)) published.set(contact.name, { email, url: page.url, format });
      }
    }
  }
  const ranked = [...patterns.values()].sort((a, b) => b.examples.size - a.examples.size || FORMATS.indexOf(a.format) - FORMATS.indexOf(b.format));
  const occupied = new Set(contacts.filter((contact) => contact.email).map((contact) => contact.email.toLowerCase()));
  return contacts.map((contact) => {
    const original = businessEmail(contact.email);
    // A rejection or mailbox check refers to this exact address. Never erase it with a guess.
    if (contact.email && (contact.emailStatus !== "Guess" || contact.verificationProvider || ["valid", "invalid", "accept_all", "mx_missing"].includes(contact.emailCheck))) return { ...contact };
    const exact = published.get(contact.name);
    const usable = (email) => businessEmail(email) && (email === original || !occupied.has(email));
    let candidate;
    if (exact && usable(exact.email)) candidate = { email: exact.email, emailType: "published", emailStatus: "Published", emailPattern: exact.format, emailScore: 95, emailEvidence: `Address published with ${contact.name} on ${exact.url}`, emailEvidenceUrl: exact.url };
    if (!candidate) for (const pattern of ranked) {
      const local = localPart(contact.name, pattern.format), email = local ? `${local}@${pattern.domain}` : "";
      if (usable(email)) {
        candidate = { email, emailType: "inferred", emailStatus: "Inferred", emailPattern: pattern.format, emailScore: pattern.examples.size > 1 ? 80 : 65, emailEvidence: `Observed company format ${pattern.format}: ${pattern.example} on ${pattern.url}. Applied to ${contact.name}; mailbox not verified.`, emailEvidenceUrl: pattern.url };
        break;
      }
    }
    if (!candidate && original) return { ...contact };
    if (!candidate && companyDomain) for (const format of ["first.last", "flast", "firstlast", "first"]) {
      const local = localPart(contact.name, format), email = local ? `${local}@${companyDomain}` : "";
      if (usable(email)) {
        candidate = { email, emailType: "guess", emailStatus: "Guess", emailPattern: format, emailScore: 30, emailEvidence: `Unconfirmed ${format} guess from the researched name and company website domain ${companyDomain}; no public format evidence or mailbox verification.`, emailEvidenceUrl: "" };
        break;
      }
    }
    if (!candidate) return { ...contact, emailFallbackReason: !nameParts(contact.name) ? "A researched Latin spelling is needed to construct an email." : !companyDomain ? "A company business email domain is needed." : "The plausible addresses overlap another contact; a distinct company format is needed." };
    if (original) occupied.delete(original);
    occupied.add(candidate.email);
    const same = candidate.email === original;
    return { ...contact, ...candidate, emailCheck: same ? contact.emailCheck || "not_checked" : "not_checked", verificationProvider: "", emailFallbackReason: "", sourceUrls: [...new Set([...(contact.sourceUrls || []), candidate.emailEvidenceUrl].filter(Boolean))] };
  });
}
