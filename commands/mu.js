"use strict";

const { spawn } = require("child_process");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");

const CACHE_DIR = path.join(__dirname, "cache");
const MAX_MINS = 10;
const MAX_SIZE = 24 * 1024 * 1024;
const TIMEOUT_MS = 120000;

fs.mkdirSync(CACHE_DIR, { recursive: true });

function cleanFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function secToTime(seconds) {
  const value = Math.floor(Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

function send(api, message, threadID, messageID) {
  return new Promise((resolve, reject) => {
    api.sendMessage(message, threadID, messageID, (error, info) => {
      if (error) reject(error);
      else resolve(info);
    });
  });
}

function unsend(api, messageID) {
  if (!messageID) return;
  try {
    api.unsendMessage(messageID, () => {});
  } catch {}
}

function downloadAudio(url, output) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--max-filesize", String(MAX_SIZE),
      "-o", output,
      "--no-playlist",
      "--socket-timeout", "30",
      "--retries", "3",
      "--no-warnings"
    ];

    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      finish(new Error("انتهت مهلة التحميل."));
    }, TIMEOUT_MS);

    function finish(error, file) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(file);
    }

    proc.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-1500);
    });

    proc.on("error", error => finish(error));

    proc.on("close", code => {
      const file = output.endsWith(".mp3") ? output : output + ".mp3";

      if (code === 0 && fs.existsSync(file)) {
        const size = fs.statSync(file).size;
        if (size > MAX_SIZE) {
          cleanFile(file);
          return finish(new Error("SIZE_LIMIT"));
        }
        return finish(null, file);
      }

      finish(new Error(stderr || `yt-dlp exited ${code}`));
    });
  });
}

module.exports = async function (
  api,
  event,
  args
) {
  const threadID = event.threadID;
  const messageID = event.messageID;
  const query = Array.isArray(args) ? args.join(" ").trim() : "";

  if (!query) {
    return send(
      api,
      "🎵 اكتب اسم الأغنية.\nمثال: mu faded",
      threadID,
      messageID
    );
  }

  let waitID = null;
  let file = null;

  try {
    const waiting = await send(
      api,
      `🔎 جاري البحث عن: ${query}`,
      threadID,
      messageID
    );
    waitID = waiting?.messageID;

    const result = await yts(query);
    const videos = (result.videos || []).filter(video =>
      Number(video.seconds) > 0 &&
      Number(video.seconds) <= MAX_MINS * 60
    );

    const video = videos[0];

    if (!video) {
      unsend(api, waitID);
      return send(api, "❌ لم أجد أغنية مناسبة أقل من 10 دقائق.", threadID, messageID);
    }

    const title = video.title || query;
    const channel = video.author?.name || "غير معروف";
    const duration = Number(video.seconds) || 0;

    unsend(api, waitID);
    waitID = null;

    const downloading = await send(
      api,
      `⬇️ جاري تحميل الأغنية:\n${title}`,
      threadID,
      messageID
    );
    waitID = downloading?.messageID;

    const output = path.join(
      CACHE_DIR,
      `mu_${process.env.SHADOW_SESSION_ID || "1"}_${Date.now()}.mp3`
    );

    file = await downloadAudio(video.url, output);

    unsend(api, waitID);
    waitID = null;

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.once("error", reject);

      api.sendMessage(
        {
          body: `🎵 ${title}\n🎤 ${channel}\n⏱ ${secToTime(duration)}`,
          attachment: stream
        },
        threadID,
        messageID,
        error => error ? reject(error) : resolve()
      );
    });

  } catch (error) {
    console.error("[MU COMMAND]", error?.message || error);

    unsend(api, waitID);

    const message = error?.message === "SIZE_LIMIT"
      ? "❌ حجم الأغنية أكبر من 24MB."
      : "❌ تعذر البحث أو تحميل الأغنية. حاول مرة أخرى.";

    try {
      await send(api, message, threadID, messageID);
    } catch {}
  } finally {
    cleanFile(file);
  }
};

module.exports.aliases = ["ميوزك", "اغنية"];
