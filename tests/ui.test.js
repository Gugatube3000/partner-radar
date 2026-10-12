import test from "node:test";
import assert from "node:assert/strict";
import { contactsForFirm, hasUsableEmail, hasEmailEvidence, summarizeFirms, matchesFirm, safeHttpUrl, selectedEngine } from "../public/ui-utils.js";

const firm = { id: "F1", name: "Atlas Investments", city: "London", fit: 4, contacts: [
  { name: "Ada Partner", title: "Head of Partnerships", email: "ada@atlas.example", emailStatus: "Published", emailCheck: "mx_present" },
  { name: "Bill Investor", title: "CIO", email: "bill@atlas.example", emailStatus: "Inferred", emailCheck: "not_checked" },
  { name: "Chris Director", title: "CEO", email: "chris@atlas.example", emailStatus: "Invalid", emailCheck: "invalid" },
] };

test("lead totals count people and distinct usable emails independently", () => {
  assert.deepEqual(summarizeFirms([firm, { id: "F2", contacts: [{ name: "Second Person", email: "ADA@ATLAS.EXAMPLE", emailStatus: "Published" }] }]), { firms: 2, contacts: 4, emails: 2 });
  assert.equal(hasUsableEmail(firm.contacts[2]), false);
  assert.equal(hasUsableEmail({ email: "broken address" }), false);
  assert.equal(hasEmailEvidence(firm.contacts[0]), true);
  assert.equal(hasEmailEvidence(firm.contacts[1]), false);
  assert.equal(hasEmailEvidence({ email: "guess@example.com", emailStatus: "Guess", emailCheck: "mx_present" }), false);
});

test("legacy saved runs display a primary contact without losing evidence", () => {
  const contacts = contactsForFirm({ contactName: "Old Contact", contactTitle: "CEO", email: "old@example.com", emailStatus: "Published", emailCheck: "mx_present", contactSourceUrl: "https://example.com/team" });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, "Old Contact");
  assert.equal(contacts[0].sourceUrl, "https://example.com/team");
  assert.deepEqual(contactsForFirm({ name: "No people yet" }), []);
});

test("search includes additional people, email evidence and role; filters combine", () => {
  assert.equal(matchesFirm(firm, { search: "bill investor" }), true);
  assert.equal(matchesFirm(firm, { search: "CIO", email: "evidence", fit: "4" }), true);
  assert.equal(matchesFirm(firm, { search: "not here" }), false);
  assert.equal(matchesFirm(firm, { email: "missing" }), false);
  assert.equal(matchesFirm(firm, { fit: "5" }), false);
  assert.equal(matchesFirm({ id: "invalid", contacts: [firm.contacts[2]] }, { email: "missing" }), true);
});

test("external source links reject scripts, local files, bad URLs and embedded credentials", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("file:///etc/passwd"), null);
  assert.equal(safeHttpUrl("https://secret:password@example.com"), null);
  assert.equal(safeHttpUrl("not a url"), null);
  assert.equal(safeHttpUrl("https://example.com/team?q=people"), "https://example.com/team?q=people");
});

test("provider selection preserves the user's choice and never silently picks a provider", () => {
  const engines = [{ id: "codex-cli", ok: true }, { id: "claude-cli", ok: false }];
  assert.equal(selectedEngine("codex-cli", null, engines), "codex-cli");
  assert.equal(selectedEngine("claude-cli", null, engines), "claude-cli");
  assert.equal(selectedEngine("", null, engines), "");
  assert.equal(selectedEngine("missing", null, engines), "");
  assert.equal(selectedEngine("claude-cli", "codex-cli", engines), "codex-cli");
});
