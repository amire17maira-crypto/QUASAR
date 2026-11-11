"use strict";

const {
  createSession,
  destroySession
} = require("./session");

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  create(options = {}) {
    const session = createSession(options);

    if (this.sessions.has(session.id)) {
      destroySession(session);
      throw new Error("Duplicate session ID");
    }

    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  has(id) {
    return this.sessions.has(id);
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    destroySession(session);
    this.sessions.delete(id);
    return true;
  }

  closeAll() {
    for (const session of this.sessions.values()) {
      destroySession(session);
    }
    this.sessions.clear();
  }

  get size() {
    return this.sessions.size;
  }

  list() {
    return Array.from(this.sessions.values(), session => ({
      id: session.id,
      state: session.state,
      createdAt: session.createdAt
    }));
  }
}

module.exports = SessionManager;
