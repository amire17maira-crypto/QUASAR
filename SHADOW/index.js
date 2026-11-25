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
const { spawn } = require("child_process");
const yts = require("yt-search");
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || ROOT);
fs.mkdirSync(DATA_DIR, { recursive: true });
const os = require("os");
const http = require("http");
const stats = require("./stats");
const { canExecuteCommand } = require("./command-access");
const autoDownload = require("./auto-download");
const { createMessageActivity } = require("./message-activity");

const MEDIA_CACHE_DIR = path.join(__dirname, "cache");
const MEDIA_MAX_MINS = 10;
const MEDIA_MAX_SIZE = 24 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 120000;
fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });

process.on("uncaughtException", (err) => console.log("خطأ:", err?.message || err));
process.on("unhandledRejection", (reason) => console.log("خطأ:", reason?.message || reason));

const CONFIG_FILE = path.join(DATA_DIR, "config.json");

const savedConfig = (() => {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
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

const healthServer = http.createServer((req, res) => res.end("ok"));
healthServer.on("error", (err) => {
  console.log("تنبيه منفذ السيرفر:", err?.message || err);
});
healthServer.listen(PORT, "127.0.0.1");

const appState = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));

let cachedData = null;
let cachedDataAt = 0;

function loadData() {
  const now = Date.now();
  if (cachedData && now - cachedDataAt < 4000) {
    return cachedData;
  }
  try {
    cachedData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    cachedDataAt = now;
    return cachedData;
  } catch {
    return {
      prefix: "!",
      freePrefix: false,
      protected: {},
      savedMessages: [],
      admins: [],
      locked: {},
      antiLeave: true,
      savedBroadcastMessage: "",
      activeBroadcastThreads: [],
      angelMessage: "",
      angelSchedules: {},
      autoAddAccounts: [],
      idAutoAddEnabled: true
    };
  }
}

function saveData(data) {
  cachedData = data;
  cachedDataAt = Date.now();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log("تعذر حفظ البيانات:", e.message);
  }
}

let cachedLiveConfig = savedConfig;
let cachedLiveConfigAt = Date.now();

function loadLiveConfigCached() {
  const now = Date.now();
  if (cachedLiveConfig && now - cachedLiveConfigAt < 15000) {
    return cachedLiveConfig;
  }
  try {
    cachedLiveConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    cachedLiveConfigAt = now;
  } catch {
    cachedLiveConfig = cachedLiveConfig || config;
    cachedLiveConfigAt = now;
  }
  return cachedLiveConfig;
}

let cachedCustomCommands = {};
let cachedCustomCommandsAt = 0;

function loadCustomCommandsCached() {
  const now = Date.now();
  if (now - cachedCustomCommandsAt < 15000) {
    return cachedCustomCommands;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_COMMANDS_FILE, "utf8"));
    cachedCustomCommands = (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    cachedCustomCommands = {};
  }
  cachedCustomCommandsAt = now;
  return cachedCustomCommands;
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
const angelTimers = new Map();
const startTime = Date.now();
let currentBotId = null;

const selfRenamedGroups = new Map();

function writeBotStatus(online) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      online,
      running: Boolean(online),
      botId: currentBotId,
      startedAt: new Date(startTime).toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.log("تعذر تحديث حالة البوت:", e.message);
  }
}

writeBotStatus(true);

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
    setTimeout(() => finish(false), 8000);
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
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("انتهت مهلة إرسال الرسالة بعد 20 ثانية")),
      20000
    );

    function finish(error, info) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const msgID = info?.messageID || info?.msgID || info?.id;
      if (msgID) trackMsg(targetKey, msgID);
      if (error) reject(error);
      else resolve(info);
    }

    try {
      const result = api.sendMessage(
        message,
        targetKey,
        replyToMessageID == null ? undefined : String(replyToMessageID),
        (err, info) => {
          if (err) finish(err);
          else finish(null, info);
        }
      );
      if (result && typeof result.then === "function") {
        result.then(info => finish(null, info), error => finish(error));
      }
    } catch (error) {
      finish(error);
    }
  });
}

function sendTempMessage(api, message, threadID, delayMs = 4500) {
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

function formatDuration(secondsTotal) {
  const sec = Math.max(0, Math.floor(Number(secondsTotal) || 0));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  return `${days}d ${hours}h ${mins}m ${remSec}s`;
}

// حفظ حالة البث القديم (250 ثانية)
function setThreadBroadcastState(threadID, enabled) {
  const key = String(threadID);
  const d = loadData() || {};
  const list = new Set(Array.isArray(d.activeBroadcastThreads) ? d.activeBroadcastThreads.map(String) : []);
  if (enabled) list.add(key);
  else list.delete(key);
  d.activeBroadcastThreads = [...list];
  saveData(d);
}

function startBroadcastLoop(api, threadID, persist = true) {
  const key = String(threadID);
  if (persist) {
    setThreadBroadcastState(key, true);
  }
  if (broadcastTimers.has(key)) {
    clearInterval(broadcastTimers.get(key));
  }

  const sendSaved = () => {
    const d = loadData() || {};
    const msg = String(d.savedBroadcastMessage || "").trim();
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
  setThreadBroadcastState(key, false);
  const timer = broadcastTimers.get(key);
  if (timer) {
    clearInterval(timer);
    broadcastTimers.delete(key);
  }
}

// نظام angel
function setAngelScheduleState(threadID, secondsOrNull) {
  const key = String(threadID);
  const d = loadData() || {};
  d.angelSchedules = d.angelSchedules && typeof d.angelSchedules === "object" ? d.angelSchedules : {};
  if (secondsOrNull && secondsOrNull > 0) {
    d.angelSchedules[key] = Number(secondsOrNull);
  } else {
    delete d.angelSchedules[key];
  }
  saveData(d);
}

function startAngelLoop(api, threadID, seconds, persist = true) {
  const key = String(threadID);
  const sec = Math.max(1, Number(seconds) || 1);
  if (persist) {
    setAngelScheduleState(key, sec);
  }
  if (angelTimers.has(key)) {
    clearInterval(angelTimers.get(key));
  }

  const tick = () => {
    const d = loadData() || {};
    const msg = String(d.angelMessage || "").trim();
    if (!msg) return;
    sendMessageAsync(api, msg, key).catch(() => {});
  };

  if (persist) {
    tick();
  }
  const timer = setInterval(tick, sec * 1000);
  if (typeof timer.unref === "function") timer.unref();
  angelTimers.set(key, timer);
}

function stopAngelLoop(threadID) {
  const key = String(threadID);
  setAngelScheduleState(key, null);
  const timer = angelTimers.get(key);
  if (timer) {
    clearInterval(timer);
    angelTimers.delete(key);
  }
}

// دوال تحميل الصوت والفيديو والصور
function cleanMediaFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function secToTime(seconds) {
  const value = Math.floor(Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

function downloadAudio(url, output) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--max-filesize", String(MEDIA_MAX_SIZE),
      "-o", output,
      "--no-playlist",
      "--socket-timeout", "30",
      "--retries", "3",
      "--no-warnings"
    ];

    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      finish(new Error("انتهت مهلة التحميل."));
    }, MEDIA_TIMEOUT_MS);

    function finish(error, file) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(file);
    }

    proc.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-1500);
    });

    proc.on("error", error => finish(error));

    proc.on("close", code => {
      const file = output.endsWith(".mp3") ? output : output + ".mp3";

      if (code === 0 && fs.existsSync(file)) {
        const size = fs.statSync(file).size;
        if (size > MEDIA_MAX_SIZE) {
          cleanMediaFile(file);
          return finish(new Error("SIZE_LIMIT"));
        }
        return finish(null, file);
      }

      finish(new Error(stderr || `yt-dlp exited ${code}`));
    });
  });
}

function downloadVideoMp4(url, output) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "--max-filesize", String(MEDIA_MAX_SIZE),
      "-o", output,
      "--no-playlist",
      "--socket-timeout", "30",
      "--retries", "3",
      "--no-warnings"
    ];

    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      finish(new Error("انتهت مهلة التحميل."));
    }, MEDIA_TIMEOUT_MS);

    function finish(error, file) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(file);
    }

    proc.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-1500);
    });

    proc.on("error", error => finish(error));

    proc.on("close", code => {
      const candidates = [
        output,
        output + ".mp4",
        output.replace(/\.mp4$/i, "") + ".mp4"
      ];
      const found = candidates.find(p => p && fs.existsSync(p));

      if (code === 0 && found) {
        const size = fs.statSync(found).size;
        if (size > MEDIA_MAX_SIZE) {
          cleanMediaFile(found);
          return finish(new Error("SIZE_LIMIT"));
        }
        return finish(null, found);
      }

      finish(new Error(stderr || `yt-dlp exited ${code}`));
    });
  });
}

async function handleMusicCommand(api, event, args) {
  const threadID = String(event.threadID || "");
  const messageID = event.messageID ? String(event.messageID) : undefined;
  const query = Array.isArray(args) ? args.join(" ").trim() : "";

  if (!query) {
    return sendMessageAsync(api, "🎵 اكتب اسم الأغنية.\nمثال: !mu faded", threadID, messageID);
  }

  let waitID = null;
  let file = null;

  try {
    const waiting = await sendMessageAsync(api, `🔎 جاري البحث عن: ${query}`, threadID, messageID);
    waitID = waiting?.messageID;

    const result = await yts(query);
    const videos = (result.videos || []).filter(video =>
      Number(video.seconds) > 0 &&
      Number(video.seconds) <= MEDIA_MAX_MINS * 60
    );

    const video = videos[0];
    if (!video) {
      await unsendMessageCompat(api, waitID, threadID);
      return sendMessageAsync(api, "❌ لم أجد أغنية مناسبة أقل من 10 دقائق.", threadID, messageID);
    }

    const title = video.title || query;
    const channel = video.author?.name || "غير معروف";
    const duration = Number(video.seconds) || 0;

    await unsendMessageCompat(api, waitID, threadID);
    waitID = null;

    const downloading = await sendMessageAsync(api, `⬇️ جاري تحميل الأغنية:\n${title}`, threadID, messageID);
    waitID = downloading?.messageID;

    const output = path.join(MEDIA_CACHE_DIR, `mu_${process.env.SHADOW_SESSION_ID || "1"}_${Date.now()}.mp3`);
    file = await downloadAudio(video.url, output);

    await unsendMessageCompat(api, waitID, threadID);
    waitID = null;

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.once("error", reject);

      api.sendMessage(
        {
          body: `🎵 ${title}\n🎤 ${channel}\n⏱ ${secToTime(duration)}`,
          attachment: stream
        },
        threadID,
        messageID,
        error => error ? reject(error) : resolve()
      );
    });
  } catch (error) {
    console.error("[MU COMMAND]", error?.message || error);
    await unsendMessageCompat(api, waitID, threadID);

    const message = error?.message === "SIZE_LIMIT"
      ? "❌ حجم الأغنية أكبر من 24MB."
      : "❌ تعذر البحث أو تحميل الأغنية. حاول مرة أخرى.";

    try {
      await sendMessageAsync(api, message, threadID, messageID);
    } catch {}
  } finally {
    cleanMediaFile(file);
  }
}

async function handleVideoCommand(api, event, args) {
  const threadID = String(event.threadID || "");
  const messageID = event.messageID ? String(event.messageID) : undefined;
  const query = Array.isArray(args) ? args.join(" ").trim() : "";

  if (!query) {
    return sendMessageAsync(api, "🎬 اكتب اسم الفيديو أو رابطه.\nمثال: !video لقطة مضحكة", threadID, messageID);
  }

  let waitID = null;
  let file = null;

  try {
    const waiting = await sendMessageAsync(api, `🔎 جاري البحث عن الفيديو: ${query}`, threadID, messageID);
    waitID = waiting?.messageID;

    let targetUrl = query;
    let title = query;
    let channel = "غير معروف";
    let duration = 0;

    if (!/^https?:\/\//i.test(query)) {
      const result = await yts(query);
      const videos = (result.videos || []).filter(v =>
        Number(v.seconds) > 0 &&
        Number(v.seconds) <= MEDIA_MAX_MINS * 60
      );
      const picked = videos[0];
      if (!picked) {
        await unsendMessageCompat(api, waitID, threadID);
        return sendMessageAsync(api, "❌ لم أجد فيديو مناسباً أقل من 10 دقائق.", threadID, messageID);
      }
      targetUrl = picked.url;
      title = picked.title || query;
      channel = picked.author?.name || "غير معروف";
      duration = Number(picked.seconds) || 0;
    }

    await unsendMessageCompat(api, waitID, threadID);
    waitID = null;

    const downloading = await sendMessageAsync(api, `⬇️ جاري تحميل الفيديو:\n${title}`, threadID, messageID);
    waitID = downloading?.messageID;

    const output = path.join(MEDIA_CACHE_DIR, `vid_${process.env.SHADOW_SESSION_ID || "1"}_${Date.now()}.mp4`);
    file = await downloadVideoMp4(targetUrl, output);

    await unsendMessageCompat(api, waitID, threadID);
    waitID = null;

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.once("error", reject);

      api.sendMessage(
        {
          body: `🎬 ${title}\n📺 ${channel}${duration ? `\n⏱ ${secToTime(duration)}` : ""}`,
          attachment: stream
        },
        threadID,
        messageID,
        error => error ? reject(error) : resolve()
      );
    });
  } catch (error) {
    console.error("[VIDEO COMMAND]", error?.message || error);
    await unsendMessageCompat(api, waitID, threadID);

    const message = error?.message === "SIZE_LIMIT"
      ? "❌ حجم الفيديو أكبر من 24MB."
      : "❌ تعذر البحث أو تحميل الفيديو. حاول مرة أخرى.";

    try {
      await sendMessageAsync(api, message, threadID, messageID);
    } catch {}
  } finally {
    cleanMediaFile(file);
  }
}

async function handleImageCommand(api, event, args) {
  const threadID = String(event.threadID || "");
  const messageID = event.messageID ? String(event.messageID) : undefined;
  const query = Array.isArray(args) ? args.join(" ").trim() : "";

  if (!query) {
    return sendMessageAsync(api, "🖼️ اكتب كلمة للبحث عن صورة.\nمثال: !img غروب الشمس", threadID, messageID);
  }

  let file = null;
  try {
    const result = await yts(query);
    const candidate = (result.videos || []).find(v => v.thumbnail || v.image);
    const thumbUrl = candidate?.thumbnail || candidate?.image;

    if (!thumbUrl) {
      return sendMessageAsync(api, "❌ لم أجد صورة مناسبة حالياً.", threadID, messageID);
    }

    const imgOut = path.join(MEDIA_CACHE_DIR, `img_${process.env.SHADOW_SESSION_ID || "1"}_${Date.now()}.jpg`);
    const resp = await fetch(thumbUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    if (!buf.length || buf.length > MEDIA_MAX_SIZE) {
      throw new Error("حجم الصورة غير مناسب");
    }
    fs.writeFileSync(imgOut, buf);
    file = imgOut;

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.once("error", reject);
      api.sendMessage(
        {
          body: `🖼️ ${candidate?.title || query}`,
          attachment: stream
        },
        threadID,
        messageID,
        error => error ? reject(error) : resolve()
      );
    });
  } catch (error) {
    console.error("[IMG COMMAND]", error?.message || error);
    try {
      await sendMessageAsync(api, "❌ تعذر تحميل الصورة الآن. حاول مرة أخرى.", threadID, messageID);
    } catch {}
  } finally {
    cleanMediaFile(file);
  }
}

async function handleMarryCommand(api, event) {
  const threadID = String(event.threadID || "");
  const senderID = String(event.senderID || "");
  if (!threadID || !senderID) return;

  try {
    const infoMap = await getThreadInfoSafe(api, [threadID]);
    const info = infoMap && infoMap[threadID];
    const participants = Array.isArray(info?.participantIDs)
      ? info.participantIDs.map(String).filter(id => id && id !== senderID && id !== String(currentBotId || ""))
      : [];

    if (!participants.length) {
      return sendMessageAsync(api, "❌ لا يوجد أعضاء كافون في المجموعة لاختيار منشن عشوائي.", threadID);
    }

    const partnerID = participants[Math.floor(Math.random() * participants.length)];
    const compatibility = Math.floor(Math.random() * 101);

    const bodyText = `💍 تم اختيار شريكك العشوائي:\n👤 @\n💞 نسبة التوافق بينكما: ${compatibility}%`;
    const mentions = [
      {
        tag: "@",
        id: partnerID,
        fromIndex: bodyText.indexOf("@")
      }
    ];

    await sendMessageAsync(api, { body: bodyText, mentions }, threadID);
  } catch (error) {
    console.error("[MARRY COMMAND]", error?.message || error);
    try {
      await sendMessageAsync(api, "❌ تعذر تنفيذ أمر زوجني الآن.", threadID);
    } catch {}
  }
}

async function handleServerInfoImageCommand(api, event) {
  const threadID = String(event.threadID || "");
  const messageID = event.messageID ? String(event.messageID) : undefined;

  const sysUptime = formatDuration(os.uptime());
  const botUptime = formatDuration((Date.now() - startTime) / 1000);
  const nodeVer = process.version;
  const platformInfo = `${os.platform()} (${os.arch()})`;
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const botName = config.BOT_NAME;
  const devName = config.DEV_NAME;

  let canvasMod = null;
  try { canvasMod = require("canvas"); } catch {}

  let file = null;
  try {
    if (canvasMod && typeof canvasMod.createCanvas === "function") {
      const width = 900;
      const height = 520;
      const canvas = canvasMod.createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, "#0f172a");
      grad.addColorStop(1, "#1e293b");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 4;
      ctx.strokeRect(18, 18, width - 36, height - 36);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 36px sans-serif";
      ctx.fillText(`SERVER & BOT INFO — ${botName}`, 48, 82);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "22px sans-serif";
      const lines = [
        `Bot Name: ${botName}`,
        `Developer: ${devName}`,
        `System Uptime: ${sysUptime}`,
        `Bot Uptime: ${botUptime}`,
        `Node.js: ${nodeVer}`,
        `Platform: ${platformInfo}`,
        `Memory: ${freeMemMb}MB free / ${totalMemMb}MB total`
      ];

      lines.forEach((line, idx) => {
        ctx.fillStyle = idx < 2 ? "#38bdf8" : "#e2e8f0";
        ctx.fillText(line, 48, 145 + idx * 48);
      });

      file = path.join(MEDIA_CACHE_DIR, `server_${Date.now()}.png`);
      fs.writeFileSync(file, canvas.toBuffer("image/png"));
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
        </defs>
        <rect width="900" height="520" fill="url(#bg)"/>
        <rect x="18" y="18" width="864" height="484" fill="none" stroke="#38bdf8" stroke-width="4" rx="16"/>
        <text x="48" y="82" fill="#f8fafc" font-size="34" font-family="Arial, sans-serif" font-weight="bold">SERVER &amp; BOT INFO — ${botName}</text>
        <text x="48" y="145" fill="#38bdf8" font-size="24" font-family="Arial, sans-serif">Bot Name: ${botName}</text>
        <text x="48" y="193" fill="#38bdf8" font-size="24" font-family="Arial, sans-serif">Developer: ${devName}</text>
        <text x="48" y="241" fill="#e2e8f0" font-size="24" font-family="Arial, sans-serif">System Uptime: ${sysUptime}</text>
        <text x="48" y="289" fill="#e2e8f0" font-size="24" font-family="Arial, sans-serif">Bot Uptime: ${botUptime}</text>
        <text x="48" y="337" fill="#e2e8f0" font-size="24" font-family="Arial, sans-serif">Node.js: ${nodeVer}</text>
        <text x="48" y="385" fill="#e2e8f0" font-size="24" font-family="Arial, sans-serif">Platform: ${platformInfo}</text>
        <text x="48" y="433" fill="#e2e8f0" font-size="24" font-family="Arial, sans-serif">Memory: ${freeMemMb}MB free / ${totalMemMb}MB total</text>
      </svg>`;
      file = path.join(MEDIA_CACHE_DIR, `server_${Date.now()}.svg`);
      fs.writeFileSync(file, svg, "utf8");
    }

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.once("error", reject);
      api.sendMessage(
        {
          body: `🖥️ معلومات النظام والبوت (${botName}) — المطور: ${devName}`,
          attachment: stream
        },
        threadID,
        messageID,
        error => error ? reject(error) : resolve()
      );
    });
  } catch (err) {
    console.error("[SERVER COMMAND]", err?.message || err);
    await sendMessageAsync(
      api,
      `🖥️ معلومات النظام:\n• اسم البوت: ${botName}\n• المطور: ${devName}\n• وقت تشغيل النظام: ${sysUptime}\n• وقت تشغيل البوت: ${botUptime}\n• Node.js: ${nodeVer}\n• النظام: ${platformInfo}`,
      threadID,
      messageID
    );
  } finally {
    cleanMediaFile(file);
  }
}

async function handleMessageRequestsCommand(api, event) {
  const threadID = String(event.threadID || "");
  const messageID = event.messageID ? String(event.messageID) : undefined;

  try {
    const reqThreads = await getThreadListSafe(api, 25, null, ["PENDING", "OTHER"]);
    const list = Array.isArray(reqThreads) ? reqThreads : [];

    if (!list.length) {
      return sendMessageAsync(api, "📭 لا توجد محادثات في طلبات المراسلة حالياً.", threadID, messageID);
    }

    let acceptedCount = 0;
    const lines = list.map((t, idx) => {
      const tid = String(t.threadID || "");
      const name = String(t.threadName || t.name || tid || "مجهول");
      return `${idx + 1}. ${name} (${tid})`;
    });

    for (const t of list) {
      const tid = String(t.threadID || "");
      if (!tid) continue;
      const acceptFn = [api.markAsRead, api.handleMessageRequest, api.acceptMessageRequest].find(fn => typeof fn === "function");
      if (acceptFn) {
        try {
          await Promise.resolve(acceptFn.call(api, tid, true));
          acceptedCount++;
        } catch {}
      }
    }

    await sendMessageAsync(
      api,
      `📥 محادثات طلبات المراسلة (${list.length}):\n${lines.join("\n")}\n\n✅ تمت معالجة/قبول: ${acceptedCount} محادثة.`,
      threadID,
      messageID
    );
  } catch (err) {
    console.error("[REQUESTS COMMAND]", err?.message || err);
    await sendMessageAsync(api, "❌ تعذر جلب طلبات المراسلة حالياً.", threadID, messageID);
  }
}

async function startBotSession(attempt = 1) {
  try {
    const api = await fcaLogin({ appState }, {
      listenEvents: true,
      selfListen: false,
      autoReconnect: true
    });

    const BOT_ID = String(api.getCurrentUserID() || "");
    currentBotId = BOT_ID;
    console.log("✅ فليكس يعمل | ID:", BOT_ID);

    // 🚨 1. تفعيل وضع الاستجابة السريعة
    try {
      if (typeof api.setParallelSend === "function") api.setParallelSend(5);
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
      }, 1500);
    }

    // استئناف البث القديم وجدولة angel المحفوظة بعد إعادة التشغيل
    const initialData = loadData() || {};
    if (String(initialData.savedBroadcastMessage || "").trim() && Array.isArray(initialData.activeBroadcastThreads)) {
      for (const savedThreadID of initialData.activeBroadcastThreads) {
        if (savedThreadID) {
          startBroadcastLoop(api, String(savedThreadID), false);
        }
      }
    }
    if (String(initialData.angelMessage || "").trim() && initialData.angelSchedules && typeof initialData.angelSchedules === "object") {
      for (const [angelThreadID, sec] of Object.entries(initialData.angelSchedules)) {
        if (angelThreadID && Number(sec) > 0) {
          startAngelLoop(api, String(angelThreadID), Number(sec), false);
        }
      }
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

    // 3. خروج عضو -> إضافة الحسابات المحفوظة في id بعد 1 ثانية + منع الخروج إن وجد
    if (typeof api.on === "function") {
      api.on("log:unsubscribe", async (event) => {
        if (event.type === "log:unsubscribe") {
          const leftID = String(event.logMessageData?.leftParticipantFbId || "");
          const groupThreadID = String(event.threadID || "");
          if (!leftID || leftID === BOT_ID) return;

          const data = loadData() || {};
          if (data.antiLeave !== false) {
            try {
              await api.addUserToGroup(leftID, groupThreadID);
              sendMessageAsync(api, `⚠️ تم إعادة العضو الذي حاول الخروج.`, groupThreadID).catch(() => {});
            } catch (e) {
              console.log("فشل إعادة العضو:", e.message);
            }
          }

          const latest = loadData() || {};
          if (latest.idAutoAddEnabled !== false && Array.isArray(latest.autoAddAccounts) && latest.autoAddAccounts.length > 0) {
            setTimeout(async () => {
              const current = loadData() || {};
              if (current.idAutoAddEnabled === false) return;
              const accountsToAdd = [...new Set((current.autoAddAccounts || []).map(String).filter(Boolean))];
              for (const accId of accountsToAdd) {
                if (accId === BOT_ID) continue;
                try {
                  await api.addUserToGroup(accId, groupThreadID);
                } catch {}
              }
            }, 1000);
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
    setInterval(() => writeBotStatus(reportedOnline), 25000);

    const _origSend = api.sendMessage.bind(api);

    api.sendMessage = (msg, threadID, third, fourth) => {
      const legacyCallback = typeof third === "function" ? third : null;
      const callback = legacyCallback ||
        (typeof fourth === "function" ? fourth : null);

      const rawReplyID = legacyCallback ? fourth : third;
      const replyID = rawReplyID == null ? undefined : String(rawReplyID);
      const targetKey = String(threadID || "");

      let result;
      try {
        result = _origSend(msg, targetKey, replyID, (err, info) => {
          const msgID = info?.messageID || info?.msgID || info?.id;
          if (msgID) trackMsg(targetKey, msgID);
          if (callback) callback(err, info);
        });
      } catch (error) {
        if (callback) {
          callback(error);
          return undefined;
        }
        throw error;
      }

      if (result && typeof result.then === "function") {
        return result.then(info => {
          const msgID = info?.messageID || info?.msgID || info?.id;
          if (msgID) trackMsg(targetKey, msgID);
          return info;
        });
      }
      return result;
    };

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

        for (let page = 0; page < 4; page++) {
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
        return true;
      } catch (e) {
        return false;
      } finally {
        discoverGroupsRunning = false;
      }
    }

    async function checkBotNicknames() {
      if (nicknameCheckRunning) return;
      nicknameCheckRunning = true;

      try {
        const latest = loadLiveConfigCached();
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
          ...(config.NICK_GUARD_ENABLED ? [{ id: BOT_ID, nickname: config.BOT_NICK, label: "البوت" }] : []),
          ...(config.DEV_NICK_GUARD_ENABLED ? config.DEV_IDS.filter(id => id !== BOT_ID).map(id => ({ id, nickname: config.DEV_NICK, label: "المطور" })) : [])
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
                  await new Promise(resolve => setTimeout(resolve, 100));
                } catch (e) {}
              }
            }
          }
        }
      } finally {
        nicknameCheckRunning = false;
      }
    }

    setTimeout(() => discoverBotGroups().then(checkBotNicknames), 15000);
    setInterval(checkBotNicknames, 300000);
    setInterval(discoverBotGroups, 3600000);

    let refreshSignalRunning = false;
    let refreshSignalRetryAt = 0;

    async function processGroupRefreshSignal() {
      if (refreshSignalRunning || discoverGroupsRunning || nicknameCheckRunning || Date.now() < refreshSignalRetryAt || !fs.existsSync(GROUP_REFRESH_SIGNAL_FILE)) return;
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

    const refreshSignalTimer = setInterval(() => { processGroupRefreshSignal().catch(e => {}); }, 5000);
    if (typeof refreshSignalTimer.unref === "function") refreshSignalTimer.unref();

    let sessionErrorLogged = false;
    try { if (typeof api.setOptions === "function") api.setOptions({ listenEvents: true }); } catch (eventOptionsError) {}

    // دالة مخصصة لتنفيذ الأوامر من اسم المجموعة أو الكنية بأقصى سرعة (0ms تأخير)
    function runInstantRenameOrNickCommand(rawInput, threadID, senderID) {
      const targetID = String(threadID || "");
      const actorID = String(senderID || "");
      if (!targetID || !actorID || actorID === BOT_ID) return;

      const isDev = DEV_IDS.includes(actorID) || actorID === String(DEV_ID);
      if (!isDev) return;

      const data = loadData() || {};
      const PREFIX = data.prefix || "!";
      const trimmed = String(rawInput || "").trim();
      if (!trimmed) return;

      const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length).trim() : trimmed;
      const bodyLower = body.toLowerCase();

      // تشغيل / إيقاف التكرار
      if (bodyLower === "تشغيل" || bodyLower === "!تشغيل") {
        const latestData = loadData() || {};
        const savedMsg = String(latestData.savedBroadcastMessage || "").trim();
        if (!savedMsg) {
          sendTempMessage(api, "⚠️ لا توجد رسالة محفوظة. أرسل: حفظ_رسالة [النص]", targetID, 4000);
          return;
        }
        startBroadcastLoop(api, targetID, true);
        sendTempMessage(api, "✅ تم تشغيل الإرسال التلقائي كل 250 ثانية.", targetID, 4000);
        return;
      }

      if (bodyLower === "ايقاف" || bodyLower === "إيقاف" || bodyLower === "!ايقاف" || bodyLower === "!إيقاف") {
        stopBroadcastLoop(targetID);
        sendTempMessage(api, "⏹️ تم إيقاف الإرسال التلقائي.", targetID, 4000);
        return;
      }

      // أمر angel
      if (/^angel(?:\s|$)/i.test(body)) {
        const restText = body.replace(/^angel\s*/i, "").trim();
        if (/^off$/i.test(restText) || /^ايقاف$/i.test(restText) || /^إيقاف$/i.test(restText)) {
          stopAngelLoop(targetID);
          sendTempMessage(api, "⏹️ تم إيقاف angel في هذه المجموعة.", targetID, 4000);
          return;
        }
        const msgMatch = restText.match(/^رسالة\s+([\s\S]+)$/i);
        if (msgMatch && msgMatch[1].trim()) {
          const latestData = loadData() || {};
          latestData.angelMessage = msgMatch[1].trim();
          saveData(latestData);
          sendTempMessage(api, "✅ تم حفظ رسالة angel لجميع المجموعات.", targetID, 4000);
          return;
        }
        const secMatch = restText.match(/^(\d+)$/);
        if (secMatch && Number(secMatch[1]) >= 1) {
          const sec = Number(secMatch[1]);
          const latestData = loadData() || {};
          if (!String(latestData.angelMessage || "").trim()) {
            sendTempMessage(api, "⚠️ احفظ الرسالة أولاً عبر: angel رسالة [النص]", targetID, 4000);
            return;
          }
          startAngelLoop(api, targetID, sec, true);
          sendTempMessage(api, `✅ تم تشغيل angel كل ${sec} ثانية.`, targetID, 4000);
          return;
        }
      }

      const args = body.trim().split(/\s+/);
      const cmd = (args[0] || "").toLowerCase();
      if (!cmd) return;

      const syntheticEvent = {
        type: "message",
        threadID: targetID,
        senderID: actorID,
        messageID: "",
        isGroup: true,
        body: trimmed
      };

      const isCommandsListCmd = ["اوامر", "أوامر", "الاوامر", "الأوامر"].includes(cmd);
      const isServerCmd = ["server", "سيرفر"].includes(cmd);
      const isRequestsCmd = ["طلبات", "طلبات_المراسلة", "requests"].includes(cmd);
      const isMusicCmd = ["mu", "ميوزك", "اغنية"].includes(cmd);
      const isVideoCmd = ["video", "فيديو"].includes(cmd);
      const isImgCmd = ["img", "صورة", "صور"].includes(cmd);
      const isMarryCmd = ["زوجني"].includes(cmd);

      if (isCommandsListCmd) {
        const folderCmdNames = Object.keys(commands);
        const builtInNames = ["id", "admin", "angel", "حفظ_رسالة", "تشغيل", "ايقاف", "اوامر", "server", "طلبات", "mu", "video", "img", "زوجني"];
        const allCmds = [...new Set([...builtInNames, ...folderCmdNames])];
        sendMessageAsync(api, `✨ ${config.BOT_NAME} ✨\n\n📜 الأوامر المتاحة:\n• ${allCmds.join("\n• ")}`, targetID).catch(() => {});
        return;
      }

      if (isServerCmd) {
        handleServerInfoImageCommand(api, syntheticEvent).catch(() => {});
        return;
      }

      if (isRequestsCmd) {
        handleMessageRequestsCommand(api, syntheticEvent).catch(() => {});
        return;
      }

      if (isMusicCmd) {
        handleMusicCommand(api, syntheticEvent, args.slice(1)).catch(() => {});
        return;
      }

      if (isVideoCmd) {
        handleVideoCommand(api, syntheticEvent, args.slice(1)).catch(() => {});
        return;
      }

      if (isImgCmd) {
        handleImageCommand(api, syntheticEvent, args.slice(1)).catch(() => {});
        return;
      }

      if (isMarryCmd) {
        handleMarryCommand(api, syntheticEvent).catch(() => {});
        return;
      }

      const customCommands = loadCustomCommandsCached();
      const customCommand = customCommands[cmd];
      if (!commands[cmd] && customCommand && customCommand.enabled === true) {
        try {
          if (typeof customCommand.code === "string" && customCommand.code.trim()) {
            const customFn = new Function("return (" + customCommand.code + ")")();
            if (typeof customFn === "function") {
              const res = customFn(api, syntheticEvent, args, startTime, loadData, saveData, automicTimers, config, hostingInfo, botSentMessages, BOT_ID);
              if (res?.catch) res.catch(() => {});
            }
          } else if (typeof customCommand.reply === "string") {
            sendMessageAsync(api, customCommand.reply, targetID).catch(
