"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadCommands(target, commandDir = __dirname) {
  if (!target || typeof target !== "object") throw new Error("جدول الأوامر النشط غير متاح");
  const files = fs.readdirSync(commandDir)
    .filter(file => file.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const staged = {};
  const canonicalNames = new Set();
  const pendingAliases = [];

  for (const file of files) {
    const commandName = path.basename(file, ".js").trim().toLowerCase();
    if (!commandName) continue;
    if (canonicalNames.has(commandName)) throw new Error(`اسم أمر مكرر: ${commandName}`);
    const resolved = require.resolve(path.join(commandDir, file));
    delete require.cache[resolved];
    const handler = require(resolved);
    if (typeof handler !== "function") throw new Error(`الأمر ${commandName} لا يصدّر دالة`);
    canonicalNames.add(commandName);
    staged[commandName] = handler;
    for (const alias of Array.isArray(handler.aliases) ? handler.aliases : []) {
      const aliasName = String(alias || "").trim().toLowerCase();
      if (aliasName) pendingAliases.push({ aliasName, handler, commandName });
    }
  }

  const aliasOwners = new Map();
  for (const { aliasName, handler, commandName } of pendingAliases) {
    if (canonicalNames.has(aliasName) && staged[aliasName] !== handler) {
      throw new Error(`الاختصار ${aliasName} يتعارض مع أمر أساسي`);
    }
    if (aliasOwners.has(aliasName) && aliasOwners.get(aliasName) !== handler) {
      throw new Error(`الاختصار ${aliasName} مستخدم لأكثر من أمر`);
    }
    aliasOwners.set(aliasName, handler);
  }

  for (const [aliasName, handler] of aliasOwners) {
    if (!Object.prototype.hasOwnProperty.call(staged, aliasName)) {
      Object.defineProperty(staged, aliasName, {
        value: handler,
        enumerable: false,
        configurable: true,
        writable: true
      });
    }
  }

  // Commit only after every module and alias has passed validation.
  for (const key of Reflect.ownKeys(target)) delete target[key];
  for (const key of Reflect.ownKeys(staged)) {
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(staged, key));
  }

  return {
    commandCount: canonicalNames.size,
    aliasCount: aliasOwners.size,
    files: files.length
  };
}

async function command(api, event, args, _startTime, _loadData, _saveData,
  _timers, _config, _hosting, _sent, _botID, _builtIn = [], _custom = [], liveCommands) {
  if (String(args[1] || "").trim().toLowerCase() !== "load") {
    return api.sendMessage("اختبار وتحميل الأوامر: !command load", event.threadID);
  }
  try {
    const result = loadCommands(liveCommands, __dirname);
    return api.sendMessage(
      `نجح فحص وإعادة تحميل الأوامر: ${result.commandCount} أمر أساسي و${result.aliasCount} اختصار. لم يتم تنفيذ الأوامر أثناء الاختبار.`,
      event.threadID
    );
  } catch (error) {
    return api.sendMessage(
      `فشل تحميل الأوامر؛ أبقيت جدول الأوامر النشط كما هو.\nالسبب: ${String(error?.message || error).slice(0, 220)}`,
      event.threadID
    );
  }
}

command.aliases = ["cmd"];
module.exports = command;
module.exports.loadCommands = loadCommands;
