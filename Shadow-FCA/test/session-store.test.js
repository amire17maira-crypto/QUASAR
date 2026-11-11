"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSession, importAppState, destroySession } =
  require("../src/core/session");

const {
  saveEncryptedSession,
  loadEncryptedSession
} = require("../src/auth/session-store");

test("encrypted session can be saved and restored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-fca-"));
  const file = path.join(dir, "session.enc");
  const password = "test-password-123";
  const original = createSession();

  try {
    importAppState(original, [{
      key: "test_cookie",
      value: "secret_test_value",
      domain: ".facebook.com",
      path: "/"
    }]);

    saveEncryptedSession(original, file, password);

    const raw = fs.readFileSync(file, "utf8");
    assert.equal(raw.includes("secret_test_value"), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    const restored = loadEncryptedSession(file, password);

    assert.equal(restored.id, original.id);
    assert.equal(restored.state, "created");
    assert.equal(
      restored.jar.getCookiesSync("https://www.facebook.com")
        .some(cookie => cookie.value === "secret_test_value"),
      true
    );

    destroySession(restored);
  } finally {
    destroySession(original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("session restoration rejects a wrong password", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-fca-"));
  const file = path.join(dir, "session.enc");
  const session = createSession();

  try {
    saveEncryptedSession(session, file, "correct-password-123");

    assert.throws(
      () => loadEncryptedSession(file, "wrong-password-123"),
      /Decryption failed/
    );
  } finally {
    destroySession(session);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("session restoration rejects corrupted files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-fca-"));
  const file = path.join(dir, "session.enc");
  const session = createSession();

  try {
    saveEncryptedSession(session, file, "test-password-123");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.data = Buffer.from("tampered").toString("base64");
    fs.writeFileSync(file, JSON.stringify(data));

    assert.throws(
      () => loadEncryptedSession(file, "test-password-123"),
      /Decryption failed/
    );
  } finally {
    destroySession(session);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
