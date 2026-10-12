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
    ...contacts.flatMap((contact) => [contact.name, contact.title, contact.email, contact.emailStatus])].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(search.trim().toLowerCase()) && (fit === "all" || Number(firm.fit || 0) >= Number(fit)) &&
    (email === "all" || email === "found" && contacts.some(hasUsableEmail) ||
     email === "evidence" && contacts.some(hasEmailEvidence) || email === "missing" && !contacts.some(hasUsableEmail));
}

export function selectedEngine(stored, requested, engines) {
  const candidate = requested || stored;
  return engines.some((engine) => engine.id === candidate) ? candidate : "";
}
