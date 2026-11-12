"use strict";

const cooldowns = Object.create(null);
const nickCooldowns = Object.create(null);
const savedNameEventCooldowns = Object.create(null);

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
  const data = loadData() || {};
  const threadID = String(event.threadID || "");
  if (!threadID) return;

  const botID = String(BOT_ID || api.getCurrentUserID());
  const developerIDs = new Set([
    ...(Array.isArray(config.DEV_IDS) ? config.DEV_IDS : []),
    config.DEV_ID
  ].map(id => String(id || "")).filter(Boolean));
  const devID = String(config.DEV_ID || "");
  const changerID = String(event.author || event.senderID || "");
  const groupNickname = typeof data.nicknameProtections?.[threadID] === "string"
    ? data.nicknameProtections[threadID]
    : "";

  // لا نعيد إضافة أي عضو غادر المجموعة؛ الانضمام يبقى باختيار العضو.
  if (event.logMessageType === "log:unsubscribe") return;

  // استعادة كنية البوت والمطورين عند تغييرها.
  if (event.logMessageType === "log:user-nickname") {
    const targetID = String(event.logMessageData?.participant_id || "");
    const now = Date.now();

    if (targetID === botID && changerID !== botID) {
      const key = `bot_${threadID}`;
      if (now - (nickCooldowns[key] || 0) > 8000) {
        nickCooldowns[key] = now;
        setTimeout(() => setNickname(api, config.BOT_NICK, threadID, botID)
          .catch(error => console.log("تعذر استعادة كنية البوت:", error.message)), 1500);
      }
      return;
    }

    if (targetID === devID && !groupNickname && changerID !== botID && changerID !== devID) {
      const key = `dev_${threadID}`;
      if (now - (nickCooldowns[key] || 0) > 8000) {
        nickCooldowns[key] = now;
        setTimeout(() => setNickname(api, config.DEV_NICK, threadID, devID)
          .catch(error => console.log("تعذر استعادة كنية المطور:", error.message)), 1500);
      }
      return;
    }

    // حماية كنيات جميع الأعضاء فور ورود حدث التغيير، دون انتظار الفحص الدوري.
    if (groupNickname && targetID && targetID !== botID && !developerIDs.has(targetID) && changerID !== botID) {
      const newNick = event.logMessageData?.nickname ?? "";
      const key = `group_${threadID}_${targetID}`;
      if (newNick !== groupNickname && now - (nickCooldowns[key] || 0) > 4000) {
        nickCooldowns[key] = now;
        setTimeout(() => setNickname(api, groupNickname, threadID, targetID)
          .catch(error => console.log("تعذر استعادة كنية العضو المحمية:", error.message)), 1200);
      }
      return;
    }
  }

  // استعادة اسم المجموعة المحفوظ فور وصول حدث MQTT.
  if (event.logMessageType === "log:thread-name") {
    const wantedName = data.savedGroupNames?.[threadID];

    if (typeof wantedName === "string" && wantedName.trim()) {
      const newName = event.logMessageData?.name;

      if (
        changerID !== botID &&
        !developerIDs.has(changerID) &&
        typeof newName === "string" &&
        newName !== wantedName
      ) {
        const now = Date.now();
        const lastAttempt = savedNameEventCooldowns[threadID] || 0;

        if (now - lastAttempt >= 4000) {
          savedNameEventCooldowns[threadID] = now;

          Promise.resolve()
            .then(() => api.gcname(wantedName, threadID))
            .catch(error => {
              console.log("تعذر استعادة اسم المجموعة المحفوظ فورًا:", error.message || error);
            });
        }
      }

      // منع الحماية القديمة من إرسال طلب استرجاع ثانٍ لهذا الحدث.
      return;
    }
  }

  // حماية الاسم والكنيات المحفوظة عند تفعيل الحماية.
  if (!data.protected?.[threadID]?.active) return;
  if (changerID === devID || changerID === botID) return;

  const protection = data.protected[threadID];
  const now = Date.now();
  if (now - (cooldowns[threadID] || 0) < 4000) return;

  if (event.logMessageType === "log:thread-name") {
    const newName = event.logMessageData?.name;
    const oldName = protection.threadName;
    if (newName && oldName && newName !== oldName) {
      cooldowns[threadID] = now;
      Promise.resolve(api.gcname(oldName, threadID))
        .catch(error => console.log("تعذر استعادة اسم المجموعة:", error.message));
    }
  }

  if (event.logMessageType === "log:user-nickname") {
    const targetID = String(event.logMessageData?.participant_id || "");
    const oldNick = protection.nicknames?.[targetID] ?? "";
    const newNick = event.logMessageData?.nickname ?? "";
    if (newNick !== oldNick) {
      cooldowns[threadID] = now;
      setTimeout(() => setNickname(api, oldNick, threadID, targetID)
        .catch(error => console.log("تعذر استعادة كنية العضو:", error.message)), 1500);
    }
  }
};
