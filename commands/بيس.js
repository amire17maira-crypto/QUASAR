"use strict";

const MIN_INTERVAL_SECONDS = 12;
const MAX_INTERVAL_SECONDS = 86400;
const STATE_PREFIX = "__shadow_bis_repeat__:";
const { acquireRepeatLock, releaseRepeatLock } = require("../SHADOW/repeat-coordinator");

function stateKey(threadID) {
  return STATE_PREFIX + String(threadID);
}

function sendOnce(api, message, threadID) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("انتهت مهلة الإرسال بعد 30 ثانية")), 30000);
    function finish(error, info) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(info);
    }
    try {
      const result = api.sendMessage(message, threadID, finish);
      if (result && typeof result.then === "function") result.then(info => finish(null, info), finish);
      else if (api.sendMessage.length < 3) finish(null, result);
    } catch (error) {
      finish(error);
    }
  });
}

function clearBis(timers, threadID) {
  const key = stateKey(threadID);
  const state = timers[key];
  if (!state) return false;
  state.stopped = true;
  if (typeof state.stop === "function") state.stop();
  else if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  delete timers[key];
  return true;
}

function scheduleNext(state, timers) {
  if (state.stopped || timers[state.key] !== state || state.sending) return;
  state.timer = setTimeout(async () => {
    state.timer = null;
    if (state.stopped || timers[state.key] !== state) return;
    state.sending = true;
    try {
      await sendOnce(state.api, state.text, state.threadID);
      state.lastSentAt = Date.now();
    } catch (error) {
      console.error("SHADOW BIS SEND ERROR:", error?.message || error);
    } finally {
      state.sending = false;
      scheduleNext(state, timers);
    }
  }, state.intervalMs);
  if (typeof state.timer.unref === "function") state.timer.unref();
}

module.exports = async (api, event, args, startTime, loadData, saveData, automicTimers) => {
  const threadID = String(event.threadID || "");
  if (!threadID) return;
  const prefix = String((loadData() || {}).prefix || "!");
  const action = String(args[1] || "").trim().toLowerCase();
  const key = stateKey(threadID);

  if (["ايقاف", "إيقاف", "off", "stop", "وقف"].includes(action)) {
    const stopped = clearBis(automicTimers, threadID);
    return api.sendMessage(
      stopped ? "🛑 تم إيقاف بيس في هذه المجموعة." : "ℹ️ بيس غير نشط في هذه المجموعة.",
      threadID
    );
  }

  const intervalToken = String(args[args.length - 1] || "").trim();
  const intervalSeconds = Number(intervalToken);
  const text = args.slice(1, -1).join(" ").trim();
  if (!text || text.length > 1800 || !/^\d+$/.test(intervalToken) ||
      !Number.isSafeInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS || intervalSeconds > MAX_INTERVAL_SECONDS) {
    return api.sendMessage(
      "🔁 طريقة الاستخدام:\n" +
      `${prefix}بيس [النص] [عدد الثواني]\n` +
      `مثال: ${prefix}بيس صباح الخير 120\n\n` +
      `⏱️ أقل فاصل ${MIN_INTERVAL_SECONDS} ثانية، وأقصى فاصل ${MAX_INTERVAL_SECONDS} ثانية.\n` +
      `🛑 للإيقاف: ${prefix}بيس إيقاف`,
      threadID
    );
  }

  clearBis(automicTimers, threadID);
  const reservation = acquireRepeatLock(threadID, "بيس");
  if (!reservation.acquired) {
    return api.sendMessage("⚠️ يوجد نظام تكرار آخر يعمل في هذه المجموعة. أوقفه أولاً قبل تشغيل بيس.", threadID);
  }

  const state = {
    kind: "shadow-bis-repeat",
    key,
    threadID,
    api,
    text,
    lock: reservation.lock,
    intervalMs: intervalSeconds * 1000,
    timer: null,
    sending: true,
    stopped: false,
    lastSentAt: 0,
    stop() {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      releaseRepeatLock(this.threadID, this.lock);
    }
  };
  automicTimers[key] = state;

  try {
    // رسالة التفعيل نفسها هي النص المطلوب تكراره؛ لا توجد رسالة تأكيد إضافية.
    const sessionID = String(process.env.SHADOW_SESSION_ID || "1");
    await sendOnce(
      api,
      `${text}\n\nبدء بيس رقم الجلسة [${sessionID}]\nعدد الثواني: ${intervalSeconds}\nللإيقاف اكتب: بيس إيقاف`,
      threadID
    );
    state.lastSentAt = Date.now();
  } catch (error) {
    state.stop();
    if (automicTimers[key] === state) delete automicTimers[key];
    return api.sendMessage(
      `❌ فشل إرسال رسالة بيس الأولى.\nالسبب: ${String(error?.message || error).slice(0, 250)}`,
      threadID
    );
  } finally {
    state.sending = false;
  }

  scheduleNext(state, automicTimers);
  return;
};

module.exports.MIN_INTERVAL_SECONDS = MIN_INTERVAL_SECONDS;
module.exports.MAX_INTERVAL_SECONDS = MAX_INTERVAL_SECONDS;
module.exports.stateKey = stateKey;
module.exports.clearBis = clearBis;
