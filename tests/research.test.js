import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, publicUrl, assertPublicUrl, collectPublicPages, extractPage, normalizeContacts, mergeContactEvidence, personLinkedin, normalizeBusinessPhone, contactResearchGaps, researchCoverage, contactEvidenceExcerpt, primaryContact, dedupeFirms, pickContacts, checkMailDomain } from "../lib/research.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const business = "https://manager.biz";
const person = (name = "Jane Smith", extra = {}) => ({ name, title: "CEO", source_url: `${business}/team`, email: "jane.smith@manager.biz", email_type: "published", email_confidence: 0.95, email_evidence_url: `${business}/team`, pattern_evidence: "Address listed on team page", ...extra });

test("public URL guard rejects local and reserved networks, mapped IPv6 and credentials", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  for (const url of ["file:///etc/passwd", "ftp://manager.biz", "http://localhost/", "http://2130706433/", "http://127.1/", "http://[::ffff:7f00:1]/", "https://user:password@manager.biz", "http://manager.biz:8080/", "http://secret.internal/"]) assert.equal(publicUrl(url), "", url);
  await assert.rejects(assertPublicUrl(business, { lookup: async () => [{ address: "8.8.8.8" }, { address: "10.0.0.1" }] }), /private/);
  assert.equal(await assertPublicUrl(business, { lookup: publicLookup }), `${business}/`);
});

test("official-page crawl reads useful same-site links and extracts business addresses", async () => {
  const requests = [];
  const pages = {
    "/": '<nav><a href="/leadership">Leadership</a><a href="/contact">Contact</a><a href="https://other.biz/team">External team</a></nav>',
    "/leadership": '<h1>Jane Smith, CEO</h1><a href="mailto:jane.smith&#64;manager.biz">Email Jane</a><script>evil@private.biz</script>',
    "/contact": '<p>Business enquiries: office@manager.biz</p>',
    "/about": '<p>Public markets manager</p>',
  };
  const result = await collectPublicPages(business, { lookup: publicLookup, fetchImpl: async (url) => {
    requests.push(url);
    return new Response(pages[new URL(url).pathname] || "", { status: 200, headers: { "content-type": "text/html" } });
  } });
  assert.equal(result.pages.length, 4);
  assert.ok(requests.every((url) => new URL(url).hostname === "manager.biz"));
  assert.ok(result.text.includes("jane.smith@manager.biz"));
  assert.ok(!result.text.includes("evil@private.biz"));
  assert.equal(result.pages.find((page) => page.url.endsWith("/leadership")).emails[0], "jane.smith@manager.biz");
});

test("redirects cannot cause a private-network or unrelated-domain fetch", async () => {
  for (const redirect of ["http://127.0.0.1/secrets", "https://unrelated.biz/team"]) {
    const requests = [];
    const result = await collectPublicPages(business, { lookup: publicLookup, fetchImpl: async (url) => {
      requests.push(url);
      return new Response(null, { status: 302, headers: { location: redirect } });
    } });
    assert.equal(result.pages.length, 0);
    assert.ok(requests.length <= 7);
    assert.ok(requests.every((url) => new URL(url).hostname === "manager.biz"));
  }
});

test("HTML evidence parsing ignores scripts and decodes entities", () => {
  const page = extractPage('<style>a@style.biz</style><p>Jane &amp; team</p><a href="/contact?a=1&amp;b=2">Contact</a><span>jane&#64;manager.biz</span>', business);
  assert.match(page.text, /Jane & team/);
  assert.deepEqual(page.emails, ["jane@manager.biz"]);
  assert.equal(page.links[0].url, `${business}/contact?a=1&b=2`);
});

test("contact normalization retains evidence, drops duplicates, and never treats unsupported guesses as published", () => {
  const contacts = normalizeContacts([
    person("Jane Smith", { email_evidence_url: "", email_confidence: 0.99 }),
    person("Jáne Smith"),
    person("Alan Doe", { email: "alan@manager.biz", email_type: "inferred", email_evidence_url: `${business}/press`, pattern_evidence: "first@domain is typical", email_confidence: 0.98 }),
    person("Dana Doe", { email: "dana.doe@manager.biz", email_type: "inferred", pattern_evidence: "jane.smith@manager.biz published on team page", email_confidence: 0.98 }),
  ], { firm: { id: "manager" }, limit: 8 });
  assert.equal(contacts.length, 3);
  assert.equal(contacts[0].emailStatus, "Guess");
  assert.equal(contacts[0].emailScore, 40);
  assert.equal(contacts[1].emailStatus, "Guess");
  assert.equal(contacts[2].emailStatus, "Inferred");
  assert.equal(contacts[2].emailScore, 85);
  assert.ok(contacts.every((contact) => contact.emailCheck === "not_checked"));
  assert.equal(primaryContact(contacts).name, "Dana Doe");
  assert.equal(normalizeContacts([person("Jane Smith")], { firm: { id: "manager" } })[0].id, contacts[0].id);
});

test("actual fetched public addresses strengthen evidence but consumer and shared mailboxes are excluded", () => {
  const contacts = normalizeContacts([
    person("Jane Smith", { email_type: "guess", email_evidence_url: "" }),
    person("Alan Doe", { email: "alan@gmail.com" }),
    person("Dana Doe", { email: "info@manager.biz" }),
    person("Unsupported Person", { source_url: "" }),
  ], { pages: [{ url: `${business}/team`, emails: ["jane.smith@manager.biz", "info@manager.biz"] }], limit: 8 });
  assert.equal(contacts.length, 3);
  assert.equal(contacts[0].emailStatus, "Published");
  assert.equal(contacts[0].emailEvidenceUrl, `${business}/team`);
  assert.equal(contacts[1].email, "");
  assert.equal(contacts[2].email, "");
});

test("firms are deduplicated by legal-name variants and website, including existing scouts", () => {
  const firms = dedupeFirms([
    { name: "Álpha Management Ltd", website: "https://alpha.biz" },
    { name: "Alpha Management Incorporated", website: "https://alpha-holdings.biz" },
    { name: "Different Branch", website: "https://www.alpha.biz/branch" },
    { name: "Beta", website: "https://beta.biz" },
    { name: "Gamma", website: "https://gamma.biz" },
  ], [{ name: "Béta LLC", website: "https://old-beta.biz" }]);
  assert.deepEqual(firms.map((firm) => firm.name), ["Álpha Management Ltd", "Gamma"]);
});

test("role selection covers business development, product and locally named executive roles", () => {
  const leaders = [
    { name: "Ana Ribeiro", title: "Diretor-Presidente" }, { name: "Jane Smith", title: "Head of Business Development" },
    { name: "Dana Doe", title: "Product Director" }, { name: "Alex Doe", title: "Former analyst" },
  ];
  assert.deepEqual(pickContacts(leaders, "CEO", ["Head of Business Development", "Head of Product"], 3).map((person) => person.name), ["Ana Ribeiro", "Jane Smith", "Dana Doe"]);
});

test("MX checks distinguish absent records from network failures without claiming deliverability", async () => {
  assert.equal(await checkMailDomain("manager.biz", { resolveMx: async () => [{ exchange: "mx.manager.biz" }] }), "mx_present");
  assert.equal(await checkMailDomain("manager.biz", { resolveMx: async () => [{ exchange: "." }] }), "mx_missing");
  assert.equal(await checkMailDomain("manager.biz", { resolveMx: async () => { throw Object.assign(new Error("NXDOMAIN"), { code: "ENOTFOUND" }); } }), "mx_missing");
  assert.equal(await checkMailDomain("manager.biz", { resolveMx: async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); } }), "unknown");
});

test("person profiles exclude company/search URLs and page parsing preserves labeled public phone links", () => {
  assert.equal(personLinkedin("https://www.linkedin.com/in/jane-smith?trk=foo"), "https://www.linkedin.com/in/jane-smith");
  for (const url of ["https://www.linkedin.com/company/manager", "https://www.linkedin.com/search/results/people/", "https://linkedin.com.evil.biz/in/jane-smith", "javascript:alert(1)"]) assert.equal(personLinkedin(url), "");
  const page = extractPage('<p>Company office</p><a href="tel:+44(20)79460958">Main office</a><a href="https://www.linkedin.com/in/jane-smith">Jane Smith</a><a href="https://www.linkedin.com/company/manager">Company</a>', business);
  assert.deepEqual(page.phoneLinks, [{ phone: "+442079460958", label: "Main office" }]);
  assert.deepEqual(page.linkedinProfiles, [{ url: "https://www.linkedin.com/in/jane-smith", label: "Jane Smith" }]);
  assert.equal(normalizeBusinessPhone("+44 (20) 7946 0958 ext. 21"), "+442079460958 ext 21");
  assert.equal(normalizeBusinessPhone("call Jane"), "");
});

test("business phone requires a published source and direct-person evidence; private mobile fields are discarded", () => {
  const team = extractPage('<p>Jane Smith CEO. Jane Smith direct office: +44 20 7946 0958.</p><p>Company switchboard +44 20 7946 0123.</p><p>Alan Doe personal mobile +44 7700 900123.</p>', `${business}/team`);
  const contacts = normalizeContacts([
    person("Jane Smith", { phone: "+44 20 7946 0958", phone_type: "direct", phone_source_url: `${business}/team` }),
    person("Dana Doe", { email: "", phone: "+44 20 7946 0123", phone_type: "company", phone_source_url: `${business}/team`, phone_evidence: "Company switchboard +44 20 7946 0123" }),
    person("Alan Doe", { email: "", phone: "+44 7700 900123", phone_type: "direct", phone_source_url: `${business}/team`, phone_evidence: "Alan Doe personal mobile +44 7700 900123" }),
    person("Pat Doe", { email: "", phone: "+44 20 7946 0958", phone_type: "direct", phone_source_url: "" }),
  ], { firm: { website: business }, pages: [team], limit: 8 });
  assert.equal(contacts[0].phone, "+442079460958");
  assert.equal(contacts[0].phoneType, "direct");
  assert.equal(contacts[1].phoneType, "company");
  assert.equal(contacts[2].phone, "");
  assert.equal(contacts[3].phone, "");
});

test("a team-page direct phone cannot move to the previous person or override fetched text with a fabricated quote", () => {
  const page = extractPage("Ada Lovelace — Head of Partnerships. Grace Hopper — CIO. Direct office +44 20 7123 4567.", `${business}/team`);
  for (const quote of ["", "Ada Lovelace direct office +44 20 7123 4567"]) {
    const [contact] = normalizeContacts([person("Ada Lovelace", { title: "Head of Partnerships", email: "", phone: "+44 20 7123 4567", phone_type: "direct", phone_source_url: `${business}/team`, phone_evidence: quote })], { firm: { website: business }, pages: [page] });
    assert.equal(contact.phone, "");
  }
  const split = extractPage("Company reference 4420. Account code 71234567.", `${business}/contact`);
  const [contact] = normalizeContacts([person("Ada Lovelace", { email: "", phone: "+44 20 7123 4567", phone_type: "company", phone_source_url: `${business}/contact` })], { firm: { website: business }, pages: [split] });
  assert.equal(contact.phone, "");
});

test("freshness distinguishes a fetched current official role from old appointment citations", () => {
  const page = extractPage('<p>Jane Smith Chief Executive Officer</p><a href="https://www.linkedin.com/in/jane-smith">Jane Smith</a>', `${business}/team`);
  const contacts = normalizeContacts([
    person("Jane Smith", { title: "Chief Executive Officer", role_evidence_date: "2020-01-01" }),
    person("Alan Doe", { email: "", source_url: `${business}/old-appointment`, role_evidence_date: "2020-01-01" }),
    person("Pat Doe", { title: "Former CEO", email: "" }),
  ], { pages: [page], limit: 8 });
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].roleEvidenceStatus, "official_page");
  assert.equal(contacts[0].linkedin, "https://www.linkedin.com/in/jane-smith");
  assert.equal(contacts[1].roleEvidenceStatus, "needs_review");
  assert.match(contacts[0].checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("targeted repairs improve the same contact without duplication or downgrading verified email evidence", () => {
  const first = normalizeContacts([person("Jane Smith", { email_type: "guess", email_evidence_url: "" })], { firm: { id: "manager" } });
  const repaired = mergeContactEvidence(first, [person("Jane Smith", { linkedin_url: "https://www.linkedin.com/in/jane-smith" })], { firm: { id: "manager" } });
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, first[0].id);
  assert.equal(repaired[0].emailStatus, "Published");
  assert.equal(repaired[0].linkedin, "https://www.linkedin.com/in/jane-smith");
  Object.assign(repaired[0], { emailStatus: "Verified", emailCheck: "valid", verificationProvider: "Hunter", emailScore: 97 });
  const retained = mergeContactEvidence(repaired, [person("Jane Smith", { email_type: "guess", email_evidence_url: "", email_confidence: 0.3 })], { firm: { id: "manager" } });
  assert.equal(retained[0].emailStatus, "Verified");
  assert.equal(retained[0].emailType, "published");
  assert.equal(retained[0].emailCheck, "valid");
  assert.equal(retained[0].emailScore, 97);
  assert.equal(contactResearchGaps(retained, 1).emailNames.length, 0);
  assert.equal(contactResearchGaps(retained, 1).linkedinNames.length, 0);
  assert.equal(researchCoverage(retained, [], 1).evidenceBackedEmails, 1);
});

test("a replacement email loses the previous address verifier and fetched former-role evidence requires review", () => {
  const first = normalizeContacts([person("Jane Smith")]);
  Object.assign(first[0], { emailStatus: "Invalid", emailCheck: "invalid", verificationProvider: "Hunter" });
  const replaced = mergeContactEvidence(first, [person("Jane Smith", { email: "jane@manager.biz" })]);
  assert.equal(replaced[0].email, "jane@manager.biz");
  assert.equal(replaced[0].emailCheck, "not_checked");
  assert.equal(replaced[0].verificationProvider, undefined);
  const former = normalizeContacts([person("Alan Doe", { email: "" })], { pages: [extractPage("Alan Doe formerly CEO, left the firm.", `${business}/team`)] });
  assert.equal(former[0].roleEvidenceStatus, "needs_review");
  const old = normalizeContacts([person("Jane Smith", { source_url: `${business}/press/appointment`, role_evidence_date: "2020-01-01" })], { pages: [extractPage("Jane Smith CEO", `${business}/press/appointment`)] });
  assert.equal(old[0].roleEvidenceStatus, "needs_review");
  assert.equal(normalizeContacts([person("Pat Doe", { title: "Ex-CEO" })]).length, 0);
});

test("contact evidence excerpts keep exact provenance and named leadership while bounding repeated context", () => {
  const pages = [
    { ...extractPage(`<p>${"Product information. ".repeat(3000)} Jane Smith CEO. jane.smith@manager.biz</p><a href="https://www.linkedin.com/in/jane-smith">Jane Smith</a>`, `${business}/team`) },
    { ...extractPage('<p>Company switchboard</p><a href="tel:+442079460958">Main office</a>', `${business}/contact`) },
  ];
  // extractPage itself limits general text; put the named contact near the retained section.
  pages[0].text = `${"Product information. ".repeat(700)} Jane Smith CEO. Business email jane.smith@manager.biz. ${"Product information. ".repeat(700)}`;
  const excerpt = contactEvidenceExcerpt(pages, { names: ["Jane Smith"], maxChars: 3000 });
  assert.ok(excerpt.length <= 3000);
  assert.ok(excerpt.includes(`SOURCE: ${business}/team`) && excerpt.includes(`SOURCE: ${business}/contact`));
  assert.ok(excerpt.includes("Jane Smith CEO"));
  assert.ok(excerpt.includes("jane.smith@manager.biz"));
  assert.ok(excerpt.includes("https://www.linkedin.com/in/jane-smith"));
  assert.ok(excerpt.includes("+442079460958"));
});
