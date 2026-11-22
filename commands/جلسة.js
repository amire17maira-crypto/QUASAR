"use strict";

const { createSessionGif } = require("../SHADOW/session-card");

const command = async (api, event) => {
  try {
    const gif = await createSessionGif();

    if (!Buffer.isBuffer(gif) ||
        !["GIF89a", "GIF87a"].includes(gif.toString("ascii", 0, 6))) {
      throw new Error("Invalid GIF generated");
    }

    return api.sendMessage(
      {
        body: "QUASAR SYSTEM OVERVIEW",
        attachment: gif
      },
      event.threadID
    );
  } catch (error) {
    console.error("[SESSION COMMAND ERROR]", error);

    return api.sendMessage(
      "❌ تعذر إرسال بطاقة جلسة QUASAR.",
      event.threadID
    );
  }
};

command.aliases = ["session", "حالة"];

module.exports = command;
