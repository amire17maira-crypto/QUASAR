"use strict";

class RequestScheduler {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.minIntervalMs = options.minIntervalMs ?? 0;

    if (!Number.isInteger(this.maxConcurrent) || this.maxConcurrent < 1) {
      throw new TypeError("maxConcurrent must be a positive integer");
    }

    if (!Number.isFinite(this.minIntervalMs) || this.minIntervalMs < 0) {
      throw new TypeError("minIntervalMs must be a non-negative number");
    }

    this.queue = [];
    this.busyKeys = new Set();
    this.active = 0;
    this.lastStartedAt = 0;
    this.wakeTimer = null;
    this.closed = false;
  }

  run(key, task) {
    if (this.closed) {
      return Promise.reject(new Error("Request scheduler is closed"));
    }

    if (typeof key !== "string" || !key.trim()) {
      return Promise.reject(new TypeError("A non-empty queue key is required"));
    }

    if (typeof task !== "function") {
      return Promise.reject(new TypeError("task must be a function"));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ key, task, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    if (this.closed || this.wakeTimer || this.active >= this.maxConcurrent) {
      return;
    }

    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastStartedAt);

    if (this.lastStartedAt && wait > 0) {
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null;
        this._pump();
      }, wait);
      return;
    }

    const index = this.queue.findIndex(item => !this.busyKeys.has(item.key));
    if (index === -1) return;

    const item = this.queue.splice(index, 1)[0];

    this.active++;
    this.busyKeys.add(item.key);
    this.lastStartedAt = Date.now();

    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active--;
        this.busyKeys.delete(item.key);
        this._pump();
      });

    this._pump();
  }

  close() {
    if (this.closed) return;

    this.closed = true;

    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }

    const error = new Error("Request scheduler is closed");

    for (const item of this.queue.splice(0)) {
      item.reject(error);
    }
  }

  get pending() {
    return this.queue.length;
  }
}

module.exports = RequestScheduler;
