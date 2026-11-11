"use strict";

const { CookieJar } = require("tough-cookie");
const crypto = require("node:crypto");
const RequestScheduler = require("../network/request-scheduler");

const DEFAULT_OPTIONS = Object.freeze({
  selfListen: false,
  listenEvents: true,
  listenTyping: false,
  updatePresence: false,
  autoMarkDelivery: false,
  autoMarkRead: true,
  autoReconnect: true,
  online: true,
  emitReady: false,
  requestTimeout: 30000
});

function createSession(options = {}) {
  const session = {
    id: crypto.randomUUID(),
    jar: new CookieJar(),
    options: { ...DEFAULT_OPTIONS, ...options },
    state: "created",
    userID: null,
    mqttClient: null,
    requestScheduler: new RequestScheduler({
      maxConcurrent: options.maxConcurrentRequests ?? 2,
      minIntervalMs: options.minRequestIntervalMs ?? 250
    }),
    timers: new Set(),
    createdAt: Date.now(),
    closedAt: null
  };

  return session;
}

function assertSession(session) {
  if (!session || !session.jar || !session.options) {
    throw new TypeError("Invalid Shadow FCA session");
  }
  if (session.state === "closed") {
    throw new Error("Session is closed");
  }
}

function importAppState(session, appState) {
  assertSession(session);

  if (!Array.isArray(appState)) {
    throw new TypeError("appState must be an array");
  }

  for (const item of appState) {
    if (!item || typeof item !== "object") {
      throw new TypeError("Invalid appState cookie");
    }

    const name = item.name || item.key;
    const value = item.value;

    if (
      typeof name !== "string" ||
      typeof value !== "string" ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
    ) {
      throw new TypeError("Invalid appState cookie fields");
    }

    const domain = String(item.domain || ".facebook.com")
      .replace(/^\./, "")
      .toLowerCase();

    if (domain !== "facebook.com" && !domain.endsWith(".facebook.com")) {
      throw new Error("Cookie domain is not allowed");
    }

    const cookie = [
      `${name}=${value}`,
      `Domain=${domain}`,
      `Path=${item.path || "/"}`,
      "Secure"
    ].join("; ");

    session.jar.setCookieSync(cookie, "https://www.facebook.com");
  }

  return session;
}

function getAppState(session) {
  assertSession(session);

  return session.jar
    .getCookiesSync("https://www.facebook.com")
    .concat(session.jar.getCookiesSync("https://www.messenger.com"))
    .map(cookie => ({
      key: cookie.key,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path
    }));
}

function destroySession(session) {
  if (!session || session.state === "closed") return;

  session.state = "closed";
  if (session.requestScheduler) session.requestScheduler.close();
  session.closedAt = Date.now();

  for (const timer of session.timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  session.timers.clear();

  if (session.mqttClient) {
    try {
      session.mqttClient.end(true);
    } catch {
      // Cleanup must continue even if MQTT shutdown fails.
    }
    session.mqttClient = null;
  }

  session.userID = null;
}

module.exports = {
  DEFAULT_OPTIONS,
  createSession,
  assertSession,
  importAppState,
  getAppState,
  destroySession
};
