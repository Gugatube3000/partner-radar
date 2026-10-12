import test from "node:test";
import assert from "node:assert/strict";
import { ActivityStore, activityRecord, sourceUrl, taskState } from "../public/activity.js";

test("activity links reject executable schemes and embedded credentials", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "https://key:secret@example.com/", "not a url"]) assert.equal(sourceUrl(url), "");
  assert.equal(sourceUrl("https://example.com/source"), "https://example.com/source");
  assert.equal(activityRecord({ type: "activity", text: "read https://example.com/source" }).kind, "read");
});

test("activity represents stopped and failed outcomes and task transitions", () => {
  assert.equal(activityRecord({ type: "done", summary: { stopped: true } }).status, "stopped");
  assert.equal(activityRecord({ type: "done", summary: { failed: true } }).kind, "issue");
  const start = { type: "task", id: "task-1", state: "running", label: "Read sources" };
  assert.notEqual(activityRecord(start).id, activityRecord({ ...start, state: "done" }).id);
  assert.equal(activityRecord({ type: "task", state: "error", error: "Timed out" }).kind, "issue");
});

test("paused activity keeps collecting, deduplicates and bounds the visible history", () => {
  const store = new ActivityStore(10);
  store.follow = false;
  for (let seq = 1; seq <= 12; seq++) store.add(activityRecord({ type: "activity", seq, agent: "finder", text: `search company ${seq}` }, "Example Firm"));
  assert.equal(store.add(activityRecord({ type: "activity", seq: 12, text: "duplicate" })), false);
  assert.equal(store.total, 12);
  assert.equal(store.records.length, 10);
  assert.equal(store.follow, false);
  assert.equal(store.filtered("search", "COMPANY 12").length, 1);
  assert.equal(store.filtered("read").length, 0);
  store.clear();
  assert.equal(store.total, 0);
  assert.equal(store.follow, true);
});

test("active task counts reflect overlaps, duplicate starts and terminal events", () => {
  let tasks = new Map();
  const first = { id: "one", agent: "analyst", state: "running" };
  tasks = taskState(tasks, first);
  tasks = taskState(tasks, first);
  tasks = taskState(tasks, { id: "two", agent: "analyst", state: "running" });
  assert.equal(tasks.size, 2);
  tasks = taskState(tasks, { ...first, state: "error" });
  assert.equal(tasks.size, 1);
  tasks = taskState(tasks, { id: "two", state: "done" });
  assert.equal(tasks.size, 0);
});
