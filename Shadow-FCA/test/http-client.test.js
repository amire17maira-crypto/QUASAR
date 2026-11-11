"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSession, destroySession } = require("../src/core/session");
const {
  createHttpClient,
  ShadowHttpError,
  containsRateLimit
} = require("../src/network/http-client");

test("HTTP clients use separate cookie jars", () => {
  const first = createSession();
  const second = createSession();

  const firstClient = createHttpClient(first);
  const secondClient = createHttpClient(second);

  assert.notEqual(firstClient.defaults.jar, secondClient.defaults.jar);
  assert.equal(firstClient.defaults.jar, first.jar);
  assert.equal(secondClient.defaults.jar, second.jar);

  destroySession(first);
  destroySession(second);
});

test("rate limit responses are classified and not retried", async () => {
  const session = createSession();
  let calls = 0;

  const client = createHttpClient(session, {
    adapter: async config => {
      calls++;
      return {
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: { errors: ["Rate limit exceeded"] }
      };
    }
  });

  await assert.rejects(
    client.get("https://example.invalid/test"),
    error => {
      assert.ok(error instanceof ShadowHttpError);
      assert.equal(error.code, "RATE_LIMITED");
      return true;
    }
  );

  assert.equal(calls, 1);
  destroySession(session);
});

test("normal responses pass through", async () => {
  const session = createSession();

  const client = createHttpClient(session, {
    adapter: async config => ({
      config,
      status: 200,
      statusText: "OK",
      headers: {},
      data: { result: "ok" }
    })
  });

  const response = await client.get("https://example.invalid/test");

  assert.deepEqual(response.data, { result: "ok" });
  destroySession(session);
});

test("rate limit detector handles nested response data", () => {
  assert.equal(containsRateLimit({
    errors: [{ message: "Rate limit exceeded" }]
  }), true);

  assert.equal(containsRateLimit({ result: "ok" }), false);
});

test("scheduled HTTP requests use the session scheduler", async () => {
  const session = createSession({ minRequestIntervalMs: 0 });
  const order = [];

  const client = createHttpClient(session, {
    adapter: async config => {
      order.push(config.url + "-start");
      await new Promise(resolve => setTimeout(resolve, 15));
      order.push(config.url + "-end");
      return {
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: { ok: true }
      };
    }
  });

  await Promise.all([
    client.scheduledGet("https://example.invalid/one", "thread-A"),
    client.scheduledGet("https://example.invalid/two", "thread-A")
  ]);

  assert.deepEqual(order, [
    "https://example.invalid/one-start",
    "https://example.invalid/one-end",
    "https://example.invalid/two-start",
    "https://example.invalid/two-end"
  ]);

  destroySession(session);
});

test("scheduled HTTP requests reject after session closure", async () => {
  const session = createSession();
  const client = createHttpClient(session);

  destroySession(session);

  await assert.rejects(
    client.scheduledGet("https://example.invalid/test"),
    /closed/
  );
});
