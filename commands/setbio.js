"use strict";
const { send, invoke } = require("../SHADOW/quasar-command-utils");

async function command(api, event, args) {
  const value = args.slice(1).join(" ").trim();
  const clear = ["clear", "مسح", "حذف"].includes(value.toLowerCase());
  if (!value) return send(api, event, "اكتب البايو الجديد. للحذف: !setbio مسح");
  if (typeof api.changeBio !== "function") return send(api, event, "تغيير البايو غير مدعوم من مكتبة FCA الحالية.");
  try {
    await invoke(api, "changeBio", [clear ? "" : value]);
    return send(api, event, clear ? "تم مسح بايو حساب البوت." : "تم تحديث بايو حساب البوت.");
  } catch (error) {
    return send(api, event, `فشل تغيير البايو: ${String(error.message || error).slice(0, 160)}`);
  }
}
command.aliases = ["بايو", "bio", "changebio", "botbio"];
module.exports = command;
