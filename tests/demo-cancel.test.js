import test from "node:test";
import assert from "node:assert/strict";
import { demoAsk } from "../lib/demo.js";
const country = { code: "BR", name: "Brazil", language: "Portuguese", lang: "pt" };
test("a stopped demo search aborts promptly rather than waiting through its animation delay", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const promise = demoAsk("firms", { country, n: 3, cfg: { types: ["Asset managers"] }, speed: 1, signal: controller.signal });
  setTimeout(() => controller.abort(new Error("Stopped by user")), 25);
  await assert.rejects(promise, /Stopped by user/);
  assert.ok(Date.now() - started < 700, "stop should not wait for the 3.8-second scout delay");
});
test("a cancelled demo cannot start another delayed stage", async () => {
  const controller = new AbortController(); controller.abort(new Error("Already stopped"));
  await assert.rejects(demoAsk("profile", { country, speed: 1, signal: controller.signal }), /Already stopped/);
});
