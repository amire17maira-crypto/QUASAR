"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../../commands/كنيات");

test("حماية الكنيات الجماعية تستثني كل المطورين والبوت", () => {
  const skipped = command.getSkipped({ DEV_ID: "111111", DEV_IDS: ["111111", "222222"] }, "999999");
  assert.equal(skipped.has("111111"), true);
  assert.equal(skipped.has("222222"), true);
  assert.equal(skipped.has("999999"), true);
  assert.equal(skipped.has("333333"), false);
});
