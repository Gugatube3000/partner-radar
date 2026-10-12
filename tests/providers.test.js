import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ask, getEngineStatuses, resolveCliCommand } from "../lib/llm.js";

const fixture = fileURLToPath(new URL("./fixtures/provider-cli.js", import.meta.url));
const schema = { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string" } } };
const options = { prompt: "Find public leadership sources.", system: "Return factual public data.", schema, name: "people", web: 2 };

async function withFixture(behavior, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-provider-test-"));
  const log = path.join(dir, "calls.jsonl");
  const variables = { PARTNER_RADAR_CODEX_CLI: fixture, PARTNER_RADAR_CLAUDE_CLI: fixture,
    RADAR_FIXTURE_CAPTURE: log, RADAR_FIXTURE_BEHAVIOR: behavior, RADAR_FIXTURE_AUTH: "subscription",
    OPENAI_API_KEY: "fixture-secret", CODEX_API_KEY: "fixture-secret", ANTHROPIC_API_KEY: "fixture-secret", ANTHROPIC_AUTH_TOKEN: "fixture-secret" };
  const before = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  try {
    await getEngineStatuses({ refresh: true });
    await run(calls);
    for (const call of calls()) assert.equal(fs.existsSync(call.cwd), false, "research temp directory must be removed");
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("subscription adapters", async (t) => {
  await t.test("CLI readiness uses auth method and does not expose account identity", async () => {
    await withFixture("success", async () => {
      const status = await getEngineStatuses({ refresh: true });
      assert.equal(status["codex-cli"].ready, true);
      assert.equal(status["claude-cli"].ready, true);
      assert.equal(JSON.stringify(status).includes("private@example.org"), false);
      assert.equal(resolveCliCommand("codex-cli").cmd, process.execPath);
      process.env.RADAR_FIXTURE_AUTH = "api";
      const api = await getEngineStatuses({ refresh: true });
      assert.equal(api["codex-cli"].authStatus, "wrong-auth");
      assert.equal(api["claude-cli"].authStatus, "wrong-auth");
      assert.equal(api["codex-cli"].ok, false);
      await assert.rejects(ask("codex-cli", options), /API or enterprise/);
    });
  });
  for (const engine of ["codex-cli", "claude-cli"]) {
    await t.test(`${engine}: streams progress, parses final unterminated JSON and strips API credentials`, async () => {
      await withFixture("success", async (calls) => {
        const activity = [];
        const answer = await ask(engine, { ...options, onActivity: (line) => activity.push(line) });
        assert.deepEqual(answer.data, { name: "Ada" });
        assert.equal(answer.cost, 0);
        assert.equal(answer.searches, 1);
        assert.equal(answer.tokens, 18);
        assert.deepEqual(answer.sources, ["https://example.org/team"]);
        assert.ok(activity.some((line) => line.startsWith("search ·")));
        assert.deepEqual(calls()[0].credentialsPresent, []);
        assert.ok(calls()[0].input.includes(options.prompt));
        const args = calls()[0].args;
        assert.equal(args.includes("--dangerously-skip-permissions"), false);
        assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
        if (engine === "codex-cli") {
          assert.ok(args.includes("--ignore-user-config"));
          assert.ok(args.includes("features.shell_tool=false"));
          if (!process.env.CODEX_MODEL) assert.equal(args.includes("--model"), false);
        } else assert.ok(args.includes("WebSearch,WebFetch"));
      });
    });
    await t.test(`${engine}: nonzero exit cannot pass as a successful JSON result`, async () => {
      await withFixture("nonzero-output", async (calls) => {
        await assert.rejects(ask(engine, options));
        assert.equal(calls().length, 1);
      });
    });
    await t.test(`${engine}: malformed schema output is rejected without retries`, async () => {
      await withFixture("invalid-schema", async (calls) => {
        await assert.rejects(ask(engine, options), /Invalid structured output/);
        assert.equal(calls().length, 1);
      });
    });
    await t.test(`${engine}: subscription limits are not retried`, async () => {
      await withFixture("plan-limit", async (calls) => {
        await assert.rejects(ask(engine, options), /Usage limit reached/);
        assert.equal(calls().length, 1);
      });
    });
    await t.test(`${engine}: transient service failure retries once`, async () => {
      await withFixture("transient-once", async (calls) => {
        assert.deepEqual((await ask(engine, options)).data, { name: "Ada" });
        assert.equal(calls().length, 2);
      });
    });
    await t.test(`${engine}: cancellation terminates the process and cleans temporary files`, async () => {
      await withFixture("slow", async (calls) => {
        const controller = new AbortController();
        const pending = ask(engine, { ...options, signal: controller.signal });
        const deadline = Date.now() + 2000;
        while (!calls().length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(calls().length, "fixture must have started before cancellation");
        controller.abort();
        await assert.rejects(pending, /Stopped/);
        assert.throws(() => process.kill(calls()[0].pid, 0));
      });
    });
    await t.test(`${engine}: timeout terminates the process and does not retry`, async () => {
      await withFixture("slow", async (calls) => {
        await assert.rejects(ask(engine, { ...options, timeoutMs: 250 }), /timed out/);
        assert.equal(calls().length, 1);
        assert.throws(() => process.kill(calls()[0].pid, 0));
      });
    });
  }
  await t.test("Codex can recover the final structured message if its output file is missing", async () => {
    await withFixture("stream-fallback", async () => {
      assert.deepEqual((await ask("codex-cli", options)).data, { name: "Ada" });
    });
  });
  await t.test("pre-cancelled calls cannot start a process", async () => {
    await withFixture("success", async (calls) => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(ask("claude-cli", { ...options, signal: controller.signal }), /Stopped/);
      assert.equal(calls().length, 0);
    });
  });
});
