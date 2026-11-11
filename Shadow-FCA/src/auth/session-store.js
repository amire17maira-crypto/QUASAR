"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CookieJar } = require("tough-cookie");
const { createSession, assertSession } = require("../core/session");
const { encryptData, decryptData } = require("./secure-store");

const FORMAT_VERSION = 1;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function saveEncryptedSession(session, filePath, password) {
  assertSession(session);

  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("Invalid filePath");
  }

  const payload = {
    formatVersion: FORMAT_VERSION,
    id: session.id,
    createdAt: session.createdAt,
    options: JSON.parse(JSON.stringify(session.options)),
    jar: session.jar.serializeSync()
  };

  const encrypted = encryptData(payload, password);
  const destination = path.resolve(filePath);
  fs.mkdirSync(path.dirname(destination), {
    recursive: true,
    mode: 0o700
  });

  const temporary =
    `${destination}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;

  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(encrypted), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }

  return destination;
}

function loadEncryptedSession(filePath, password) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("Invalid filePath");
  }

  const source = path.resolve(filePath);
  const stat = fs.statSync(source);

  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_SIZE) {
    throw new Error("Invalid encrypted session file");
  }

  const encrypted = JSON.parse(fs.readFileSync(source, "utf8"));
  const payload = decryptData(encrypted, password);

  if (
    !payload ||
    payload.formatVersion !== FORMAT_VERSION ||
    typeof payload.id !== "string" ||
    !payload.jar ||
    typeof payload.jar !== "object" ||
    !payload.options ||
    typeof payload.options !== "object" ||
    Array.isArray(payload.options)
  ) {
    throw new Error("Invalid session payload");
  }

  const session = createSession(payload.options);

  try {
    session.jar = CookieJar.deserializeSync(payload.jar);
    session.id = payload.id;
    session.createdAt = Number.isFinite(payload.createdAt)
      ? payload.createdAt
      : Date.now();

    return session;
  } catch (error) {
    session.requestScheduler.close();
    throw new Error("Could not restore session cookie jar", {
      cause: error
    });
  }
}

module.exports = {
  saveEncryptedSession,
  loadEncryptedSession
};
