
const { invoke } = require("../SHADOW/quasar-command-utils");

function deleteAfterSixSeconds(api, sent) {
  const messageID = sent && sent.messageID;
  if (!messageID) return;

  setTimeout(() => {
    invoke(api, "unsendMessage", [String(messageID)]).catch(error => {
      console.log("تعذر حذف رسالة التغيير تلقائيًا:", error.message || error);
    });
  }, 6000);
}


async function sendAndDelete(api, message, threadID) {
  const sent = await api.sendMessage(message, threadID);
  deleteAfterSixSeconds(api, sent);
  return sent;
}

const command = async (api, event, args, startTime, loadData, saveData) => {
  const threadID = String(event.threadID || "");
  if (!threadID) return;

  const action = String(args[1] || "").trim().toLowerCase();
  const data = loadData() || {};
  const prefix = String(data.prefix || "!");

  if (!data.savedGroupNames || typeof data.savedGroupNames !== "object" || Array.isArray(data.savedGroupNames)) data.savedGroupNames = {};

  if (["إيقاف", "ايقاف", "stop", "off"].includes(action)) {
    delete data.savedGroupNames[threadID];
    saveData(data);

    return api.sendMessage(
      "🛑 تم إيقاف حماية اسم المجموعة.\n🗑️ تم حذف الاسم المحفوظ.",
      threadID
    );
  }

  const newName = args.slice(1).join(" ").trim();

  if (!newName) {
    return api.sendMessage(
      "🛡️ حماية اسم المجموعة\n\n" +
      "✏️ لتغيير الاسم وتفعيل الحماية:\n" +
      `${prefix}nm [الاسم الجديد]\n\n` +
      "🛑 لإيقاف الحماية:\n" +
      `${prefix}nm إيقاف\n\n` +
      `🔤 الاسم الآخر: ${prefix}اسم\n` +
      "🛡️ تتم استعادة الاسم تلقائيًا عند تغييره.",
      threadID
    );
  }

  data.savedGroupNames[threadID] = newName;
  saveData(data);

  try {
    await api.gcname(newName, threadID);
    return sendAndDelete(api,
      "✅ تم تغيير اسم المجموعة بنجاح!\n" +
      "🏷️ الاسم: " + newName + "\n" +
      "💾 تم حفظه وتفعيل الحماية 🛡️",
      threadID
    );
  } catch (e) {
    return sendAndDelete(api,
      "💾 تم حفظ الاسم: " + newName +
      "\n⚠️ تعذّر تغييره الآن، ستتم إعادة المحاولة لاحقًا.",
      threadID
    );
  }
};


command.aliases = ["nm"];
module.exports = command;
