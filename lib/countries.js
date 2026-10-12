// @ts-check
// Target markets. `regulators` are hints for the Scout agent: the public registers
// and member lists it should read first. `lang` drives the Writer agent.

/** @typedef {{ code: string, name: string, flag: string, region: string, language: string, lang: "pt"|"es"|"en"|"ko"|"other", regulators: string }} Country */

/** @type {Country[]} */
export const COUNTRIES = [
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

/** @param {string} code */
export function getCountry(code) {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}
