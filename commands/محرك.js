"use strict";

// One engine may run per group. Its reservation is shared with بيس.
const ENGINE_INTERVALS = Object.freeze({
  1: 60_000,
  2: 90_000,
  3: 120_000
});
const STATE_PREFIX = "__shadow_engines__:";
const { acquireRepeatLock, releaseRepeatLock } = require("../SHADOW/repeat-coordinator");

function stateKey(threadID) {
  return STATE_PREFIX + String(threadID);
}

function sendOnce(api, message, threadID) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = null;
    const finish = (error, info) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(info);
    };
    timeout = setTimeout(() => finish(new Error("انتهت مهلة الإرسال بعد 30 ثانية")), 30000);
    try {
      const result = api.sendMessage(message, threadID, finish);
      if (result && typeof result.then === "function") result.then(info => finish(null, info), finish);
      else if (api.sendMessage.length < 3) finish(null, result);
    } catch (error) {
      finish(error);
    }
  });
}

function clearEngineTimer(engine) {
  if (engine?.timer) clearTimeout(engine.timer);
  if (engine) engine.timer = null;
}

function stopEngines(automicTimers, threadID, engineID = null) {
  const key = stateKey(threadID);
  const state = automicTimers[key];
  if (!state) return 0;

  if (engineID !== null) {
    const id = String(engineID);
    const engine = state.engines[id];
    if (!engine) return 0;
    engine.stopped = true;
    clearEngineTimer(engine);
    delete state.engines[id];
  } else {
    for (const engine of Object.values(state.engines || {})) {
      engine.stopped = true;
      clearEngineTimer(engine);
    }
    state.engines = {};
  }

  if (!Object.keys(state.engines || {}).length) {
    state.stopped = true;
    releaseRepeatLock(state.threadID, state.lock);
    delete automicTimers[key];
  }
  return 1;
}

function scheduleEngine(state, engine) {
  if (state.stopped || engine.stopped || state.engines[engine.id] !== engine || engine.sending) return;
  clearEngineTimer(engine);
  engine.timer = setTimeout(async () => {
    engine.timer = null;
    if (state.stopped || engine.stopped || state.engines[engine.id] !== engine) return;
    engine.sending = true;
    try {
      await sendOnce(state.api, engine.text, state.threadID);
      engine.lastSentAt = Date.now();
      console.log(`SHADOW ENGINE ${engine.id} SENT:`, state.threadID);
    } catch (error) {
      console.error(`SHADOW ENGINE ${engine.id} SEND ERROR:`, error?.message || error);
    } finally {
      engine.sending = false;
      scheduleEngine(state, engine);
    }
  }, engine.intervalMs);
  if (typeof engine.timer.unref === "function") engine.timer.unref();
}

async function startEngine(api, threadID, automicTimers, engineID, text) {
  const id = String(engineID);
  const intervalMs = ENGINE_INTERVALS[id];
  const cleanText = String(text ?? "");
  if (!intervalMs) throw new Error("رقم المحرك غير صحيح");
  if (!cleanText.trim()) throw new Error("أرسل نص الرسالة");

  const key = stateKey(threadID);
  if (automicTimers[key]) stopEngines(automicTimers, threadID);

  const reservation = acquireRepeatLock(threadID, "محرك " + id);
  if (!reservation.acquired) {
    const error = new Error("يوجد نظام تكرار آخر يعمل في هذه المجموعة. أوقفه أولاً قبل تشغيل محرك.");
    error.code = "REPEAT_BUSY";
    throw error;
  }

  const state = {
    kind: "shadow-engines",
    key,
    threadID: String(threadID),
    api,
    lock: reservation.lock,
    engines: {},
    stopped: false
  };
  automicTimers[key] = state;

  const engine = {
    id,
    text: cleanText,
    intervalMs,
    timer: null,
    sending: true,
    stopped: false,
    lastSentAt: 0
  };
  state.engines[id] = engine;

  try {
    // أرسل النص الأصلي فقط دون معلومات تفعيل إضافية.
    await sendOnce(api, cleanText, String(threadID));
    engine.lastSentAt = Date.now();
    console.log(`SHADOW ENGINE ${id} FIRST SEND:`, threadID);
  } catch (error) {
    engine.stopped = true;
    clearEngineTimer(engine);
    state.stopped = true;
    releaseRepeatLock(state.threadID, state.lock);
    if (automicTimers[key] === state) delete automicTimers[key];
    throw error;
  } finally {
    engine.sending = false;
  }

  scheduleEngine(state, engine);
  return { engineID: id, intervalMs };
}

module.exports = async (api, event, args, startTime, loadData, saveData, automicTimers) => {
  const threadID = String(event.threadID || "");
  if (!threadID) return;

  const selector = String(args[1] || "").trim().toLowerCase();
  if (["ايقاف", "إيقاف", "off", "stop", "وقف"].includes(selector)) {
    const stopped = stopEngines(automicTimers, threadID);
    return api.sendMessage(
      stopped ? "🛑 تم إيقاف محرك هذه المجموعة." : "ℹ️ محرك غير نشط في هذه المجموعة.",
      threadID
    );
  }

  const engineID = Number(selector);
  if (![1, 2, 3].includes(engineID)) {
    return api.sendMessage(
      "⚙️ طريقة الاستخدام:\n" +
      "محرك 1 [النص] — كل 60 ثانية.\n" +
      "محرك 2 [النص] — كل 90 ثانية.\n" +
      "محرك 3 [النص] — كل 120 ثانية.\n" +
      "محرك إيقاف — إيقاف المحرك في هذه المجموعة.",
      threadID
    );
  }

  const rawText = typeof args.rawText === "string" ? args.rawText : args.slice(1).join(" ");
  const parsed = rawText.match(/^\s*([123])(?:[ \t\r\n]+([\s\S]*))?$/);
  const text = parsed && Number(parsed[1]) === engineID ? (parsed[2] || "") : "";
  if (!text.trim()) {
    return api.sendMessage("⚠️ أرسل نص الرسالة بعد رقم المحرك.", threadID);
  }

  try {
    await startEngine(api, threadID, automicTimers, engineID, text);
  } catch (error) {
    console.error("SHADOW ENGINE START ERROR:", error?.message || error);
    return api.sendMessage(
      `❌ ${String(error?.message || error).slice(0, 300)}`,
      threadID
    );
  }
};

module.exports.startEngine = startEngine;
module.exports.stopEngines = stopEngines;
module.exports.ENGINE_INTERVALS = ENGINE_INTERVALS;
module.exports.stateKey = stateKey;
