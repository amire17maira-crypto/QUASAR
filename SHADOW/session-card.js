"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Jimp, loadFont } = require("jimp");

const WIDTH = 1400;
const HEIGHT = 1000;

const C = {
  bg: 0x080e1aff,
  panel: 0x111c30ff,
  panel2: 0x172640ff,
  border: 0x293e5cff,
  white: 0xeaf3ffff,
  muted: 0x91a6c1ff,
  cyan: 0x45d6eaff,
  green: 0x43d6a0ff,
  orange: 0xffbd69ff,
  red: 0xff737dff,
  track: 0x26364dff
};

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "N/A";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "N/A";
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function readNumber(file) {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    if (!value || value === "max") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function getMemory() {
  const totalHost = os.totalmem();
  const freeHost = os.freemem();

  const cgroupTotal =
    readNumber("/sys/fs/cgroup/memory.max") ??
    readNumber("/sys/fs/cgroup/memory/memory.limit_in_bytes");

  const cgroupUsed =
    readNumber("/sys/fs/cgroup/memory.current") ??
    readNumber("/sys/fs/cgroup/memory/memory.usage_in_bytes");

  if (cgroupTotal && cgroupUsed !== null &&
      cgroupTotal < 1e15 && cgroupUsed <= cgroupTotal) {
    return {
      total: cgroupTotal,
      used: cgroupUsed,
      free: Math.max(0, cgroupTotal - cgroupUsed),
      percent: cgroupTotal
        ? Math.round(cgroupUsed / cgroupTotal * 100)
        : null,
      source: "CONTAINER LIMIT"
    };
  }

  return {
    total: totalHost,
    used: Math.max(0, totalHost - freeHost),
    free: freeHost,
    percent: totalHost
      ? Math.round((totalHost - freeHost) / totalHost * 100)
      : null,
    source: "HOST OS"
  };
}

function directorySize(root) {
  let total = 0;
  const excludedDirs = new Set(["node_modules", ".git", ".cache"]);
  const excludedFiles = new Set([
    "config.json", "fca-config.json", ".env"
  ]);

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        if (excludedFiles.has(entry.name)) continue;
        if (/^appState.*\.json$/i.test(entry.name)) continue;
        if (/\.(zip|tar\.gz)$/i.test(entry.name)) continue;
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }

  walk(root);
  return total;
}

function getPanelStatus(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const start = Date.parse(data.startedAt);
    const pid = Number(data.pid);

    if (!Number.isFinite(start) || start <= 0 ||
        !Number.isInteger(pid) || pid <= 0) {
      throw new Error("Invalid panel status");
    }

    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code !== "EPERM") throw e;
    }

    return {
      online: true,
      uptime: formatDuration(Date.now() - start),
      startedAt: new Date(start).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    };
  } catch {
    return {
      online: false,
      uptime: "N/A",
      startedAt: "N/A"
    };
  }
}

function getHosting() {
  const e = process.env;
  const railway =
    e.RAILWAY_PROJECT_ID ||
    e.RAILWAY_SERVICE_ID ||
    e.RAILWAY_DEPLOYMENT_ID;

  if (railway) {
    return {
      provider: "RAILWAY",
      environment: e.RAILWAY_ENVIRONMENT_NAME || "N/A",
      service: e.RAILWAY_SERVICE_NAME || "N/A"
    };
  }

  if (e.RENDER) return { provider: "RENDER", environment: "N/A", service: "N/A" };
  if (e.HEROKU_APP_NAME) return { provider: "HEROKU", environment: "N/A", service: e.HEROKU_APP_NAME };
  if (e.VERCEL) return { provider: "VERCEL", environment: "N/A", service: "N/A" };
  if (e.PREFIX && String(e.PREFIX).includes("com.termux")) {
    return { provider: "TERMUX", environment: "ANDROID", service: "LOCAL DEVICE" };
  }

  return {
    provider: "NOT DETECTED",
    environment: process.platform.toUpperCase(),
    service: "N/A"
  };
}

function getStorage(dir) {
  try {
    const s = fs.statfsSync(dir);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);

    if (!Number.isFinite(total) || total <= 0 ||
        !Number.isFinite(free) || free < 0) throw new Error();

    const used = Math.max(0, total - free);
    return {
      total, free, used,
      percent: Math.round(used / total * 100)
    };
  } catch {
    return { total: null, free: null, used: null, percent: null };
  }
}

function getSystemMetrics(dataDir, projectDir, statusFile) {
  const memory = getMemory();
  const hosting = getHosting();
  const cpus = os.cpus() || [];
  const load = os.loadavg();

  return {
    generated: new Date().toISOString(),
    panel: getPanelStatus(statusFile),
    ram: memory,
    storage: getStorage(projectDir),
    projectSize: directorySize(projectDir),
    hosting,
    os: `${os.type()} ${os.release()}`,
    architecture: process.arch.toUpperCase(),
    node: process.version,
    cpu: cpus.length ? `${cpus.length} CORES` : "N/A",
    cpuModel: cpus[0]?.model || "N/A",
    load: load.every(Number.isFinite)
      ? load.map(x => x.toFixed(2)).join(" / ")
      : "N/A",
    pid: String(process.pid),
    dataDir: path.basename(dataDir)
  };
}

function rect(image, x, y, w, h, color) {
  const x2 = Math.min(WIDTH, x + w);
  const y2 = Math.min(HEIGHT, y + h);
  for (let py = Math.max(0, y); py < y2; py++) {
    for (let px = Math.max(0, x); px < x2; px++) {
      image.setPixelColor(color, px, py);
    }
  }
}

function txt(image, font, value, x, y, maxWidth = 500) {
  image.print({ font, x, y, text: String(value), maxWidth });
}

function bar(image, x, y, width, percent, color) {
  rect(image, x, y, width, 10, C.track);
  if (Number.isFinite(percent)) {
    const w = Math.max(0, Math.min(width, width * percent / 100));
    if (w > 0) rect(image, x, y, w, 10, color);
  }
}

async function createSessionCard(options = {}) {
  const projectDir = path.resolve(
    options.projectDir || path.resolve(__dirname, "..")
  );
  const dataDir = path.resolve(
    options.dataDir || projectDir
  );
  const statusFile = path.join(dataDir, "panel-status.json");
  const m = getSystemMetrics(dataDir, projectDir, statusFile);

  const fontRoot = path.resolve(
    path.dirname(require.resolve("@jimp/plugin-print")),
    "../fonts/open-sans"
  );

  async function font(size) {
    const name = `open-sans-${size}-white`;
    const file = path.join(fontRoot, name, `${name}.fnt`);
    if (!fs.existsSync(file)) throw new Error(`Missing font: ${file}`);
    return loadFont(file);
  }

  const [f8, f16, f32, f64] = await Promise.all([
    font(8), font(16), font(32), font(64)
  ]);

  const image = new Jimp({
    width: WIDTH,
    height: HEIGHT,
    color: C.bg
  });

  // Header
  rect(image, 0, 0, WIDTH, 7, C.cyan);
  txt(image, f64, "QUASAR", 48, 30, 450);
  txt(image, f16, "SYSTEM MONITORING CENTER", 55, 108, 650);
  txt(image, f8, `LIVE SNAPSHOT  /  ${m.generated}`, 870, 65, 470);
  rect(image, 48, 150, 1304, 2, C.border);

  // Panel status
  rect(image, 48, 175, 1304, 145, C.panel);
  rect(image, 48, 175, 7, 145, m.panel.online ? C.green : C.red);
  txt(image, f8, "PANEL STATUS", 78, 194, 300);
  txt(image, f32, m.panel.online ? "ONLINE" : "OFFLINE", 78, 225, 350);
  txt(image, f8, "PANEL UPTIME", 510, 194, 300);
  txt(image, f32, m.panel.uptime, 510, 225, 550);
  txt(image, f8, `STARTED: ${m.panel.startedAt}`, 78, 285, 700);
  txt(image, f8, `PROCESS ID: ${m.pid}`, 950, 285, 300);

  // Memory
  rect(image, 48, 345, 630, 205, C.panel);
  txt(image, f16, "MEMORY MONITOR", 78, 365, 450);
  txt(image, f32, formatBytes(m.ram.used), 78, 405, 350);
  txt(image, f8, `USED / ${formatBytes(m.ram.total)} TOTAL`, 80, 455, 500);
  bar(image, 80, 485, 550, m.ram.percent, C.cyan);
  txt(image, f8, `FREE: ${formatBytes(m.ram.free)}  |  ${m.ram.percent ?? "N/A"}%`, 80, 510, 540);
  txt(image, f8, `SOURCE: ${m.ram.source}`, 80, 530, 500);

  // Storage
  rect(image, 722, 345, 630, 205, C.panel);
  txt(image, f16, "STORAGE MONITOR", 752, 365, 450);
  txt(image, f32, formatBytes(m.storage.used), 752, 405, 350);
  txt(image, f8, `USED / ${formatBytes(m.storage.total)} TOTAL`, 754, 455, 500);
  bar(image, 754, 485, 550, m.storage.percent, C.green);
  txt(image, f8, `FREE: ${formatBytes(m.storage.free)}  |  ${m.storage.percent ?? "N/A"}%`, 754, 510, 540);

  // Project and hosting
  rect(image, 48, 575, 405, 150, C.panel);
  txt(image, f16, "PROJECT FOOTPRINT", 75, 595, 350);
  txt(image, f32, formatBytes(m.projectSize), 75, 635, 320);
  txt(image, f8, "SOURCE FILES EXCLUDING DEPENDENCIES", 77, 690, 350);

  rect(image, 475, 575, 405, 150, C.panel);
  txt(image, f16, "HOSTING PROVIDER", 502, 595, 350);
  txt(image, f32, m.hosting.provider, 502, 635, 350);
  txt(image, f8, `ENV: ${m.hosting.environment}`, 504, 690, 350);

  rect(image, 902, 575, 450, 150, C.panel);
  txt(image, f16, "SERVICE", 929, 595, 350);
  txt(image, f32, m.hosting.service, 929, 635, 390);
  txt(image, f8, `NODE PROCESS: ${m.pid}`, 931, 690, 350);

  // System details
  rect(image, 48, 750, 1304, 175, C.panel2);
  txt(image, f16, "SYSTEM INFORMATION", 76, 770, 500);
  txt(image, f8, `OS: ${m.os}`, 78, 815, 600);
  txt(image, f8, `ARCH: ${m.architecture}`, 78, 850, 500);
  txt(image, f8, `NODE: ${m.node}`, 78, 885, 500);

  txt(image, f8, "CPU INFORMATION", 720, 770, 350);
  txt(image, f8, `CORES: ${m.cpu}`, 722, 815, 500);
  txt(image, f8, `MODEL: ${m.cpuModel}`, 722, 850, 600);
  txt(image, f8, `LOAD: ${m.load}`, 722, 885, 500);

  // Footer
  rect(image, 48, 950, 1304, 2, C.border);
  txt(image, f8, "QUASAR MONITOR  /  VALUES READ FROM CURRENT RUNTIME", 50, 965, 900);
  txt(image, f8, "AUTO GENERATED PNG", 1120, 965, 230);

  return image.getBuffer("image/png");
}

module.exports = {
  createSessionCard,
  formatBytes,
  formatDuration,
  getSystemMetrics
};
