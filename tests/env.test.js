import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
test("local .env model defaults load before provider modules and external environment wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-env-test-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, 'CODEX_MODEL="fixture-model"\nCLAUDE_CLI_MODEL=opus\n');
  const env = { ...process.env, PARTNER_RADAR_ENV_FILE: file };
  delete env.CODEX_MODEL; delete env.CLAUDE_CLI_MODEL;
  const code = 'await import("./server.js"); const {MODELS}=await import("./lib/llm.js"); process.stdout.write(JSON.stringify(MODELS["codex-cli"]));';
  try {
    const saved = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8" }));
    assert.equal(saved.brain, "fixture-model");
    env.CODEX_MODEL = "external-model";
    const external = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8" }));
    assert.equal(external.brain, "external-model");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
