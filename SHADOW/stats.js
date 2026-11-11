const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || path.join(__dirname, ".."));
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, "shadow-stats.json");

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyStats() {
  return {
    version: 1,
    totals: {
      messages: 0, groupMessages: 0, privateMessages: 0,
      commands: 0, commandErrors: 0, unauthorizedCommands: 0
    },
    users: {}, threads: {}, groups: {}, commands: {}, days: {}
  };
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (data.version !== 1) return emptyStats();
    return data;
  } catch {
    return emptyStats();
  }
}

let stats = read();
let dirty = false;

function dayBucket() {
  const key = dateKey();
  if (!stats.days[key]) {
    stats.days[key] = {
      messages: 0, groupMessages: 0, privateMessages: 0,
      commands: 0, commandErrors: 0, unauthorizedCommands: 0,
      users: {}, groups: {}, commandStats: {}
    };
    dirty = true;
  }

  const day = stats.days[key];
  day.users ||= {};
  day.groups ||= {};
  day.commandStats ||= {};
  return day;
}

function commandBucket(day, name) {
  if (!day.commandStats[name]) {
    day.commandStats[name] = {
      count: 0, errors: 0, unauthorized: 0, users: {}
    };
  }
  return day.commandStats[name];
}

function save() {
  if (!dirty) return;
  const temp = FILE + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(stats), { mode: 0o600 });
    fs.renameSync(temp, FILE);
    dirty = false;
  } catch (error) {
    console.log("تعذر حفظ الإحصائيات:", error.message);
  }
}

function recordMessage(event) {
  if (!event || event.type !== "message") return;

  const user = String(event.senderID || "");
  const thread = String(event.threadID || "");
  if (!user || !thread) return;

  const group = event.isGroup === true;
  const day = dayBucket();

  stats.totals.messages++;
  day.messages++;

  if (group) {
    stats.totals.groupMessages++;
    day.groupMessages++;
    stats.groups[thread] = (stats.groups[thread] || 0) + 1;
    day.groups[thread] = (day.groups[thread] || 0) + 1;
  } else {
    stats.totals.privateMessages++;
    day.privateMessages++;
  }

  stats.users[user] = (stats.users[user] || 0) + 1;
  day.users[user] = (day.users[user] || 0) + 1;
  stats.threads[thread] = (stats.threads[thread] || 0) + 1;

  dirty = true;
}

function recordCommand(name, user, thread) {
  const command = String(name || "unknown").slice(0, 80);
  const userId = String(user || "");
  const threadId = String(thread || "");
  const day = dayBucket();

  stats.totals.commands++;
  day.commands++;

  if (!stats.commands[command]) {
    stats.commands[command] = {
      count: 0, errors: 0, unauthorized: 0, users: {}, threads: {}
    };
  }

  const item = stats.commands[command];
  item.count++;
  if (userId) item.users[userId] = (item.users[userId] || 0) + 1;
  if (threadId) item.threads[threadId] = (item.threads[threadId] || 0) + 1;

  const daily = commandBucket(day, command);
  daily.count++;
  if (userId) daily.users[userId] = (daily.users[userId] || 0) + 1;

  dirty = true;
}

function recordCommandError(name) {
  const command = String(name || "unknown").slice(0, 80);
  const day = dayBucket();

  stats.totals.commandErrors++;
  day.commandErrors++;

  if (!stats.commands[command]) {
    stats.commands[command] = {
      count: 0, errors: 0, unauthorized: 0, users: {}, threads: {}
    };
  }

  stats.commands[command].errors++;
  commandBucket(day, command).errors++;
  dirty = true;
}

function recordUnauthorized(name) {
  const command = String(name || "unknown").slice(0, 80);
  const day = dayBucket();

  stats.totals.unauthorizedCommands++;
  day.unauthorizedCommands++;

  if (!stats.commands[command]) {
    stats.commands[command] = {
      count: 0, errors: 0, unauthorized: 0, users: {}, threads: {}
    };
  }

  stats.commands[command].unauthorized++;
  commandBucket(day, command).unauthorized++;
  dirty = true;
}

function topEntries(map, limit = 10) {
  return Object.entries(map || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

function summary(period = "day") {
  if (!["day", "week", "month", "all"].includes(period)) {
    throw new Error("فترة إحصائيات غير صالحة");
  }

  if (period === "all") {
    return {
      period,
      ...stats.totals,
      activeUsers: Object.keys(stats.users).length,
      activeGroups: Object.keys(stats.groups).length,
      topUsers: topEntries(stats.users),
      topGroups: topEntries(stats.groups),
      topCommands: Object.entries(stats.commands)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([name, data]) => ({ name, ...data }))
    };
  }

  const now = new Date();
  const start = new Date(now);

  if (period === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (period === "month") {
    start.setDate(1);
  }

  const totals = {
    messages: 0, groupMessages: 0, privateMessages: 0,
    commands: 0, commandErrors: 0, unauthorizedCommands: 0
  };

  const users = {};
  const groups = {};
  const commands = {};

  for (const [key, day] of Object.entries(stats.days)) {
    if (key < dateKey(start) || key > dateKey(now)) continue;

    for (const field of Object.keys(totals)) {
      totals[field] += Number(day[field] || 0);
    }

    for (const [id, count] of Object.entries(day.users || {})) {
      users[id] = (users[id] || 0) + count;
    }

    for (const [id, count] of Object.entries(day.groups || {})) {
      groups[id] = (groups[id] || 0) + count;
    }

    for (const [name, data] of Object.entries(day.commandStats || {})) {
      if (!commands[name]) {
        commands[name] = { count: 0, errors: 0, unauthorized: 0 };
      }
      commands[name].count += data.count || 0;
      commands[name].errors += data.errors || 0;
      commands[name].unauthorized += data.unauthorized || 0;
    }
  }

  return {
    period,
    ...totals,
    activeUsers: Object.keys(users).length,
    activeGroups: Object.keys(groups).length,
    topUsers: topEntries(users),
    topGroups: topEntries(groups),
    topCommands: Object.entries(commands)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({ name, ...data }))
  };
}

function snapshot() {
  return JSON.parse(JSON.stringify(stats));
}

process.on("exit", save);
const flushTimer = setInterval(save, 5000);
if (typeof flushTimer.unref === "function") flushTimer.unref();

module.exports = {
  recordMessage,
  recordCommand,
  recordCommandError,
  recordUnauthorized,
  snapshot,
  summary,
  save
};
