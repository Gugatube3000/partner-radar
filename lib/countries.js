// @ts-check
// Target markets. `regulators` are hints for the Scout agent: the public registers
// and member lists it should read first. `lang` drives the Writer agent.

/** @typedef {{ code: string, name: string, flag: string, region: string, language: string, lang: "pt"|"es"|"en"|"ko"|"other", regulators: string }} Country */

/** @type {Country[]} */
const CURATED_COUNTRIES = [
  { code: "BR", name: "Brazil", flag: "🇧🇷", region: "Latin America", language: "Portuguese", lang: "pt", regulators: "CVM register of portfolio managers; ANBIMA member list" },
  { code: "MX", name: "Mexico", flag: "🇲🇽", region: "Latin America", language: "Spanish", lang: "es", regulators: "CNBV supervised entities; AMIB member list" },
  { code: "CL", name: "Chile", flag: "🇨🇱", region: "Latin America", language: "Spanish", lang: "es", regulators: "CMF registry of supervised entities" },
  { code: "CO", name: "Colombia", flag: "🇨🇴", region: "Latin America", language: "Spanish", lang: "es", regulators: "Superintendencia Financiera (SFC) supervised entities" },
  { code: "PE", name: "Peru", flag: "🇵🇪", region: "Latin America", language: "Spanish", lang: "es", regulators: "SMV registry of market participants" },
  { code: "AR", name: "Argentina", flag: "🇦🇷", region: "Latin America", language: "Spanish", lang: "es", regulators: "CNV registry of agents" },
  { code: "UY", name: "Uruguay", flag: "🇺🇾", region: "Latin America", language: "Spanish", lang: "es", regulators: "BCU registry of securities market participants" },
  { code: "PA", name: "Panama", flag: "🇵🇦", region: "Latin America", language: "Spanish", lang: "es", regulators: "SMV Panama licensed entities" },
  { code: "CR", name: "Costa Rica", flag: "🇨🇷", region: "Latin America", language: "Spanish", lang: "es", regulators: "SUGEVAL registry" },
  { code: "IN", name: "India", flag: "🇮🇳", region: "Asia", language: "English", lang: "en", regulators: "SEBI registered portfolio managers and investment advisers; AMFI members" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩", region: "Asia", language: "Indonesian", lang: "other", regulators: "OJK licensed securities companies and investment managers" },
  { code: "PH", name: "Philippines", flag: "🇵🇭", region: "Asia", language: "English", lang: "en", regulators: "SEC Philippines and BSP supervised trust entities" },
  { code: "TH", name: "Thailand", flag: "🇹🇭", region: "Asia", language: "Thai", lang: "other", regulators: "SEC Thailand licensed securities and asset management companies" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳", region: "Asia", language: "Vietnamese", lang: "other", regulators: "State Securities Commission licensed firms" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾", region: "Asia", language: "English", lang: "en", regulators: "Securities Commission Malaysia licensed intermediaries" },
  { code: "KR", name: "South Korea", flag: "🇰🇷", region: "Asia", language: "Korean", lang: "ko", regulators: "FSS supervised financial investment companies; KOFIA members" },
  { code: "TW", name: "Taiwan", flag: "🇹🇼", region: "Asia", language: "Traditional Chinese", lang: "other", regulators: "FSC licensed securities firms and SITEs" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰", region: "Asia", language: "English", lang: "en", regulators: "SFC public register of licensed persons" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", region: "Middle East & Africa", language: "English", lang: "en", regulators: "SCA licensed companies; DFSA (DIFC) and FSRA (ADGM) public registers" },
  { code: "QA", name: "Qatar", flag: "🇶🇦", region: "Middle East & Africa", language: "English", lang: "en", regulators: "QFCRA public register; QFMA licensed firms" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼", region: "Middle East & Africa", language: "Arabic", lang: "other", regulators: "Capital Markets Authority licensed persons" },
  { code: "IL", name: "Israel", flag: "🇮🇱", region: "Middle East & Africa", language: "Hebrew", lang: "other", regulators: "Israel Securities Authority licensed portfolio managers" },
  { code: "TR", name: "Turkey", flag: "🇹🇷", region: "Middle East & Africa", language: "Turkish", lang: "other", regulators: "Capital Markets Board (SPK) authorized institutions" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", region: "Middle East & Africa", language: "English", lang: "en", regulators: "FSCA register of financial services providers" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬", region: "Middle East & Africa", language: "English", lang: "en", regulators: "SEC Nigeria registered capital market operators" },
  { code: "KE", name: "Kenya", flag: "🇰🇪", region: "Middle East & Africa", language: "English", lang: "en", regulators: "Capital Markets Authority licensees" },
  { code: "EG", name: "Egypt", flag: "🇪🇬", region: "Middle East & Africa", language: "Arabic", lang: "other", regulators: "Financial Regulatory Authority licensed companies" },
  { code: "MA", name: "Morocco", flag: "🇲🇦", region: "Middle East & Africa", language: "French", lang: "other", regulators: "AMMC regulated entities" },
  { code: "PL", name: "Poland", flag: "🇵🇱", region: "Europe", language: "Polish", lang: "other", regulators: "KNF register of investment firms" },
  { code: "CZ", name: "Czech Republic", flag: "🇨🇿", region: "Europe", language: "Czech", lang: "other", regulators: "Czech National Bank register of investment firms" },
  { code: "GR", name: "Greece", flag: "🇬🇷", region: "Europe", language: "Greek", lang: "other", regulators: "Hellenic Capital Market Commission register" },
  { code: "PT", name: "Portugal", flag: "🇵🇹", region: "Europe", language: "Portuguese", lang: "pt", regulators: "CMVM register of financial intermediaries" },
];

// ISO 3166-1's 249 countries and territories, plus Kosovo (XK).
// Keep this explicit: Intl.DisplayNames also accepts obsolete and non-country codes.
const ISO_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK`.split(/\s+/);

const REGION_CODES = {
  "North America": "CA US GL BM PM",
  "Latin America & Caribbean": "AG AI AR AW BB BL BO BQ BR BS BZ CL CO CR CU CW DM DO EC FK GD GF GP GT GY HN HT JM KN KY LC MF MQ MS MX NI PA PE PR PY SR SV SX TC TT UY VC VE VG VI",
  "Europe": "AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
  "Middle East": "AE BH CY IL IQ IR JO KW LB OM PS QA SA SY TR YE",
  "Africa": "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
  "Asia": "AF AM AZ BD BN BT CN GE HK ID IN JP KG KH KP KR KZ LA LK MM MN MO MV MY NP PH PK SG TH TJ TL TM TW UZ VN",
  "Oceania": "AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
  "Antarctic & remote territories": "AQ BV GS HM IO TF",
};
const regionByCode = new Map(Object.entries(REGION_CODES).flatMap(([region, codes]) => codes.split(" ").map((code) => [code, region])));
const names = new Intl.DisplayNames(["en"], { type: "region" });
const familiarNames = { KR: "South Korea", KP: "North Korea", CZ: "Czech Republic", XK: "Kosovo", VA: "Vatican City", CD: "Democratic Republic of the Congo", CG: "Republic of the Congo", CI: "Côte d’Ivoire" };
const curated = new Map(CURATED_COUNTRIES.map((country) => [country.code, country]));

// These are outreach defaults, not a claim that a country has only one language.
const languageGroups = {
  English: "AG AI AS AU BB BM BS BZ CA CK DM FJ FK FM GB GD GG GH GI GM GU GY IE IM IN IO JE JM KE KI KN KY LC LR MH MP MS MT MU MW NA NF NG NR NU NZ PG PH PN PW SB SG SH SL SS TC TK TO TT TV UG UM US VC VG VI VU WS ZA ZM ZW",
  Spanish: "AR BO CL CO CR CU DO EC ES GQ GT HN MX NI PA PE PR PY SV UY VE",
  Portuguese: "AO BR CV GW MZ PT ST TL",
  French: "BF BI BJ BL CD CF CG CI CM DJ FR GA GF GN GP HT KM MC MF MG ML MQ NC NE PF PM RE RW SC SN TD TF TG WF YT",
  Arabic: "AE BH DZ EG IQ JO KW LB LY MA MR OM PS QA SA SD SO SY TN YE",
  German: "AT DE LI", Dutch: "AW BQ CW NL SR SX", Italian: "IT SM VA", Korean: "KP KR",
  "Simplified Chinese": "CN", "Traditional Chinese": "HK MO TW", Russian: "BY RU", Hindi: "IN",
  Japanese: "JP", Indonesian: "ID", Malay: "BN MY", Bengali: "BD", Thai: "TH", Vietnamese: "VN",
  Turkish: "TR", Greek: "CY GR", Hebrew: "IL", Persian: "IR", Urdu: "PK", Ukrainian: "UA",
  Polish: "PL", Czech: "CZ", Slovak: "SK", Hungarian: "HU", Romanian: "MD RO", Bulgarian: "BG",
  Croatian: "HR", Serbian: "RS", Slovenian: "SI", Albanian: "AL XK", Macedonian: "MK",
  Swedish: "AX SE", Danish: "DK", Norwegian: "NO SJ", Finnish: "FI", Icelandic: "IS",
  Estonian: "EE", Latvian: "LV", Lithuanian: "LT", Armenian: "AM", Georgian: "GE",
  Azerbaijani: "AZ", Kazakh: "KZ", Uzbek: "UZ", Kyrgyz: "KG", Tajik: "TJ", Turkmen: "TM",
  Mongolian: "MN", Khmer: "KH", Lao: "LA", Burmese: "MM", Nepali: "NP", Sinhala: "LK",
  Dzongkha: "BT", Dhivehi: "MV", Pashto: "AF", Amharic: "ET", Tigrinya: "ER",
  Swahili: "TZ", Kinyarwanda: "RW", Kirundi: "BI", Sesotho: "LS", siSwati: "SZ",
  Malagasy: "MG", "Local language": "AQ BA BE BV CH EH FO GL GS HM LU ME SB SC SJ TL UM",
};
const languageByCode = new Map(Object.entries(languageGroups).flatMap(([language, codes]) => codes.split(" ").map((code) => [code, language])));

/** @type {Country[]} */
export const COUNTRIES = ISO_CODES.map((code) => {
  const existing = curated.get(code);
  const name = existing?.name || familiarNames[code] || names.of(code) || code;
  const language = existing?.language || languageByCode.get(code) || "Local language";
  return {
    ...existing,
    code, name,
    flag: String.fromCodePoint(...[...code].map((letter) => 0x1F1E6 + letter.charCodeAt(0) - 65)),
    region: regionByCode.get(code) || "Other territories",
    language,
    lang: existing?.lang || (language === "Portuguese" ? "pt" : language === "Spanish" ? "es" : language === "English" ? "en" : language === "Korean" ? "ko" : "other"),
    // Research the actual authority; never manufacture a regulator's name.
    regulators: existing?.regulators || `Find official financial regulator and central-bank license registers for ${name}; check local asset-management and banking associations; confirm authority and active status from primary sources. Territories may use a parent jurisdiction; verify rather than assume.`,
  };
}).sort((a, b) => a.name.localeCompare(b.name, "en"));

/** @param {string} code */
export function getCountry(code) {
  return COUNTRIES.find((country) => country.code === String(code).toUpperCase()) ?? COUNTRIES.find((country) => country.code === "BR");
}
