import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "radar-server-tests-"));
process.env.PARTNER_RADAR_RUNS_DIR = path.join(scratch, "runs");
process.env.PARTNER_RADAR_ENV_FILE = path.join(scratch, ".env");
const { createApp, normalizeConfig } = await import("../server.js");
const { Run, newFirm, loadSavedRun } = await import("../lib/run.js");
const { buildWorkbook, buildCsv } = await import("../lib/excel.js");
const { getCountry } = await import("../lib/countries.js");
const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(scratch, { recursive: true, force: true }); });
function runWithContacts() {
  const run = new Run({ mode: "live", engine: "codex-cli", config: normalizeConfig({}), country: getCountry("JP") });
  run.emit("run", { id: run.id, mode: run.mode, engine: run.engine, config: run.config, country: run.country });
  run.addFirm(newFirm({ id: "firm1", name: "=HYPERLINK(\"bad\")", country: "Japan", website: "https://firm.example", fit: 5, contacts: [
    { name: "Person One", title: "CEO", email: "one@firm.example", emailStatus: "Verified", emailCheck: "valid", provider: "Hunter", verificationProvider: "Hunter", sourceUrl: "https://firm.example/team", sourceUrls: ["https://firm.example/team"] },
    { name: "Person Two", title: "CIO", email: "two@firm.example", emailStatus: "Inferred", emailCheck: "mx_present", provider: "Public web", sourceUrls: [] },
  ] }));
  run.pushMetrics(); return run;
}
test("configuration retains types, broad roles and bounded finite numeric values", () => {
  const config = normalizeConfig({ types: ["Family offices", "Private banks", "bogus"], roles: ["CIO", "Business Development"], firms: Infinity, contactsPerFirm: 99, minFit: -4 });
  assert.deepEqual(config.types, ["Family offices", "Private banks"]);
  assert.equal(config.firms, 15); assert.equal(config.contactsPerFirm, 8); assert.equal(config.minFit, 1);
  assert.equal(normalizeConfig({ researchBrief: "  Focus on independent managers  " }).researchBrief, "Focus on independent managers");
  assert.equal(normalizeConfig({ researchBrief: "x".repeat(3000) }).researchBrief.length, 2000);
});
test("preflight estimate is available before a run and responds to research controls", async () => {
  const small = await (await fetch(`${base}/api/estimate?engine=codex-cli&firms=3&contactsPerFirm=1`)).json();
  const deep = await (await fetch(`${base}/api/estimate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "codex-cli", firms: 30, contactsPerFirm: 5, researchDepth: "deep", drafts: true }) })).json();
  assert.ok(small.highMinutes > small.lowMinutes); assert.ok(deep.highMinutes > small.highMinutes); assert.equal(small.concurrency, 2); assert.match(small.basis, /Approximate/);
});
test("metrics count people, unique emails and independent verification separately", () => {
  const run = runWithContacts(); assert.equal(run.metrics.contacts, 2); assert.equal(run.metrics.emails, 2); assert.equal(run.metrics.verified, 1); assert.equal(run.metrics.published, 0); assert.equal(run.metrics.meetingReady, 1);
  run.firms.get("firm1").contacts[0].emailStatus = "Invalid"; run.pushMetrics(); assert.equal(run.metrics.meetingReady, 0); assert.equal(run.metrics.emails, 1);
});
test("workbook includes a source-bearing row for every person, CSV escapes formulas", async () => {
  const run = runWithContacts(), workbook = await buildWorkbook(run);
  const sheet = workbook.getWorksheet("Contacts"); assert.equal(sheet.rowCount, 3); assert.equal(sheet.getRow(2).getCell("provider").value, "Hunter");
  const buffer = await workbook.xlsx.writeBuffer(); assert.ok(buffer.byteLength > 1000);
  const csv = buildCsv(run); assert.ok(csv.includes("Person Two")); assert.ok(csv.includes("'=")); assert.ok(csv.includes("Verified"));
});
test("completed saved runs restore all contacts, metrics and export routes after restart", async () => {
  const run = runWithContacts(); run.done = true; run.emit("done", { state: "completed", summary: { firms: 1 } });
  const response = await fetch(`${base}/api/runs/${run.id}`); assert.equal(response.status, 200);
  const snapshot = await response.json(); assert.equal(snapshot.done, true); assert.equal(snapshot.firms[0].contacts.length, 2);
  assert.equal((await fetch(`${base}/api/runs/${run.id}/csv`)).status, 200);
  const excel = await fetch(`${base}/api/runs/${run.id}/excel`); assert.equal(excel.status, 200); assert.ok((await excel.arrayBuffer()).byteLength > 1000);
});
test("interrupted logs restore partial results and a stopped completion", () => {
  const run = runWithContacts(), saved = loadSavedRun(run.id);
  assert.equal(saved.aborted, true); assert.equal(saved.events.at(-1).type, "done"); assert.equal(saved.events.at(-1).stopped, true);
});
test("SSE reconnect resumes from last-event-id without duplicating prior events", async () => {
  const run = runWithContacts(); run.emit("done", { state: "completed" });
  const response = await fetch(`${base}/api/runs/${run.id}/events`, { headers: { "Last-Event-ID": "3" } });
  const reader = response.body.getReader(); const chunk = await reader.read(); await reader.cancel();
  const text = new TextDecoder().decode(chunk.value); assert.ok(text.includes("id: 4")); assert.ok(!text.includes("id: 1\n")); assert.ok(!text.includes('"type":"firm"'));
});
test("foreign browser origins cannot change local credentials", async () => {
  const response = await fetch(`${base}/api/integrations/hunter`, { method: "PUT", headers: { Origin: "https://unrelated.example", "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "secret-test-key" }) });
  assert.equal(response.status, 403); assert.equal(fs.existsSync(process.env.PARTNER_RADAR_ENV_FILE), false);
});
test("invalid countries, engines, JSON and unknown runs give useful errors", async () => {
  const result = await fetch(`${base}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "demo", country: "XX" }) });
  assert.equal(result.status, 400);
  const malformed = await fetch(`${base}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }); assert.equal(malformed.status, 400);
  assert.equal((await fetch(`${base}/api/runs/..`)).status, 404);
  assert.equal((await fetch(`${base}/api/runs/abcdabcd/stop`, { method: "POST" })).status, 404);
});
