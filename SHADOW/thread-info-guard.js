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
    console.log(
      "[THREAD INFO GUARD] Request paused for",
      Math.round(cooldown / 1000),
      "seconds."
    );
    lastNotice = Date.now();
  }
}

function enqueueRequest(operation, validate) {
  const task = queue.then(async () => {
    if (Date.now() < blockedUntil) {
      throw new Error("Facebook thread-info cooldown active; request skipped.");
    }

    try {
      const result = await operation();
      validate(result);

      failures = 0;
      blockedUntil = 0;
      return result;
    } catch (error) {
      activateCooldown(error);
      throw error;
    }
  });

  // Keep the queue usable after a failed request.
  queue = task.catch(() => {});
  return task;
}

function getThreadInfoSafe(api, ids) {
  return enqueueRequest(
    async () => {
      if (!api || typeof api.getThreadInfo !== "function") {
        throw new Error("Facebook getThreadInfo method is unavailable.");
      }
      return await api.getThreadInfo(ids);
    },
    result => {
      if (
        result == null ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        Object.keys(result).length === 0
      ) {
        throw new Error("Unexpected thread response: thread info must be a non-empty object.");
      }
    }
  );
}

function getThreadListSafe(api, ...args) {
  return enqueueRequest(
    async () => {
      if (!api || typeof api.getThreadList !== "function") {
        throw new Error("Facebook getThreadList method is unavailable.");
      }
      return await api.getThreadList(...args);
    },
    result => {
      // An empty array is a valid end-of-list response.
      if (!Array.isArray(result)) {
        throw new Error("Unexpected thread response: thread list must be an array.");
      }
    }
  );
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
