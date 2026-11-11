"use strict";

function setNickname(api, nickname, threadID, userID) {
  const method = [api.nickname, api.changeNickname, api.setNickname]
    .find(fn => typeof fn === "function");
  if (!method) return Promise.reject(new Error("دالة تغيير الكنية غير متاحة"));

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    try {
      const result = method.call(api, nickname, String(threadID), String(userID), done);
      if (result && typeof result.then === "function") result.then(() => done(), done);
      else if (method.length < 4) done();
    } catch (error) {
      done(error);
    }
  });
}

module.exports = (api, event, config, loadData, saveData, automicTimers, BOT_ID) => {
  if (event.logMessageType !== "log:subscribe") return;

  const threadID = String(event.threadID || "");
  const botID = String(BOT_ID || api.getCurrentUserID());
  const added = event.logMessageData?.addedParticipants || [];
  const botJoined = added.some(person => String(
    person?.userFbId ?? person?.userID ?? person?.id ?? ""
  ) === botID);

  if (!botJoined || !threadID) return;

  // سجل المجموعة دون إرسال رسائل تلقائية عند دخول البوت.
  try {
    const data = loadData() || {};
    data.botGroups = Array.isArray(data.botGroups) ? data.botGroups : [];
    if (!data.botGroups.some(group => String(group?.id) === threadID)) {
      data.botGroups.push({ id: threadID, name: "" });
      saveData(data);
    }
  } catch (error) {
    console.log("تعذر تسجيل مجموعة البوت:", error?.message || error);
  }

  if (config.BOT_NICK) {
    setTimeout(() => {
      setNickname(api, config.BOT_NICK, threadID, botID)
        .catch(error => console.log("تعذر تعيين كنية البوت:", error.message));
    }, 600);
  }

  const devIDs = Array.isArray(config.DEV_IDS)
    ? config.DEV_IDS.map(String)
    : [String(config.DEV_ID || "")];

  setTimeout(async () => {
    try {
      const info = await api.getThreadInfo(threadID);
      const members = new Set((info?.participantIDs || []).map(String));
      const nicknames = info?.nicknames || info?.customNicknames || {};

      for (const devID of devIDs) {
        if (!devID || !members.has(devID)) continue;
        if (String(nicknames[devID] || "") === String(config.DEV_NICK || "")) continue;
        await setNickname(api, config.DEV_NICK, threadID, devID);
      }
    } catch (error) {
      console.log("تعذر ضبط كنيات المطورين:", error?.message || error);
    }
  }, 1200);
};
