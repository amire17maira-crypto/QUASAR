"use strict";

const net = require("net");
const os = require("os");

const SESSION_PORTS = {
  1: 3000,
  2: 3002,
  3: 3003
};

function checkPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port
    });

    let finished = false;

    const finish = result => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function formatDuration(seconds) {
  seconds = Math.floor(seconds);

  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return [
    d ? `${d} يوم` : "",
    h ? `${h} ساعة` : "",
    m ? `${m} دقيقة` : "",
    `${s} ثانية`
  ].filter(Boolean).join(" و ");
}

function gb(bytes) {
  return (bytes / 1024 ** 3).toFixed(2) + " GB";
}

module.exports = async (api, event) => {
  try {
    const currentSession = Number(process.env.SHADOW_SESSION_ID || 1);

    const sessions = await Promise.all(
      Object.entries(SESSION_PORTS).map(async ([id, port]) => ({
        id: Number(id),
        port,
        online: await checkPort(port)
      }))
    );

    const onlineCount = sessions.filter(s => s.online).length;
    const lines = [
      "╔════════════════════════════╗",
      "       ⚛️ QUASAR SYSTEM",
      "╚════════════════════════════╝",
      "",
      "📡 SERVER MONITOR",
      `🖥️ عدد الجلسات: ${sessions.length}`,
      `🟢 الجلسات المتصلة: ${onlineCount}`,
      `🔴 الجلسات المتوقفة: ${sessions.length - onlineCount}`,
      "",
      "╭────〔 SESSION STATUS 〕────╮"
    ];

    for (const session of sessions) {
      lines.push(
        `${session.online ? "🟢" : "🔴"} الجلسة ${session.id}`,
        `   📡 Port: ${session.port}`,
        `   ⚙️ الحالة: ${session.online ? "الخدمة تستجيب" : "الخدمة لا تستجيب"}`
      );
    }

    lines.push(
      "╰──────────────────────────╯",
      "",
      "⚙️ CURRENT SESSION",
      `🔹 الجلسة الحالية: ${currentSession}`,
      `⏱️ مدة تشغيل البوت الحالي: ${formatDuration(process.uptime())}`,
      "",
      "🖥️ SERVER INFORMATION",
      `⚡ Node.js: ${process.version}`,
      `📱 النظام: ${os.platform()} ${os.arch()}`,
      `💾 الذاكرة الكلية: ${gb(os.totalmem())}`,
      `🧠 الذاكرة المتاحة: ${gb(os.freemem())}`,
      `📊 استهلاك ذاكرة البوت: ${(process.memoryUsage().rss / 1048576).toFixed(1)} MB`,
      "",
      "🛡️ QUASAR SYSTEM",
      "⚛️ SESSION MANAGEMENT",
      "📡 LIVE PORT MONITOR",
      "",
      "╔════════════════════════════╗",
      "       QUASAR • DEVIL SHADOW",
      "╚════════════════════════════╝"
    );

    return api.sendMessage(lines.join("\n"), event.threadID);
  } catch (error) {
    console.error("QUASAR SESSION ERROR:", error);
    return api.sendMessage(
      "❌ تعذر الحصول على معلومات السيرفر.",
      event.threadID
    );
  }
};
