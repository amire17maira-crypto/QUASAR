// 🚨 حل مشكلة SharedWorker في Railway
if (typeof global.SharedWorker === 'undefined') {
    global.SharedWorker = class SharedWorker {
        constructor() { console.warn("SharedWorker ignored."); }
    };
}

const fcaLogin = require("nexus-fca");

const { getThreadInfoSafe, getThreadListSafe, isCoolingDown, installThreadOperationGuard } = require("./thread-info-guard");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || ROOT);
fs.mkdirSync(DATA_DIR, { recursive: true });
const os = require("os");
const http = require("http");
const stats = require("./stats");
const { canExecuteCommand } = require("./command-access");
const autoDownload = require("./auto-download");
const { createMessageActivity } = require("./message-activity");

process.on("uncaughtException", (err) => console.log("خطأ:", err.message));
process.on("unhandledRejection", (reason) => console.log("خطأ:", reason));

const savedConfig = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8")); }
  catch { return {}; }
})();

const SESSION_ID = String(process.env.SHADOW_SESSION_ID || "1");
if (!/^[123]$/.test(SESSION_ID)) throw new Error("رقم الجلسة غير صالح");

const SESSION_SUFFIX = SESSION_ID === "1" ? "" : SESSION_ID;
const SESSION_FILE = path.join(DATA_DIR, "appState" + SESSION_SUFFIX + ".json");
const DATA_FILE = path.join(DATA_DIR, "data" + SESSION_SUFFIX + ".json");
const STATUS_FILE = path.join(DATA_DIR, "bot-status" + SESSION_SUFFIX + ".json");
const CUSTOM_COMMANDS_FILE = path.join(DATA_DIR, "custom-commands" + SESSION_SUFFIX + ".json");
const GROUP_REFRESH_SIGNAL_FILE = path.join(DATA_DIR, ".groups-refresh" + SESSION_SUFFIX + ".json");

const PORT = Number(process.env.SHADOW_BOT_PORT || process.env.PORT || (SESSION_ID === "1" ? 3000 : SESSION_ID === "2" ? 3002 : 3003));
const sessionConfig = savedConfig.SESSIONS?.[SESSION_ID] || {};

const environmentDevIds = String(process.env.DEV_IDS || "")
  .split(",").map(value => value.trim()).filter(value => /^[0-9]{5,25}$/.test(value));

function getSessionDeveloperSettings(sourceConfig = {}) {
  const session = sourceConfig.SESSIONS?.[SESSION_ID] || {};
  let rawIds = [];

  if (Array.isArray(session.DEV_IDS)) {
    rawIds = session.DEV_IDS;
  } else if (session.DEV_ID) {
    rawIds = [session.DEV_ID];
  } else if (SESSION_ID === "1") {
    rawIds = [
      ...(Array.isArray(sourceConfig.DEV_IDS) ? sourceConfig.DEV_IDS : []),
      sourceConfig.DEV_ID,
      process.env.DEV_ID,
      ...environmentDevIds
    ];
  }

  const ids = [...new Set(rawIds.map(String)
    .map(value => value.trim())
    .filter(value => /^[0-9]{5,25}$/.test(value)))].slice(0, 50);

  const preferredId = String(
    session.DEV_ID ||
    (SESSION_ID === "1" ? sourceConfig.DEV_ID || process.env.DEV_ID || "" : "") ||
    ids[0] || ""
  ).trim();

  if (/^[0-9]{5,25}$/.test(preferredId) && !ids.includes(preferredId)) {
    ids.unshift(preferredId);
  }

  return {
    id: /^[0-9]{5,25}$/.test(preferredId) ? preferredId : (ids[0] || ""),
    ids
  };
}

const developerSettings = getSessionDeveloperSettings(savedConfig);
const DEV_ID = developerSettings.id;
const DEV_IDS = developerSettings.ids;

const DEFAULT_BOT_NICK = "𝐅̷̸̳̿𝐄̷̸̴̸̵̴̶̵̺̱̰𝐋̷̸̧̰̦̰𝐈̷̸̚𝐗̷̸̳̿ 🇩🇪";
const DEFAULT_DEV_NICK = "𝗘𝗱𝘄𝗶𝗻 🪽";

const config = {
  BOT_NAME: "فليكس",
  BOT_NICK: String(sessionConfig.BOT_NICK || savedConfig.BOT_NICK || DEFAULT_BOT_NICK),
  NICK_GUARD_ENABLED: (sessionConfig.NICK_GUARD_ENABLED ?? savedConfig.NICK_GUARD_ENABLED) !== false,
  DEV_ID,
  DEV_IDS,
  DEV_NICK: String(sessionConfig.DEV_NICK || (SESSION_ID === "1" ? savedConfig.DEV_NICK : "") || DEFAULT_DEV_NICK),
  DEV_NICK_GUARD_ENABLED: (
    sessionConfig.DEV_NICK_GUARD_ENABLED ??
    (SESSION_ID === "1" ? savedConfig.DEV_NICK_GUARD_ENABLED : undefined)
  ) !== false,
  DEV_NAME: "Edwin"
};

http.createServer((req, res) => res.end("ok")).listen(PORT, "127.0.0.1");

const appState = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));

// تخزين مؤقت في الذاكرة لتسريع القراءة ومنع البطء
let cachedData = null;
let cachedDataAt = 0;

function loadData() {
  const now = Date.now();
  if (cachedData && now - cachedDataAt < 1500) {
    return cachedData;
  }
  try {
    cachedData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    cachedDataAt = now;
    return cachedData;
  } catch {
    return { prefix: "!", freePrefix: false, protected: {}, savedMessages: [], admins: [], locked: {}, antiLeave: true };
  }
}

function saveData(data) {
  cachedData = data;
  cachedDataAt = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const commands = {};
fs.readdirSync(path.join(ROOT, "commands")).sort().forEach(file => {
  if (!file.endsWith(".js")) return;
  const commandName = file.slice(0, -3);
  const handler = require(path.join(ROOT, "commands", file));
  commands[commandName] = handler;
  for (const alias of Array.isArray(handler.aliases) ? handler.aliases : []) {
    const aliasName = String(alias || "").trim().toLowerCase();
    if (!aliasName || Object.prototype.hasOwnProperty.call(commands, aliasName)) continue;
    Object.defineProperty(commands, aliasName, {
      value: handler,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
});

const events = {};
fs.readdirSync(path.join(ROOT, "events")).forEach(file => {
  if (file.endsWith(".js")) {
    events[file.replace(".js", "")] = require(path.join(ROOT, "events", file));
  }
});

const automicTimers = {};
const botSentMessages = {};
const broadcastTimers = new Map();
const startTime = Date.now();
let currentBotId = null;

// طابور إرسال معزول لكل محادثة/مجموعة لمنع تكرار الرسائل في مجموعة من تعطيل باقي المجموعات
const threadSendQueues = new Map();

// تتبع آخر الأسماء التي وضعها البوت نفسه حتى لا يعيد تفسيرها كأمر
const selfRenamedGroups = new Map();

function enqueueThreadSend(threadKey, taskFn) {
  const key = String(threadKey || "default");
  const prev = threadSendQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => taskFn());

  threadSendQueues.set(key, next);
  next.finally(() => {
    if (threadSendQueues.get(key) === next) {
      threadSendQueues.delete(key);
    }
  });

  return next;
}

function writeBotStatus(online) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      online,
      botId: currentBotId,
      startedAt: new Date(startTime).toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.log("تعذر تحديث حالة البوت:", e.message);
  }
}

process.on("exit", () => writeBotStatus(false));

function trackMsg(threadID, msgID) {
  if (!threadID || !msgID) return;
  const key = String(threadID);
  if (!botSentMessages[key]) botSentMessages[key] = [];
  botSentMessages[key].push(String(msgID));
  if (botSentMessages[key].length > 80) botSentMessages[key].shift();
}

async function unsendMessageCompat(api, messageID, threadID) {
  if (!messageID) return false;
  const msgIdStr = String(messageID);
  const fn = [api.unsendMessage, api.deleteMessage, api.removeMessage].find(m => typeof m === "function");
  if (!fn) return false;

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    setTimeout(() => finish(false), 10000);
    try {
      const res = fn.call(api, msgIdStr, (err) => finish(!err), threadID ? String(threadID) : undefined);
      if (res && typeof res.then === "function") {
        res.then(() => finish(true), () => finish(false));
      } else if (fn.length < 2) {
        finish(true);
      }
    } catch {
      finish(false);
    }
  });
}

function sendMessageAsync(api, message, threadID, replyToMessageID) {
  const targetKey = String(threadID || "");
  return enqueueThreadSend(targetKey, () => new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("انتهت مهلة إرسال الرسالة بعد 30 ثانية")),
      30000
    );

    function finish(error, info) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(info);
    }

    try {
      const result = api.sendMessage(
        message,
        targetKey,
        replyToMessageID == null ? undefined : String(replyToMessageID)
      );
      Promise.resolve(result).then(
        info => finish(null, info),
        error => finish(error)
      );
    } catch (error) {
      finish(error);
    }
  }));
}

// إرسال رسالة مؤقتة تُحذف تلقائياً بعد 5 ثوانٍ
function sendTempMessage(api, message, threadID, delayMs = 5000) {
  const targetKey = String(threadID || "");
  return sendMessageAsync(api, message, targetKey)
    .then((info) => {
      const msgID = info?.messageID || info?.msgID || info?.id;
      if (msgID) {
        trackMsg(targetKey, msgID);
        setTimeout(() => {
          unsendMessageCompat(api, msgID, targetKey).catch(() => {});
        }, delayMs);
      }
      return info;
    })
    .catch(() => {});
}

function startBroadcastLoop(api, threadID) {
  const key = String(threadID);
  if (broadcastTimers.has(key)) {
    clearInterval(broadcastTimers.get(key));
  }

  const sendSaved = () => {
    const d = loadData();
    const msg = d.groupBroadcastMessages?.[key] || d.savedBroadcastMessage;
    if (!msg) return;
    sendMessageAsync(api, msg, key).catch(() => {});
  };

  sendSaved();
  const timer = setInterval(sendSaved, 250 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  broadcastTimers.set(key, timer);
}

function stopBroadcastLoop(threadID) {
  const key = String(threadID);
  const timer = broadcastTimers.get(key);
  if (timer) {
    clearInterval(timer);
    broadcastTimers.delete(key);
  }
}

(async () => {
  try {
    const api = await fcaLogin({ appState }, {
      listenEvents: true,
      selfListen: false,
      autoReconnect: true
    });

    const BOT_ID = api.getCurrentUserID();
    currentBotId = BOT_ID;
    console.log("✅ فليكس يعمل | ID:", BOT_ID);

    // 🚨 1. تفعيل وضع الاستجابة السريعة
    try {
      if (typeof api.setParallelSend === "function") api.setParallelSend(3);
      if (typeof api.setFastSend === "function") api.setFastSend(true);
      if (typeof api.autoTyping === "function") api.autoTyping(false);
      console.log("⚡ تم تفعيل وضع الاستجابة السريعة.");
    } catch (protectionError) {
      console.log("⚠️ بعض إعدادات السرعة غير مدعومة:", protectionError.message);
    }

    // 2. إرسال رسالة التشغيل التلقائية للمطور
    if (DEV_ID) {
      setTimeout(() => {
        api.sendMessage("تم تشغيل فليكس ✅", String(DEV_ID)).catch(e => console.log("فشل إرسال رسالة التشغيل:", e.message));
      }, 3000);
    }

    const messageActivity = createMessageActivity({
      developerIds: config.DEV_IDS,
      react: async (messageID, threadID) => {
        if (typeof api.setMessageReactionMqtt !== "function") {
          throw new Error("دالة التفاعل غير متاحة");
        }
        await api.setMessageReactionMqtt("❤️", messageID, threadID);
      }
    });

    const fcaCompat = require("./fca-compat")(api);
    console.log("[FCA COMPAT] Installed:", fcaCompat.installed.join(", ") || "native methods");

    installThreadOperationGuard(api);

    const nicknameCommand = commands["كنيات"];
    if (nicknameCommand && typeof nicknameCommand.restoreProtection === "function") {
      const savedNicknameProtections = loadData().nicknameProtections || {};
      for (const [threadID, nickname] of Object.entries(savedNicknameProtections)) {
        if (typeof nickname === "string" && nickname.trim()) {
          nicknameCommand.restoreProtection(
            api, String(threadID), nickname, loadData, automicTimers, config, BOT_ID
          );
        }
      }
    }

    let reportedOnline = true;
    writeBotStatus(true);

    // 3. ميزة منع الخروج من القروبات (Anti-Leave)
    if (typeof api.on === "function") {
      api.on("log:unsubscribe", async (event) => {
        if (event.type === "log:unsubscribe") {
          const data = loadData();
          if (data.antiLeave === false) return;
          const leftID = event.logMessageData?.leftParticipantFbId;
          if (leftID && String(leftID) !== String(BOT_ID)) {
            try {
              await api.addUserToGroup(leftID, event.threadID);
              sendMessageAsync(api, `⚠️ تم إعادة العضو الذي حاول الخروج.`, event.threadID).catch(() => {});
            } catch (e) {
              console.log("فشل إعادة العضو:", e.message);
            }
          }
        }
      });

      const restrictedEvents = ["checkpoint", "checkpoint_282", "checkpoint_956", "loginBlocked", "sessionExpired", "account_inactive"];
      for (const eventName of restrictedEvents) {
        api.on(eventName, details => {
          reportedOnline = false;
          writeBotStatus(false);
          console.log(`[FCA SESSION] ${eventName}:`, String(details?.message || details?.reason || details || "requires account review").slice(0, 220));
          for (const [timerKey, timerValue] of Object.entries(automicTimers)) {
            if (["shadow-atomic", "shadow-engines"].includes(timerValue?.kind) && typeof timerValue.stop === "function") {
              timerValue.stop();
              delete automicTimers[timerKey];
            }
          }
        });
      }
      api.on("rateLimit", details => {
        console.log("[FCA SESSION] Rate limit reported; SHADOW request queue will apply cooldown.", String(details?.message || details || "").slice(0, 160));
      });
    }
    setInterval(() => writeBotStatus(reportedOnline), 10000);

    const _origSend = api.sendMessage.bind(api);

    api.sendMessage = (msg, threadID, third, fourth) => {
      const legacyCallback = typeof third === "function" ? third : null;
      const callback = legacyCallback ||
        (typeof fourth === "function" ? fourth : null);

      const rawReplyID = legacyCallback ? fourth : third;
      const replyID = rawReplyID == null ? undefined : String(rawReplyID);
      const targetKey = String(threadID || "");

      return enqueueThreadSend(targetKey, () => {
        let result;
        try {
          result = _origSend(msg, targetKey, replyID);
        } catch (error) {
          if (callback) {
            callback(error);
            return undefined;
          }
          throw error;
        }

        return Promise.resolve(result).then(info => {
          const msgID = info?.messageID || info?.msgID || info?.id;
          if (msgID) trackMsg(targetKey, msgID);
          if (callback) callback(null, info);
          return info;
        }, error => {
          if (callback) {
            callback(error);
            return undefined;
          }
          throw error;
        });
      });
    };

    // تغليف دوال تغيير اسم المجموعة لتسجيل أن البوت هو من غيّر الاسم (حتى لا يعيد تفسيرها كأمر)
    for (const renameMethod of ["gcname", "setTitle", "changeGroupName"]) {
      if (typeof api[renameMethod] === "function") {
        const origRename = api[renameMethod].bind(api);
        api[renameMethod] = (title, threadID, ...rest) => {
          if (threadID) {
            selfRenamedGroups.set(String(threadID), { title: String(title || ""), at: Date.now() });
          }
          return origRename(title, threadID, ...rest);
        };
      }
    }

    const hostingInfo = { platform: os.platform(), arch: os.arch(), node: process.version };

    async function setNicknameCompat(nickname, threadID, userID) {
      const method = [api.nickname, api.changeNickname, api.setNickname]
        .find(fn => typeof fn === "function");
      if (!method) throw new Error("دالة تغيير الكنية غير متاحة في FCA");
      return new Promise((resolve, reject) => {
        let settled = false;
        let timeout = null;
        const done = error => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        };
        timeout = setTimeout(() => done(new Error("انتهت مهلة تغيير الكنية بعد 30 ثانية")), 30000);
        try {
          const result = method.call(api, nickname, String(threadID), String(userID), done);
          if (result && typeof result.then === "function") result.then(() => done(), done);
          else if (method.length < 4) done();
        } catch (error) {
          done(error);
        }
      });
    }

    let nicknameCheckRunning = false;
    let discoverGroupsRunning = false;

    async function discoverBotGroups() {
      if (discoverGroupsRunning) return false;
      discoverGroupsRunning = true;
      try {
        const data = loadData();
        data.botGroups = Array.isArray(data.botGroups) ? data.botGroups : [];
        const known = new Map(data.botGroups.map(g => [String(g.id), g]));
        let cursor = null;

        for (let page = 0; page < 8; page++) {
          const list = await getThreadListSafe(api, 50, cursor, ["INBOX", "ARCHIVED"]);
          if (!Array.isArray(list) || !list.length) break;

          for (const thread of list) {
            if (!thread || !thread.isGroup || !thread.threadID) continue;
            const id = String(thread.threadID);
            known.set(id, { id, name: thread.threadName || id });
          }

          if (list.length < 50) break;
          const next = Number(list[list.length - 1].timestamp);
          if (!Number.isSafeInteger(next) || next <= 0 || next === cursor) break;
          cursor = next;
        }

        data.botGroups = [...known.values()];
        data.groupsUpdatedAt = new Date().toISOString();
        saveData(data);
        console.log("تم تحديث قروبات البوت:", data.botGroups.length);
        return true;
      } catch (e) {
        console.log("تعذر اكتشاف القروبات:", e.message);
        return false;
      } finally {
        discoverGroupsRunning = false;
      }
    }

    async function checkBotNicknames() {
      if (nicknameCheckRunning) return;
      nicknameCheckRunning = true;

      try {
        let latest = {};
        try {
          latest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8"));
        } catch {}

        const latestSession = latest.SESSIONS?.[SESSION_ID] || {};
        const legacyConfig = SESSION_ID === "1" ? latest : {};

        config.BOT_NICK = String(latestSession.BOT_NICK || latest.BOT_NICK || DEFAULT_BOT_NICK);
        config.DEV_NICK = String(latestSession.DEV_NICK || legacyConfig.DEV_NICK || DEFAULT_DEV_NICK);
        config.NICK_GUARD_ENABLED = (latestSession.NICK_GUARD_ENABLED ?? latest.NICK_GUARD_ENABLED) !== false;
        config.DEV_NICK_GUARD_ENABLED = (
          latestSession.DEV_NICK_GUARD_ENABLED ??
          legacyConfig.DEV_NICK_GUARD_ENABLED
        ) !== false;

        const developerSettings = getSessionDeveloperSettings(latest);
        config.DEV_ID = developerSettings.id;
        config.DEV_IDS = developerSettings.ids;

        const targets = [
          ...(config.NICK_GUARD_ENABLED ? [{ id: String(BOT_ID), nickname: config.BOT_NICK, label: "البوت" }] : []),
          ...(config.DEV_NICK_GUARD_ENABLED ? config.DEV_IDS.filter(id => id !== String(BOT_ID)).map(id => ({ id, nickname: config.DEV_NICK, label: "المطور" })) : [])
        ].filter(target => target.nickname && target.nickname.trim());

        if (!targets.length) return;

        const data = loadData();
        const ids = [...new Set([
          ...(Array.isArray(data.botGroups) ? data.botGroups.map(g => g && g.id) : []),
          ...Object.keys(data.protected || {}),
          ...Object.keys(data.nicknameProtections || {})
        ].map(id => String(id || "")).filter(Boolean))];

        for (let i = 0; i < ids.length; i += 20) {
          const batch = ids.slice(i, i + 20);
          let infos;
          try { infos = await getThreadInfoSafe(api, batch); }
          catch (e) { if (isCoolingDown(api)) break; continue; }

          for (const id of batch) {
            const info = infos && infos[id];
            if (!info) continue;
            const nicknames = info.nicknames || info.customNicknames || {};
            const groupNickname = loadData().nicknameProtections?.[id];

            for (const target of targets) {
              if (target.label === "المطور" && typeof groupNickname === "string" && groupNickname.trim()) continue;
              const current = nicknames[target.id] || "";
              if (current !== target.nickname) {
                try {
                  await setNicknameCompat(target.nickname, id, target.id);
                  await new Promise(resolve => setTimeout(resolve, 250));
                } catch (e) {}
              }
            }
          }
        }
      } finally {
        nicknameCheckRunning = false;
      }
    }

    let groupNameCheckRunning = false;
    const groupNameLastAttempt = new Map();

    async function checkSavedGroupNames() {
      if (groupNameCheckRunning) return;
      groupNameCheckRunning = true;
      try {
        const data = loadData();
        const saved = data.savedGroupNames || {};
        const ids = Object.keys(saved).filter(id => typeof saved[id] === "string" && saved[id].trim());

        for (let i = 0; i < ids.length; i += 20) {
          const batch = ids.slice(i, i + 20);
          let infos;
          try { infos = await getThreadInfoSafe(api, batch); }
          catch (e) { if (isCoolingDown(api)) break; continue; }

          for (const id of batch) {
            const latest = loadData().savedGroupNames || {};
            const wanted = latest[id];
            if (typeof wanted !== "string" || !wanted.trim()) continue;

            const info = infos && infos[id];
            if (!info) continue;

            const current = info.threadName || info.name || "";
            if (current === wanted) continue;

            const now = Date.now();
            const last = groupNameLastAttempt.get(id) || 0;
            if (now - last < 30000) continue;
            groupNameLastAttempt.set(id, now);

            try { await api.gcname(wanted, id); } catch {}
          }
        }
      } catch (e) {} finally { groupNameCheckRunning = false; }
    }

    setTimeout(() => discoverBotGroups().then(checkBotNicknames), 5000);
    setInterval(checkBotNicknames, 25000);
    setTimeout(checkSavedGroupNames, 10000);
    setInterval(checkSavedGroupNames, 45000);
    setInterval(discoverBotGroups, 600000);

    let refreshSignalRunning = false;
    let refreshSignalRetryAt = 0;

    async function processGroupRefreshSignal() {
      if (refreshSignalRunning || discoverGroupsRunning || nicknameCheckRunning || groupNameCheckRunning || Date.now() < refreshSignalRetryAt || !fs.existsSync(GROUP_REFRESH_SIGNAL_FILE)) return;
      refreshSignalRunning = true;
      let signalClaimed = false;

      try {
        try { fs.unlinkSync(GROUP_REFRESH_SIGNAL_FILE); signalClaimed = true; }
        catch (e) { if (e.code === "ENOENT") return; throw e; }

        const updated = await discoverBotGroups();
        if (!updated) {
          fs.writeFileSync(GROUP_REFRESH_SIGNAL_FILE, "retry");
          signalClaimed = false;
          refreshSignalRetryAt = Date.now() + 30000;
          return;
        }
      } catch (e) {
        if (signalClaimed) { try { fs.writeFileSync(GROUP_REFRESH_SIGNAL_FILE, "retry"); } catch (restoreError) {} }
        refreshSignalRetryAt = Date.now() + 30000;
      } finally {
        refreshSignalRunning = false;
      }
    }

    const refreshSignalTimer = setInterval(() => { processGroupRefreshSignal().catch(e => {}); }, 2500);
    if (typeof refreshSignalTimer.unref === "function") refreshSignalTimer.unref();

    let sessionErrorLogged = false;
    try { if (typeof api.setOptions === "function") api.setOptions({ listenEvents: true }); } catch (eventOptionsError) {}

    // دالة موحدة وسريعة لمعالجة أي رسالة أو أمر (من الدردشة أو من تغيير اسم المجموعة)
    async function handleIncomingMessage(event, options = {}) {
      const fromRename = options.fromRename === true;
      const eventThreadID = String(event.threadID || "");
      const senderID = String(event.senderID || "");
      const targetID = eventThreadID || senderID;
      if (!targetID || !senderID || senderID === String(BOT_ID)) return;

      const isPrivateEvent = event.isGroup === false || (!!eventThreadID && eventThreadID === senderID);

      if (!fromRename) {
        try { stats.recordMessage(event); } catch (e) {}
      }

      const data = loadData() || {};
      if (!isPrivateEvent && data.mutedGroups?.[eventThreadID] === true && !fromRename) return;

      if (!fromRename && eventThreadID && typeof api.markAsRead === "function") {
        Promise.resolve(api.markAsRead(eventThreadID)).catch(() => {});
      }

      if (!fromRename) {
        for (const e in events) {
          try {
            const res = events[e](api, event, config, loadData, saveData, automicTimers, BOT_ID, startTime);
            if (res?.catch) res.catch(() => {});
          } catch (eventError) {}
        }

        messageActivity.record(event, (threadID, messageEvent) => {
          const sender = String(messageEvent.senderID || "");
          if (!sender || sender === String(BOT_ID)) return false;
          return threadID !== sender;
        }).catch(() => {});

        if (event.body) {
          try { autoDownload(api, event, BOT_ID); } catch (downloadError) {}
        }
      }

      if (!event.body) return;

      const PREFIX = data.prefix || "!";
      const rawBody = String(event.body).trim();
      const body = rawBody.startsWith(PREFIX) && fromRename ? rawBody.slice(PREFIX.length).trim() : rawBody;
      const bodyLower = body.toLowerCase();
      const isDev = DEV_IDS.includes(senderID) || senderID === String(DEV_ID);

      // حفظ رسالة التكرار من داخل المجموعة برسالة عادية (للمطور)
      if (isDev && body.startsWith("حفظ_رسالة ")) {
        const textToSave = body.slice("حفظ_رسالة ".length).trim();
        if (!textToSave) {
          sendTempMessage(api, "⚠️ اكتب النص بعد: حفظ_رسالة [النص]", targetID, 5000);
          return;
        }
        const latestData = loadData() || {};
        latestData.groupBroadcastMessages = latestData.groupBroadcastMessages || {};
        latestData.groupBroadcastMessages[targetID] = textToSave;
        saveData(latestData);
        sendTempMessage(api, "✅ تم حفظ الرسالة لهذه المجموعة (ستُحذف هذه الرسالة بعد 5 ثوانٍ).", targetID, 5000);
        return;
      }

      // تشغيل التكرار كل 250 ثانية (عبر تغيير اسم المجموعة أو برسالة عادية للمطور)
      if (isDev && (bodyLower === "تشغيل" || bodyLower === "!تشغيل")) {
        const latestData = loadData() || {};
        const savedMsg = latestData.groupBroadcastMessages?.[targetID] || latestData.savedBroadcastMessage;
        if (!savedMsg) {
          sendTempMessage(api, "⚠️ لا توجد رسالة محفوظة لهذه المجموعة. أرسل: حفظ_رسالة [النص]", targetID, 5000);
          return;
        }
        startBroadcastLoop(api, targetID);
        if (fromRename) {
          sendTempMessage(api, "✅ تم تشغيل الإرسال التلقائي كل 250 ثانية (سيتم حذف هذا التنبيه خلال 5 ثوانٍ).", targetID, 5000);
        }
        return;
      }

      // إيقاف التكرار (عبر تغيير اسم المجموعة أو برسالة عادية للمطور)
      if (isDev && (bodyLower === "ايقاف" || bodyLower === "إيقاف" || bodyLower === "!ايقاف" || bodyLower === "!إيقاف")) {
        stopBroadcastLoop(targetID);
        sendTempMessage(api, "⏹️ تم إيقاف الإرسال التلقائي (سيتم حذف هذا التنبيه خلال 5 ثوانٍ).", targetID, 5000);
        return;
      }

      if (isDev && bodyLower === "فليكس") {
        sendMessageAsync(api, "شني", targetID).catch(() => {});
        return;
      }

      if (isDev && body.startsWith("ارسل ")) {
        const parts = body.split(" ");
        if (parts.length >= 3) {
          const destID = parts[1];
          const message = parts.slice(2).join(" ");
          sendMessageAsync(api, message, destID)
            .then(() => sendMessageAsync(api, `✅ تم إرسال رسالتك إلى ${destID} بنجاح.`, targetID))
            .catch(e => sendMessageAsync(api, `❌ فشل الإرسال: ${e.message}\nتأكد أن المعرف صحيح والحساب لا يمنع الرسائل.`, targetID));
        } else {
          sendMessageAsync(api, "الاستخدام: ارسل [ID] [الرسالة]", targetID).catch(() => {});
        }
        return;
      }

      if (isDev) {
        if (body === "-") {
          sendMessageAsync(api, "أحبك ❤️", targetID).catch(() => {});
          return;
        }
        if (body === "._.") {
          sendMessageAsync(api, "يا مطوري العظيم، أنت أكثر ما أحب ❤️", targetID).catch(() => {});
          return;
        }
        if (body.includes("منو عمك")) {
          sendMessageAsync(api, "هتلر مع علم ألمانيا 🇩🇪", targetID).catch(() => {});
          return;
        }
      }

      const developerIdsForReactions = new Set([...(Array.isArray(config.DEV_IDS) ? config.DEV_IDS : []), config.DEV_ID].filter(Boolean).map(String));
      if (developerIdsForReactions.has(senderID) && body === "مح") {
        if (event.messageID && typeof api.setMessageReactionMqtt === "function") {
          Promise.resolve(api.setMessageReactionMqtt("❤️", String(event.messageID), String(targetID))).catch(() => {});
        }
        return;
      }

      let cmd = null, args = [];
      let usedPrefix = false;
      if (rawBody.startsWith(PREFIX)) {
        args = rawBody.slice(PREFIX.length).trim().split(/\s+/);
        cmd = args[0].toLowerCase();
        usedPrefix = true;
      } else if (data.freePrefix || (fromRename && isDev)) {
        args = body.trim().split(/\s+/);
        cmd = args[0].toLowerCase();
      }

      const rawCommandLine = usedPrefix ? rawBody.slice(PREFIX.length) : body;
      const rawCommandMatch = rawCommandLine.match(/^\s*\S+(?:\s+([\s\S]*))?$/);
      args.rawText = rawCommandMatch ? (rawCommandMatch[1] || "") : "";

      if (!cmd) return;

      let customCommands = {};
      try {
        customCommands = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, "utf8"));
        if (!customCommands || typeof customCommands !== "object" || Array.isArray(customCommands)) customCommands = {};
      } catch {}

      const customCommand = customCommands[cmd];
      const hasCustomCommand = !commands[cmd] && customCommand && customCommand.enabled === true && (typeof customCommand.code === "string" || typeof customCommand.reply === "string");

      if (!commands[cmd] && !hasCustomCommand) return;

      stats.recordCommand(cmd, senderID, targetID);

      let liveConfig = {};
      try { liveConfig = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "config.json"), "utf8")); } catch { liveConfig = config; }

      const developerIds = getSessionDeveloperSettings(liveConfig).ids;
      const isDeveloper = developerIds.includes(senderID);
      const publicMode = data.publicMode === true;

      if (!isPrivateEvent && !fromRename) {
        if (!canExecuteCommand({ cmd, isDeveloper, publicMode })) {
          stats.recordUnauthorized(cmd);
          return;
        }
      }

      // إذا كان الأمر منفّذاً من اسم المجموعة، نرسل تنبيهاً مؤقتاً يُحذف بعد 5 ثوانٍ
      if (fromRename) {
        sendTempMessage(api, `⚙️ تم تنفيذ الأمر (${cmd}) عبر الاسم، وسيتم حذف هذا التنبيه بعد 5 ثوانٍ.`, targetID, 5000);
      }

      if (hasCustomCommand) {
        try {
          if (typeof customCommand.code === "string" && customCommand.code.trim()) {
            const customFn = new Function("return (" + customCommand.code + ")")();
            if (typeof customFn !== "function") throw new Error("كود الأمر يجب أن يكون دالة JavaScript");
            const result = customFn(api, event, args, startTime, loadData, saveData, automicTimers, config, hostingInfo, botSentMessages, BOT_ID);
            if (result?.catch) result.catch(e => {});
          } else if (typeof customCommand.reply === "string") {
            sendMessageAsync(api, customCommand.reply, targetID).catch(() => {});
          }
        } catch (e) {}
        return;
      }

      try {
        const result = commands[cmd](api, event, args, startTime, loadData, saveData, automicTimers, config, hostingInfo, botSentMessages, BOT_ID, Object.keys(commands), Object.keys(customCommands).filter(name => !commands[name] && customCommands[name] && customCommands[name].enabled === true), commands, { isDeveloper, fromRename });
        if (result?.catch) result.catch(e => {});
      } catch (e) {}
    }

    // 🚨 الفحص الاحتياطي للخاص وطلبات المراسلة
    const handledPollMsgIds = new Set();
    const bootTime = Date.now();

    setInterval(async () => {
      try {
        const threads = await api.getThreadList(10, null, ["INBOX", "PENDING", "OTHER"]);
        if (!Array.isArray(threads)) return;

        for (const thread of threads) {
          if (!thread || thread.isGroup) continue;
          const history = await api.getThreadHistory(thread.threadID, 3);
          if (!Array.isArray(history)) continue;

          for (const msg of history) {
            const msgTs = Number(msg.timestamp || 0);
            if (msgTs <= bootTime) continue;

            const msgId = String(msg.messageID || `${msg.threadID}:${msg.timestamp}`);
            if (handledPollMsgIds.has(msgId)) continue;
            handledPollMsgIds.add(msgId);
            if (handledPollMsgIds.size > 500) {
              handledPollMsgIds.delete(handledPollMsgIds.values().next().value);
            }

            if (String(msg.senderID || "") !== String(BOT_ID)) {
              handleIncomingMessage({
                type: "message",
                threadID: String(msg.threadID || thread.threadID),
                senderID: String(msg.senderID || ""),
                messageID: msg.messageID,
                isGroup: false,
                body: msg.body || ""
              }).catch(() => {});
            }
          }
        }
      } catch (e) {}
    }, 20000);

    // 🚨 استخدام api.listenMqtt
    api.listenMqtt(async (err, event) => {
      if (err) {
        const errorText = String(err?.message || err || "");
        console.log("SHADOW MQTT ERROR:", errorText);
        if (/checkpoint|logged.?out|login required|invalid app.?state|session.{0,20}(expired|invalid)|authentication|not authenticated|too many sessions|multiple sessions|session limit|rate.?limit|temporarily blocked|http\s*429|\b429\b|\b368\b|\b1545012\b/i.test(errorText)) {
          reportedOnline = false;
          writeBotStatus(false);
          for (const [timerKey, timerValue] of Object.entries(automicTimers)) {
            if (["shadow-atomic", "shadow-engines"].includes(timerValue?.kind) && typeof timerValue.stop === "function") {
              timerValue.stop();
              delete automicTimers[timerKey];
            }
          }
          if (!sessionErrorLogged) {
            sessionErrorLogged = true;
            console.log("⚠️ يبدو أن جلسة الحساب انتهت أو رُفضت. لن أبدأ تسجيل دخول جديدًا تلقائيًا.");
          }
          return;
        }
        return;
      }
      if (!event) return;

      if (["account_inactive", "stop_listen"].includes(String(event.type || ""))) {
        reportedOnline = false;
        writeBotStatus(false);
        for (const [timerKey, timerValue] of Object.entries(automicTimers)) {
          if (["shadow-atomic", "shadow-engines"].includes(timerValue?.kind) && typeof timerValue.stop === "function") {
            timerValue.stop();
            delete automicTimers[timerKey];
          }
        }
        return;
      }

      reportedOnline = true;
      sessionErrorLogged = false;

      // 🚨 حذف رسالة البوت عند تفاعل المطور بـ 😂
      if (event.type === "message_reaction") {
        const reactorID = String(event.userID || event.senderID || "");
        const reaction = String(event.reaction || "");
        const targetMsgID = String(event.messageID || "");
        const threadKey = String(event.threadID || "");
        const isDevReactor = DEV_IDS.includes(reactorID) || reactorID === String(DEV_ID);

        if (isDevReactor && reaction === "😂" && targetMsgID) {
          const trackedList = botSentMessages[threadKey] || [];
          const isBotMsg = trackedList.includes(targetMsgID) || String(event.senderID || "") === String(BOT_ID);
          if (isBotMsg || trackedList.length > 0) {
            unsendMessageCompat(api, targetMsgID, threadKey).catch(() => {});
          }
        }
        return;
      }

      // 🚨 تنفيذ الأوامر عند تغيير اسم المجموعة من قِبل المطور (مع رسالة مؤقتة تُحذف بعد 5 ثوانٍ)
      if (event.type === "event" && event.logMessageType === "log:thread-name") {
        const threadID = String(event.threadID || "");
        const changerID = String(event.author || event.senderID || "");
        const newGroupName = String(event.logMessageData?.name || "").trim();

        const selfRename = selfRenamedGroups.get(threadID);
        if (selfRename && selfRename.title === newGroupName && Date.now() - selfRename.at < 8000) {
          return;
        }

        const isDev = DEV_IDS.includes(changerID) || changerID === String(DEV_ID);
        if (isDev && newGroupName && changerID !== String(BOT_ID)) {
          handleIncomingMessage({
            type: "message",
            threadID,
            senderID: changerID,
            messageID: event.messageID || "",
            isGroup: true,
            body: newGroupName
          }, { fromRename: true }).catch(() => {});
          return;
        }
      }

      const addedParticipants = event.logMessageData?.addedParticipants;
      const botWasAdded = event.logMessageType === "log:subscribe" &&
        Array.isArray(addedParticipants) &&
        addedParticipants.some(person => String(person?.userFbId ?? person?.userID ?? person?.id ?? "") === String(BOT_ID));

      if (botWasAdded) {
        try {
          if (typeof events.join === "function") events.join(api, event, config, loadData, saveData, automicTimers, BOT_ID, startTime);
        } catch (eventError) {}
        return;
      }

      if (["message", "message_reply"].includes(String(event.type || ""))) {
        handleIncomingMessage(event).catch(() => {});
      } else {
        for (const e in events) {
          try {
            const res = events[e](api, event, config, loadData, saveData, automicTimers, BOT_ID, startTime);
            if (res?.catch) res.catch(() => {});
          } catch (eventError) {}
        }
      }
    });
  } catch (err) {
    console.error("فشل تسجيل الدخول باستخدام nexus-fca:", err.message);
  }
})();
