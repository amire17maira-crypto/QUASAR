"use strict";

const { assertSession } = require("./session");
const { createHttpClient } = require("../network/http-client");

function createClient(session, options = {}) {
  assertSession(session);

  const http = createHttpClient(session, options);
  let closed = false;

  function assertClient() {
    if (closed) throw new Error("Client is closed");
    assertSession(session);
  }

  function request(config, queueKey = "global") {
    try {
      assertClient();
      return http.scheduledRequest(config, queueKey);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function get(url, queueKey = "global", config = {}) {
    return request({ ...config, method: "GET", url }, queueKey);
  }

  function post(url, data, queueKey = "global", config = {}) {
    return request({ ...config, method: "POST", url, data }, queueKey);
  }

  return {
    get id() {
      return session.id;
    },
    get state() {
      return closed ? "closed" : session.state;
    },
    request,
    get,
    post,
    close() {
      closed = true;
    }
  };
}

module.exports = { createClient };
