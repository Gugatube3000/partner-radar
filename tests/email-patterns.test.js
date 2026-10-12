import test from "node:test";
import assert from "node:assert/strict";
import { fillEmailCandidates } from "../lib/email-patterns.js";
import { demoEmail } from "../lib/demo.js";
import { normalizeContacts } from "../lib/research.js";

const firm = { website: "https://manager.biz" };
const person = (name, extra = {}) => ({ name, email: "", emailType: "none", emailStatus: "Not found", emailCheck: "not_checked", sourceUrl: "https://manager.biz/team", ...extra });
const published = person("Jane Smith", { email: "jsmith@parent.biz", emailStatus: "Published", emailType: "published", emailEvidenceUrl: "https://manager.biz/team" });

test("missing addresses get plausible name-and-company guesses with no invented evidence", () => {
  assert.equal(normalizeContacts([{ name: "Jane Smith", source_url: "https://manager.biz/team", email: "jane.smith@manager.biz", email_type: "none" }], { firm })[0].emailStatus, "Guess");
  const result = fillEmailCandidates([person("José Muñoz"), person("Dr. Anne O'Neil"), person("Prince"), person("A. Smith"), person("Prof. Dr. John Brown Jr.")], { firm });
  assert.deepEqual(result.map((contact) => contact.email), ["jose.munoz@manager.biz", "anne.oneil@manager.biz", "prince@manager.biz", "asmith@manager.biz", "john.brown@manager.biz"]);
  for (const contact of result) { assert.equal(contact.emailStatus, "Guess"); assert.equal(contact.emailCheck, "not_checked"); assert.equal(contact.emailEvidenceUrl, ""); assert.ok(contact.emailScore <= 40); assert.match(contact.emailEvidence, /Unconfirmed/); }
});

test("observed named company examples infer the format and parent email domain", () => {
  const result = fillEmailCandidates([published, person("Alan Doe"), person("Dana Jones", { email: "dana.jones@manager.biz", emailStatus: "Guess", emailType: "guess", emailCheck: "mx_present" })], { firm });
  assert.equal(result[1].email, "adoe@parent.biz");
  assert.equal(result[2].email, "djones@parent.biz");
  assert.equal(result[2].emailCheck, "not_checked", "a changed domain must be checked again");
  assert.equal(result[1].emailStatus, "Inferred");
  assert.equal(result[1].emailPattern, "flast");
  assert.match(result[1].emailEvidence, /jsmith@parent.biz/);
  assert.equal(result[1].emailEvidenceUrl, published.emailEvidenceUrl);
  assert.deepEqual(result[0], published);
});

test("fetched name-and-address examples publish the exact contact and infer others", () => {
  const pages = [{ url: "https://manager.biz/team", text: "Jane Smith CEO: jane.smith@manager.biz", emails: ["jane.smith@manager.biz", "info@manager.biz"] }];
  const result = fillEmailCandidates([person("Jane Smith"), person("Alan Doe")], { firm, pages });
  assert.equal(result[0].emailStatus, "Published");
  assert.equal(result[1].email, "alan.doe@manager.biz");
  assert.equal(result[1].emailStatus, "Inferred");
  const unbound = fillEmailCandidates([person("Jane Smith")], { firm, pages: [{ ...pages[0], text: "Unrelated vendor addresses" }] });
  assert.equal(unbound[0].emailStatus, "Guess", "an anonymous address list cannot prove a named format");
});

test("documented company patterns are reused but guesses cannot teach an observed pattern", () => {
  const inferred = person("Jane Smith", { email: "jane.smith@parent.biz", emailStatus: "Inferred", emailType: "inferred", emailPattern: "first.last", emailEvidence: "Actual example: maria.souza@parent.biz", emailEvidenceUrl: "https://manager.biz/press" });
  const result = fillEmailCandidates([inferred, person("Alan Doe")], { firm });
  assert.equal(result[1].email, "alan.doe@parent.biz");
  assert.equal(result[1].emailStatus, "Inferred");
  const guessed = fillEmailCandidates([{ ...inferred, emailStatus: "Guess", emailType: "guess" }, person("Alan Doe")], { firm });
  assert.equal(guessed[1].emailStatus, "Guess");
  assert.equal(guessed[1].email, "alan.doe@manager.biz");
});

test("fallback preserves verifier results and never reuses another person's address", () => {
  const checked = ["Verified", "Invalid", "Catch-all", "No mail server"].map((emailStatus, index) => person(`Checked Person${index}`, { email: `checked${index}@manager.biz`, emailStatus, verificationProvider: "Hunter", emailCheck: "invalid" }));
  assert.deepEqual(fillEmailCandidates(checked, { firm }), checked);
  const result = fillEmailCandidates([person("Alan Doe", { email: "alan.doe@manager.biz", emailStatus: "Published" }), person("Alan Robert Doe")], { firm });
  assert.equal(result[1].email, "adoe@manager.biz");
  assert.equal(new Set(result.map((contact) => contact.email)).size, result.length);
});

test("unsupported names, unknown domains and consumer mail domains retain an explicit reason", () => {
  for (const website of ["", "http://localhost", "https://gmail.com"]) {
    const result = fillEmailCandidates([person("Alan Doe")], { firm: { website } });
    assert.equal(result[0].email, ""); assert.match(result[0].emailFallbackReason, /domain/);
  }
  for (const name of ["池田 美咲", "Unknown Person", "A."]) {
    const result = fillEmailCandidates([person(name)], { firm });
    assert.equal(result[0].email, ""); assert.match(result[0].emailFallbackReason, /spelling/);
  }
});

test("a demo never randomly drops a named person's address", () => {
  for (let index = 0; index < 100; index++) assert.ok(demoEmail({ website: "https://firm.example" }, "Jane Smith", 1).email);
});
