import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/mcp-cli.js", import.meta.url));
let moduleId = 0;
async function isolated(servers, run, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-mcp-test-")), log = path.join(dir, "commands.jsonl");
  const variables = { PARTNER_RADAR_CODEX_CLI: fixture, PARTNER_RADAR_CLAUDE_CLI: fixture, RADAR_MCP_CAPTURE: log,
    RADAR_MCP_SERVERS: JSON.stringify(servers), RADAR_MCP_LIST_FAILURE: "0", RADAR_MCP_ADD_FAILURE: "0", ...extra };
  const before = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  try {
    const api = await import(`../lib/mcp.js?test=${++moduleId}`);
    await run(api, calls);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("MCP registration", async (t) => {
  for (const provider of ["codex-cli", "claude-cli"]) {
    await t.test(`${provider}: click registers only the documented service and returns the sign-in step`, async () => {
      await isolated([], async (api, calls) => {
        const result = await api.setupMcp(provider, "apollo");
        assert.equal(result.ok, true);
        assert.ok(result.authCommand);
        const commands = calls().filter((call) => call.args[1] === "add");
        assert.equal(commands.length, 1);
        assert.equal(commands[0].provider, provider);
        assert.deepEqual(commands[0].args, provider === "codex-cli" ? ["mcp", "add", "apollo", "--url", "https://mcp.apollo.io/mcp"] : ["mcp", "add", "--scope", "user", "--transport", "http", "apollo", "https://mcp.apollo.io/mcp"]);
        assert.equal(calls().some((call) => call.args[1] === "login"), false, "OAuth sign-in stays under user control");
      });
    });
    await t.test(`${provider}: repeated setup preserves an existing official server`, async () => {
      await isolated([{ name: "hunter", transport: { url: "https://mcp.hunter.io/mcp" }, auth_status: "not_logged_in" }], async (api, calls) => {
        assert.equal((await api.setupMcp(provider, "hunter")).ok, true);
        assert.equal(calls().filter((call) => call.args[1] === "add").length, 0);
      });
    });
    await t.test(`${provider}: same-name custom server cannot be overwritten or misreported as official`, async () => {
      await isolated([{ name: "hunter", transport: { url: "https://custom.example/mcp?api_key=fixture-secret" }, auth_status: "logged_in" }], async (api, calls) => {
        const status = await api.getMcpStatus(true);
        assert.equal(JSON.stringify(status).includes("fixture-secret"), false);
        const own = status.providers.find((item) => item.id === provider);
        assert.ok(own.servers.some((item) => item.name === "hunter" && item.conflict));
        await assert.rejects(api.setupMcp(provider, "hunter"), /different|exists|conflict|review/i);
        assert.equal(calls().filter((call) => call.args[1] === "add").length, 0);
      });
    });
    await t.test(`${provider}: existing stdio server with the same name is a conflict`, async () => {
      await isolated([{ name: "apollo", transport: { type: "stdio", command: "custom-command", args: ["private-key"] } }], async (api, calls) => {
        await assert.rejects(api.setupMcp(provider, "apollo"), /different|exists|conflict|review/i);
        assert.equal(calls().filter((call) => call.args[1] === "add").length, 0);
      });
    });
    await t.test(`${provider}: failed status check prevents registration`, async () => {
      await isolated([], async (api, calls) => {
        await assert.rejects(api.setupMcp(provider, "hunter"));
        assert.equal(calls().filter((call) => call.args[1] === "add").length, 0);
      }, { RADAR_MCP_LIST_FAILURE: "1" });
    });
    await t.test(`${provider}: CLI registration failure is returned to the user`, async () => {
      await isolated([], async (api) => {
        await assert.rejects(api.setupMcp(provider, "hunter"), /register|setup/i);
      }, { RADAR_MCP_ADD_FAILURE: "1" });
    });
  }
  await t.test("status filters unrelated connections and does not return their secrets", async () => {
    await isolated([{ name: "private-database", transport: { url: "https://private.example/mcp?token=private-secret" }, auth_status: "logged_in" },
      { name: "apollo", transport: { url: "https://mcp.apollo.io/mcp" }, auth_status: "logged_in" }], async (api) => {
      const status = await api.getMcpStatus(true);
      assert.equal(JSON.stringify(status).includes("private-secret"), false);
      for (const provider of status.providers) assert.deepEqual(provider.servers.map((server) => server.name), ["apollo"]);
      assert.ok(status.message.includes("API"));
    });
  });
  await t.test("unsupported provider or service cannot trigger a command", async () => {
    await isolated([], async (api, calls) => {
      await assert.rejects(api.setupMcp("arbitrary-command", "hunter"), /supported|Choose/);
      await assert.rejects(api.setupMcp("codex-cli", "custom-service"), /supported|Choose/);
      assert.equal(calls().length, 0);
    });
  });
});
