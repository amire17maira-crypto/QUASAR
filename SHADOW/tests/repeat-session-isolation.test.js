"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "quasar-session-locks-"));
process.env.SHADOW_REPEAT_LOCK_DIR = lockDir;

const coordinator = require("../repeat-coordinator");
const bis = require("../../commands/بيس");
const engine = require("../../commands/محرك");
const aut = require("../../commands/aut");

test("كل جلسة لها حجز مستقل حتى في المجموعة نفسها", t => {
  t.after(() => {
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  const previousSession = process.env.SHADOW_SESSION_ID;

  try {
    process.env.SHADOW_SESSION_ID = "1";
    const first = coordinator.acquireRepeatLock("same-group", "بيس");
    assert.equal(first.acquired, true);

    process.env.SHADOW_SESSION_ID = "2";
    const second = coordinator.acquireRepeatLock("same-group", "محرك");
    assert.equal(second.acquired, true);

    process.env.SHADOW_SESSION_ID = "1";
    const blockedFirst = coordinator.acquireRepeatLock("same-group", "محرك");
    assert.equal(blockedFirst.acquired, false);

    process.env.SHADOW_SESSION_ID = "2";
    const blockedSecond = coordinator.acquireRepeatLock("same-group", "بيس");
    assert.equal(blockedSecond.acquired, false);

    assert.equal(coordinator.releaseRepeatLock("same-group", first.lock), true);
    assert.equal(coordinator.releaseRepeatLock("same-group", second.lock), true);
  } finally {
    if (previousSession === undefined) delete process.env.SHADOW_SESSION_ID;
    else process.env.SHADOW_SESSION_ID = previousSession;
  }
});

test("مفاتيح بيس ومحرك وaut تختلف بين الجلسات", () => {
  assert.notEqual(bis.stateKey("same-group", "1"), bis.stateKey("same-group", "2"));
  assert.notEqual(engine.stateKey("same-group", "1"), engine.stateKey("same-group", "2"));
  assert.notEqual(aut.stateKey("same-group", "1"), aut.stateKey("same-group", "2"));
});

test("aut يفحص كل 80 ثانية", () => {
  assert.equal(aut.POLL_GAP_MS, 80_000);
});
