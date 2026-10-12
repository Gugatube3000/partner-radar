// @ts-check
// Demo mode: the same pipeline, with a fake model that returns fictional firms.
// Every firm, person and email here is invented; domains use the reserved .example TLD.

const GREEK = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Theta", "Iota", "Kappa", "Lambda", "Sigma", "Omega", "Orion", "Vega", "Lyra", "Nova", "Atlas", "Aurora", "Helix", "Polaris"];
const SUFFIX = {
  pt: ["Gestão", "Investimentos", "Asset", "Capital", "Gestora", "Investimentos", "Asset Management", "Capital"],
  es: ["Asset Management", "Inversiones", "Gestión", "Capital", "Fondos", "Asset", "Administradora", "Capital"],
  ko: ["Securities", "Asset Management", "Wealth", "Investment", "Private Bank", "Capital"],
  en: ["Asset Management", "Capital", "Investments", "Asset Managers", "Funds", "Investment Management", "Capital Partners", "Asset"],
};
const PEOPLE = {
  pt: [["Ana", "Bruno", "Carla", "Diego", "Fernanda", "Helena", "Lucas", "Mariana", "Rafael", "Paula", "Tiago", "Beatriz"], ["Ribeiro", "Souza", "Almeida", "Costa", "Ferreira", "Lima", "Rocha", "Martins", "Carvalho", "Teixeira"]],
  es: [["Luis", "María", "Javier", "Sofía", "Andrés", "Camila", "Diego", "Valentina", "Pablo", "Lucía", "Mateo", "Elena"], ["García", "Martínez", "Vidal", "Rojas", "Herrera", "Morales", "Castro", "Vargas", "Navarro", "Torres"]],
  ko: [["Ji-woo", "Min-jun", "Seo-yeon", "Do-hyun", "Ha-eun", "Joon-ho", "Ye-jin", "Sung-min"], ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Yoon", "Han"]],
  en: [["Aisha", "Daniel", "Priya", "Omar", "Grace", "Samuel", "Leila", "Arjun", "Nadia", "Tomás", "Hana", "Kofi"], ["Okafor", "Mensah", "Sharma", "Haddad", "Naidoo", "Kaplan", "Novak", "Tan", "Rahman", "Silva"]],
};
const CITIES = {
  BR: ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Porto Alegre", "Curitiba"], MX: ["Ciudad de México", "Monterrey", "Guadalajara"],
  CL: ["Santiago", "Viña del Mar"], CO: ["Bogotá", "Medellín", "Cali"], PE: ["Lima", "Arequipa"], AR: ["Buenos Aires", "Córdoba"],
  KR: ["Seoul", "Busan"], IN: ["Mumbai", "Bengaluru", "New Delhi"], AE: ["Dubai", "Abu Dhabi"], ZA: ["Johannesburg", "Cape Town"],
};
const TYPES = ["Asset manager", "Asset manager", "Asset manager (bank-owned)", "Asset manager (independent)"];
const CLASSES = [
  ["Local equities, fixed income, multi-asset", 5], ["Fixed income, credit, multi-asset", 4], ["Local equities, long-short, multi-asset", 5],
  ["Fixed income, money market", 4], ["Real estate funds, private equity", 1], ["Private equity, infrastructure", 1], ["Multi-asset, some real estate", 3],
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let rand = rng(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const langKey = (c) => (c.lang === "pt" || c.lang === "es" || c.lang === "ko" ? c.lang : "en");

function person(country) {
  const [firsts, lasts] = PEOPLE[langKey(country)];
  return `${pick(firsts)} ${pick(lasts)}`;
}

/**
 * @param {string} name
 * @param {any} ctx
 * @returns {Promise<{ data: any, cost: number, searches: number, tokens: number, sources: string[] }>}
 */
export async function demoAsk(name, ctx) {
  const { country, speed } = ctx;
  if (name === "firms") {
    rand = rng([...country.code].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) + ctx.n);
    await sleep(3800 / speed);
    const suffixes = SUFFIX[langKey(country)];
    const firms = [];
    for (let i = 0; i < ctx.n; i++) {
      const nm = `${GREEK[i % GREEK.length]} ${suffixes[(i * 3 + Math.floor(i / GREEK.length)) % suffixes.length]}`;
      firms.push({
        name: nm, website: `https://${slug(nm)}.example`, city: pick(CITIES[country.code] || ["Capital city"]),
        type: pick(TYPES), client_segment: pick(["Retail funds", "Institutional + retail", "Wealth / private clients", "Pension funds + retail"]),
        aum_estimate: `US$ ${Math.round(between(0.3, 9) * 10) / 10}B`,
        source: i % 3 === 0 ? "Association list" : i % 3 === 1 ? "Regulator list" : "Web search", source_url: "",
      });
    }
    return { data: { firms }, cost: 0, searches: 8, tokens: 24000, sources: [] };
  }
  if (name === "profile") {
    await sleep(between(1600, 3200) / speed);
    const ge = rand() < 0.5 ? "No" : rand() < 0.6 ? "Yes" : "Unknown";
    const cls = pick(CLASSES);
    const leaders = [
      { name: person(country), title: "CEO", linkedin_url: "", source_url: "" },
      { name: person(country), title: pick(["Head of Wealth Management", "Head of Private Banking", "Head of Partnerships", "Chief Investment Officer"]), linkedin_url: "", source_url: "" },
    ];
    return {
      data: {
        aum: ctx.firm.aum, asset_classes: cls[0], client_segment: ctx.firm.segment, offers_global_equity: ge,
        global_equity_evidence: ge === "No" ? "Product shelf lists local equity and fixed income only." : ge === "Yes" ? "Offers an international equity fund via a global partner." : "",
        languages: country.language, summary: `${ctx.firm.name} is a ${ctx.firm.type.toLowerCase()} in ${ctx.firm.city} serving ${ctx.firm.segment.toLowerCase()} clients.`,
        recent_news: rand() < 0.5 ? "Opened a new advisory office this year." : "", leadership: leaders,
      },
      cost: 0, searches: 3, tokens: 14000, sources: [],
    };
  }
  if (name === "judge") {
    await sleep(between(220, 520) / speed);
    const base = Number((CLASSES.find((c) => c[0] === ctx.profile.asset_classes) || ["", 3])[1]);
    const fit = base >= 5 ? (rand() < 0.7 ? 5 : 4) : base;
    const why = fit >= 4 ? `Public-markets manager (${ctx.profile.asset_classes.toLowerCase()}); a global equity strategy is a natural add for its clients.`
      : fit === 3 ? "Some public-markets business, but mostly other assets." : "Real estate / private assets only. Not a fit.";
    return { data: { fit_score: fit, confidence: Math.round(between(0.62, 0.96) * 100) / 100, why, best_contact: pick(ctx.cfg.roles.length ? ctx.cfg.roles : ["CEO"]) }, cost: 0, searches: 0, tokens: 900, sources: [] };
  }
  if (name === "contact") {
    await sleep(between(1100, 2100) / speed);
    const t = ctx.target || { name: person(country), title: "CEO" };
    return { data: { name: t.name, title: t.title, linkedin_url: "", email: "", email_evidence: "", source_url: "" }, cost: 0, searches: 2, tokens: 6000, sources: [] };
  }
  if (name === "email") {
    await sleep(between(1000, 1800) / speed);
    const fill = (s) => s.replaceAll("{{first_name}}", ctx.first).replaceAll("{{firm}}", ctx.firm.name)
      .replaceAll("{{country}}", country.name).replaceAll("{{language}}", country.language)
      .replaceAll("{{sender}}", ctx.cfg.sender || "[Your name]").replaceAll("{{why}}", "your client base");
    return {
      data: { subject: `${ctx.firm.name} × global equity for your clients`, body: fill(ctx.cfg.template), english_gist: `Demo mode. Live mode writes this in ${country.language}.` },
      cost: 0, searches: 0, tokens: 2200, sources: [],
    };
  }
  throw new Error(`Unknown demo step ${name}`);
}

/** @param {any} firm @param {string} name @param {number} _speed */
export function demoEmail(firm, name, _speed) {
  const r = rand();
  const none = { email: "", emailStatus: "Not found", emailScore: null, emailPattern: "", emailEvidence: "" };
  if (!name || r < 0.1) return none;
  const host = new URL(firm.website).hostname;
  const [first, ...rest] = slug(name).split("-");
  const last = rest[rest.length - 1] || "";
  const pats = { "first.last": `${first}.${last}`, flast: `${first[0]}${last}`, first: first };
  const pattern = r < 0.55 ? "first.last" : r < 0.8 ? "flast" : "first";
  const email = `${pats[pattern]}@${host}`;
  const example = { "first.last": "maria.souza", flast: "msouza", first: "maria" }[pattern] + "@" + host;
  if (r < 0.22) return { email, emailStatus: "Published", emailScore: 95, emailPattern: pattern, emailEvidence: `team page, ${firm.website}/team` };
  if (r < 0.8) return { email, emailStatus: "Inferred", emailScore: Math.round(between(68, 82)), emailPattern: pattern, emailEvidence: `${example} (press release)` };
  return { email, emailStatus: "Guess", emailScore: Math.round(between(30, 40)), emailPattern: "first.last", emailEvidence: "" };
}
