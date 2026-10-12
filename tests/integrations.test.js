import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let moduleId = 0;
async function isolated(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-integrations-test-"));
  const envFile = path.join(dir, ".env");
  const names = ["PARTNER_RADAR_ENV_FILE", "HUNTER_API_KEY", "APOLLO_API_KEY", "FIRECRAWL_API_KEY"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  for (const name of names) delete process.env[name];
  process.env.PARTNER_RADAR_ENV_FILE = envFile;
  const requests = [];
  let handler = () => ({ data: {} });
  global.fetch = async (url, options = {}) => {
    const request = { url: new URL(url), ...options, body: options.body ? JSON.parse(String(options.body)) : undefined };
    requests.push(request);
    const result = await handler(request);
    return new Response(JSON.stringify(result.body ?? result), { status: result.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const api = await import(`../lib/integrations.js?test=${++moduleId}`);
    await run({ api, envFile, requests, respond: (next) => { handler = next; } });
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const person = { name: "Ada Lovelace", title: "Chief Investment Officer", email: "", emailType: "none", emailStatus: "Not found", sourceUrl: "https://firm.example/team" };
const hunterOnly = { integrations: { hunter: true, apollo: false } };
const apolloOnly = { integrations: { hunter: false, apollo: true } };

test("optional enrichment integrations", async (t) => {
  await t.test("saving and disconnecting keys preserves unrelated settings and never returns secrets", async () => {
    await isolated(async ({ api, envFile }) => {
      fs.writeFileSync(envFile, "# User settings\nPORT=4747\n  export HUNTER_API_KEY=old-secret\nOPENROUTER_MODEL=custom-model\nHUNTER_API_KEY=duplicate-secret\n");
      const result = api.saveIntegration("hunter", "fixture-hunter-secret");
      const contents = fs.readFileSync(envFile, "utf8");
      assert.equal((contents.match(/HUNTER_API_KEY=/g) || []).length, 1);
      assert.ok(contents.includes("PORT=4747"));
      assert.ok(contents.includes("OPENROUTER_MODEL=custom-model"));
      assert.ok(contents.includes("# User settings"));
      assert.equal(process.env.HUNTER_API_KEY, "fixture-hunter-secret");
      assert.equal(JSON.stringify(result).includes("fixture-hunter-secret"), false);
      assert.equal(JSON.stringify(api.integrationStatus()).includes("HUNTER_API_KEY"), false);
      api.saveIntegration("hunter", "");
      assert.equal(process.env.HUNTER_API_KEY, undefined);
      assert.equal(fs.readFileSync(envFile, "utf8").includes("HUNTER_API_KEY"), false);
      assert.throws(() => api.saveIntegration("hunter", "test-api-key"), /real API key/);
      assert.throws(() => api.saveIntegration("hunter", "malicious\nPORT=9000"), /real API key/);
      assert.throws(() => api.saveIntegration("unknown", "fixture-key"), /Unknown integration/);
      assert.throws(() => api.saveIntegration("__proto__", "fixture-key"), /Unknown integration/);
      assert.throws(() => api.saveIntegration("constructor", "fixture-key"), /Unknown integration/);
    });
  });

  await t.test("Apollo auth check uses GET and requires both documented health flags", async () => {
    await isolated(async ({ api, respond, requests }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ healthy: true, is_logged_in: true }));
      assert.equal((await api.testIntegration("apollo")).ok, true);
      assert.equal(requests[0].method, "GET");
      assert.equal(requests[0].url.href, "https://api.apollo.io/api/v1/auth/health");
      assert.equal(requests[0].headers["x-api-key"], "fixture-apollo-secret");
      for (const response of [{ healthy: false, is_logged_in: true }, { healthy: true, is_logged_in: false }, {}]) {
        respond(() => response);
        assert.equal((await api.testIntegration("apollo")).ok, false);
      }
    });
  });

  await t.test("connection errors redact keys, retain discovered contacts and stop repeated rejected requests", async () => {
    for (const status of [401, 429]) await isolated(async ({ api, respond, requests }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond(() => ({ status, body: { errors: [{ details: "fixture-hunter-secret" }] } }));
      const activity = [];
      const found = await api.enrichContacts("firm.example", [person], { ...hunterOnly, onActivity: (line) => activity.push(line) });
      assert.deepEqual(found, [person]);
      assert.equal(requests.length, 1);
      assert.ok(activity.some((line) => line.startsWith("warning ·")));
      assert.equal(JSON.stringify(activity).includes("fixture-hunter-secret"), false);
      assert.equal((await api.testIntegration("hunter")).ok, false);
      assert.equal(JSON.stringify(api.integrationStatus()).includes("fixture-hunter-secret"), false);
    });
  });

  await t.test("a successful connection recheck clears the previous auth cooldown", async () => {
    await isolated(async ({ api, respond, requests }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond(() => ({ status: 401, body: {} }));
      await api.enrichContacts("firm.example", [person], hunterOnly);
      respond(() => ({ data: {} }));
      assert.equal((await api.testIntegration("hunter")).ok, true);
      const before = requests.length;
      await api.enrichContacts("firm.example", [person], hunterOnly);
      assert.ok(requests.length > before, "research must resume after a successful key recheck");
    });
  });

  await t.test("Hunter adds named relevant professionals with public source evidence", async () => {
    await isolated(async ({ api, respond, requests }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond((request) => {
        assert.ok(request.url.pathname.endsWith("domain-search"));
        return { data: { emails: [
          { first_name: "Ada", last_name: "Lovelace", position: "Chief Investment Officer", value: "ada@firm.example", sources: [{ uri: "https://firm.example/team", still_on_page: true }], verification: { status: "valid" }, confidence: 98 },
          { first_name: "Alan", last_name: "Turing", position: "Support Associate", value: "alan@firm.example" },
          { position: "Chief Executive Officer", value: "info@firm.example" },
        ] } };
      });
      const found = await api.enrichContacts("firm.example", [], hunterOnly);
      assert.equal(found.length, 1);
      assert.equal(found[0].name, "Ada Lovelace");
      assert.equal(found[0].email, "ada@firm.example");
      assert.equal(found[0].emailType, "published");
      assert.equal(found[0].emailStatus, "Verified");
      assert.equal(found[0].emailEvidenceUrl, "https://firm.example/team");
      assert.equal(requests[0].url.searchParams.get("type"), "personal"); // Hunter terminology: named work emails.
      assert.equal(requests[0].url.searchParams.has("api_key"), false);
      assert.equal(requests[0].headers.Authorization, "Bearer fixture-hunter-secret");
    });
  });

  await t.test("Hunter finder fills a known person's email without replacing leadership evidence", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond((request) => request.url.pathname.endsWith("domain-search") ? { data: { emails: [] } } : {
        data: { first_name: "Ada", last_name: "Lovelace", email: "ada@firm.example", verification: { status: "valid" }, sources: [] },
      });
      const found = await api.enrichContacts("firm.example", [person], hunterOnly);
      assert.equal(found[0].email, "ada@firm.example");
      assert.equal(found[0].sourceUrl, person.sourceUrl);
      assert.equal(found[0].title, person.title);
      assert.equal(found[0].emailType, "inferred");
      assert.equal(found[0].emailStatus, "Verified");
    });
  });

  for (const [state, expected] of [["valid", "Verified"], ["invalid", "Invalid"], ["accept_all", "Catch-all"], ["unknown", "Unverified"], ["disposable", "Unverified"], ["webmail", "Unverified"]]) {
    await t.test(`Hunter verifier ${state} keeps an honest deliverability label`, async () => {
      await isolated(async ({ api, respond }) => {
        api.saveIntegration("hunter", "fixture-hunter-secret");
        respond((request) => request.url.pathname.endsWith("domain-search") ? { data: { emails: [] } } : request.url.pathname.endsWith("email-finder") ? { data: {} } : { data: { status: state, score: 0 } });
        const contact = { ...person, email: "ada@firm.example", emailType: "inferred", emailStatus: "Unverified", emailScore: 80 };
        const found = await api.enrichContacts("firm.example", [contact], hunterOnly);
        assert.equal(found[0].emailStatus, expected);
        assert.equal(found[0].emailCheck, state);
        assert.equal(found[0].emailScore, 0);
        assert.equal(found[0].verificationProvider, "Hunter");
      });
    });
  }

  await t.test("Hunter 202 verification remains pending rather than verified", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond((request) => request.url.pathname.endsWith("domain-search") ? { data: { emails: [] } } : request.url.pathname.endsWith("email-finder") ? { data: {} } : { status: 202, body: { data: { status: "pending" } } });
      const found = await api.enrichContacts("firm.example", [{ ...person, email: "ada@firm.example", emailType: "inferred", emailStatus: "Unverified" }], hunterOnly);
      assert.notEqual(found[0].emailStatus, "Verified");
      assert.equal(found[0].emailCheck, "pending");
    });
  });

  await t.test("Hunter finder rejects another person and emails outside the company", async () => {
    for (const candidate of [
      { first_name: "Grace", last_name: "Hopper", email: "grace@firm.example" },
      { first_name: "Ada", last_name: "Lovelace", email: "ada@gmail.com" },
      { first_name: "Ada", last_name: "Lovelace", email: "ada@other.example" },
    ]) await isolated(async ({ api, respond }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond((request) => request.url.pathname.endsWith("domain-search") ? { data: { emails: [] } } : { data: { ...candidate, verification: { status: "valid" } } });
      const found = await api.enrichContacts("firm.example", [person], hunterOnly);
      assert.equal(found[0].email, "");
    });
  });

  await t.test("Apollo enriches the same person at the company without requesting personal data", async () => {
    await isolated(async ({ api, respond, requests }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ match_confidence: "high", person: { name: "Ada Lovelace", email: "ada@firm.example", organization: { primary_domain: "firm.example" }, email_status: "verified" } }));
      const found = await api.enrichContacts("firm.example", [person], apolloOnly);
      assert.equal(found[0].email, "ada@firm.example");
      assert.equal(found[0].emailStatus, "Unverified", "provider data is not a new deliverability check");
      assert.equal(found[0].sourceUrl, person.sourceUrl);
      assert.equal(requests[0].method, "POST");
      assert.equal(requests[0].body.reveal_personal_emails, false);
      assert.equal(requests[0].body.reveal_phone_number, false);
    });
  });

  await t.test("Apollo rejects a namesake at another company or a personal email", async () => {
    for (const candidate of [
      { name: "Grace Hopper", email: "grace@firm.example", organization: { primary_domain: "firm.example" } },
      { name: "Ada Lovelace", email: "ada@firm.example", organization: { primary_domain: "other.example" } },
      { name: "Ada Lovelace", email: "ada@gmail.com", organization: { primary_domain: "firm.example" } },
      { name: "Ada Lovelace", email: "ada@other.example" },
    ]) await isolated(async ({ api, respond }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ match_confidence: "high", person: candidate }));
      assert.equal((await api.enrichContacts("firm.example", [person], apolloOnly))[0].email, "");
    });
  });

  await t.test("Hunter reads the Finder LinkedIn field and never treats generic email sources as phone proof", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond((request) => request.url.pathname.endsWith("domain-search") ? { data: { emails: [] } } : { data: {
        first_name: "Ada", last_name: "Lovelace", email: "ada@firm.example", verification: { status: "valid" },
        linkedin_url: "https://www.linkedin.com/in/ada-lovelace/?trk=provider", phone_number: "+1 202 555 0123", sources: [{ uri: "https://firm.example/team" }],
      } });
      const found = await api.enrichContacts("firm.example", [person], hunterOnly);
      assert.equal(found[0].linkedin, "https://www.linkedin.com/in/ada-lovelace/");
      assert.equal(found[0].phone || "", "", "email attribution does not establish a phone's business source");
    });
  });

  await t.test("Hunter recognizes selected roles and diacritic-equivalent names without creating duplicates", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      respond(() => ({ data: { emails: [{ first_name: "Jose", last_name: "Munoz", position: "Product Specialist", value: "jose@firm.example", verification: { status: "valid" }, sources: [{ uri: "https://firm.example/team" }], linkedin: "https://www.linkedin.com/in/jose-munoz" }] } }));
      const found = await api.enrichContacts("firm.example", [{ ...person, name: "José Muñoz" }], { ...hunterOnly, roles: ["Product Specialist"] });
      assert.equal(found.length, 1);
      assert.equal(found[0].name, "José Muñoz");
      assert.equal(found[0].email, "jose@firm.example");
    });
  });

  await t.test("Apollo rejects the documented nested low-confidence match", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ person: { name: "Ada Lovelace", match_confidence: "low", email: "ada@firm.example", linkedin_url: "https://www.linkedin.com/in/ada-lovelace", organization: { primary_domain: "firm.example" } } }));
      assert.equal((await api.enrichContacts("firm.example", [person], apolloOnly))[0].email, "");
    });
  });

  await t.test("Apollo can add a missing person profile while preserving independently verified email and published office phone", async () => {
    await isolated(async ({ api, respond, requests }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ person: { name: "Ada Lovelace", match_confidence: "high", email: "new@firm.example", linkedin_url: "https://www.linkedin.com/in/ada-lovelace?trk=apollo", organization: { primary_domain: "firm.example" }, phone_numbers: [{ raw_number: "+1 202 555 9999", type: "mobile" }] } }));
      const contact = { ...person, email: "ada@firm.example", emailType: "published", emailStatus: "Verified", emailCheck: "valid", verificationProvider: "Hunter", phone: "+442071234567", phoneType: "direct", phoneSourceUrl: "https://firm.example/team" };
      const found = (await api.enrichContacts("firm.example", [contact], apolloOnly))[0];
      assert.equal(found.linkedin, "https://www.linkedin.com/in/ada-lovelace");
      assert.equal(found.email, contact.email);
      assert.equal(found.emailStatus, "Verified");
      assert.equal(found.emailCheck, "valid");
      assert.equal(found.verificationProvider, "Hunter");
      assert.equal(found.phone, contact.phone);
      assert.equal(found.phoneSourceUrl, contact.phoneSourceUrl);
      assert.equal(requests[0].body.reveal_phone_number, false);
      assert.equal("webhook_url" in requests[0].body, false);
    });
  });

  await t.test("Apollo adds profile-only data only for a matching firm and never accepts company LinkedIn as a contact", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ person: { name: "Ada Lovelace", match_confidence: "high", linkedin_url: "https://www.linkedin.com/company/firm", organization: { primary_domain: "firm.example" } } }));
      const found = await api.enrichContacts("firm.example", [{ ...person, linkedin: "https://www.linkedin.com/search/results/people/" }], apolloOnly);
      assert.equal(found[0].linkedin, "");
      assert.equal(found[0].email, "");
    });
  });

  await t.test("Apollo profile enrichment preserves a real invalid check for the same address", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ person: { name: "Ada Lovelace", match_confidence: "high", email: "ada@firm.example", email_status: "verified", linkedin_url: "https://www.linkedin.com/in/ada-lovelace", organization: { primary_domain: "firm.example" } } }));
      const contact = { ...person, email: "ada@firm.example", emailStatus: "Invalid", emailCheck: "invalid", verificationProvider: "Hunter" };
      const found = (await api.enrichContacts("firm.example", [contact], apolloOnly))[0];
      assert.equal(found.emailStatus, "Invalid");
      assert.equal(found.emailCheck, "invalid");
      assert.equal(found.verificationProvider, "Hunter");
      assert.equal(found.linkedin, "https://www.linkedin.com/in/ada-lovelace");
    });
  });

  await t.test("a different Apollo address does not inherit verification for the old invalid address", async () => {
    await isolated(async ({ api, respond }) => {
      api.saveIntegration("apollo", "fixture-apollo-secret");
      respond(() => ({ person: { name: "Ada Lovelace", match_confidence: "high", email: "new@firm.example", organization: { primary_domain: "firm.example" } } }));
      const found = (await api.enrichContacts("firm.example", [{ ...person, email: "old@firm.example", emailStatus: "Invalid", emailCheck: "invalid", verificationProvider: "Hunter" }], apolloOnly))[0];
      assert.equal(found.email, "new@firm.example");
      assert.equal(found.emailStatus, "Unverified");
      assert.equal(found.emailCheck, "not_checked");
      assert.equal(found.verificationProvider, "");
    });
  });

  await t.test("disabled integrations and invalid company domains make no network requests", async () => {
    await isolated(async ({ api, requests }) => {
      api.saveIntegration("hunter", "fixture-hunter-secret");
      api.saveIntegration("apollo", "fixture-apollo-secret");
      assert.deepEqual(await api.enrichContacts("firm.example", [person], { integrations: { hunter: false, apollo: false } }), [person]);
      assert.deepEqual(await api.enrichContacts("https://firm.example/path", [person]), [person]);
      assert.equal(requests.length, 0);
    });
  });
});
