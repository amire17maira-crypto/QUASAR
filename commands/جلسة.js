"use strict";

const { createSessionGif } = require("../SHADOW/session-card");

module.exports = async (api, event) => {
  try {
    const gif = await createSessionGif();

    return api.sendMessage({
      body: "QUASAR SYSTEM OVERVIEW",
      attachment: gif
    }, event.threadID);
  } catch (error) {
    console.error("QUASAR SESSION GIF ERROR:", error);
    return api.sendMessage(
      "❌ تعذر إنشاء صورة حالة QUASAR.",
      event.threadID
    );
  }
};
