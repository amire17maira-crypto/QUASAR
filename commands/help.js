"use strict";

const sections = [
  ["🛡️ إدارة المجموعة", [
    ["اسم", "nm", "🏷️"],
    ["كنيات", "nik", "👥"],
    ["خروج", null, "🚪"],
    ["حذف", null, "🗑️"]
  ]],
  ["🔁 أنظمة التكرار", [
    ["بيس", null, "⚡"],
    ["محرك", null, "🚀"]
  ]],
  ["👤 حساب البوت", [
    ["setbio", "بايو", "🪪"]
  ]],
  ["🧰 أدوات النظام", [
    ["command", "cmd", "🔧"],
    ["uptime", "ابتايم", "⏱️"],
    ["help", null, "📖"]
  ]]
];

module.exports = (api, event, _args, _startTime, loadData,
  _saveData, _timers, _config, _hosting, _sent, _botID,
  builtInCommands = [], customCommandNames = []) => {
  const prefix = String((loadData() || {}).prefix || "!");
  const available = new Set([...builtInCommands, ...customCommandNames].map(String));
  const shown = new Set();
  const output = [
    "🌌✨━━━━━━━━━━ ⚛️ QUASAR × SHADOW ⚛️ ━━━━━━━━━━✨🌌",
    "             📜 قَائِمَةُ الأَوَامِر 📜",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  ];

  for (const [title, commands] of sections) {
    const active = commands.filter(([name]) => available.has(name));
    if (!active.length) continue;

    output.push(`\n${title}`);
    output.push("✨━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✨");
    for (const [name, alias, icon] of active) {
      shown.add(name);
      const displayName = name === "setbio" ? "بايو" : name;
      const preferredName = alias === "nm" || alias === "nik" ? alias : displayName;
      output.push(`${icon} ${prefix}${preferredName}`);
      if (alias && alias !== preferredName) {
        output.push(`   ↳ 🔤 اختصار: ${prefix}${alias}`);
      } else if (preferredName !== displayName) {
        output.push(`   ↳ 🏷️ الاسم الآخر: ${prefix}${displayName}`);
      } else if (alias && alias === displayName && name !== displayName) {
        output.push(`   ↳ 🏷️ الاسم البرمجي: ${prefix}${name}`);
      }
    }
  }

  const extras = [...available]
    .filter(name => !shown.has(name))
    .sort((a, b) => a.localeCompare(b, "ar"));
  if (extras.length) {
    output.push("\n🧩 أوامر إضافية");
    output.push("✨━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━✨");
    for (const name of extras) output.push(`🔹 ${prefix}${name}`);
  }

  output.push("🌠 QUASAR × SHADOW — Powered by ⚛️");
  return api.sendMessage(output.join("\n"), event.threadID);
  output.push(`👥 تغيير الكنيات: ${prefix}nik [الكنية]  |  ${prefix}nik إيقاف`);
  output.push(`⚡ بيس: ${prefix}بيس [النص] [الثواني]  |  ${prefix}بيس إيقاف`);
  output.push(`🚀 محرك: ${prefix}محرك 1/2/3 [النص]  |  ${prefix}محرك إيقاف`);
  output.push(`🪪 البايو: ${prefix}بايو [النص]`);
  output.push(`🔧 تحميل الأوامر: ${prefix}command load`);
  output.push("\n💡 لا يعمل أكثر من نظام تكرار واحد في المجموعة نفسها.");
  output.push("⏳ بيس: الحد الأدنى 60 ثانية.");
  output.push("📨 أول رسالة هي النص نفسه، دون رسالة تفعيل منفصلة.");
  output.push("🔤 الاختصارات: nm ← اسم | nik ← كنيات | cmd ← command");
};
