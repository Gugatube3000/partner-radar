// @ts-check
import { resolveCliCommand, runProviderCommand } from "./llm.js";

export const MCP_SERVICES = {
  hunter: { label: "Hunter", url: "https://mcp.hunter.io/mcp", docsUrl: "https://hunter.io/mcp" },
  apollo: { label: "Apollo", url: "https://mcp.apollo.io/mcp", docsUrl: "https://docs.apollo.io/docs/apollo-mcp" },
};
let cached = null;
async function providerStatus(id) {
  const label = id === "codex-cli" ? "Codex" : "Claude Code";
  if (!resolveCliCommand(id)) return { id, label, installed: false, servers: [], message: "Install this CLI to add MCP connections" };
  try {
    const result = await runProviderCommand(id, ["mcp", "list", ...(id === "codex-cli" ? ["--json"] : [])], { timeoutMs: 12000 });
    if (result.code !== 0) return { id, label, installed: true, error: true, servers: [], message: "MCP status could not be checked. Use your CLI to inspect connections." };
    if (id === "codex-cli") {
      const data = JSON.parse(result.out);
      return { id, label, installed: true, servers: data.filter((server) => Object.entries(MCP_SERVICES).some(([name, service]) => server.name === name || server.transport?.url === service.url)).map((server) => { const expected = MCP_SERVICES[server.name]?.url; const conflict = !!expected && server.transport?.url !== expected; return { name: server.name, url: conflict ? "" : server.transport?.url || "", conflict, status: conflict ? "name already used by a different server" : server.auth_status === "logged_in" ? "authenticated" : server.auth_status === "not_logged_in" ? "needs sign-in" : "registered; check sign-in in CLI" }; }) };
    }
    const text = result.out + result.err;
    return { id, label, installed: true, servers: Object.entries(MCP_SERVICES).flatMap(([name, service]) => { const line = text.split("\n").find((line) => new RegExp(`^\\s*${name}:`).test(line)); if (!line) return []; const actual = line.match(/https?:\/\/[^\s]+/)?.[0] || ""; const conflict = actual !== service.url; return [{ name, url: conflict ? "" : service.url, conflict, status: conflict ? "name already used by a different server" : /(?:^|\s)Connected(?:\s|$)/.test(line) ? "connected" : "registered; check sign-in in CLI" }]; }) };
  } catch { return { id, label, installed: true, error: true, servers: [], message: "MCP status check timed out. Inspect connections in your CLI." }; }
}
export async function getMcpStatus(refresh = false) {
  if (!refresh && cached?.until > Date.now()) return cached.data;
  const data = {
    providers: await Promise.all([providerStatus("codex-cli"), providerStatus("claude-cli")]),
    setup: Object.entries(MCP_SERVICES).map(([id, service]) => ({ id, label: service.label, url: service.url, docsUrl: service.docsUrl, command: `codex mcp add ${id} --url ${service.url}`, claudeCommand: `claude mcp add --scope user --transport http ${id} ${service.url}` })),
    message: "MCP connections belong to your CLI. The dashboard uses API keys for its automatic enrichment; adding an MCP server does not connect the API key.",
  };
  cached = { until: Date.now() + 30000, data }; return data;
}
/** Register only documented remote services with fixed commands; OAuth stays in the user's CLI. */
export async function setupMcp(provider, id) {
  if (!["codex-cli", "claude-cli"].includes(provider) || !Object.hasOwn(MCP_SERVICES, id)) throw new Error("Choose Codex or Claude and a supported MCP service");
  if (!resolveCliCommand(provider)) throw new Error("Install the selected CLI first");
  const service = MCP_SERVICES[id];
  const status = await providerStatus(provider);
  if (status.error) throw new Error("Check MCP settings in your CLI first; the current configuration could not be read safely.");
  const existing = status.servers.find((server) => server.name === id);
  if (existing?.conflict) throw new Error(`A different ${id} server already exists. Review its settings in your CLI first.`);
  if (!existing) {
    const args = provider === "codex-cli" ? ["mcp", "add", id, "--url", service.url] : ["mcp", "add", "--scope", "user", "--transport", "http", id, service.url];
    const result = await runProviderCommand(provider, args, { timeoutMs: 15000 });
    if (result.code !== 0) throw new Error("The CLI could not register this server. Use the setup command in its terminal.");
  }
  cached = null;
  const authCommand = provider === "codex-cli" ? `codex mcp login ${id}` : "claude → /mcp → select the server → Authenticate";
  return { ok: true, message: `${service.label} MCP registered. Complete sign-in in ${provider === "codex-cli" ? "Codex" : "Claude Code"}.`, authCommand, docsUrl: service.docsUrl };
}
