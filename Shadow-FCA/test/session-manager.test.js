"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const SessionManager = require("../src/core/session-manager");

test("manager creates and retrieves independent sessions", () => {
  const manager = new SessionManager();
  const first = manager.create();
  const second = manager.create();

  assert.equal(manager.size, 2);
  assert.equal(manager.get(first.id), first);
  assert.equal(manager.get(second.id), second);
  assert.notEqual(first.jar, second.jar);

  manager.closeAll();
});

test("closing a session removes it from the manager", () => {
  const manager = new SessionManager();
  const session = manager.create();

  assert.equal(manager.close(session.id), true);
  assert.equal(manager.get(session.id), null);
  assert.equal(session.state, "closed");
  assert.equal(manager.size, 0);
  assert.equal(manager.close(session.id), false);
});

test("closeAll closes every managed session", () => {
  const manager = new SessionManager();
  const first = manager.create();
  const second = manager.create();

  manager.closeAll();

  assert.equal(first.state, "closed");
  assert.equal(second.state, "closed");
  assert.equal(manager.size, 0);
  assert.deepEqual(manager.list(), []);
});
