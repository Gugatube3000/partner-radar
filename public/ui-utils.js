// Small shared helpers keep evidence labels and lead counts consistent.
export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function contactsForFirm(firm) {
  if (Array.isArray(firm.contacts) && firm.contacts.length) return firm.contacts;
  if (!firm.contactName && !firm.email) return [];
  return [{ name: firm.contactName, title: firm.contactTitle, linkedin: firm.linkedin, sourceUrl: firm.contactSourceUrl,
    phone: firm.contactPhone || firm.phone, phoneType: firm.contactPhoneType || firm.phoneType, phoneSourceUrl: firm.contactPhoneSourceUrl || firm.phoneSourceUrl,
    email: firm.email, emailStatus: firm.emailStatus, emailCheck: firm.emailCheck, emailScore: firm.emailScore,
    emailPattern: firm.emailPattern, emailEvidence: firm.emailEvidence, emailEvidenceUrl: firm.emailEvidenceUrl }];
}

export function hasUsableEmail(contact) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email || "")) &&
    !/invalid|no mail|not found/i.test(String(contact.emailStatus || "")) && !["invalid", "mx_missing"].includes(contact.emailCheck);
}

export function hasEmailEvidence(contact) {
  return hasUsableEmail(contact) && (/^(published|verified)$/i.test(String(contact.emailStatus)) || contact.emailCheck === "valid");
}

export function summarizeFirms(firms) {
  const people = new Set(), emails = new Set();
  for (const firm of firms) for (const contact of contactsForFirm(firm)) {
    if (contact.name) people.add(`${firm.id}:${String(contact.name).trim().toLowerCase()}`);
    if (hasUsableEmail(contact)) emails.add(String(contact.email).toLowerCase());
  }
  return { firms: firms.length, contacts: people.size, emails: emails.size };
}

export function matchesFirm(firm, { search = "", email = "all", fit = "all" } = {}) {
  const contacts = contactsForFirm(firm);
  const haystack = [firm.name, firm.type, firm.city, firm.country, firm.assetClasses,
    ...contacts.flatMap((contact) => [contact.name, contact.title, contact.email, contact.emailStatus, contact.phone, contact.linkedin])].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(search.trim().toLowerCase()) && (fit === "all" || Number(firm.fit || 0) >= Number(fit)) &&
    (email === "all" || email === "found" && contacts.some(hasUsableEmail) ||
     email === "evidence" && contacts.some(hasEmailEvidence) || email === "missing" && !contacts.some(hasUsableEmail));
}

export function selectedEngine(stored, requested, engines) {
  const candidate = requested || stored;
  return engines.some((engine) => engine.id === candidate) ? candidate : "";
}

export function estimateRange(low, high) {
  const lo = Number(low), hi = Number(high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < 0) return "Estimating…";
  if (hi < 1) return "Under a minute";
  const from = Math.max(1, Math.ceil(lo)), to = Math.max(from, Math.ceil(hi));
  return from === to ? `About ${to} min` : `${from}–${to} min`;
}

export function phoneLabel(type) {
  return type === "direct" ? "Professional direct number" : type === "company" ? "Company switchboard" : "Phone type not confirmed";
}

export function contactCoverage(firms) {
  const contacts = firms.flatMap(contactsForFirm);
  const personalLinkedin = (contact) => { const url = safeHttpUrl(contact.linkedin); return url && /(^|\.)linkedin\.com$/i.test(new URL(url).hostname) && /^\/in\/[^/]+\/?$/i.test(new URL(url).pathname); };
  return { people: contacts.filter((contact) => contact.name).length, evidenceEmails: contacts.filter(hasEmailEvidence).length, linkedin: contacts.filter(personalLinkedin).length, directPhones: contacts.filter((contact) => contact.phone && contact.phoneType === "direct" && safeHttpUrl(contact.phoneSourceUrl)).length, companyPhones: contacts.filter((contact) => contact.phone && contact.phoneType === "company" && safeHttpUrl(contact.phoneSourceUrl)).length };
}
