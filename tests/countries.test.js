import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, getCountry } from "../lib/countries.js";

test("all 249 ISO countries and territories plus Kosovo have valid flags and research hints", () => {
  assert.equal(COUNTRIES.length, 250);
  assert.equal(new Set(COUNTRIES.map((country) => country.code)).size, 250);
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.equal([...country.flag].length, 2, country.name);
    assert.equal(country.flag, String.fromCodePoint(...[...country.code].map((letter) => 0x1F1E6 + letter.charCodeAt(0) - 65)));
    assert.ok(country.name && country.region && country.language && country.regulators, country.code);
    assert.notEqual(country.region, "Other territories", country.name);
  }
});

test("major markets, remote territories and Kosovo can all be selected", () => {
  for (const code of ["US", "CA", "GB", "FR", "DE", "JP", "CN", "SG", "AU", "NZ", "SA", "AQ", "AX", "BQ", "CC", "PS", "XK"]) {
    assert.equal(getCountry(code).code, code);
  }
  assert.equal(getCountry("us").code, "US");
});

test("curated regulatory and outreach metadata is preserved", () => {
  assert.equal(getCountry("BR").regulators, "CVM register of portfolio managers; ANBIMA member list");
  assert.equal(getCountry("BR").lang, "pt");
  assert.equal(getCountry("KR").lang, "ko");
  assert.equal(getCountry("MX").language, "Spanish");
  assert.match(getCountry("US").regulators, /Find official financial regulator/);
  assert.match(getCountry("US").regulators, /verify rather than assume/);
});
