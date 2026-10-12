// @ts-check
// One `ask()` interface over four engines:
//   openrouter  - one key for Claude Opus 5.5, GPT and Jev Router (pay per use)
//   anthropic   - Claude API directly (pay per use)
//   claude-cli  - your Claude subscription, via the logged-in Claude Code CLI
//   codex-cli   - your ChatGPT subscription, via the logged-in Codex CLI
// Every call returns schema-shaped JSON plus cost/latency so the dashboard can show spend.
import Anthropic from "@anthropic-ai/sdk";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {"openrouter"|"anthropic"|"claude-cli"|"codex-cli"} EngineId */
/**
 * @typedef {{
 *   system: string, prompt: string, schema: Record<string, any>, name: string,
 *   web?: number, effort?: "low"|"medium"|"high", model?: string, signal?: AbortSignal,
 *   onActivity?: (text: string) => void
 * }} AskOptions
 * @typedef {{ data: any, cost: number, searches: number, tokens: number, ms: number, sources: string[] }} AskResult
 */

export const MODELS = {
  openrouter: { brain: process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5", judge: process.env.OPENROUTER_JUDGE_MODEL || "typesafe/jev-router" },
  anthropic: { brain: process.env.CLAUDE_MODEL || "claude-opus-5-5", judge: process.env.CLAUDE_MODEL || "claude-opus-5-5" },
  "claude-cli": { brain: process.env.CLAUDE_CLI_MODEL || "sonnet", judge: process.env.CLAUDE_CLI_MODEL || "sonnet" },
  "codex-cli": { brain: process.env.CODEX_MODEL || "gpt-5.5", judge: process.env.CODEX_MODEL || "gpt-5.5" },
};

export const ENGINE_LABELS = {
  openrouter: "OpenRouter · Claude Opus 5.5 + Jev Router",
  anthropic: "Claude API · Opus 5.5",
  "claude-cli": "Your Claude plan · no API key",
  "codex-cli": "ChatGPT subscription · Codex",
};

function which(cmd) {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch { return false; }
}

let codexEntry = /** @type {string|null} */ (null);
function codexCommand() {
  if (process.platform !== "win32") return { cmd: "codex", pre: [] };
  if (!codexEntry) {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    codexEntry = path.join(root, "@openai", "codex", "bin", "codex.js");
  }
  return { cmd: process.execPath, pre: [codexEntry] };
}

/** Which engines can run on this machine right now. */
export function detectEngines() {
  return {
    openrouter: !!process.env.OPENROUTER_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    "claude-cli": which("claude"),
    "codex-cli": which("codex"),
  };
}

/** @param {EngineId} engine @param {AskOptions} o @returns {Promise<AskResult>} */
export async function ask(engine, o) {
  const t0 = Date.now();
  /** @type {Omit<AskResult, "ms">} */
  let r;
  if (engine === "openrouter") r = await askOpenRouter(o);
  else if (engine === "anthropic") r = await askAnthropic(o);
  else if (engine === "claude-cli") r = await askClaudeCli(o);
  else r = await askCodexCli(o);
  return { ...r, ms: Date.now() - t0 };
}

/** Pull the first JSON object out of a model reply. */
function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
  throw new Error("Model did not return JSON");
}

// ---------------------------------------------------------------- OpenRouter
/** @param {AskOptions} o */
async function askOpenRouter(o) {
  const model = o.model || MODELS.openrouter.brain;
  /** @type {Record<string, any>} */
  const body = {
    model,
    messages: [{ role: "system", content: o.system }, { role: "user", content: o.prompt }],
    response_format: { type: "json_schema", json_schema: { name: o.name, strict: true, schema: o.schema } },
    // Keep the cap modest: OpenRouter reserves credit for max_tokens on every in-flight call.
    max_tokens: o.web >= 6 ? 12000 : 5000,
    reasoning: { effort: o.effort || "medium" },
    usage: { include: true },
  };
  // Exa search keeps token volume (and cost) low: ~10 results for the market map, ~5 per firm.
  if (o.web) body.plugins = [{ id: "web", engine: "exa", max_results: o.web >= 6 ? 10 : Math.min(5, o.web + 1) }];
  let res, json;
  for (let attempt = 0; attempt < 4; attempt++) {
  res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: o.signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:4747",
      "X-Title": "Partner Radar",
    },
    body: JSON.stringify(body),
  });
  json = await res.json().catch(() => ({}));
    // 402 here usually means credit is reserved by other in-flight calls; 429 is rate limiting. Both clear quickly.
    if ((res.status === 402 || res.status === 429) && attempt < 3) { await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); continue; }
    break;
  }
  if (!res.ok || json.error) throw new Error(`OpenRouter ${res.status}: ${json.error?.message || res.statusText}`);
  const msg = json.choices?.[0]?.message ?? {};
  const sources = (msg.annotations ?? []).filter((a) => a.type === "url_citation").map((a) => a.url_citation?.url).filter(Boolean);
  return {
    data: parseJson(msg.content ?? ""),
    cost: Number(json.usage?.cost ?? 0),
    searches: o.web ? 1 : 0,
    tokens: Number(json.usage?.total_tokens ?? 0),
    sources,
  };
}

// ---------------------------------------------------------------- Claude API
let anthropic = /** @type {Anthropic|null} */ (null);
const PRICE = { in: 4 / 1e6, out: 20 / 1e6, cacheRead: 0.2 / 1e6, search: 0.01 };

/** @param {AskOptions} o */
async function askAnthropic(o) {
  anthropic ??= new Anthropic();
  /** @type {any[]} */
  const tools = [];
  if (o.web) {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: o.web });
    tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.max(1, Math.floor(o.web / 2)) });
  }
  tools.push({ name: o.name, description: "Submit your final answer. Call this exactly once when you are done.", strict: true, input_schema: o.schema });

  /** @type {import("@anthropic-ai/sdk").default.Beta.BetaMessageParam[]} */
  const messages = [{ role: "user", content: o.prompt }];
  let cost = 0, searches = 0, tokens = 0;
  for (let turn = 0; turn < 8; turn++) {
    const res = await anthropic.beta.messages.create({
      model: o.model || MODELS.anthropic.brain,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: o.system,
      tools,
      tool_choice: { type: "auto" },
      output_config: { effort: o.effort || "medium" },
      messages,
    }, { signal: o.signal });

    const u = res.usage;
    const s = u.server_tool_use?.web_search_requests ?? 0;
    searches += s;
    tokens += u.input_tokens + u.output_tokens;
    cost += u.input_tokens * PRICE.in + u.output_tokens * PRICE.out + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + s * PRICE.search;

    if (res.stop_reason === "refusal") throw new Error("Model declined this request");
    const call = res.content.find((b) => b.type === "tool_use" && b.name === o.name);
    if (call && call.type === "tool_use") return { data: call.input, cost, searches, tokens, sources: [] };
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    messages.push({ role: "user", content: `Call ${o.name} now with your final answer.` });
  }
  throw new Error("No answer after 8 turns");
}

// ---------------------------------------------------------------- CLI engines
const CLI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "partner-radar-"));

/** @param {string} cmd @param {string[]} args @param {AbortSignal|undefined} signal @param {number} timeoutMs */
function run(cmd, args, signal, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: CLI_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const kill = () => child.kill();
    const timer = setTimeout(() => { kill(); reject(new Error("CLI call timed out")); }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) return reject(new Error("Stopped"));
      if (code !== 0 && !out) return reject(new Error(err.trim().split("\n").pop() || `exit ${code}`));
      resolve(out);
    });
  });
}

/** Run Claude Code with stream-json output, reporting each search / page read as it happens. */
function runStream(cmd, args, signal, onEvent, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: CLI_DIR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", err = "", result = null;
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (e.type === "result") result = e;
          else onEvent?.(e);
        } catch { /* partial or non-JSON line */ }
      }
    });
    child.stderr.on("data", (d) => (err += d));
    const kill = () => child.kill();
    const timer = setTimeout(() => { kill(); reject(new Error("CLI call timed out")); }, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) return reject(new Error("Stopped"));
      if (!result) return reject(new Error(err.trim().split("\n").pop() || `exit ${code}`));
      resolve(result);
    });
  });
}

/** Turn a Claude Code stream event into a short human line ("search · ...", "read · ..."). */
function describe(e) {
  if (e.type !== "assistant") return [];
  const out = [];
  for (const c of e.message?.content ?? []) {
    if (c.type !== "tool_use") continue;
    const inp = c.input ?? {};
    if (c.name === "WebSearch") out.push(`search · "${String(inp.query || "").slice(0, 90)}"`);
    else if (c.name === "WebFetch") {
      let u = String(inp.url || "");
      try { const x = new URL(u); u = x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? x.pathname.slice(0, 40) : ""); } catch {}
      out.push(`read · ${u}`);
    } else if (c.name === "StructuredOutput") out.push("writing up results");
  }
  return out;
}

/** @param {AskOptions} o */
async function askClaudeCli(o) {
  const args = [
    "-p", o.prompt,
    "--output-format", "stream-json", "--verbose",
    "--json-schema", JSON.stringify(o.schema),
    "--model", o.model || MODELS["claude-cli"].brain,
    "--system-prompt", o.system,
    "--effort", o.effort || "medium",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  if (o.web) args.push("--tools", "WebSearch", "WebFetch", "--allowedTools", "WebSearch", "WebFetch");
  else args.push("--tools", "");
  let lastErr = "Claude Code did not answer";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (o.signal?.aborted) throw new Error("Stopped");
    try {
      o.onActivity?.("thinking about where to look");
      const res = await runStream("claude", args, o.signal, (e) => { for (const t of describe(e)) o.onActivity?.(t); });
      if (res.is_error) {
        lastErr = `${res.subtype || "error"}${res.result ? `: ${String(res.result).slice(0, 160)}` : ""}`;
        if (/not logged in|login|authenticate/i.test(lastErr) && !/OAuth token/i.test(lastErr)) throw new Error("Claude Code isn't signed in. Open Claude Code once and sign in.");
        await new Promise((r) => setTimeout(r, /OAuth|refresh/i.test(lastErr) ? 4000 : 1500));
        continue;
      }
      const data = res.structured_output ?? parseJson(res.result ?? "");
      const u = res.usage ?? {};
      return {
        data,
        cost: 0, // covered by the subscription
        searches: u.server_tool_use?.web_search_requests ?? 0,
        tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        sources: [],
      };
    } catch (e) {
      const msg = String(/** @type {any} */ (e)?.message || e);
      if (msg === "Stopped" || /isn't signed in/.test(msg)) throw e;
      lastErr = msg;
    }
  }
  throw new Error(lastErr);
}

/** @param {AskOptions} o */
async function askCodexCli(o) {
  const id = Math.random().toString(36).slice(2);
  const schemaFile = path.join(CLI_DIR, `${id}.schema.json`);
  const outFile = path.join(CLI_DIR, `${id}.out.json`);
  fs.writeFileSync(schemaFile, JSON.stringify(o.schema));
  const { cmd, pre } = codexCommand();
  const args = [...pre];
  if (o.web) args.push("--search");
  args.push("exec", "-m", o.model || MODELS["codex-cli"].brain, "--skip-git-repo-check", "--sandbox", "read-only",
    "-c", `model_reasoning_effort="${o.effort || "medium"}"`, "--output-schema", schemaFile, "-o", outFile,
    `${o.system}\n\n${o.prompt}`);
  try {
    await run(cmd, args, o.signal);
    const text = fs.readFileSync(outFile, "utf8");
    return { data: parseJson(text), cost: 0, searches: o.web ? 1 : 0, tokens: 0, sources: [] };
  } finally {
    fs.rmSync(schemaFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}
