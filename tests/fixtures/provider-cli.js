import fs from "node:fs";
const args = process.argv.slice(2);
const engine = args.includes("exec") || args.includes("login") ? "codex" : "claude";
const auth = args.includes("status");
if (auth) {
  const api = process.env.RADAR_FIXTURE_AUTH === "api";
  if (engine === "codex") process.stdout.write(api ? "Logged in using an API key" : "Logged in using ChatGPT");
  else process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: api ? "api_key" : "claude.ai", apiProvider: "firstParty", email: "private@example.org" }));
  process.exit(0);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const log = process.env.RADAR_FIXTURE_CAPTURE;
const count = log && fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").length : 0;
if (log) fs.appendFileSync(log, JSON.stringify({ engine, args, input, cwd: process.cwd(), pid: process.pid,
  credentialsPresent: ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].filter((key) => process.env[key]) }) + "\n");
const behavior = process.env.RADAR_FIXTURE_BEHAVIOR || "success";
if (behavior === "slow") {
  setInterval(() => {}, 1000);
} else if (behavior === "nonzero-output") {
  process.stdout.write(JSON.stringify({ type: "result", structured_output: { name: "Ada" } }));
  process.stderr.write("invalid model configured");
  process.exitCode = 1;
} else if (behavior === "plan-limit" || behavior === "transient-once" && count === 0) {
  const message = behavior === "plan-limit" ? "Usage limit reached; try again after your plan resets" : "HTTP 503 service unavailable";
  process.stdout.write(JSON.stringify(engine === "codex" ? { type: "turn.failed", error: { message } } : { type: "result", is_error: true, result: message }));
  process.exitCode = 1;
} else {
  const data = behavior === "invalid-schema" ? { name: 7 } : { name: "Ada" };
  if (engine === "codex") {
    if (behavior !== "stream-fallback") fs.writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify(data));
    const events = [
      { type: "item.started", item: { id: "search-1", type: "web_search", query: "asset manager" } },
      { type: "item.completed", item: { id: "search-1", type: "web_search", sources: [{ url: "https://example.org/team" }] } },
      { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(data) } },
      { type: "turn.completed", usage: { input_tokens: 11, output_tokens: 7 } },
    ];
    process.stdout.write(events.map((event) => JSON.stringify(event)).join("\n"));
  } else {
    const events = [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "asset manager" } }, { type: "tool_use", name: "WebFetch", input: { url: "https://example.org/team" } }] } },
      { type: "result", structured_output: data, usage: { input_tokens: 11, output_tokens: 7 } },
    ];
    // Split a JSON event between chunks and leave the final line unterminated.
    const text = events.map((event) => JSON.stringify(event)).join("\n");
    process.stdout.write(text.slice(0, 37));
    setTimeout(() => process.stdout.write(text.slice(37)), 20);
  }
}
