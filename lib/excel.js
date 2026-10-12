// @ts-check
// Builds the deliverable: one row per firm, sorted by fit, ready to filter and work.
import ExcelJS from "exceljs";

const GREEN = "FF034638", MINT = "FFE3F2D3", LEAF = "FFCDEBB0", AMBER = "FFE16B00", GREY = "FF5B6870";

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
    ["Fit confidence", "fitConfidence", 11], ["Why it fits", "why", 44], ["Contact name", "contactName", 22],
    ["Title", "contactTitle", 24], ["LinkedIn URL", "linkedin", 30], ["Email", "email", 32], ["Email status", "emailStatus", 14],
    ["Email confidence %", "emailScore", 11], ["Email pattern", "emailPattern", 14], ["Pattern evidence", "emailEvidence", 40], ["Warm intro path", "warmIntro", 22], ["Recent news", "news", 34],
    ["Draft subject", "subject", 36], ["Draft email", "body", 60], ["English gist", "gist", 40],
    ["Data source", "source", 15], ["Source URL", "sourceUrl", 30], ["Date collected", "collectedAt", 13],
    ["Outreach status", "status", 16], ["Owner", "", 12], ["Notes", "", 30],
  ];
  ws.columns = cols.map(([header, key, width]) => ({ header, key: key || header, width }));
  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell((c) => {
    c.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  for (const f of firms) {
    const row = ws.addRow({ ...f, fitConfidence: f.fitConfidence == null ? null : Math.round(f.fitConfidence * 100) / 100 });
    row.font = { name: "Arial", size: 10 };
    row.alignment = { vertical: "top" };
    for (const k of ["why", "body", "gist", "globalEquityEvidence", "news", "assetClasses"]) row.getCell(k).alignment = { vertical: "top", wrapText: true };
    const fit = row.getCell("fit");
    if ((f.fit ?? 0) >= 5) fit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LEAF } };
    else if ((f.fit ?? 0) >= 4) fit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MINT } };
    fit.font = { name: "Arial", size: 10, bold: true, color: { argb: GREEN } };
    const es = row.getCell("emailStatus");
    es.font = { name: "Arial", size: 10, bold: true, color: { argb: ["Verified", "Published"].includes(f.emailStatus) ? GREEN : f.emailStatus === "Inferred" ? "FF1B9A77" : f.emailStatus ? AMBER : GREY } };
    for (const k of ["website", "linkedin", "sourceUrl"]) {
      const c = row.getCell(k);
      const v = String(c.value || "");
      if (/^https?:\/\//.test(v)) { c.value = { text: v, hyperlink: v }; c.font = { name: "Arial", size: 10, color: { argb: "FF446CA9" }, underline: true }; }
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const s = wb.addWorksheet("Run summary");
  s.columns = [{ width: 26 }, { width: 70 }];
  const m = run.metrics;
  const rows = [
    ["Partner Radar run", run.id], ["Mode", run.mode === "demo" ? "DEMO (fictional data)" : run.engine === "claude-cli" ? "Live · your Claude plan" : `Live · ${run.engine}`],
    ["Country", `${run.country.name} (${run.country.language})`], ["Looking for", "Asset managers investing in public markets (equities / fixed income)"], ["Decision-makers", run.config.roles.join(", ")],
    ["Firms mapped", firms.length], ["Scored", firms.filter((f) => f.fit != null).length],
    ["Fit 4-5", firms.filter((f) => (f.fit ?? 0) >= 4).length], ["Emails found", m.emails ?? 0], ["Verified or published", m.verified],
    ["Meeting-ready (fit 4+ with an email)", m.meetingReady],
    ["Generated", new Date().toISOString().replace("T", " ").slice(0, 16)], ["", ""],
    ["Email status key", "Verified = checked by Hunter. Published = seen on a public page. Inferred = built from the firm's email pattern (see Pattern evidence). Guess = common pattern, no example found. Check Inferred/Guess before sending."],
    ["Before you send", "Review every row. Follow Compliance review and local data-protection rules (e.g., GDPR, LGPD). Log the source of every contact."],
  ];
  rows.forEach((r, i) => {
    const row = s.addRow(r);
    row.font = { name: "Arial", size: 10, bold: i === 0 };
    row.getCell(1).font = { name: "Arial", size: 10, bold: true, color: { argb: GREEN } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });
  if (run.mode === "demo") {
    s.getCell("A1").value = "Partner Radar run (DEMO)";
  }

  const t = wb.addWorksheet("Template");
  t.columns = [{ width: 110 }];
  t.addRow(["Email template used for this run"]).font = { name: "Arial", bold: true, color: { argb: GREEN } };
  t.addRow([run.config.template]).alignment = { wrapText: true, vertical: "top" };
  return wb;
}
