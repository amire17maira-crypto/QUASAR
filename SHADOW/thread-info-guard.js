"use strict";

let queue = Promise.resolve();
let blockedUntil = 0;
let failures = 0;
let lastNotice = 0;

function activateCooldown(error) {
  const message = String(error && (error.message || error));

  if (!/rate.?limit|too many requests|unexpected thread response|reading ['"]errors['"]/i.test(message)) {
    return;
  }

  failures = Math.min(failures + 1, 5);
  const cooldown = Math.min(60000 * (2 ** (failures - 1)), 900000);
  blockedUntil = Date.now() + cooldown;

  if (Date.now() - lastNotice > 10000) {
    console.log("[THREAD INFO GUARD] Request paused for", Math.round(cooldown / 1000), "seconds.");
    lastNotice = Date.now();
  }
}

function getThreadInfoSafe(api, ids) {
  const task = queue.then(async () => {
    if (Date.now() < blockedUntil) {
      throw new Error("Facebook thread-info cooldown active; request skipped.");
    }

    try {
      const result = await api.getThreadInfo(ids);
      const emptyResult = result == null ||
        (Array.isArray(ids) && typeof result === "object" && Object.keys(result).length === 0);

      if (emptyResult) {
        throw new Error("Unexpected thread response: empty result.");
      }

      failures = 0;
      blockedUntil = 0;
      return result;
    } catch (error) {
      activateCooldown(error);
      throw error;
    }
  });

  queue = task.catch(() => {});
  return task;
}

function getThreadListSafe(api, ...args) {
  const task = queue.then(async () => {
    if (Date.now() < blockedUntil) {
      throw new Error("Facebook thread-info cooldown active; request skipped.");
    }

    try {
      if (!api || typeof api.getThreadList !== "function") {
        throw new Error("Facebook getThreadList method is unavailable.");
      }

      return await api.getThreadList(...args);
    } catch (error) {
      activateCooldown(error);
      throw error;
    }
  });

  queue = task.catch(() => {});
  return task;
}

function isCoolingDown() {
  return Date.now() < blockedUntil;
}

function getCooldownRemaining() {
  return Math.max(0, blockedUntil - Date.now());
}

module.exports = {
  getThreadInfoSafe,
  getThreadListSafe,
  isCoolingDown,
  getCooldownRemaining
};
