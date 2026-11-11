"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function getLockDirectory() {
  const root = process.env.SHADOW_REPEAT_LOCK_DIR ||
    path.join(path.resolve(process.env.SHADOW_DATA_DIR || path.resolve(__dirname, "..")), ".repeat-locks");
  return path.resolve(root);
}

function getLockPath(threadID, directory = getLockDirectory()) {
  const id = String(threadID || "").trim();
  if (!id || id.length > 256) throw new Error("معرف المجموعة غير صالح");
  const key = crypto.createHash("sha256").update(id).digest("hex");
  return path.join(directory, `${key}.lock`);
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isSafeInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function readLock(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function acquireRepeatLock(threadID, kind) {
  const directory = getLockDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
  const file = getLockPath(threadID, directory);
  const record = {
    token: crypto.randomBytes(18).toString("hex"),
    pid: process.pid,
    sessionId: String(process.env.SHADOW_SESSION_ID || "1"),
    kind: String(kind || "repeat"),
    createdAt: new Date().toISOString()
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(record));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      return { acquired: true, lock: record, path: file };
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      if (error.code !== "EEXIST") throw error;

      const current = readLock(file);
      if (current && processIsAlive(current.pid)) {
        return { acquired: false, current };
      }
      try { fs.unlinkSync(file); } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") return { acquired: false, current };
      }
    }
  }
  return { acquired: false, current: readLock(file) };
}

function releaseRepeatLock(threadID, lock) {
  if (!lock || !lock.token) return false;
  let file;
  try { file = getLockPath(threadID); } catch { return false; }
  const current = readLock(file);
  if (!current || current.token !== lock.token || Number(current.pid) !== process.pid) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { getLockDirectory, getLockPath, acquireRepeatLock, releaseRepeatLock };
