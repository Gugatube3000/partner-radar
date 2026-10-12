// @ts-check
// Firm overview plus one row per contact with source and verification provenance.
import ExcelJS from "exceljs";
import { personLinkedin, normalizeBusinessPhone, publicUrl } from "./research.js";

const GREEN = "FF034638", MINT = "FFE3F2D3", LEAF = "FFCDEBB0", AMBER = "FFE16B00", GREY = "FF5B6870";
const phoneTypeLabel = (type) => type === "direct" ? "Direct business line" : type === "company" ? "Company switchboard" : "";

/** A legacy or provider-only number must not become a sourced business number in an export. */
function sourcedPhone(value, type, source) {
  const phone = normalizeBusinessPhone(value), url = publicUrl(source);
  return phone && url && ["direct", "company"].includes(type) ? { phone, phoneType: type, phoneSourceUrl: url } : { phone: "", phoneType: "none", phoneSourceUrl: "" };
}

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.height = 34;
  row.eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function hyperlink(row, key) {
  const cell = row.getCell(key), url = publicUrl(cell.value);
  if (!url) return;
  cell.value = { text: url, hyperlink: url };
  cell.font = { name: "Arial", size: 10, color: { argb: "FF446CA9" }, underline: true };
}

function readableHeight(row, columns, max = 110) {
  const lines = Math.max(2, ...columns.map(([key, width]) => String(row.getCell(key).value || "").split(/\r?\n/).reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / width)), 0)));
  row.height = Math.min(max, 15 * lines + 10);
}

/** @param {import("./run.js").Run} run */
export async function buildWorkbook(run) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Partner Radar";
  const firms = [...run.firms.values()].sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0) || (b.fitConfidence ?? 0) - (a.fitConfidence ?? 0));

  const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  /** @type {[string, string, number][]} */
  const cols = [
    ["Firm", "name", 28], ["Country", "country", 12], ["City", "city", 15], ["Website", "website", 30], ["Type", "type", 17],
    ["Client segment", "segment", 16], ["Est. AUM", "aum", 14], ["Asset classes", "assetClasses", 30], ["Offers global equity?", "globalEquity", 12],
    ["Evidence", "globalEquityEvidence", 34], ["Languages", "languages", 14], ["Fit (1-5)", "fit", 9],
    ["Fit confidence", "fitConfidence", 11], ["Why it fits", "why", 44], ["Recommended next action", "nextAction", 44], ["Research notes", "researchWarnings", 55], ["Contact name", "contactName", 22],
    ["Title", "contactTitle", 24], ["Contact LinkedIn", "linkedin", 32], ["Contact phone", "contactPhone", 23], ["Phone type", "contactPhoneType", 24], ["Phone source", "contactPhoneSourceUrl", 34],
    ["Company switchboard", "companyPhone", 23], ["Company phone source", "companyPhoneSourceUrl", 34], ["Email", "email", 32], ["Email status", "emailStatus", 14],
    ["Email confidence %", "emailScore", 11], ["Email pattern", "emailPattern", 14], ["Pattern evidence", "emailEvidence", 40], ["Warm intro path", "warmIntro", 22], ["Recent news", "news", 34],
    ["Draft subject", "subject", 36], ["Draft email", "body", 60], ["English gist", "gist", 40],
    ["Contacts found", "contactCount", 12], ["LinkedIn coverage", "linkedinCoverage", 16], ["Public phone coverage", "phoneCoverage", 18], ["Contact source", "contactSourceUrl", 34], ["Role evidence", "roleEvidenceStatus", 20], ["Contact checked", "contactCheckedAt", 24],
    ["Data source", "source", 15], ["Source URL", "sourceUrl", 30], ["Date collected", "collectedAt", 13],
    ["Outreach status", "status", 16], ["Owner", "", 12], ["Notes", "", 30],
  ];
  ws.columns = cols.map(([header, key, width]) => ({ header, key: key || header, width }));
  styleHeader(ws);
  for (const f of firms) {
    const people = contactsForFirm(f);
    const primary = people.find((person) => person.name && person.name === f.contactName) || people.find((person) => person.email && person.email === f.email) || people[0] || {};
    const companyPhone = sourcedPhone(f.companyPhone, "company", f.companyPhoneSourceUrl);
    const row = ws.addRow({ ...f, researchWarnings: (f.researchWarnings || []).join("\n"), contactName: primary.name || f.contactName, contactTitle: primary.title || f.contactTitle, linkedin: primary.linkedin || "",
      contactPhone: primary.phone || "", contactPhoneType: phoneTypeLabel(primary.phoneType), contactPhoneSourceUrl: primary.phoneSourceUrl || "",
      companyPhone: companyPhone.phone, companyPhoneSourceUrl: companyPhone.phoneSourceUrl, contactSourceUrl: primary.sourceUrl || f.contactSourceUrl || "", roleEvidenceStatus: primary.roleEvidenceStatus || "", contactCheckedAt: primary.checkedAt || "",
      email: primary.email || "", emailStatus: primary.emailStatus || "", emailScore: primary.emailScore ?? null, emailPattern: primary.emailPattern || "", emailEvidence: primary.emailEvidence || "",
      contactCount: people.length, linkedinCoverage: `${people.filter((person) => person.linkedin).length}/${people.length}`, phoneCoverage: `${people.filter((person) => person.phone).length}/${people.length}`,
      fitConfidence: f.fitConfidence == null ? null : Math.round(f.fitConfidence * 100) / 100 });
    row.font = { name: "Arial", size: 10 };
    row.alignment = { vertical: "top" };
    for (const k of ["why", "body", "gist", "globalEquityEvidence", "news", "assetClasses", "nextAction", "researchWarnings"]) row.getCell(k).alignment = { vertical: "top", wrapText: true };
    const fit = row.getCell("fit");
    if ((f.fit ?? 0) >= 5) fit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LEAF } };
    else if ((f.fit ?? 0) >= 4) fit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MINT } };
    fit.font = { name: "Arial", size: 10, bold: true, color: { argb: GREEN } };
    const es = row.getCell("emailStatus");
    es.font = { name: "Arial", size: 10, bold: true, color: { argb: ["Verified", "Published"].includes(f.emailStatus) ? GREEN : f.emailStatus === "Inferred" ? "FF1B9A77" : f.emailStatus ? AMBER : GREY } };
    for (const key of ["website", "linkedin", "sourceUrl", "contactSourceUrl", "contactPhoneSourceUrl", "companyPhoneSourceUrl"]) hyperlink(row, key);
    readableHeight(row, [["why", 44], ["body", 60], ["gist", 40], ["nextAction", 44], ["researchWarnings", 55]], 180);
    row.getCell("contactPhone").numFmt = "@";
    row.getCell("companyPhone").numFmt = "@";
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const contacts = wb.addWorksheet("Contacts", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  const contactColumns = [
    ["Firm", "firm", 28], ["Country", "country", 22], ["Fit", "fit", 8], ["Name", "name", 26],
    ["Title", "title", 30], ["Work email", "email", 34], ["Email status", "emailStatus", 16],
    ["Email check", "emailCheck", 16], ["Confidence %", "emailScore", 14], ["Email pattern", "emailPattern", 18], ["Email fallback reason", "emailFallbackReason", 45], ["Found using", "provider", 18],
    ["Verified using", "verificationProvider", 18], ["Contact LinkedIn", "linkedin", 32], ["Business phone", "phone", 24], ["Phone type", "phoneType", 24], ["Phone source", "phoneSourceUrl", 40], ["Phone evidence", "phoneEvidence", 50], ["Person source", "sourceUrl", 40],
    ["Email evidence", "emailEvidence", 65], ["Email evidence URL", "emailEvidenceUrl", 40], ["Other sources", "sourceUrls", 50],
    ["Role evidence", "roleEvidenceStatus", 22], ["Role source date", "roleEvidenceDate", 18], ["Role evidence quote", "roleEvidenceQuote", 55], ["Checked at (UTC)", "checkedAt", 26],
    ["Company website", "website", 32], ["Collected", "collectedAt", 14],
  ];
  contacts.columns = contactColumns.map(([header, key, width]) => ({ header: String(header), key: String(key), width: Number(width) }));
  styleHeader(contacts);
  for (const firm of firms) for (const contact of contactsForFirm(firm)) {
    const row = contacts.addRow({ ...contact, phoneType: phoneTypeLabel(contact.phoneType), firm: firm.name, country: firm.country, fit: firm.fit, website: firm.website, collectedAt: contact.collectedAt || firm.collectedAt, sourceUrls: (contact.sourceUrls || []).join("; ") });
    row.font = { name: "Arial", size: 10 };
    row.alignment = { vertical: "top", wrapText: true };
    for (const key of ["linkedin", "sourceUrl", "emailEvidenceUrl", "phoneSourceUrl", "website"]) hyperlink(row, key);
    row.getCell("phone").numFmt = "@";
    readableHeight(row, [["title", 30], ["emailEvidence", 65], ["phoneEvidence", 50], ["roleEvidenceQuote", 55]]);
  }
  contacts.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: contactColumns.length } };

  const s = wb.addWorksheet("Run summary");
  s.columns = [{ width: 34 }, { width: 100 }];
  const m = run.metrics;
  const people = firms.flatMap(contactsForFirm);
  const rows = [
    ["Partner Radar run", run.id], ["Mode", run.mode === "demo" ? "DEMO (fictional data)" : run.engine === "claude-cli" ? "Live · your Claude plan" : `Live · ${run.engine}`],
    ["Country", `${run.country.flag || ""} ${run.country.name} (${run.country.language})`], ["Looking for", run.config.types.join(", ")], ["Decision-makers", run.config.roles.join(", ")],
    ["Initial time estimate", run.estimate?.label || "Not recorded for this saved run"], ["Estimate basis", run.estimate?.basis || ""], ["Estimate note", "Planning estimate only. Provider response time, research gaps and account limits can change the duration."],
    ["Research depth", run.config.researchDepth || "balanced"], ["Specific research brief", run.config.researchBrief || "No additional focus supplied"], ["Contacts per firm target", run.config.contactsPerFirm || 1], ["Named contacts", people.filter((person) => person.name).length],
    ["Contacts with LinkedIn", people.filter((person) => person.linkedin).length], ["Contacts with public business phone", people.filter((person) => person.phone).length], ["Direct business lines", people.filter((person) => person.phone && person.phoneType === "direct").length], ["Company switchboard references", people.filter((person) => person.phone && person.phoneType === "company").length],
    ["Roles backed by official pages", people.filter((person) => person.roleEvidenceStatus === "official_page").length],
    ["Data services configured", Object.entries(run.config.integrations || {}).filter(([, enabled]) => enabled).map(([id]) => id).join(", ") || "Public web only"],
    ["Firms mapped", firms.length], ["Scored", firms.filter((f) => f.fit != null).length],
    ["Fit 4-5", firms.filter((f) => (f.fit ?? 0) >= 4).length], ["Emails found", m.emails ?? 0], ["Verified emails", m.verified], ["Published emails", m.published || 0],
    ["Fit 4+ with published / verified email", m.meetingReady],
    ["Generated", new Date().toISOString().replace("T", " ").slice(0, 16)], ["", ""],
    ["Email status key", "Verified = checked by Hunter. Published = seen on a public page. Inferred = an address pattern or provider suggestion, with provenance. Guess = a plausible name-and-company-domain address without public pattern evidence. Catch-all = the mail server accepts unknown recipients; the mailbox is not confirmed. Invalid = rejected by the verifier. An MX record confirms a mail server, not an individual inbox."],
    ["Phone / LinkedIn key", "LinkedIn links are person profiles. Direct business line = a sourced professional office number for that person. Company switchboard = a shared company line, not their direct number. Missing fields remain blank; personal mobile numbers are not requested from providers."],
    ["Workbook guide", "Leads has one row per firm and its primary contact. Contacts has one row per person with evidence and phone type. Both sheets have filters and frozen headers. Keep number columns as text to preserve country codes."],
    ["Before you send", "Review every row. Follow Compliance review and local data-protection rules (e.g., GDPR, LGPD). Log the source of every contact."],
  ];
  rows.forEach((r, i) => {
    const row = s.addRow(r);
    row.font = { name: "Arial", size: 10, bold: i === 0 };
    row.getCell(1).font = { name: "Arial", size: 10, bold: true, color: { argb: GREEN } };
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    readableHeight(row, [[1, 34], [2, 100]], 385);
  });
  if (run.mode === "demo") {
    s.getCell("A1").value = "Partner Radar run (DEMO)";
  }

  const t = wb.addWorksheet("Template");
  t.columns = [{ width: 110 }];
  t.addRow(["Email template used for this run"]).font = { name: "Arial", bold: true, color: { argb: GREEN } };
  const templateRow = t.addRow([run.config.template || ""]);
  templateRow.alignment = { wrapText: true, vertical: "top" };
  readableHeight(templateRow, [[1, 110]], 280);
  return wb;
}

export function contactsForFirm(firm) {
  const contacts = firm.contacts?.length ? firm.contacts : firm.contactName || firm.email ? [{ name: firm.contactName, title: firm.contactTitle, email: firm.email, emailStatus: firm.emailStatus, emailCheck: firm.emailCheck || "not_checked", emailScore: firm.emailScore, emailEvidence: firm.emailEvidence, sourceUrl: firm.contactSourceUrl || "", linkedin: firm.linkedin, phone: firm.contactPhone, phoneType: firm.contactPhoneType, phoneSourceUrl: firm.contactPhoneSourceUrl, sourceUrls: [] }] : [];
  return contacts.map((contact) => ({ ...contact, linkedin: personLinkedin(contact.linkedin), ...sourcedPhone(contact.phone, contact.phoneType, contact.phoneSourceUrl), checkedAt: contact.checkedAt || "", collectedAt: contact.collectedAt || firm.collectedAt || "" }));
}

/** CSV exported as plain text; protect spreadsheet users from formula injection. */
export function buildCsv(run) {
  const headers = ["Firm", "Country", "Fit", "Name", "Title", "Work email", "Email status", "Email check", "Found using", "Verified using", "Contact LinkedIn", "Business phone", "Phone type", "Phone source", "Phone evidence", "Person source", "Email evidence", "Email evidence URL", "Role evidence", "Checked at (UTC)", "Collected", "Email pattern", "Email fallback reason"];
  const quote = (value) => { let text = String(value ?? ""); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
  const rows = [headers];
  for (const firm of [...run.firms.values()].sort((a, b) => (b.fit || 0) - (a.fit || 0))) for (const contact of contactsForFirm(firm)) rows.push([firm.name, firm.country, firm.fit, contact.name, contact.title, contact.email, contact.emailStatus, contact.emailCheck, contact.provider || "Public web", contact.verificationProvider || "", contact.linkedin, contact.phone, phoneTypeLabel(contact.phoneType), contact.phoneSourceUrl, contact.phoneEvidence || "", contact.sourceUrl, contact.emailEvidence, contact.emailEvidenceUrl, contact.roleEvidenceStatus || "", contact.checkedAt, contact.collectedAt, contact.emailPattern || "", contact.emailFallbackReason || ""]);
  return "\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}
