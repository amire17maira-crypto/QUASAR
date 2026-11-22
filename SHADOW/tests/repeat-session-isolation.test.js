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

test("aut يحتفظ بفاصل 80 ثانية كقيمة افتراضية", () => {
  assert.equal(aut.POLL_GAP_MS, 80_000);
  assert.deepEqual(aut.parseAutInput("مرحبا"), {
    text: "مرحبا", intervalMs: 80_000, intervalSeconds: 80, error: null
  });
});

test("aut يقبل فاصل 200s دون تغيير نص الرسالة", () => {
  const result = aut.parseAutInput("مرحبا\nكيف حالك 200s");
  assert.equal(result.text, "مرحبا\nكيف حالك");
  assert.equal(result.intervalMs, 200_000);
  assert.equal(result.intervalSeconds, 200);
  assert.equal(result.error, null);
  assert.equal(aut.parseAutInput("مرحبا 200 s").intervalMs, 200_000);
});

test("aut يرفض الفواصل الأقل من 12 ثانية والأكبر من 24 ساعة", () => {
  assert.ok(aut.parseAutInput("مرحبا 5s").error);
  assert.ok(aut.parseAutInput("مرحبا 90000s").error);
});

test("الحجز القديم لا يُحذف تلقائياً ولا يمكنه حذف حجز جديد", t => {
  const staleDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "quasar-stale-lock-")
  );

  const previousDir = process.env.SHADOW_REPEAT_LOCK_DIR;
  const previousSession = process.env.SHADOW_SESSION_ID;

  try {
    process.env.SHADOW_REPEAT_LOCK_DIR = staleDir;
    process.env.SHADOW_SESSION_ID = "stale-test";

    const file = coordinator.getLockPath(
      "stale-group",
      staleDir,
      "stale-test"
    );

    const staleRecord = {
      token: "old-token",
      pid: -1,
      sessionId: "stale-test",
      kind: "بيس",
      createdAt: new Date().toISOString()
    };

    fs.writeFileSync(file, JSON.stringify(staleRecord));

    const result = coordinator.acquireRepeatLock(
      "stale-group",
      "محرك"
    );

    assert.equal(result.acquired, false);
    assert.equal(result.stale, true);
    assert.equal(fs.existsSync(file), true);

    const stillStored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stillStored.token, "old-token");
  } finally {
    if (previousDir === undefined) {
      delete process.env.SHADOW_REPEAT_LOCK_DIR;
    } else {
      process.env.SHADOW_REPEAT_LOCK_DIR = previousDir;
    }

    if (previousSession === undefined) {
      delete process.env.SHADOW_SESSION_ID;
    } else {
      process.env.SHADOW_SESSION_ID = previousSession;
    }

    fs.rmSync(staleDir, { recursive: true, force: true });
  }
});
