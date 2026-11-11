"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "quasar-repeat-locks-"));
process.env.SHADOW_REPEAT_LOCK_DIR = lockDir;

const bis = require("../../commands/بيس");
const engine = require("../../commands/محرك");

function mockApi() {
  const sent = [];
  return {
    sent,
    sendMessage(message, threadID, callback) {
      sent.push({ message, threadID });
      if (typeof callback === "function") {
        queueMicrotask(() => callback(null, { messageID: `m${sent.length}` }));
      }
      return undefined;
    }
  };
}

test("بيس ومحرك متبادلة الحجز ولا يعملان معًا في المجموعة", async t => {
  t.after(() => fs.rmSync(lockDir, { recursive: true, force: true }));

  assert.deepEqual(engine.ENGINE_INTERVALS, { 1: 60000, 2: 90000, 3: 120000 });
  assert.equal(bis.MIN_INTERVAL_SECONDS, 12);

  const api = mockApi();
  const timers = {};
  const loadData = () => ({ prefix: "!" });
  const saveData = () => {};
  const threadID = "group-1";
  const bisKey = bis.stateKey(threadID);
  const engineKey = engine.stateKey(threadID);

  await bis(api, { threadID }, ["بيس", "رسالة بيس", "120"], 0, loadData, saveData, timers);
  assert.ok(timers[bisKey]);
  assert.equal(String(api.sent.at(-1).message), "رسالة بيس");

  await engine(api, { threadID }, ["محرك", "1", "رسالة المحرك"], 0, loadData, saveData, timers);
  assert.equal(timers[engineKey], undefined);
  assert.match(String(api.sent.at(-1).message), /نظام تكرار آخر/);

  bis.clearBis(timers, threadID);
  assert.equal(timers[bisKey], undefined);

  await engine(api, { threadID }, ["محرك", "1", "رسالة المحرك"], 0, loadData, saveData, timers);
  assert.ok(timers[engineKey]);
  assert.equal(String(api.sent.at(-1).message), "رسالة المحرك");

  await bis(api, { threadID }, ["بيس", "رسالة بيس", "120"], 0, loadData, saveData, timers);
  assert.equal(timers[bisKey], undefined);
  assert.match(String(api.sent.at(-1).message), /نظام تكرار آخر/);

  engine.stopEngines(timers, threadID);
  assert.equal(timers[engineKey], undefined);
});
