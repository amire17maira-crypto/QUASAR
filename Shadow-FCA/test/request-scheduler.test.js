"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const RequestScheduler = require("../src/network/request-scheduler");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("requests with the same key execute sequentially", async () => {
  const scheduler = new RequestScheduler({ maxConcurrent: 3 });
  const order = [];

  const first = scheduler.run("thread-A", async () => {
    order.push("first-start");
    await delay(20);
    order.push("first-end");
  });

  const second = scheduler.run("thread-A", async () => {
    order.push("second-start");
    order.push("second-end");
  });

  await Promise.all([first, second]);

  assert.deepEqual(order, [
    "first-start",
    "first-end",
    "second-start",
    "second-end"
  ]);

  scheduler.close();
});

test("different keys respect the global concurrency limit", async () => {
  const scheduler = new RequestScheduler({ maxConcurrent: 2 });
  let active = 0;
  let maximum = 0;

  const task = key => scheduler.run(key, async () => {
    active++;
    maximum = Math.max(maximum, active);
    await delay(25);
    active--;
  });

  await Promise.all([
    task("A"),
    task("B"),
    task("C"),
    task("D")
  ]);

  assert.equal(maximum, 2);
  scheduler.close();
});

test("closing rejects queued requests", async () => {
  const scheduler = new RequestScheduler({ maxConcurrent: 1 });

  let release;
  const running = scheduler.run("A", () =>
    new Promise(resolve => { release = resolve; })
  );

  await Promise.resolve();

  const queued = scheduler.run("B", async () => "should not run");
  scheduler.close();

  await assert.rejects(queued, /closed/);

  release();
  await running;

  assert.equal(scheduler.pending, 0);
});

test("invalid scheduler options are rejected", () => {
  assert.throws(
    () => new RequestScheduler({ maxConcurrent: 0 }),
    /maxConcurrent/
  );

  assert.throws(
    () => new RequestScheduler({ minIntervalMs: -1 }),
    /minIntervalMs/
  );
});
