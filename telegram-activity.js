"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, "telegram-activity.json");

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return data && data.users ? data : { users: {} };
  } catch {
    return { users: {} };
  }
}

let data = load();

function save() {
  const temp = FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, FILE);
  try { fs.chmodSync(FILE, 0o600); } catch {}
}

function record(user, action) {
  if (!user || !user.id) return;

  const id = String(user.id);
  const now = new Date().toISOString();

  if (!data.users[id]) {
    data.users[id] = {
      id,
      username: "",
      firstName: "",
      firstSeen: now,
      lastSeen: now,
      interactions: 0,
      actions: {},
      recent: []
    };
  }

  const item = data.users[id];
  item.username = user.username || item.username;
  item.firstName = user.first_name || item.firstName;
  item.lastSeen = now;
  item.interactions++;
  item.actions[action] = (item.actions[action] || 0) + 1;
  item.recent.push({ action, time: now });

  if (item.recent.length > 30) item.recent.shift();
  save();
}

function list() {
  return Object.values(data.users)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

function get(id) {
  return data.users[String(id)] || null;
}

function snapshot() {
  const users = list();
  return {
    totalUsers: users.length,
    activeToday: users.filter(u =>
      Date.now() - new Date(u.lastSeen).getTime() < 86400000
    ).length,
    totalInteractions: users.reduce((n, u) => n + u.interactions, 0),
    users
  };
}

module.exports = { record, list, get, snapshot };
