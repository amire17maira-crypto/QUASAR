"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const activity = require("./telegram-activity");
const { Bot } = require("node-telegram-bot-api");

const ROOT = __dirname;

const ENV_FILE = path.join(ROOT, ".telegram.env");

try {
  const envText = fs.readFileSync(ENV_FILE, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
    }
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || ROOT);
fs.mkdirSync(DATA_DIR, { recursive: true });
const AUTH_FILE = path.join(DATA_DIR, "telegram-auth.json");
const SECRET_FILE = path.join(DATA_DIR, ".telegram-secret");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const OWNER_ID = String(process.env.TELEGRAM_OWNER_ID || "");
const PANEL_PORT = Number(process.env.PANEL_PORT || 3001);

if (!TOKEN || !/^\d+$/.test(OWNER_ID)) {
  console.error("يلزم إعداد TELEGRAM_BOT_TOKEN و TELEGRAM_OWNER_ID");
  process.exit(1);
}

let INTERNAL_SECRET;
try {
  INTERNAL_SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim();
} catch {
  console.error("ملف المفتاح الداخلي غير موجود");
  process.exit(1);
}
if (!/^[a-f0-9]{96}$/i.test(INTERNAL_SECRET)) {
  console.error("المفتاح الداخلي غير صالح");
  process.exit(1);
}

function readAuth() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (data.version === 1) return data;
  } catch {}
  return { version: 1, password: null, developers: [] };
}

let authData = readAuth();

function saveAuth() {
  const temp = AUTH_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(authData, null, 2), { mode: 0o600 });
  fs.renameSync(temp, AUTH_FILE);
  try { fs.chmodSync(AUTH_FILE, 0o600); } catch {}
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64);
}

function setPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt).toString("hex");
  authData.password = { salt, hash };
  saveAuth();
}

function checkPassword(password) {
  if (!authData.password) return false;
  const { salt, hash } = authData.password;
  const actual = hashPassword(password, salt);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected);
}

function isOwner(id) {
  return String(id) === OWNER_ID;
}

function isDeveloper(id) {
  return isOwner(id) || authData.developers.includes(String(id));
}

function privateChat(ctx) {
  return ctx.chatId !== undefined &&
    ctx.message?.chat?.type === "private";
}

const attempts = new Map();

function limited(id) {
  const now = Date.now();
  const item = attempts.get(String(id)) || { count: 0, until: now };
  if (now > item.until) {
    item.count = 0;
    item.until = now + 60000;
  }
  item.count++;
  attempts.set(String(id), item);
  return item.count > 5;
}

function panelRequest(route, method = "GET", payload) {
  return new Promise((resolve, reject) => {
    const requestBody = payload === undefined ? null : JSON.stringify(payload);
    const headers = {
      "x-shadow-telegram-secret": INTERNAL_SECRET,
      "content-type": "application/json"
    };

    if (requestBody !== null) {
      headers["content-length"] = Buffer.byteLength(requestBody);
    }

    const req = http.request({
      hostname: "127.0.0.1",
      port: PANEL_PORT,
      path: route,
      method,
      headers,
      timeout: 10000
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          const data = JSON.parse(body || "{}");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(data.error || "خطأ من لوحة التحكم"));
          }
          resolve(data);
        } catch {
          reject(new Error("استجابة غير مفهومة من لوحة التحكم"));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("انتهت مهلة الاتصال")));
    req.on("error", reject);
    req.end(requestBody === null ? undefined : requestBody);
  });
}

const bot = new Bot(TOKEN);

const TELEGRAM_COMMANDS = [
  { command: "menu", description: "فتح لوحة التحكم" },
  { command: "register", description: "تسجيل حساب مطور" },
  { command: "adddev", description: "إضافة مطور فيسبوك" },
  { command: "removedev", description: "إزالة مطور فيسبوك" },
  { command: "fbdevs", description: "عرض مطوري فيسبوك" },
  { command: "setdevnick", description: "تغيير كنية المطور" },
  { command: "setbotnick", description: "تغيير كنية البوت" }
];

fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ commands: TELEGRAM_COMMANDS })
})
.then(async response => {
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.description || "فشل تحديث قائمة الأوامر");
  }
  console.log("Telegram commands menu updated.");
})
.catch(error => console.error("Telegram commands menu error:", error.message));


const pendingSessionUploads = new Map();
const MAX_SESSION_SIZE = 5 * 1024 * 1024;

async function chooseCookieSession(ctx) {
  return ctx.reply("🍪 اختر الجلسة التي تريد رفع ملف الكوكيز إليها:", keyboard([
    [{ text: "الجلسة 1 — المنفذ 3000", callback_data: "cookies:1" }],
    [{ text: "الجلسة 2 — المنفذ 3002", callback_data: "cookies:2" }],
    [{ text: "الجلسة 3 — المنفذ 3003", callback_data: "cookies:3" }],
    [{ text: "↩️ القائمة الرئيسية", callback_data: "menu" }]
  ]));
}

async function receiveSessionDocument(msg, sessionId) {
  const document = msg.document;
  if (!["1", "2", "3"].includes(sessionId)) throw new Error("رقم الجلسة غير صالح");
  if (!document || !/\.json$/i.test(String(document.file_name || ""))) {
    throw new Error("أرسل ملف JSON فقط.");
  }
  if (!document.file_id) throw new Error("تعذر قراءة الملف.");
  if (Number(document.file_size || 0) > MAX_SESSION_SIZE) {
    throw new Error("حجم الملف أكبر من 5 ميجابايت.");
  }

  const file = await bot.api.getFile({ file_id: document.file_id });
  if (!file?.file_path) throw new Error("تعذر الحصول على مسار الملف.");

  const url = "https://api.telegram.org/file/bot" + TOKEN + "/" + file.file_path;
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("فشل تنزيل الملف من Telegram.");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_SESSION_SIZE) {
    throw new Error("حجم الملف غير صالح أو أكبر من 5 ميجابايت.");
  }

  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("محتوى الملف ليس JSON صالحاً.");
  }

  if (!Array.isArray(parsed) || !parsed.length ||
      !parsed.every(item => item && typeof item === "object" &&
        !Array.isArray(item) && typeof item.key === "string" &&
        Object.prototype.hasOwnProperty.call(item, "value"))) {
    throw new Error("تنسيق الملف غير صالح؛ يجب أن يحتوي على key و value.");
  }

  const keys = new Map(parsed.map(item => [item.key, item.value]));
  if (!keys.get("c_user") || !keys.get("xs")) {
    throw new Error("الملف لا يحتوي على c_user و xs.");
  }

  const suffix = sessionId === "1" ? "" : sessionId;
  const target = path.join(DATA_DIR, "appState" + suffix + ".json");
  const temp = target + ".tmp-" + process.pid;

  try {
    if (fs.existsSync(target)) {
      fs.copyFileSync(target, target + ".backup-" + Date.now());
    }
    fs.writeFileSync(temp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
}

function keyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function mainKeyboard() {
  return keyboard([
    [
      { text: "▶️ تشغيل Facebook", callback_data: "start" },
      { text: "⏹ إيقاف Facebook", callback_data: "stop" }
    ],
    [
      { text: "🔄 إعادة التشغيل", callback_data: "restart" },
      { text: "📡 حالة البوت", callback_data: "status" }
    ],
    [
      { text: "📊 الإحصائيات", callback_data: "stats" },
      { text: "📜 السجلات", callback_data: "logs" }
    ],
    [{ text: "🍪 رفع كوكيز", callback_data: "upload_cookies" }],
    [
      { text: "👥 المطورون", callback_data: "developers" },
      { text: "🛰️ المراقبة المباشرة", callback_data: "monitor" },
      { text: "👤 إدارة المستخدمين", callback_data: "users" },
      { text: "ℹ️ المساعدة", callback_data: "help" }
    ]
  ]);
}

async function showMenu(ctx) {
  return ctx.reply(
    "🌷 SHADOW CONTROL\n\nاختر العملية التي تريد تنفيذها:",
    mainKeyboard()
  );
}

function duration(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = seconds % 60;
  return `${d} يوم، ${h} ساعة، ${m} دقيقة، ${s} ثانية`;
}

function statsText(s, title) {
  return [
    `📊 إحصائيات ${title}`,
    "",
    `✉️ إجمالي الرسائل: ${s.messages || 0}`,
    `👥 رسائل المجموعات: ${s.groupMessages || 0}`,
    `💬 رسائل الخاص: ${s.privateMessages || 0}`,
    `👤 المستخدمون النشطون: ${s.activeUsers || 0}`,
    `🏘 المجموعات النشطة: ${s.activeGroups || 0}`,
    `⚙️ استخدام الأوامر: ${s.commands || 0}`,
    `❌ أخطاء الأوامر: ${s.commandErrors || 0}`,
    `🚫 أوامر غير مصرح بها: ${s.unauthorizedCommands || 0}`,
    "",
    "🏆 أكثر الأوامر استخداماً:",
    ...(s.topCommands || []).slice(0, 7).map(
      x => `• ${x.name}: ${x.count}`
    )
  ].join("\n");
}

async function showStats(ctx) {
  const periods = [
    [{ text: "اليوم", callback_data: "period:day" },
     { text: "الأسبوع", callback_data: "period:week" }],
    [{ text: "الشهر", callback_data: "period:month" },
     { text: "الإجمالي", callback_data: "period:all" }],
    [{ text: "⬅️ القائمة", callback_data: "menu" }]
  ];
  await ctx.reply("اختر فترة الإحصائيات:", keyboard(periods));
}

async function sendPeriod(ctx, period) {
  const summary = await panelRequest("/internal/telegram/stats/" + period);
  const labels = {
    day: "اليوم", week: "الأسبوع", month: "الشهر", all: "الإجمالي"
  };
  await ctx.reply(statsText(summary, labels[period]));
}

async function showStatus(ctx) {
  const p = await panelRequest("/internal/telegram/process");
  await ctx.reply([
    "📡 حالة بوت Facebook",
    "",
    `الحالة: ${p.running ? "🟢 يعمل" : "🔴 متوقف"}`,
    `معرّف العملية: ${p.pid || "—"}`,
    `مدة التشغيل: ${duration(p.uptimeSeconds)}`,
    `معرّف الجلسة: ${p.sessionId}`,
    `المنفذ: ${p.port}`
  ].join("\n"));
}

async function showLogs(ctx) {
  const result = await panelRequest("/internal/telegram/logs");
  const logs = result.logs || [];
  if (!logs.length) return ctx.reply("لا توجد سجلات حالياً.");
  const output = logs.slice(-15).map(x =>
    `[${String(x.time || "").replace("T", " ").slice(0, 19)}] ${x.text}`
  ).join("\n");
  await ctx.reply("📜 آخر السجلات:\n\n" + output.slice(-3800));
}

async function showDevelopers(ctx) {
  const lines = authData.developers.map((id, i) => `${i + 1}. ${id}`);
  await ctx.reply(
    "👥 المطورون المسجلون:\n\n" +
    (lines.join("\n") || "لا يوجد مطورون إضافيون.") +
    (isOwner(ctx.from.id)
      ? "\n\nإدارة المطورين: /remove ID\nتغيير كلمة التسجيل: /setpassword كلمة_جديدة"
      : "")
  );
}

async function chooseSession(ctx, name) {
  const ports = { "1": 3000, "2": 3002, "3": 3003 };
  const rows = [];

  for (const id of ["1", "2", "3"]) {
    let running = false;
    try {
      const info = await panelRequest("/internal/telegram/process/" + id);
      running = info.running;
    } catch {}

    rows.push([{
      text: (running ? "🟢 " : "⚫ ") +
        "الجلسة " + id + " — المنفذ " + ports[id],
      callback_data: "session:" + name + ":" + id
    }]);
  }

  rows.push([{ text: "↩️ القائمة الرئيسية", callback_data: "menu" }]);

  const labels = {
    start: "تشغيل",
    stop: "إيقاف",
    restart: "إعادة تشغيل"
  };

  return ctx.reply(
    "اختر الجلسة التي تريد " + labels[name] +
    ":\n🟢 تعمل   ⚫ متوقفة",
    keyboard(rows)
  );
}

async function action(ctx, name, id) {
  const ports = { "1": 3000, "2": 3002, "3": 3003 };
  const labels = {
    start: "تشغيل",
    stop: "إيقاف",
    restart: "إعادة تشغيل"
  };

  const result = await panelRequest(
    "/internal/telegram/" + name + "/" + id,
    "POST"
  );

  if (name === "start") {
    return ctx.reply(result.ok
      ? "✅ تم إرسال طلب تشغيل الجلسة " + id +
        " على المنفذ " + ports[id] + ". PID: " + result.pid
      : "❌ تعذر تشغيل الجلسة " + id);
  }

  if (name === "stop") {
    return ctx.reply(result.stopped
      ? "✅ تم إيقاف الجلسة " + id + " على المنفذ " + ports[id]
      : "ℹ️ الجلسة " + id + " لم تكن تعمل.");
  }

  return ctx.reply(result.ok
    ? "✅ تمت إعادة تشغيل الجلسة " + id +
      " على المنفذ " + ports[id] + ". PID: " + result.pid
    : "❌ تعذرت إعادة تشغيل الجلسة " + id);
}

bot.command("start", async ctx => {
  if (!privateChat(ctx)) return;
  await ctx.reply(
    "مرحباً بك في SHADOW CONTROL.\nللتسجيل كمطور أرسل:\n/register كلمة_المرور"
  );
});

bot.command("register", async ctx => {
  if (!privateChat(ctx)) return;
  const id = String(ctx.from.id);
  const password = String(ctx.match || "").trim();

  try { await bot.api.deleteMessage({
    chat_id: ctx.chatId,
    message_id: ctx.message.message_id
  }); } catch {}

  if (isDeveloper(id)) return ctx.reply("أنت مسجل بالفعل.");
  if (limited(id)) return ctx.reply("محاولات كثيرة. انتظر دقيقة.");
  if (!password || password.length > 200) {
    return ctx.reply("صيغة التسجيل: /register كلمة_المرور");
  }
  if (!checkPassword(password)) {
    return ctx.reply("كلمة التسجيل غير صحيحة.");
  }

  authData.developers.push(id);
  saveAuth();
  return ctx.reply("✅ تم تسجيلك كمطور. أرسل /menu لفتح لوحة التحكم.");
});

bot.command("menu", async ctx => {
  if (!privateChat(ctx)) return;
  if (!isDeveloper(ctx.from.id)) {
    return ctx.reply("غير مصرح. سجّل أولاً باستخدام /register.");
  }
  await showMenu(ctx);
});

bot.command("remove", async ctx => {
  if (!privateChat(ctx) || !isOwner(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط.");
  }
  const id = String(ctx.match || "").trim();
  if (!/^\d+$/.test(id) || id === OWNER_ID) {
    return ctx.reply("استخدم: /remove TELEGRAM_ID");
  }
  authData.developers = authData.developers.filter(x => x !== id);
  saveAuth();
  return ctx.reply("تم تحديث قائمة المطورين.");
});

bot.command("setpassword", async ctx => {
  if (!privateChat(ctx) || !isOwner(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط.");
  }
  const password = String(ctx.match || "").trim();
  try { await bot.api.deleteMessage({
    chat_id: ctx.chatId,
    message_id: ctx.message.message_id
  }); } catch {}
  if (password.length < 10 || password.length > 200) {
    return ctx.reply("كلمة المرور يجب أن تكون بين 10 و200 حرف.");
  }
  setPassword(password);
  return ctx.reply("✅ تم تغيير كلمة تسجيل المطورين.");
});



bot.command("adddev", async ctx => {
  if (!privateChat(ctx) || !isDeveloper(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط وفي المحادثة الخاصة.");
  }

  const id = String(ctx.match || "").trim();
  if (!/^\d{5,25}$/.test(id)) {
    return ctx.reply("الاستخدام الصحيح:\n/adddev FACEBOOK_ID");
  }

  try {
    const result = await panelRequest(
      "/internal/telegram/facebook-developers",
      "POST",
      { id }
    );

    return ctx.reply(result.added
      ? "✅ تمت إضافة المطور إلى بوت فيسبوك.\n🆔 " + id
      : "ℹ️ هذا المعرف مسجل بالفعل كمطور.");
  } catch (error) {
    return ctx.reply("❌ تعذرت إضافة المطور: " + error.message);
  }
});


bot.command("removedev", async ctx => {
  if (!privateChat(ctx) || !isDeveloper(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط وفي المحادثة الخاصة.");
  }

  const id = String(ctx.match || "").trim();
  if (!/^\d{5,25}$/.test(id)) {
    return ctx.reply("الاستخدام الصحيح:\n/removedev FACEBOOK_ID");
  }

  try {
    const result = await panelRequest(
      "/internal/telegram/facebook-developers",
      "DELETE",
      { id }
    );

    return ctx.reply(
      "✅ تمت إزالة المطور بنجاح.\n🆔 " + id +
      "\n👥 عدد المطورين المتبقين: " + result.ids.length
    );
  } catch (error) {
    return ctx.reply("❌ تعذرت إزالة المطور: " + error.message);
  }
});

bot.command("fbdevs", async ctx => {
  if (!privateChat(ctx) || !isDeveloper(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط.");
  }

  try {
    const result = await panelRequest("/internal/telegram/facebook-developers");
    const ids = result.ids || [];
    return ctx.reply(
      "👥 مطورو بوت فيسبوك:\n\n" +
      (ids.length ? ids.map((id, i) => `${i + 1}. ${id}`).join("\n") : "لا يوجد مطورون.")
    );
  } catch (error) {
    return ctx.reply("❌ تعذر جلب المطورين: " + error.message);
  }
});

bot.command("setdevnick", async ctx => {
  if (!privateChat(ctx) || !isDeveloper(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط.");
  }

  const nickname = String(ctx.match || "").trim();
  if (!nickname || nickname.length > 80) {
    return ctx.reply("الاستخدام:\n/setdevnick الكنية الجديدة");
  }

  try {
    await panelRequest(
      "/internal/telegram/developer-nickname",
      "PUT",
      { nickname }
    );
    return ctx.reply("✅ تم تغيير كنية المطورين.");
  } catch (error) {
    return ctx.reply("❌ تعذر تغيير الكنية: " + error.message);
  }
});

bot.command("setbotnick", async ctx => {
  if (!privateChat(ctx) || !isDeveloper(ctx.from.id)) {
    return ctx.reply("هذا الأمر متاح للمالك فقط.");
  }

  const nickname = String(ctx.match || "").trim();
  if (!nickname || nickname.length > 80) {
    return ctx.reply("الاستخدام:\n/setbotnick الكنية الجديدة");
  }

  try {
    await panelRequest(
      "/internal/telegram/bot-nickname",
      "PUT",
      { nickname }
    );
    return ctx.reply("✅ تم تغيير كنية البوت.");
  } catch (error) {
    return ctx.reply("❌ تعذر تغيير الكنية: " + error.message);
  }
});


function showMonitor(ctx) {
  const snap = activity.snapshot();
  const events = snap.users.flatMap(u =>
    u.recent.map(e => ({
      id: u.id, username: u.username, name: u.firstName,
      action: e.action, time: e.time
    }))
  ).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 15);

  const lines = [
    "🛰️ المراقبة المباشرة",
    "👥 إجمالي المستخدمين: " + snap.totalUsers,
    "🟢 النشطون آخر 24 ساعة: " + snap.activeToday,
    "⚡ إجمالي التفاعلات: " + snap.totalInteractions,
    "",
    "آخر التفاعلات:"
  ];

  for (const e of events) {
    const who = e.username ? "@" + e.username : (e.name || e.id);
    lines.push("• " + who + " [" + e.id + "]");
    lines.push("  " + e.action + " — " + new Date(e.time).toLocaleString("ar-EG"));
  }

  if (!events.length) lines.push("لا توجد تفاعلات مسجلة بعد.");
  return ctx.reply(lines.join("\n"), keyboard([
    [{ text: "🔄 تحديث", callback_data: "monitor" }],
    [{ text: "👤 إدارة المستخدمين", callback_data: "users" }],
    [{ text: "↩️ القائمة", callback_data: "menu" }]
  ]));
}

function showUsers(ctx) {
  const users = activity.list().slice(0, 20);
  const rows = users.map(u => [{
    text: (u.firstName || u.username || u.id) + " — " + u.interactions + " تفاعل",
    callback_data: "user:" + u.id
  }]);

  rows.push([{ text: "🔄 تحديث", callback_data: "users" }]);
  rows.push([{ text: "↩️ القائمة", callback_data: "menu" }]);

  return ctx.reply(
    "👤 إدارة المستخدمين\nعدد المستخدمين: " + activity.snapshot().totalUsers +
    "\nاختر مستخدمًا لعرض تفاصيل نشاطه:",
    keyboard(rows)
  );
}

function showUser(ctx, id) {
  const u = activity.get(id);
  if (!u) return ctx.reply("المستخدم غير موجود في سجل النشاط.");

  const lines = [
    "👤 تفاصيل المستخدم",
    "🆔 المعرف: " + u.id,
    "الاسم: " + (u.firstName || "غير متوفر"),
    "اسم المستخدم: " + (u.username ? "@" + u.username : "غير متوفر"),
    "عدد التفاعلات: " + u.interactions,
    "أول ظهور: " + new Date(u.firstSeen).toLocaleString("ar-EG"),
    "آخر ظهور: " + new Date(u.lastSeen).toLocaleString("ar-EG"),
    "",
    "آخر الأنشطة:"
  ];

  for (const e of u.recent.slice(-15).reverse()) {
    lines.push("• " + e.action + " — " + new Date(e.time).toLocaleString("ar-EG"));
  }

  return ctx.reply(lines.join("\n"), keyboard([
    [{ text: "↩️ قائمة المستخدمين", callback_data: "users" }],
    [{ text: "🏠 القائمة الرئيسية", callback_data: "menu" }]
  ]));
}

bot.on("message", async ctx => {
  const msg = ctx.message;
  if (!msg?.from || msg.chat?.type !== "private") return;

  const userId = String(msg.from.id);
  const sessionId = pendingSessionUploads.get(userId);

  if (msg.document && sessionId) {
    pendingSessionUploads.delete(userId);
    if (!isDeveloper(userId)) {
      return ctx.reply("غير مصرح لك باستخدام لوحة التحكم.");
    }

    try {
      await receiveSessionDocument(msg, sessionId);
      try {
        await bot.api.deleteMessage({
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } catch {}
      try { activity.record(msg.from, "رفع ملف جلسة " + sessionId); } catch {}
      return ctx.reply("✅ تم حفظ ملف الجلسة " + sessionId + " بنجاح. لم يتم تشغيلها تلقائياً.");
    } catch (error) {
      console.error("Session upload error:", error.message);
      return ctx.reply("❌ تعذر رفع الملف: " + error.message);
    }
  }

  const text = String(msg.text || "");
  const action = text.startsWith("/")
    ? "أمر " + text.split(/\\s+/)[0].split("@")[0]
    : "رسالة نصية";
  try {
    activity.record(msg.from, action);
  } catch (e) {
    console.error("Activity log:", e.message);
  }
});

bot.on("callback_query", async ctx => {
  const query = ctx.callbackQuery;
  const id = String(query.from.id);
  const data = String(query.data || "");
    try { activity.record(query.from, "زر " + data); } catch (e) { console.error("Activity log:", e.message); }

  try {
    await ctx.answerCallbackQuery();
    if (!isDeveloper(id)) {
      return ctx.reply("غير مصرح لك باستخدام لوحة التحكم.");
    }
    if (query.message?.chat?.type !== "private") return;
    try {
      if (query.message?.message_id) {
        await bot.api.deleteMessage({
          chat_id: query.message.chat.id,
          message_id: query.message.message_id
        });
      }
    } catch {}


    if (data === "menu") return showMenu(ctx);
    if (data === "upload_cookies") return chooseCookieSession(ctx);
    if (data.startsWith("cookies:")) {
      const sessionId = data.slice(8);
      if (!["1", "2", "3"].includes(sessionId)) return;
      pendingSessionUploads.set(id, sessionId);
      return ctx.reply(
        "📎 أرسل ملف JSON للجلسة " + sessionId +
        "\\nالحد الأقصى 5 ميجابايت. سيتم التحقق من الملف قبل حفظه."
      );
    }
    if (data === "help") {
      return ctx.reply(
        "الأوامر:\n/start - البداية\n/register - تسجيل مطور\n/menu - لوحة التحكم\n\nإدارة المطورين متاحة للمالك فقط."
      );
    }
    if (data === "status") return showStatus(ctx);
    if (data === "logs") return showLogs(ctx);
    if (data === "stats") return showStats(ctx);
    if (data === "developers") return showDevelopers(ctx);
    if (data === "monitor") return showMonitor(ctx);
    if (data === "users") return showUsers(ctx);
    if (data.startsWith("user:")) return showUser(ctx, data.slice(5));

    if (data.startsWith("period:")) {
      const period = data.slice(7);
      if (!["day", "week", "month", "all"].includes(period)) return;
      return sendPeriod(ctx, period);
    }

    if (["start", "stop", "restart"].includes(data)) {
      return chooseSession(ctx, data);
    }

    if (data.startsWith("session:")) {
      const parts = data.split(":");
      const name = parts[1];
      const sessionId = parts[2];
      if (!["start", "stop", "restart"].includes(name)) return;
      if (!["1", "2", "3"].includes(sessionId)) return;
      return action(ctx, name, sessionId);
    }
  } catch (error) {
    console.error("Callback error:", error.message);
    try { await ctx.reply("حدث خطأ: " + error.message); } catch {}
  }
});

bot.catch(error => {
  console.error("Telegram update error:", error?.message || error);
});

async function main() {
  if (!authData.password) {
    const initial = process.env.TELEGRAM_DEV_PASSWORD || "";
    if (initial.length < 10) {
      console.error("عيّن TELEGRAM_DEV_PASSWORD بطول 10 أحرف على الأقل لأول تشغيل.");
      process.exit(1);
    }
    setPassword(initial);
  }

  console.log("SHADOW TELEGRAM CONTROL: starting...");
  await bot.startPolling();
}

main().catch(error => {
  console.error("Telegram startup failed:", error.message);
  process.exitCode = 1;
});
