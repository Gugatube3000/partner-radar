// @ts-check
// One `ask()` interface over four engines:
//   openrouter  - one key for Claude Opus 5.5, GPT and Jev Router (pay per use)
//   anthropic   - Claude API directly (pay per use)
//   claude-cli  - your Claude subscription, via the logged-in Claude Code CLI
//   codex-cli   - your ChatGPT subscription, via the logged-in Codex CLI
// Every call returns schema-shaped JSON plus cost/latency so the dashboard can show spend.
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {"openrouter"|"anthropic"|"claude-cli"|"codex-cli"} EngineId */
/**
 * @typedef {{
 *   system: string, prompt: string, schema: Record<string, any>, name: string,
 *   web?: number, effort?: "low"|"medium"|"high", model?: string, signal?: AbortSignal,
 *   onActivity?: (text: string) => void, timeoutMs?: number,
 *   mcpServers?: Record<string, {url: string, tools: string[]}>
 * }} AskOptions
 * @typedef {{ data: any, cost: number, searches: number, tokens: number, ms: number, sources: string[] }} AskResult
 */

export const MODELS = {
  openrouter: { brain: process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5", judge: process.env.OPENROUTER_JUDGE_MODEL || "typesafe/jev-router" },
  anthropic: { brain: process.env.CLAUDE_MODEL || "claude-opus-5-5", judge: process.env.CLAUDE_MODEL || "claude-opus-5-5" },
  "claude-cli": { brain: process.env.CLAUDE_CLI_MODEL || "sonnet", judge: process.env.CLAUDE_CLI_MODEL || "sonnet" },
  "codex-cli": { brain: process.env.CODEX_MODEL || "CLI default", judge: process.env.CODEX_MODEL || "CLI default" },
};

export const ENGINE_LABELS = {
  openrouter: "OpenRouter · Claude Opus 5.5 + Jev Router",
  anthropic: "Claude API · Opus 5.5",
  "claude-cli": "Your Claude plan · no API key",
  "codex-cli": "ChatGPT subscription · Codex",
};

/** Resolve native executables and npm shims without invoking a shell. */
function cliCommand(engine) {
  if (!["codex-cli", "claude-cli"].includes(engine)) return null;
  const name = engine === "codex-cli" ? "codex" : "claude";
  const override = process.env[engine === "codex-cli" ? "PARTNER_RADAR_CODEX_CLI" : "PARTNER_RADAR_CLAUDE_CLI"];
  const extensions = process.platform === "win32" ? [".exe", ".com", ".cmd", ".ps1", ""] : [""];
  const paths = override ? [path.resolve(override)] : (process.env.PATH || "").split(path.delimiter)
    .flatMap((dir) => extensions.map((ext) => path.join(dir.replace(/^"|"$/g, ""), name + ext)));
  for (const file of paths) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    if (/\.[cm]?js$/i.test(file)) return { cmd: process.execPath, pre: [file] };
    if (/\.(cmd|ps1)$/i.test(file)) {
      const packageName = engine === "codex-cli" ? "@openai/codex" : "@anthropic-ai/claude-code";
      const root = path.join(path.dirname(file), "node_modules", packageName);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[name];
        const entry = bin && path.join(root, bin);
        if (entry && fs.existsSync(entry)) return { cmd: process.execPath, pre: [entry] };
      } catch { /* Try another installation on PATH. */ }
      continue;
    }
    return { cmd: file, pre: [] };
  }
  return null;
}

/** Safe CLI resolution for setup commands; callers supply a fixed allowlisted argument list. */
export function resolveCliCommand(engine) { return cliCommand(engine); }

/** Fast install/key detection. Use getEngineStatuses() for subscription readiness. */
export function detectEngines() {
  return {
    openrouter: !!process.env.OPENROUTER_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    "claude-cli": !!cliCommand("claude-cli"),
    "codex-cli": !!cliCommand("codex-cli"),
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
  else if (engine === "codex-cli") r = await askCodexCli(o);
  else throw new Error(`Unknown research engine: ${engine}`);
  validateOutput(r.data, o.schema);
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
const CLI_TIMEOUT_MS = 600000;
const STATUS_TTL_MS = 15000;
const SETUP = {
  "codex-cli": { install: "npm install -g @openai/codex", login: "codex login", status: "codex login status", docs: "https://developers.openai.com/codex/cli/" },
  "claude-cli": { install: "https://code.claude.com/docs/en/setup", login: "claude auth login", status: "claude auth status", docs: "https://code.claude.com/docs/en/setup" },
};

/** Subscription adapters must never silently fall back to usage-billed API credentials. */
function subscriptionEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|OPENAI_BASE_URL|OPENAI_WIF_.*|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)|CLAUDE_CODE_SIMPLE)$/i.test(key)) delete env[key];
  }
  return env;
}

/** @param {unknown} e */
const errorText = (e) => String(/** @type {any} */ (e)?.message || e);
function stopped() { return new Error("Stopped"); }
function safeError(text) {
  return String(text).replace(/(?:sk-|sk-ant-)[\w-]+/g, "[redacted]")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]").slice(-1500).trim();
}

/** Kill the entire CLI process tree, including the native process behind npm's Node launcher. */
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill("SIGKILL"));
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

/** One bounded process runner for auth checks and streamed research. No shell interpolation. */
function runCli(command, args, { signal = undefined, timeoutMs = CLI_TIMEOUT_MS, cwd = os.tmpdir(), input = "", onEvent = undefined } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(stopped()); return; }
    const child = spawn(command.cmd, [...command.pre, ...args], {
      cwd, env: subscriptionEnv(), windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "", buf = "", terminal = /** @type {Error|null} */ (null), closed = false;
    const consume = (line) => {
      if (!line.trim()) return;
      try { onEvent?.(JSON.parse(line)); } catch { /* Ignore human logs and incomplete JSON. */ }
    };
    const end = (reason) => {
      if (closed || terminal) return;
      terminal = reason;
      killTree(child);
    };
    const abort = () => end(stopped());
    const timer = setTimeout(() => end(new Error("Research timed out. Reduce the research size or try again.")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      out = (out + data).slice(-2 * 1024 * 1024);
      if (!onEvent) return;
      buf += data;
      let newline;
      while ((newline = buf.indexOf("\n")) >= 0) { consume(buf.slice(0, newline)); buf = buf.slice(newline + 1); }
      if (buf.length > 4 * 1024 * 1024) end(new Error("CLI returned an oversized event"));
    });
    child.stderr.on("data", (data) => { err = (err + data).slice(-16000); });
    child.stdin.on("error", () => { /* EPIPE is handled by the CLI exit/error below. */ });
    child.stdin.end(input);
    child.on("error", (e) => { terminal ??= new Error(`Could not launch the CLI: ${safeError(e.message)}`); });
    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (buf) consume(buf); // Some CLI versions do not append a final newline.
      if (terminal) reject(terminal);
      else resolve({ code, out, err });
    });
  });
}

/** Run a fixed provider setup/status command. Does not modify or ignore the user's configuration. */
export async function runProviderCommand(engine, args, { timeoutMs = 10000, signal = undefined } = {}) {
  const command = cliCommand(engine);
  if (!command) throw new Error(`${engine === "codex-cli" ? "Codex" : "Claude"} CLI is not installed.`);
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("CLI arguments must be strings");
  const safeArgs = engine === "codex-cli" ? ["-c", 'model_reasoning_effort="medium"', ...args] : args;
  return runCli(command, safeArgs, { timeoutMs, signal });
}

/** @typedef {{id: string, label: string, model: string, judge: string, installed: boolean, authenticated: boolean, authStatus: string, ready: boolean, ok: boolean, message: string, setup: {install: string, login: string, status: string, docs?: string}}} EngineStatus */
let statusCache = /** @type {{at: number, value: Record<string, EngineStatus>}|null} */ (null);
let statusPending = /** @type {Promise<Record<string, EngineStatus>>|null} */ (null);

/** Read CLI-reported authentication, returning no account details or credentials. */
async function subscriptionStatus(engine) {
  const command = cliCommand(engine);
  const base = { id: engine, label: ENGINE_LABELS[engine], model: MODELS[engine].brain, judge: MODELS[engine].judge,
    installed: !!command, authenticated: false, authStatus: "missing", ready: false, ok: false,
    message: "Install the CLI, sign in with your subscription, then refresh.", setup: SETUP[engine] };
  if (!command) return base;
  try {
    // Override effort for status so a newer desktop config does not break an older CLI.
    const args = engine === "codex-cli" ? ["-c", 'model_reasoning_effort="medium"', "login", "status"] : ["auth", "status", "--json"];
    const result = await runCli(command, args, { timeoutMs: 10000 });
    if (engine === "codex-cli") {
      const text = result.out + result.err;
      if (result.code === 0 && /using ChatGPT/i.test(text)) return { ...base, authenticated: true, authStatus: "ready", ready: true, ok: true, message: "ChatGPT subscription signed in. Runs count toward your plan limits." };
      if (/API key|access token|workload identity/i.test(text)) return { ...base, authenticated: true, authStatus: "wrong-auth", message: "Codex is using API or enterprise credentials. Sign in with ChatGPT using codex login to use this subscription option." };
      if (/not logged in|not signed in/i.test(text)) return { ...base, authStatus: "signed-out", message: "Run codex login and choose your ChatGPT account, then refresh." };
      return { ...base, authStatus: "error", message: "Codex status could not be checked. Update the CLI and check codex login status." };
    }
    const auth = JSON.parse(result.out);
    if (!auth.loggedIn) return { ...base, authStatus: "signed-out", message: "Run claude auth login and sign in with your Claude subscription, then refresh." };
    if (!["claude.ai", "oauth_token"].includes(auth.authMethod) || auth.apiProvider && auth.apiProvider !== "firstParty") return { ...base, authenticated: true, authStatus: "wrong-auth", message: "Claude is using API or third-party credentials. Run claude auth login and choose your Claude subscription." };
    return { ...base, authenticated: true, authStatus: "ready", ready: true, ok: true, message: "Claude subscription signed in. Runs count toward your plan limits." };
  } catch {
    return { ...base, authStatus: "error", message: `Could not check ${engine === "codex-cli" ? "Codex" : "Claude"} sign-in. Update the CLI and run ${base.setup.status}.` };
  }
}

/** Async readiness used by the dashboard and before starting live runs. */
export async function getEngineStatuses({ refresh = false } = {}) {
  if (!refresh && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  if (statusPending) return statusPending;
  statusPending = (async () => {
    const [codex, claude] = await Promise.all([subscriptionStatus("codex-cli"), subscriptionStatus("claude-cli")]);
    const result = { "codex-cli": codex, "claude-cli": claude };
    for (const id of ["openrouter", "anthropic"]) {
      const ok = !!process.env[id === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"];
      result[id] = { id, label: ENGINE_LABELS[id], model: MODELS[id].brain, judge: MODELS[id].judge, installed: true,
        authenticated: ok, authStatus: ok ? "ready" : "missing", ready: ok, ok,
        message: ok ? "API key configured. Usage is billed separately." : "Optional: configure an API key for pay-per-use access.",
        setup: { install: "", login: "", status: "" } };
    }
    statusCache = { at: Date.now(), value: result };
    return result;
  })();
  try { return await statusPending; } finally { statusPending = null; }
}

async function requireSubscription(engine, signal) {
  if (signal?.aborted) throw stopped();
  const statuses = await getEngineStatuses();
  if (signal?.aborted) throw stopped();
  if (!statuses[engine].ok) throw new Error(statuses[engine].message);
  const command = cliCommand(engine);
  if (!command) throw new Error(`${ENGINE_LABELS[engine]} CLI is missing. Install it and refresh.`);
  return command;
}

/** Retry network hiccups and service overload only; auth, schema and plan-limit errors need action. */
function transient(message) {
  if (/usage limit|rate limit|limit reached|quota|credit|not logged|sign.?in|unauthorized|authentication|invalid|schema|timed out|Stopped/i.test(message)) return false;
  return /overloaded|temporarily unavailable|service unavailable|ECONNRESET|ETIMEDOUT|fetch failed|network error|connection (?:reset|closed)|HTTP (?:500|502|503|504)\b/i.test(message);
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(stopped()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(undefined); }, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(stopped()); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function retryCli(o, work) {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); } catch (e) {
      const message = errorText(e);
      if (attempt >= 1 || !transient(message) || o.signal?.aborted) throw e;
      o.onActivity?.("Temporary connection problem; retrying once");
      await pause(1500, o.signal);
    }
  }
}

function conciseUrl(value) {
  try { const url = new URL(value); return url.hostname.replace(/^www\./, "") + url.pathname.slice(0, 60); } catch { return String(value || "").slice(0, 90); }
}

/** MCP research is opt-in and requires verified read-only tool names supplied by the app. */
function approvedMcp(o) {
  const entries = Object.entries(o.mcpServers || {});
  for (const [name, server] of entries) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || !/^https:\/\//i.test(server.url) || !server.tools?.length || server.tools.some((tool) => !/^[a-zA-Z0-9_-]+$/.test(tool))) {
      throw new Error("MCP research requires HTTPS endpoints and an explicit read-only tool allowlist");
    }
  }
  return entries;
}

/** @param {AskOptions} o */
async function askClaudeCli(o) {
  const command = await requireSubscription("claude-cli", o.signal);
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--json-schema", JSON.stringify(o.schema),
    "--model", o.model || MODELS["claude-cli"].brain, "--system-prompt", o.system, "--effort", o.effort || "medium",
    "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"];
  const mcp = approvedMcp(o);
  const allowed = o.web ? ["WebSearch", "WebFetch"] : [];
  if (mcp.length) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: Object.fromEntries(mcp.map(([name, server]) => [name, { type: "http", url: server.url }])) }));
    for (const [name, server] of mcp) allowed.push(...server.tools.map((tool) => `mcp__${name}__${tool}`));
  }
  args.push("--tools", o.web ? "WebSearch,WebFetch" : "");
  if (allowed.length) args.push("--allowedTools", allowed.join(","));
  return retryCli(o, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partner-radar-call-"));
    let result = null, searches = 0;
    const sources = new Set();
    try {
      o.onActivity?.("Claude is researching public sources");
      const processResult = await runCli(command, args, { cwd: dir, input: o.prompt, signal: o.signal, timeoutMs: o.timeoutMs || CLI_TIMEOUT_MS,
        onEvent: (event) => {
          if (event.type === "result") result = event;
          if (event.type !== "assistant") return;
          for (const block of event.message?.content || []) {
            if (block.type !== "tool_use") continue;
            if (block.name === "WebSearch") { searches++; o.onActivity?.(`search · ${String(block.input?.query || "").slice(0, 100)}`); }
            if (block.name === "WebFetch") { const url = block.input?.url; if (/^https?:\/\//i.test(url)) sources.add(url); o.onActivity?.(`read · ${conciseUrl(url)}`); }
            if (block.name === "StructuredOutput") o.onActivity?.("writing up results");
          }
        } });
      if (processResult.code !== 0 || !result || result.is_error) {
        throw new Error(safeError(result?.result || result?.subtype || processResult.err || `Claude exited with code ${processResult.code}`));
      }
      const data = result.structured_output ?? parseJson(result.result || "");
      validateOutput(data, o.schema);
      const usage = result.usage || {};
      return { data, cost: 0, searches: Math.max(searches, usage.server_tool_use?.web_search_requests || 0),
        tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0), sources: [...sources] };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

/** @param {AskOptions} o */
async function askCodexCli(o) {
  const command = await requireSubscription("codex-cli", o.signal);
  return retryCli(o, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partner-radar-call-"));
    const schemaFile = path.join(dir, "schema.json"), outFile = path.join(dir, "answer.json");
    fs.writeFileSync(schemaFile, JSON.stringify(o.schema));
    // Do not load unrelated hooks, MCP servers or config intended for a different CLI version.
    // Authentication is retained, and omitting --model uses the installed CLI's supported default.
    const args = ["exec", "--ignore-user-config", "--ephemeral", "--json", "--color", "never", "--skip-git-repo-check", "--sandbox", "read-only",
      "-c", 'approval_policy="never"', "-c", 'model_provider="openai"', "-c", `model_reasoning_effort="${o.effort || "medium"}"`,
      "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.shell_snapshot=false",
      "-c", `web_search="${o.web ? "live" : "disabled"}"`, "--output-schema", schemaFile, "-o", outFile];
    const model = o.model || process.env.CODEX_MODEL;
    if (model) args.push("--model", model);
    for (const [name, server] of approvedMcp(o)) {
      args.push("-c", `mcp_servers.${name}.url=${JSON.stringify(server.url)}`, "-c", `mcp_servers.${name}.enabled_tools=${JSON.stringify(server.tools)}`);
    }
    args.push("-");
    let searches = 0, tokens = 0, streamError = "", lastMessage = "";
    const searchIds = new Set();
    const sources = new Set();
    try {
      o.onActivity?.("Codex is researching public sources");
      const processResult = await runCli(command, args, { cwd: dir, input: `${o.system}\n\n${o.prompt}`, signal: o.signal, timeoutMs: o.timeoutMs || CLI_TIMEOUT_MS,
        onEvent: (event) => {
          if (event.type === "error" || event.type === "turn.failed") streamError = safeError(event.message || event.error?.message || "Codex research failed");
          if (event.type === "turn.completed") { const u = event.usage || {}; tokens = (u.input_tokens || 0) + (u.output_tokens || 0); streamError = ""; }
          const item = event.item;
          if (!item) return;
          if (item.type === "web_search" && ["item.started", "item.completed"].includes(event.type)) {
            const id = item.id || item.query || item.action?.query || "public sources";
            const action = item.action?.type;
            if (action === "open_page" || action === "open") {
              if (item.action.url) { sources.add(item.action.url); o.onActivity?.(`read · ${conciseUrl(item.action.url)}`); }
            } else if (!searchIds.has(id)) {
              searchIds.add(id);
              searches++;
              o.onActivity?.(`search · ${String(item.query || item.action?.query || "public sources").slice(0, 100)}`);
            }
          }
          if (item.type === "web_search" && event.type === "item.completed") {
            for (const source of item.sources || []) if (/^https?:\/\//i.test(source.url)) sources.add(source.url);
          }
          if (item.type === "agent_message" && event.type === "item.completed") { lastMessage = item.text || ""; o.onActivity?.("writing up results"); }
        } });
      if (processResult.code !== 0 || streamError) throw new Error(streamError || safeError(processResult.err || `Codex exited with code ${processResult.code}`));
      const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : lastMessage;
      const data = parseJson(text);
      validateOutput(data, o.schema);
      return { data, cost: 0, searches, tokens, sources: [...sources] };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

/** Validate the JSON Schema vocabulary used by pipeline outputs before consuming model data. */
function validateOutput(value, schema, location = "result") {
  if (!schema || typeof schema !== "object") return;
  const fail = (detail) => { throw new Error(`Invalid structured output: ${location} ${detail}`); };
  const matches = (sub) => { try { validateOutput(value, sub, location); return true; } catch { return false; } };
  if (schema.anyOf && !schema.anyOf.some(matches)) fail("does not match its schema");
  if (schema.oneOf && schema.oneOf.filter(matches).length !== 1) fail("does not match exactly one schema");
  if (schema.enum && !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) fail("has an unexpected value");
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (!types.includes(type) && !(type === "number" && Number.isInteger(value) && types.includes("integer"))) fail(`must be ${types.join(" or ")}`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("must be finite");
    if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) fail("is out of range");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) fail("has the wrong number of items");
    if (schema.items) value.forEach((entry, i) => validateOutput(entry, schema.items, `${location}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`is missing ${key}`);
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties?.[key]) validateOutput(entry, schema.properties[key], `${location}.${key}`);
      else if (schema.additionalProperties === false) fail(`has an unexpected field ${key}`);
    }
  } else if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) fail("has the wrong length");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("has an invalid format");
  }
}
