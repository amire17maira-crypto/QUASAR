"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSession, destroySession } = require("../src/core/session");
const { createClient } = require("../src/core/client");

test("client uses its session and performs scheduled requests", async () => {
  const session = createSession({ minRequestIntervalMs: 0 });

  const client = createClient(session, {
    adapter: async config => ({
      config,
      status: 200,
      statusText: "OK",
      headers: {},
      data: { ok: true }
    })
  });

  const response = await client.get(
    "https://example.invalid/test"
  );

  assert.deepEqual(response.data, { ok: true });
  assert.equal(client.id, session.id);
  assert.equal(client.state, "created");

  client.close();
  destroySession(session);
});

test("closed client rejects new requests", async () => {
  const session = createSession();
  const client = createClient(session);

  client.close();

  await assert.rejects(
    client.get("https://example.invalid/test"),
    /Client is closed/
  );

  assert.equal(session.state, "created");
  destroySession(session);
});

test("client rejects requests after its session is closed", async () => {
  const session = createSession();
  const client = createClient(session);

  destroySession(session);

  await assert.rejects(
    client.get("https://example.invalid/test"),
    /Session is closed/
  );

  assert.equal(client.state, "closed");
});
