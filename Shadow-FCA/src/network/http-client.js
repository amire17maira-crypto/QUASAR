"use strict";

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { assertSession } = require("../core/session");

class ShadowHttpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ShadowHttpError";
    this.code = details.code || "HTTP_ERROR";
    this.status = details.status ?? null;
    this.response = details.response ?? null;
  }
}

function containsRateLimit(value) {
  if (typeof value === "string") {
    return /rate[\s_-]*limit|too many requests/i.test(value);
  }

  if (value && typeof value === "object") {
    return Object.values(value).some(containsRateLimit);
  }

  return false;
}

function createHttpClient(session, options = {}) {
  assertSession(session);

  const timeout = options.timeout ?? session.options.requestTimeout ?? 30000;

  const client = wrapper(axios.create({
    jar: session.jar,
    timeout,
    headers: {
      "Accept": "*/*",
      "User-Agent": options.userAgent || "Shadow-FCA/0.1"
    },
    ...(options.adapter ? { adapter: options.adapter } : {})
  }));

  // Force every request to use this session's cookie jar.
  client.interceptors.request.use(config => {
    assertSession(session);
    config.jar = session.jar;
    return config;
  });

  client.interceptors.response.use(
    response => {
      if (containsRateLimit(response.data)) {
        throw new ShadowHttpError(
          "Facebook rate limit detected; request was not retried",
          {
            code: "RATE_LIMITED",
            status: response.status,
            response
          }
        );
      }

      return response;
    },
    error => {
      if (containsRateLimit(error.response?.data)) {
        return Promise.reject(new ShadowHttpError(
          "Facebook rate limit detected; request was not retried",
          {
            code: "RATE_LIMITED",
            status: error.response.status,
            response: error.response
          }
        ));
      }

      return Promise.reject(error);
    }
  );

  // Execute requests through this session's scheduler.
  client.scheduledRequest = (config, queueKey = "global") => {
    try {
      assertSession(session);
      return session.requestScheduler.run(queueKey, () => {
        assertSession(session);
        return client.request(config);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  };

  client.scheduledGet = (url, queueKey = "global", config = {}) =>
    client.scheduledRequest({ ...config, method: "GET", url }, queueKey);

  client.scheduledPost = (url, data, queueKey = "global", config = {}) =>
    client.scheduledRequest({ ...config, method: "POST", url, data }, queueKey);

  return client;
}

module.exports = {
  createHttpClient,
  ShadowHttpError,
  containsRateLimit
};
