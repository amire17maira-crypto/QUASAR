"use strict";

const GRAPHQL_URL = "https://www.facebook.com/api/graphql/";

function parseFacebookPayload(response, label) {
  let raw = response;
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) {
    if (Object.prototype.hasOwnProperty.call(raw, "body")) raw = raw.body;
    else if (Object.prototype.hasOwnProperty.call(raw, "data")) raw = raw.data;
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    const cleaned = raw.trim().replace(/^(?:for\s*\(\s*;;\s*\)\s*;|while\s*\(\s*1\s*\)\s*;)/, "").trim();
    try {
      raw = JSON.parse(cleaned);
    } catch {
      throw new Error(`${label}: استجابة فيسبوك غير مفهومة`);
    }
  }
  if (!raw || typeof raw !== "object") throw new Error(`${label}: استجابة فيسبوك فارغة`);
  if (raw.error || (Array.isArray(raw.errors) && raw.errors.length)) {
    const detail = raw.error?.message || raw.errors?.[0]?.message || raw.errorDescription;
    throw new Error(`${label}: ${detail || "رفض فيسبوك الطلب"}`);
  }
  return raw;
}

function requireProfileContext(api) {
  const ctx = api && api.ctx;
  const defaults = api && api.defaultFuncs;
  if (!ctx || !ctx.userID || !ctx.jar || !defaults || typeof defaults.post !== "function") {
    throw new Error("بيانات جلسة الحساب غير متاحة في ws3-fca");
  }
  return { ctx, defaults, userID: String(ctx.userID) };
}

function installWS3ProfileApi(api) {
  if (!api || typeof api !== "object") throw new TypeError("كائن FCA غير صالح");
  if (typeof api.changeBio !== "function") {
    api.changeBio = async function changeBio(bio, publish = false) {
      const { ctx, defaults, userID } = requireProfileContext(api);
      if (typeof bio !== "string") throw new TypeError("البايو يجب أن يكون نصاً");
      const form = {
        av: userID,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "ProfileCometSetBioMutation",
        doc_id: "2725043627607610",
        variables: JSON.stringify({
          input: {
            bio,
            publish_bio_feed_story: Boolean(publish),
            actor_id: userID,
            client_mutation_id: String(Math.floor(Math.random() * 1025))
          },
          hasProfileTileViewID: false,
          profileTileViewID: null,
          scale: 1
        })
      };
      const response = await defaults.post(GRAPHQL_URL, ctx.jar, form);
      return parseFacebookPayload(response, "تغيير البايو");
    };
  }

  return api;
}

module.exports = installWS3ProfileApi;
module.exports.parseFacebookPayload = parseFacebookPayload;
