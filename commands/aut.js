"use strict";

// Aut: check every 80 seconds, reply only to the latest new human message,
// then leave the group after 16 minutes without human activity.
const STATE_PREFIX = "__alpha_aut__:";
const POLL_GAP_MS = 80 * 1000;
const IDLE_LIMIT_MS = 16 * 60 * 1000;
const TYPING_TIME_MS = 3 * 1000;
const HISTORY_LIMIT = 100;
const HISTORY_TIMEOUT_MS = 10000;
const MAX_SEEN_MESSAGES = 5000;
const LEAVE_TIMEOUT_MS = 10000;

const STOP_TEXT =
  "يولد المضحكة أو بنت المضحكة الدرويشة مهم مدري مين انت يك. س. م. ك المهم هذي رسالة تؤكد أن ا. م. ك اتركبت بفارق 16 دقيقه يا ديو٣ة ني. كر. بك تتحدى ر. ب. ك شخصيا";

function stateKey(threadID, sessionId = process.env.SHADOW_SESSION_ID || "1") {
  return STATE_PREFIX + String(sessionId) + ":" + String(threadID);
}

function normalizeId(value) {
  return value === undefined || value === null ? "" : String(value);
}

function timestampToMs(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function messageTimestamp(message) {
  return timestampToMs(
    message?.timestampMs ?? message?.timestamp_ms ??
    message?.timestamp ?? message?.createdTime
  );
}

function rememberBotMessage(botSentMessages, threadID, info) {
  const messageID = info?.messageID;
  if (!messageID || !botSentMessages || typeof botSentMessages !== "object") return;
  const id = String(threadID);
  if (!Array.isArray(botSentMessages[id])) botSentMessages[id] = [];
  const saved = botSentMessages[id];
  if (!saved.some(value => normalizeId(value) === normalizeId(messageID))) {
    saved.push(messageID);
  }
  if (saved.length > 60) saved.splice(0, saved.length - 60);
}

function sendOnce(api, message, threadID, replyToMessageID) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("انتهت مهلة الإرسال بعد 30 ثانية")),
      30000
    );
    if (typeof timeout.unref === "function") timeout.unref();

    function finish(error, info) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(info || null);
    }

    try {
      const callback = (error, info) => finish(error, info);
      const result = api.sendMessage(
        String(message),
        String(threadID),
        callback,
        replyToMessageID == null ? undefined : String(replyToMessageID)
      );
      if (result && typeof result.then === "function") {
        result.then(info => finish(null, info), finish);
      } else if (api.sendMessage.length < 3) {
        finish(null, result);
      }
    } catch (error) {
      finish(error);
    }
  });
}

function invokeApi(api, methodName, args, timeoutMs = LEAVE_TIMEOUT_MS) {
  const method = api && api[methodName];
  if (typeof method !== "function") {
    return Promise.reject(new Error(`واجهة ${methodName} غير متاحة`));
  }

  // Promise-style methods (including @dongdev/fca-unofficial) need no callback.
  if (method.length <= args.length) {
    try {
      return Promise.resolve(method.apply(api, args));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // Support callback-style FCA implementations as well.
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error(`انتهت مهلة ${methodName}`)),
      timeoutMs
    );
    if (typeof timer.unref === "function") timer.unref();

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    }

    try {
      const result = method.apply(api, [...args, (error, value) => finish(error, value)]);
      if (result && typeof result.then === "function") {
        result.then(value => finish(null, value), finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function leaveBotFromGroup(api, threadID, BOT_ID) {
  let botID = normalizeId(BOT_ID);
  if (!botID && typeof api?.getCurrentUserID === "function") {
    botID = normalizeId(await api.getCurrentUserID());
  }
  if (!botID) throw new Error("تعذر تحديد معرّف حساب البوت لمغادرة المجموعة");

  if (typeof api?.removeUserFromGroup === "function") {
    await invokeApi(api, "removeUserFromGroup", [botID, String(threadID)]);
    return true;
  }

  if (typeof api?.gcmember === "function") {
    await invokeApi(api, "gcmember", ["remove", botID, String(threadID)]);
    return true;
  }

  throw new Error("دالة مغادرة المجموعة غير متاحة في مكتبة الاتصال الحالية");
}

function stopJob(automicTimers, threadID) {
  const key = stateKey(threadID);
  const job = automicTimers?.[key];
  if (!job) return false;
  if (typeof job.stop === "function") job.stop();
  else {
    job.stopped = true;
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
  }
  if (automicTimers[key] === job) delete automicTimers[key];
  return true;
}

function stopAll(automicTimers) {
  const keys = Object.keys(automicTimers || {}).filter(key => key.startsWith(STATE_PREFIX));
  for (const key of keys) {
    const job = automicTimers[key];
    if (job && typeof job.stop === "function") job.stop();
    else if (job) {
      job.stopped = true;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
    }
    if (automicTimers[key] === job) delete automicTimers[key];
  }
  return keys.length;
}

function readHistory(api, threadID) {
  if (typeof api.getThreadHistory !== "function") {
    return Promise.resolve({ unavailable: true });
  }

  return new Promise(resolve => {
    let settled = false;
    const timeout = setTimeout(
      () => finish({ error: new Error("history-timeout") }),
      HISTORY_TIMEOUT_MS
    );
    if (typeof timeout.unref === "function") timeout.unref();

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    try {
      const callback = (error, history) => {
        if (error || !Array.isArray(history)) {
          finish({ error: error || new Error("invalid-history") });
        } else {
          finish({ history });
        }
      };
      const result = api.getThreadHistory(String(threadID), HISTORY_LIMIT, null, callback);
      if (result && typeof result.then === "function") {
        result.then(value => {
          if (Array.isArray(value)) finish({ history: value });
          else if (value && Array.isArray(value.history)) finish({ history: value.history });
          else if (value !== undefined) finish({ error: new Error("invalid-history") });
        }, error => finish({ error }));
      } else if (api.getThreadHistory.length < 4) {
        if (Array.isArray(result)) finish({ history: result });
        else if (result !== undefined) finish({ error: new Error("invalid-history") });
      }
    } catch (error) {
      finish({ error });
    }
  });
}

function getDeveloperIds(data, config) {
  const stored = Array.isArray(data?.developers)
    ? data.developers
    : Array.isArray(data?.developers?.list)
      ? data.developers.list
      : [];
  const configured = [
    ...(Array.isArray(config?.DEV_IDS) ? config.DEV_IDS : []),
    ...(Array.isArray(config?.developers) ? config.developers : []),
    config?.DEV_ID,
    config?.owner
  ];
  return new Set([...stored, ...configured].map(normalizeId).filter(Boolean));
}

async function finishJob(job) {
  if (!job || job.stopped || job.finishing) return false;
  job.finishing = true;

  // Remove the timer first so this closing path can run only once.
  job.stop();

  try {
    const info = await sendOnce(job.api, STOP_TEXT, job.threadID, job.lastTargetID || undefined);
    rememberBotMessage(job.botSentMessages, job.threadID, info);
  } catch (error) {
    console.error("ALPHA AUT CLOSING MESSAGE ERROR:", error?.message || error);
  }

  try {
    await leaveBotFromGroup(job.api, job.threadID, job.botID);
    job.leftGroup = true;
  } catch (error) {
    job.leaveError = error;
    console.error("ALPHA AUT LEAVE GROUP ERROR:", error?.message || error);
  }
  return true;
}

module.exports = async function autCommand(
  api,
  event,
  args,
  _startTime,
  loadData,
  _saveData,
  automicTimers,
  config = {},
  _hostingInfo,
  botSentMessages,
  BOT_ID,
  _builtInCommandNames,
  _customCommandNames,
  _commands,
  access = {}
) {
  const threadID = normalizeId(event?.threadID);
  if (!api || !threadID || !automicTimers) return;

  const messageID = event?.messageID;
  const senderID = normalizeId(event?.senderID);
  const commandArgs = Array.isArray(args) ? args : [];
  const prefix = String((typeof loadData === "function" ? await loadData() : {})?.prefix || "!");

  const reply = async message => {
    try {
      const info = await sendOnce(api, message, threadID, messageID);
      rememberBotMessage(botSentMessages, threadID, info);
      return info;
    } catch (error) {
      console.error("ALPHA AUT REPLY ERROR:", error?.message || error);
      return null;
    }
  };

  let data = {};
  try {
    data = typeof loadData === "function" ? (await loadData() || {}) : {};
  } catch (error) {
    return reply("❌ تعذر قراءة بيانات المطورين.");
  }

  const developerIds = getDeveloperIds(data, config);
  const isDeveloper = access.isDeveloper === true || access.isDev === true || developerIds.has(senderID);
  if (!isDeveloper) return reply("⛔ هذا الأمر للمطورين فقط.");
  const ownerID = normalizeId(config?.DEV_ID || config?.DEV_IDS?.[0]);

  const action = normalizeId(commandArgs[1]).trim().toLowerCase();
  if (["off", "stop", "إيقاف", "ايقاف", "وقف"].includes(action)) {
    if (normalizeId(commandArgs[2]).trim().toLowerCase() === "all") {
      if (!ownerID || senderID !== ownerID) {
        return reply("🔒 إيقاف جميع مهام Aut متاح للمالك الأساسي فقط.");
      }
      const count = stopAll(automicTimers);
      return reply(`🛑 تم إيقاف ${count} مهمة Aut.`);
    }

    return reply(
      stopJob(automicTimers, threadID)
        ? "🛑 تم إيقاف Aut في هذه المحادثة."
        : "ℹ️ لا توجد مهمة Aut شغالة هنا."
    );
  }

  // Keep raw text exactly as entered, including line breaks (same parser as بيس).
  const rawText = typeof commandArgs.rawText === "string"
    ? commandArgs.rawText
    : commandArgs.slice(1).join(" ");
  let text = String(rawText || "").trim();
  if (!text && event?.messageReply?.body) {
    text = String(event.messageReply.body).trim();
  }

  if (!text) {
    return reply(
      "🤖 Aut — يرد على أحدث رسالة بشرية جديدة\n" +
      `${prefix}aut [النص] — تشغيل الرد التلقائي\n` +
      `${prefix}aut off — إيقاف هذه المحادثة\n` +
      `${prefix}aut off all — إيقاف جميع المهام (للمالك فقط)`
    );
  }

  stopJob(automicTimers, threadID);
  const key = stateKey(threadID);
  const startedAt = Date.now();
  const job = {
    kind: "alpha-aut",
    key,
    threadID,
    api,
    botID: normalizeId(BOT_ID),
    botSentMessages,
    text,
    since: startedAt,
    lastHumanAt: startedAt,
    lastTargetID: null,
    timer: null,
    stopped: false,
    finishing: false,
    polling: false,
    seen: new Set(messageID ? [normalizeId(messageID)] : []),
    stop() {
      if (this.stopped) return;
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (automicTimers[key] === this) delete automicTimers[key];
    }
  };
  automicTimers[key] = job;

  const isBotMessage = message => {
    const messageSender = normalizeId(message?.senderID);
    const botId = normalizeId(BOT_ID);
    if (botId && messageSender && messageSender === botId) return true;
    const id = normalizeId(message?.messageID);
    const sentInThread = botSentMessages && botSentMessages[threadID];
    return Boolean(
      id && Array.isArray(sentInThread) &&
      sentInThread.some(saved => normalizeId(saved) === id)
    );
  };

  const showTyping = async () => {
    if (job.stopped) return;
    try {
      if (typeof api.sendTypingIndicator === "function") {
        const result = api.sendTypingIndicator(threadID, true, {
          duration: TYPING_TIME_MS,
          autoStop: true
        });
        if (result && typeof result.then === "function") await result;
      }
    } catch (error) {
      console.log("ALPHA AUT TYPING ERROR:", error?.message || error);
    }

    await new Promise(resolve => setTimeout(resolve, TYPING_TIME_MS));

    try {
      if (typeof api.sendTypingIndicator === "function") {
        const result = api.sendTypingIndicator(threadID, false);
        if (result && typeof result.then === "function") await result;
      }
    } catch {}
  };

  const scheduleNext = () => {
    if (job.stopped || automicTimers[key] !== job) return;
    job.timer = setTimeout(() => {
      job.timer = null;
      pollAndReply().catch(error => {
        console.error("ALPHA AUT POLL ERROR:", error?.message || error);
      });
    }, POLL_GAP_MS);
    if (typeof job.timer.unref === "function") job.timer.unref();
  };

  const pollAndReply = async () => {
    if (job.stopped || automicTimers[key] !== job || job.polling) return;
    job.polling = true;
    try {
      const result = await readHistory(api, threadID);
      if (job.stopped || automicTimers[key] !== job) return;

      if (result.unavailable) {
        stopJob(automicTimers, threadID);
        await reply("⚠️ مكتبة الاتصال الحالية لا تدعم getThreadHistory؛ تم إيقاف Aut.");
        return;
      }

      // Do not treat a failed history request as proof that the group is idle.
      if (result.error) return;

      const fresh = (result.history || [])
        .filter(message => {
          if (!message?.messageID || !message?.senderID || isBotMessage(message)) return false;
          const id = normalizeId(message.messageID);
          const timestamp = messageTimestamp(message);
          return id && !job.seen.has(id) && timestamp >= job.since;
        })
        .sort((left, right) => messageTimestamp(left) - messageTimestamp(right));

      if (fresh.length) {
        // Mark all discovered messages, but respond only to the latest one.
        for (const message of fresh) {
          const id = normalizeId(message.messageID);
          if (!id) continue;
          job.seen.add(id);
          if (job.seen.size > MAX_SEEN_MESSAGES) {
            const oldest = job.seen.values().next().value;
            job.seen.delete(oldest);
          }
        }

        const latest = fresh[fresh.length - 1];
        const targetID = normalizeId(latest.messageID);
        const latestAt = messageTimestamp(latest);
        job.lastTargetID = targetID;
        job.lastHumanAt = Math.max(job.lastHumanAt, latestAt || Date.now());

        await showTyping();
        if (job.stopped || automicTimers[key] !== job) return;

        try {
          const info = await sendOnce(api, job.text, threadID, targetID);
          rememberBotMessage(botSentMessages, threadID, info);
        } catch (error) {
          console.error("ALPHA AUT SEND ERROR:", error?.message || error);
        }
      }

      // A successful history read confirmed there has been no newer human message.
      if (!job.stopped && Date.now() - job.lastHumanAt >= IDLE_LIMIT_MS) {
        await finishJob(job);
        return;
      }
    } finally {
      job.polling = false;
      scheduleNext();
    }
  };

  const started = await reply(
    "🤖 Aut يعمل الآن.\n" +
    "يفحص كل 80 ثانية ويرد على أحدث رسالة بشرية بعد إظهار الكتابة 3 ثوانٍ.\n" +
    "إذا مرّت 16 دقيقة دون رسالة بشرية، يرسل الختامية ثم يغادر المجموعة.\n" +
    "للإيقاف اليدوي: aut off"
  );
  if (!started) {
    stopJob(automicTimers, threadID);
    return;
  }

  // First scan is immediate; all subsequent scans are 80 seconds apart.
  await pollAndReply();
};

module.exports.aliases = ["au"];
module.exports.stateKey = stateKey;
module.exports.POLL_GAP_MS = POLL_GAP_MS;
module.exports.stopJob = stopJob;
module.exports.stopAll = stopAll;
module.exports.finishJob = finishJob;
module.exports.leaveBotFromGroup = leaveBotFromGroup;
module.exports.constants = {
  POLL_GAP_MS,
  IDLE_LIMIT_MS,
  TYPING_TIME_MS,
  HISTORY_LIMIT,
  HISTORY_TIMEOUT_MS,
  MAX_SEEN_MESSAGES,
  STOP_TEXT
};
