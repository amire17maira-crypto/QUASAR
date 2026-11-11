"use strict";

const session = require("./src/core/session");
const { createClient } = require("./src/core/client");
const SessionManager = require("./src/core/session-manager");
const { createHttpClient, ShadowHttpError } =
  require("./src/network/http-client");
const RequestScheduler = require("./src/network/request-scheduler");
const { encryptData, decryptData } = require("./src/auth/secure-store");
const {
  saveEncryptedSession,
  loadEncryptedSession
} = require("./src/auth/session-store");

module.exports = {
  ...session,
  createClient,
  SessionManager,
  createHttpClient,
  ShadowHttpError,
  RequestScheduler,
  encryptData,
  decryptData,
  saveEncryptedSession,
  loadEncryptedSession
};
