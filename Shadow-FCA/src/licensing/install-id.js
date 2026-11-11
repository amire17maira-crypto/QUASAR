"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

function getInstallId(options = {}) {
  const dataDir = path.resolve(
    options.dataDir || process.env.SHADOW_FCA_DATA_DIR ||
    path.join(process.cwd(), ".shadow-fca")
  );

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const filePath = path.join(dataDir, "install-id");

  try {
    const existing = fs.readFileSync(filePath, "utf8").trim();

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      throw new Error("Stored installation ID is invalid");
    }

    return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const id = crypto.randomUUID();

  try {
    fs.writeFileSync(filePath, id + os.EOL, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return getInstallId(options);
  }

  return id;
}

module.exports = { getInstallId };
