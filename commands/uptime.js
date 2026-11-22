"use strict";

const command = async (
  api,
  event,
  args,
  startTime,
  loadData,
  saveData,
  automicTimers,
  config,
  hostingInfo,
  botSentMessages,
  BOT_ID,
  builtInCommands,
  customCommandNames
) => {
  try {
    // قراءة بيانات البوت
    let data = {};

    try {
      data = typeof loadData === "function" ? (loadData() || {}) : {};
    } catch (_) {
      data = {};
    }

    // حساب مدة التشغيل
    const startedAt = Number(startTime);

    const elapsed = startedAt > 0
      ? Math.max(0, Date.now() - startedAt)
      : Math.max(0, process.uptime() * 1000);

    let totalSeconds = Math.floor(elapsed / 1000);

    const days = Math.floor(totalSeconds / 86400);
    totalSeconds %= 86400;

    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    // البادئة
    const prefix =
      typeof data.prefix === "string" && data.prefix.trim()
        ? data.prefix.trim()
        : "!";

    // تحديد الاستضافة تلقائياً
    let hosting = "";

    if (
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_DEPLOYMENT_ID
    ) {
      hosting = "Railway";
    } else if (
      process.env.RENDER ||
      process.env.RENDER_SERVICE_ID
    ) {
      hosting = "Render";
    } else if (process.env.HEROKU_APP_NAME) {
      hosting = "Heroku";
    } else if (
      process.env.VERCEL ||
      process.env.VERCEL_ENV
    ) {
      hosting = "Vercel";
    } else if (
      process.env.TERMUX_VERSION ||
      (process.env.PREFIX || "").includes("com.termux")
    ) {
      hosting = "Termux";
    } else if (hostingInfo && typeof hostingInfo === "object") {
      const detected =
        hostingInfo.provider ||
        hostingInfo.hosting ||
        hostingInfo.name;

      if (typeof detected === "string" && detected.trim()) {
        hosting = detected.trim();
      }
    }

    // الاسم الافتراضي عند تعذر تحديد الاستضافة
    if (!hosting) {
      hosting = "QUASAR v. 28";
    }

    const message = [
      "⏳ UPTIME・وقت التشغيل",
      "",
      `📅 Days・الأيام: ${days}`,
      `🕒 Hours・الساعات: ${hours}`,
      `⏱️ Minutes・الدقائق: ${minutes}`,
      `⌛ Seconds・الثواني: ${seconds}`,
      "",
      "⚡ Status・الحالة: Online",
      `🔰 Prefix・البادئة: ${prefix}`,
      `🖥️ Hosting・الاستضافة: ${hosting}`,
      "🌐 Connection・الاتصال: Stable",
      "",
      "⌁ Powered by QUASAR 📡"
    ].join("\n");

    return api.sendMessage(message, event.threadID);
  } catch (error) {
    console.error("[UPTIME ERROR]", error);

    return api.sendMessage(
      "❌ حدث خطأ أثناء عرض وقت تشغيل QUASAR.",
      event.threadID
    );
  }
};

command.aliases = ["ابتايم"];

module.exports = command;
