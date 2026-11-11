"use strict";

const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 1;

function deriveKey(password, salt) {
  if (typeof password !== "string" || password.length < 12) {
    throw new TypeError("Password must contain at least 12 characters");
  }

  return crypto.scryptSync(password, salt, KEY_LENGTH);
}

function encryptData(data, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    version: VERSION,
    algorithm: ALGORITHM,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64")
  };
}

function decryptData(envelope, password) {
  if (
    !envelope ||
    envelope.version !== VERSION ||
    envelope.algorithm !== ALGORITHM
  ) {
    throw new Error("Unsupported encrypted data format");
  }

  try {
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const ciphertext = Buffer.from(envelope.data, "base64");

    if (
      salt.length !== SALT_LENGTH ||
      iv.length !== IV_LENGTH ||
      tag.length !== TAG_LENGTH ||
      ciphertext.length === 0
    ) {
      throw new Error("Invalid encrypted data");
    }

    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Decryption failed: invalid password or corrupted data");
  }
}

module.exports = {
  encryptData,
  decryptData
};
