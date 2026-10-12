import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, publicUrl, assertPublicUrl, collectPublicPages, extractPage, normalizeContacts, primaryContact, dedupeFirms, pickContacts, checkMailDomain } from "../lib/research.js";

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
