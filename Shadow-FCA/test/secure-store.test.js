"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  encryptData,
  decryptData
} = require("../src/auth/secure-store");

test("encrypted data can be decrypted with the correct password", () => {
  const original = {
    session: "test-session",
    cookies: [{ key: "test", value: "secret-value" }]
  };

  const encrypted = encryptData(original, "test-password-123");
  const decrypted = decryptData(encrypted, "test-password-123");

  assert.deepEqual(decrypted, original);
  assert.equal(JSON.stringify(encrypted).includes("secret-value"), false);
});

test("wrong password is rejected", () => {
  const encrypted = encryptData(
    { value: "private" },
    "correct-password-123"
  );

  assert.throws(
    () => decryptData(encrypted, "incorrect-password-123"),
    /Decryption failed/
  );
});

test("tampered ciphertext is rejected", () => {
  const encrypted = encryptData(
    { value: "private" },
    "test-password-123"
  );

  encrypted.data = Buffer.from("tampered-data").toString("base64");

  assert.throws(
    () => decryptData(encrypted, "test-password-123"),
    /Decryption failed/
  );
});

test("short passwords are rejected", () => {
  assert.throws(
    () => encryptData({ value: 1 }, "short"),
    /12 characters/
  );
});
