import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildWorkbook, buildCsv, contactsForFirm } from "../lib/excel.js";

function fixture() {
  const contacts = [
    { name: "José Muñoz", title: "Head of Partnerships", email: "jose@atlascapital.com", emailStatus: "Verified", emailCheck: "valid", emailScore: 95, provider: "Hunter", verificationProvider: "Hunter", linkedin: "https://www.linkedin.com/in/jose-munoz?trk=search", phone: "+44 20 7123 4567 ext 21", phoneType: "direct", phoneSourceUrl: "https://atlascapital.com/team/jose", phoneEvidence: "José Muñoz, direct business line: +44 20 7123 4567 ext 21", sourceUrl: "https://atlascapital.com/team/jose", sourceUrls: ["https://atlascapital.com/team/jose"], roleEvidenceStatus: "official_page", checkedAt: "2026-10-12T09:01:02.000Z" },
    { name: "池田 美咲", title: "Chief Investment Officer", email: "misaki@atlascapital.com", emailStatus: "Published", emailCheck: "mx_present", linkedin: "https://www.linkedin.com/in/misaki-ikeda", phone: "+81 3 1234 5678", phoneType: "company", phoneSourceUrl: "https://atlascapital.com/contact", emailEvidence: "Published on the official team page", emailEvidenceUrl: "https://atlascapital.com/team/misaki", sourceUrl: "https://atlascapital.com/team/misaki", sourceUrls: [], roleEvidenceStatus: "public_source" },
    { name: "Sam Review", title: "Director", email: "", emailStatus: "Not found", linkedin: "https://www.linkedin.com/company/atlas", phone: "+1 202 555 0123", phoneType: "direct", sourceUrls: [] },
  ];
  return {
    id: "fixture-run", mode: "live", engine: "codex-cli", estimate: { label: "About 8–14 minutes", basis: "Based on planned research passes" },
    config: { types: ["Asset managers"], roles: ["Head of Partnerships", "CIO"], researchDepth: "deep", researchBrief: "Prioritize firms serving institutional clients in Tokyo.", contactsPerFirm: 3, integrations: { hunter: true }, template: "Hello {{name}},\nLet's discuss a partnership." },
    country: { name: "Japan", flag: "🇯🇵", language: "Japanese" }, metrics: { contacts: 3, emails: 2, verified: 1, meetingReady: 1 },
    firms: new Map([["atlas", { id: "atlas", name: "Atlas Capital", country: "Japan", website: "https://atlascapital.com/", fit: 5, fitConfidence: .9, why: "Strong institutional distribution presence.", contactName: "José Muñoz", contacts, collectedAt: "2026-10-12", companyPhone: "+81 3 1234 5678", companyPhoneSourceUrl: "https://atlascapital.com/contact" }]]),
  };
}

test("workbook round trip preserves every person, person LinkedIn, sourced text phones and verifier provenance", async () => {
  const source = await buildWorkbook(fixture());
  const bytes = await source.xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const contacts = workbook.getWorksheet("Contacts");
  assert.equal(contacts.rowCount, 4);
  // Column keys are not persisted by XLSX, so use the saved headers to address cells after loading.
  const column = (sheet, header) => sheet.getRow(1).values.findIndex((value) => value === header);
  const cell = (row, header) => contacts.getRow(row).getCell(column(contacts, header));
  assert.equal(cell(2, "Name").value, "José Muñoz");
  assert.equal(cell(3, "Name").value, "池田 美咲");
  assert.equal(cell(2, "Contact LinkedIn").value.hyperlink, "https://www.linkedin.com/in/jose-munoz");
  assert.equal(cell(2, "Business phone").value, "+442071234567 ext 21");
  assert.equal(cell(2, "Business phone").numFmt, "@");
  assert.equal(cell(2, "Phone type").value, "Direct business line");
  assert.equal(cell(3, "Phone type").value, "Company switchboard");
  assert.equal(cell(2, "Phone source").value.hyperlink, "https://atlascapital.com/team/jose");
  assert.equal(cell(2, "Email status").value, "Verified");
  assert.equal(cell(2, "Verified using").value, "Hunter");
  assert.equal(cell(2, "Checked at (UTC)").value, "2026-10-12T09:01:02.000Z");
  assert.equal(cell(4, "Contact LinkedIn").value, "");
  assert.equal(cell(4, "Business phone").value, "");
  assert.equal(contacts.views[0].state, "frozen");
  assert.ok(contacts.autoFilter);
  assert.ok(contacts.getRow(2).height >= 40);
  const leads = workbook.getWorksheet("Leads");
  assert.equal(leads.getRow(2).getCell(column(leads, "Contact LinkedIn")).value.hyperlink, "https://www.linkedin.com/in/jose-munoz");
  assert.equal(leads.getRow(2).getCell(column(leads, "Contact phone")).value, "+442071234567 ext 21");
  assert.equal(leads.getRow(2).getCell(column(leads, "Company switchboard")).value, "+81312345678");
  assert.equal(leads.getRow(2).getCell(column(leads, "LinkedIn coverage")).value, "2/3");
  const summaryRows = workbook.getWorksheet("Run summary").getSheetValues().slice(1).map((row) => row.slice(1));
  assert.ok(summaryRows.some(([key, value]) => key === "Specific research brief" && value.includes("Tokyo")));
  assert.ok(summaryRows.some(([key, value]) => key === "Initial time estimate" && value === "About 8–14 minutes"));
  assert.ok(summaryRows.some(([key, value]) => key === "Direct business lines" && value === 1));
});

test("legacy saved contacts keep personal profile and phone only with a source and explicit business type", () => {
  const people = contactsForFirm({ contactName: "Old Contact", contactTitle: "CEO", email: "old@atlascapital.com", linkedin: "https://www.linkedin.com/in/old-contact", contactPhone: "+1 202 555 0123", contactPhoneType: "company", contactPhoneSourceUrl: "https://atlascapital.com/contact", collectedAt: "2025-01-02" });
  assert.equal(people[0].phone, "+12025550123");
  assert.equal(people[0].phoneType, "company");
  assert.equal(people[0].collectedAt, "2025-01-02");
  assert.equal(contactsForFirm({ contactName: "Unsupported", contactPhone: "+1 202 555 0123", contactPhoneType: "direct" })[0].phone, "");
  assert.equal(contactsForFirm({ contactName: "Private", contactPhone: "+1 202 555 0123", contactPhoneType: "mobile", contactPhoneSourceUrl: "https://atlascapital.com/contact" })[0].phone, "");
});

test("firm overview never attaches a different person's legacy email to its selected primary contact", async () => {
  const run = fixture(), firm = run.firms.get("atlas");
  firm.contactName = "Sam Review";
  firm.email = "jose@atlascapital.com";
  firm.emailStatus = "Verified";
  firm.emailEvidence = "Published address for José";
  const workbook = await buildWorkbook(run), row = workbook.getWorksheet("Leads").getRow(2);
  assert.equal(row.getCell("contactName").value, "Sam Review");
  assert.equal(row.getCell("email").value, "");
  assert.equal(row.getCell("emailStatus").value, "Not found");
  assert.equal(row.getCell("emailEvidence").value, "");
});

test("CSV includes source-labelled phones, contact profiles and dates while protecting every field from formulas", () => {
  const run = fixture(), firm = run.firms.get("atlas");
  firm.name = "=HYPERLINK(\"https://bad.invalid\")";
  firm.contacts[0].title = "\t@malicious";
  firm.contacts[0].emailEvidence = "A quote with \"double quotes\", commas and\na new line";
  const csv = buildCsv(run);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Contact LinkedIn","Business phone","Phone type","Phone source"'));
  assert.ok(csv.includes('"\'+442071234567 ext 21"'));
  assert.ok(csv.includes('"\'=HYPERLINK'));
  assert.ok(csv.includes('"\'\t@malicious"'));
  assert.ok(csv.includes("José Muñoz"));
  assert.ok(csv.includes("池田 美咲"));
  assert.ok(csv.includes('"Company switchboard"'));
  assert.ok(csv.includes("2026-10-12T09:01:02.000Z"));
  assert.ok(csv.includes('"A quote with ""double quotes"", commas and\na new line"'));
});
