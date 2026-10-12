import fs from "node:fs";
const allArgs = process.argv.slice(2), args = allArgs.slice(allArgs.indexOf("mcp"));
const codex = allArgs.includes("-c");
const log = process.env.RADAR_MCP_CAPTURE;
if (log) fs.appendFileSync(log, JSON.stringify({ provider: codex ? "codex-cli" : "claude-cli", args }) + "\n");
const servers = JSON.parse(process.env.RADAR_MCP_SERVERS || "[]");
if (args[1] === "list") {
  if (process.env.RADAR_MCP_LIST_FAILURE === "1") { process.stderr.write("Status unavailable"); process.exitCode = 1; }
  else if (codex) process.stdout.write(JSON.stringify(servers));
  else process.stdout.write(servers.map((server) => `${server.name}: ${server.transport?.url || "stdio custom-command"} - ${server.auth_status === "logged_in" ? "✓ Connected" : "✗ Needs authentication"}`).join("\n"));
} else if (args[1] === "get") {
  const name = args[2], server = servers.find((item) => item.name === name);
  if (!server) process.exitCode = 1;
  else if (codex) process.stdout.write(JSON.stringify(server));
  else process.stdout.write(`${name}\nType: ${server.transport?.url ? "http" : "stdio"}\nURL: ${server.transport?.url || ""}\nStatus: Needs authentication\n`);
} else if (args[1] === "add") {
  if (process.env.RADAR_MCP_ADD_FAILURE === "1") { process.stderr.write("Registration failed"); process.exitCode = 1; }
  else process.stdout.write("Server registered");
} else {
  process.stderr.write("Unexpected fixture command"); process.exitCode = 1;
}
