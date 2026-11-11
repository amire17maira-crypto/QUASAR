"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const bis = require("../../commands/بيس");

function mockApi() {
  const sent = [];
  return {
    sent,
    sendMessage(message, threadID, callback) {
      sent.push({ message, threadID });
      if (typeof callback === "function") {
        queueMicrotask(() => callback(null, { messageID: `m${sent.length}` }));
      }
    }
  };
}

test("بيس يرسل النص فقط ويحافظ على الأسطر ويضبط الفاصل", async () => {
  const api = mockApi();
  const timers = {};
  const args = ["بيس", "صباح", "الخير", "120"];
  args.rawText = "صباح\nالخير 120";

  try {
    await bis(api, { threadID: "bis-test-1" }, args, 0, () => ({ prefix: "!" }), () => {}, timers);
    const state = timers[bis.stateKey("bis-test-1")];
    assert.ok(state);
    assert.equal(state.text, "صباح\nالخير");
    assert.equal(state.intervalMs, 120000);
    assert.equal(api.sent.length, 1);
    assert.equal(api.sent[0].message, "صباح\nالخير");
  } finally {
    bis.clearBis(timers, "bis-test-1");
  }
});

test("بيس يرفض الفاصل الأقل من 12 ثانية", async () => {
  const api = mockApi();
  const timers = {};
  const args = ["بيس", "رسالة", "11"];
  args.rawText = "رسالة 11";

  try {
    await bis(api, { threadID: "bis-test-2" }, args, 0, () => ({ prefix: "!" }), () => {}, timers);
    assert.equal(timers[bis.stateKey("bis-test-2")], undefined);
    assert.match(String(api.sent[0].message), /أقل فاصل 12 ثانية/);
  } finally {
    bis.clearBis(timers, "bis-test-2");
  }
});

test("إيقاف بيس يزيل مؤقته في المجموعة الحالية", async () => {
  const api = mockApi();
  const timers = {};
  const args = ["بيس", "رسالة", "60"];
  args.rawText = "رسالة 60";

  try {
    await bis(api, { threadID: "bis-test-3" }, args, 0, () => ({ prefix: "!" }), () => {}, timers);
    await bis(api, { threadID: "bis-test-3" }, ["بيس", "إيقاف"], 0, () => ({ prefix: "!" }), () => {}, timers);
    assert.equal(timers[bis.stateKey("bis-test-3")], undefined);
    assert.match(String(api.sent.at(-1).message), /تم إيقاف بيس/);
  } finally {
    bis.clearBis(timers, "bis-test-3");
  }
});
