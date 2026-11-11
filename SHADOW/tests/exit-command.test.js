"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const exitCommand = require("../../commands/خروج");

test("خروج يوقف مؤقتات المجموعة ثم يزيل حساب البوت منها", async () => {
  const stopped = [];
  const removed = [];
  const nickTimer = setInterval(() => {}, 100000);
  const timers = {
    "__shadow_atomic__:group-1": {
      threadID: "group-1",
      stop() { stopped.push("atomic"); }
    },
    "nik_group-1": nickTimer,
    "__shadow_bis_repeat__:group-2": {
      threadID: "group-2",
      stop() { stopped.push("other-group"); }
    }
  };
  const api = {
    sendMessage: async () => {},
    getCurrentUserID: () => "bot-123",
    removeUserFromGroup: async (userID, threadID) => removed.push({ userID, threadID })
  };

  try {
    await exitCommand(api, { threadID: "group-1" }, [], 0, () => ({}), () => {}, timers, {}, {}, {}, "bot-123");
    assert.deepEqual(stopped, ["atomic"]);
    assert.equal(timers["__shadow_atomic__:group-1"], undefined);
    assert.equal(timers["nik_group-1"], undefined);
    assert.ok(timers["__shadow_bis_repeat__:group-2"]);
    assert.deepEqual(removed, [{ userID: "bot-123", threadID: "group-1" }]);
  } finally {
    clearInterval(nickTimer);
  }
});
