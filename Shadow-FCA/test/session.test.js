"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSession,
  importAppState,
  getAppState,
  destroySession,
  assertSession
} = require("../src/core/session");

test("each session owns an independent cookie jar", () => {
  const first = createSession();
  const second = createSession();

  importAppState(first, [
    { key: "session_test", value: "first_value" }
  ]);

  assert.equal(getAppState(first).length, 1);
  assert.equal(getAppState(second).length, 0);
  assert.notEqual(first.jar, second.jar);

  destroySession(first);
  destroySession(second);
});

test("destroyed sessions reject further access", () => {
  const session = createSession();
  destroySession(session);

  assert.equal(session.state, "closed");
  assert.throws(() => assertSession(session), /closed/);
  assert.deepEqual(session.timers.size, 0);
});

test("invalid cookie domains are rejected", () => {
  const session = createSession();

  assert.throws(() => {
    importAppState(session, [
      { key: "test", value: "value", domain: "example.com" }
    ]);
  }, /not allowed/);

  destroySession(session);
});
