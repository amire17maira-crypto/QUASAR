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
      if (typeof callback === "function") queueMicrotask(() => callback(null, { messageID: `m${sent.length}` }));
    }
  };
}

test("بيس يرسل النص فوراً ويضبط التكرار بالثواني في المجموعة الحالية", async () => {
  const api = mockApi();
  const timers = {};
  await bis(api, { threadID: "g1" }, ["بيس", "صباح", "الخير", "120"], 0, () => ({ prefix: "!" }), () => {}, timers);
  const state = timers[bis.stateKey("g1")];
  assert.ok(state);
  assert.equal(state.text, "صباح الخير");
  assert.equal(state.intervalMs, 120000);
  assert.equal(api.sent.length, 1, "بدء بيس يجب أن يرسل رسالة واحدة فقط");
  assert.equal(api.sent[0].message, "صباح الخير\n\nبدء بيس رقم الجلسة [1]\nعدد الثواني: 120\nللإيقاف اكتب: بيس إيقاف");
  bis.clearBis(timers, "g1");
});

test("بيس يرفض الفاصل الأقصر من ستين ثانية ولا يبدأ مؤقتاً", async () => {
  const api = mockApi();
  const timers = {};
  await bis(api, { threadID: "g1" }, ["بيس", "رسالة", "30"], 0, () => ({ prefix: "!" }), () => {}, timers);
  assert.equal(timers[bis.stateKey("g1")], undefined);
  assert.match(String(api.sent[0].message), /أقل فاصل 60 ثانية/);
});

test("إيقاف بيس يزيل مؤقته في المجموعة الحالية", async () => {
  const api = mockApi();
  const timers = {};
  await bis(api, { threadID: "g1" }, ["بيس", "رسالة", "60"], 0, () => ({ prefix: "!" }), () => {}, timers);
  await bis(api, { threadID: "g1" }, ["بيس", "إيقاف"], 0, () => ({ prefix: "!" }), () => {}, timers);
  assert.equal(timers[bis.stateKey("g1")], undefined);
  assert.match(String(api.sent.at(-1).message), /تم إيقاف بيس/);
});
