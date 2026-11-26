"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn } = require("child_process");
const multer = require("multer");

const app = express();
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || ROOT);
const GENERATED_BOTS_DIR = path.join(DATA_DIR, "generated-bots");
const WORKSPACE_ZIP_DIR = path.join(DATA_DIR, "zip-workspaces");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(GENERATED_BOTS_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_ZIP_DIR, { recursive: true });

const ENV_FILE = path.join(ROOT, ".telegram.env");
try {
  const envText = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const STATUS_FILE = path.join(DATA_DIR, "bot-status.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PANEL_STATUS_FILE = path.join(DATA_DIR, "panel-status.json");
const PORT = Number(process.env.PORT || process.env.PANEL_PORT || 3001);
const PASSWORD = process.env.PANEL_PASSWORD || "ShadowBluePanel2026!";

const liveBridgeApis = new Map();
global.setShadowBridgeApi = (sessionId, apiInstance) => {
  liveBridgeApis.set(String(sessionId || "1"), apiInstance);
};
global.getShadowBridgeApi = (sessionId = "1") => {
  return liveBridgeApis.get(String(sessionId || "1")) || null;
};

/* =========================================================
   محرك داخلي خالص لفك ضغط وإنشاء ملفات ZIP بدون أدوات خارجية
   ========================================================= */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function extractZipBuffer(zipBuf, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;

  let eocdPos = -1;
  const minPos = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minPos; i--) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error("ملف ZIP غير صالح أو تالف");

  const totalEntries = zipBuf.readUInt16LE(eocdPos + 10);
  const cenOffset = zipBuf.readUInt32LE(eocdPos + 16);

  let ptr = cenOffset;
  let extractedCount = 0;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (ptr + 46 > zipBuf.length || zipBuf.readUInt32LE(ptr) !== CEN_SIG) break;

    const compression = zipBuf.readUInt16LE(ptr + 10);
    const compSize = zipBuf.readUInt32LE(ptr + 20);
    const nameLen = zipBuf.readUInt16LE(ptr + 28);
    const extraLen = zipBuf.readUInt16LE(ptr + 30);
    const commentLen = zipBuf.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(ptr + 42);

    const rawName = zipBuf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    const normalizedName = rawName.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalizedName || normalizedName.split("/").includes("..")) continue;

    const resolvedTarget = path.resolve(destDir, normalizedName);
    const resolvedRoot = path.resolve(destDir);
    if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) continue;

    if (normalizedName.endsWith("/")) {
      fs.mkdirSync(resolvedTarget, { recursive: true });
      continue;
    }

    if (localHeaderOffset + 30 > zipBuf.length || zipBuf.readUInt32LE(localHeaderOffset) !== LOC_SIG) continue;
    const locNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const locExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + locNameLen + locExtraLen;
    const compData = zipBuf.subarray(dataStart, dataStart + compSize);

    let fileData;
    if (compression === 0) {
      fileData = Buffer.from(compData);
    } else if (compression === 8) {
      fileData = zlib.inflateRawSync(compData);
    } else {
      throw new Error(`طريقة ضغط غير مدعومة داخل ZIP (${compression})`);
    }

    fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
    fs.writeFileSync(resolvedTarget, fileData);
    extractedCount++;
  }

  return extractedCount;
}

function collectFilesRecursive(dir, base = "") {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(full, rel));
    } else if (entry.isFile()) {
      results.push({ rel, full });
    }
  }
  return results;
}

function buildZipFromDirectory(sourceDir, outZipPath) {
  const files = collectFilesRecursive(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.full);
    const nameBuf = Buffer.from(f.rel.replace(/\\/g, "/"), "utf8");
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);

    const locHeader = Buffer.alloc(30);
    locHeader.writeUInt32LE(0x04034b50, 0);
    locHeader.writeUInt16LE(20, 4);
    locHeader.writeUInt16LE(0x0800, 6); // UTF-8
    locHeader.writeUInt16LE(8, 8); // Deflate
    locHeader.writeUInt32LE(crc, 14);
    locHeader.writeUInt32LE(compressed.length, 18);
    locHeader.writeUInt32LE(data.length, 22);
    locHeader.writeUInt16LE(nameBuf.length, 26);
    locHeader.writeUInt16LE(0, 28);

    localParts.push(locHeader, nameBuf, compressed);

    const cenHeader = Buffer.alloc(46);
    cenHeader.writeUInt32LE(0x02014b50, 0);
    cenHeader.writeUInt16LE(20, 4);
    cenHeader.writeUInt16LE(20, 6);
    cenHeader.writeUInt16LE(0x0800, 8);
    cenHeader.writeUInt16LE(8, 10);
    cenHeader.writeUInt32LE(crc, 16);
    cenHeader.writeUInt32LE(compressed.length, 20);
    cenHeader.writeUInt32LE(data.length, 24);
    cenHeader.writeUInt16LE(nameBuf.length, 28);
    cenHeader.writeUInt16LE(0, 30);
    cenHeader.writeUInt16LE(0, 32);
    cenHeader.writeUInt16LE(0, 34);
    cenHeader.writeUInt16LE(0, 36);
    cenHeader.writeUInt32LE(0, 38);
    cenHeader.writeUInt32LE(offset, 42);

    centralParts.push(cenHeader, nameBuf);
    offset += locHeader.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const localBuf = Buffer.concat(localParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outZipPath, Buffer.concat([localBuf, centralBuf, eocd]));
}

/* =========================================================
   واجهة زرقاء جديدة كلياً (Sidebar + Glass Blue Cards)
   ========================================================= */
function renderBlueModernPanelHtml() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>لوحة التحكم الزرقاء — BOT STUDIO</title>
  <style>
    :root {
      --bg: #050b16;
      --side: #091326;
      --card: #0d1b33;
      --card-hi: #13274a;
      --blue: #2563eb;
      --blue-bright: #38bdf8;
      --line: #1d355e;
      --text: #eff6ff;
      --sub: #93c5fd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, system-ui, sans-serif;
      background: linear-gradient(135deg, #050b16 0%, #08152b 100%);
      color: var(--text);
      min-height: 100vh;
    }
    .shell { display: flex; min-height: 100vh; }
    .sidebar {
      width: 245px;
      background: var(--side);
      border-left: 1px solid var(--line);
      padding: 18px 12px;
      flex-shrink: 0;
    }
    .logo {
      font-size: 1.1rem;
      font-weight: 900;
      color: var(--blue-bright);
      padding: 8px 10px 16px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 14px;
    }
    .menu-btn {
      width: 100%;
      text-align: right;
      background: transparent;
      color: var(--sub);
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 6px;
      cursor: pointer;
      font-weight: 700;
      font-size: 0.9rem;
    }
    .menu-btn.active, .menu-btn:hover {
      background: rgba(37, 99, 235, 0.22);
      color: #fff;
      border-color: rgba(56, 189, 248, 0.35);
    }
    .content-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .header-bar {
      background: rgba(9, 19, 38, 0.9);
      border-bottom: 1px solid var(--line);
      padding: 12px 18px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .main-pad { padding: 18px; max-width: 1240px; width: 100%; margin: 0 auto; }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    }
    .card h3 {
      margin: 0 0 12px;
      color: var(--blue-bright);
      font-size: 1rem;
    }
    .flex-row { display: flex; gap: 14px; flex-wrap: wrap; }
    .flex-col { flex: 1; min-width: 280px; }
    input, select, textarea {
      width: 100%;
      background: #071122;
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 11px;
      margin-bottom: 10px;
      font-size: 0.9rem;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--blue-bright);
    }
    .btn {
      background: var(--blue);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 9px 14px;
      font-weight: 700;
      cursor: pointer;
      font-size: 0.86rem;
    }
    .btn:hover { background: #1d4ed8; }
    .btn.alt {
      background: var(--card-hi);
      color: var(--sub);
      border: 1px solid var(--line);
    }
    .btn.stop { background: #dc2626; color: #fff; }
    .list-box {
      max-height: 320px;
      overflow-y: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #071122;
    }
    .list-row {
      padding: 9px 11px;
      border-bottom: 1px solid var(--line);
      cursor: pointer;
      font-size: 0.86rem;
    }
    .list-row:hover, .list-row.active { background: rgba(56, 189, 248, 0.16); color: #fff; }
    .msg-stream {
      height: 250px;
      overflow-y: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #071122;
      padding: 10px;
      margin-bottom: 10px;
    }
    .msg-item {
      background: var(--card-hi);
      border-right: 3px solid var(--blue-bright);
      padding: 7px 10px;
      border-radius: 6px;
      margin-bottom: 7px;
      font-size: 0.86rem;
    }
    .msg-item span { display: block; color: var(--sub); font-size: 0.74rem; margin-bottom: 2px; }
    .chip {
      display: inline-block;
      background: rgba(37, 99, 235, 0.2);
      border: 1px solid var(--line);
      color: var(--sub);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.8rem;
    }
    .log-area {
      background: #040912;
      color: #7dd3fc;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      height: 210px;
      overflow-y: auto;
      font-family: Consolas, monospace;
      font-size: 0.8rem;
      white-space: pre-wrap;
    }
    .toast {
      position: fixed;
      bottom: 16px;
      left: 16px;
      background: var(--blue);
      color: #fff;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 700;
      display: none;
      z-index: 999;
    }
    .hidden { display: none !important; }
    a.dl { color: var(--blue-bright); font-weight: 800; }
    @media (max-width: 820px) {
      .shell { flex-direction: column; }
      .sidebar { width: 100%; border-left: none; border-bottom: 1px solid var(--line); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="logo">💠 BLUE BOT STUDIO</div>
      <button class="menu-btn active" onclick="showSection('secChat', this)">💬 ماسنجر وتشغيل أوامر الغروب</button>
      <button class="menu-btn" onclick="showSection('secDm', this)">✉️ رسائل الخاص (شخص لشخص)</button>
      <button class="menu-btn" onclick="showSection('secZipBuilder', this)">📦 فك وإكمال ZIP للبوت</button>
      <button class="menu-btn" onclick="showSection('secGroupsNicks', this)">🏷️ الأسماء والكنيات</button>
      <button class="menu-btn" onclick="showSection('secSettings', this)">⚙️ المطورين والكوكيز والسجل</button>
    </aside>

    <div class="content-area">
      <div class="header-bar">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="chip" id="botStateChip">الحالة: فحص...</span>
          <span class="chip" id="latencyChip">Ping: -</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <select id="sessionSel" style="width:auto;margin:0;">
            <option value="1">الجلسة 1</option>
            <option value="2">الجلسة 2</option>
            <option value="3">الجلسة 3</option>
          </select>
          <button class="btn alt" onclick="controlBot('start')">تشغيل</button>
          <button class="btn alt" onclick="controlBot('restart')">إعادة تشغيل</button>
          <button class="btn stop" onclick="controlBot('stop')">إيقاف</button>
        </div>
      </div>

      <div class="main-pad">
        <div id="loginBox" class="card hidden" style="max-width:400px;margin:30px auto;">
          <h3>تسجيل الدخول للواجهة الزرقاء</h3>
          <input type="password" id="loginPass" placeholder="أدخل كلمة المرور" onkeydown="if(event.key==='Enter') loginUser()" />
          <button class="btn" style="width:100%;" onclick="loginUser()">دخول</button>
        </div>

        <div id="workspaceBox" class="hidden">
          <!-- 1. ماسنجر وتشغيل أوامر الغروب -->
          <div id="secChat" class="section-pane">
            <div class="card">
              <h3>الغروبات والمحادثات والتحكم المباشر</h3>
              <div class="flex-row">
                <div class="flex-col" style="max-width:340px;">
                  <div style="display:flex;gap:6px;margin-bottom:8px;">
                    <button class="btn" onclick="fetchThreads()">تحديث</button>
                    <input id="threadSearch" placeholder="بحث..." oninput="renderFilteredThreads()" style="margin:0;" />
                  </div>
                  <div id="threadsBox" class="list-box">
                    <div class="list-row">اضغط تحديث لعرض الغروبات والمحادثات...</div>
                  </div>
                </div>

                <div class="flex-col">
                  <div style="display:flex;gap:6px;margin-bottom:8px;">
                    <input id="activeTidInput" placeholder="Thread ID الغروب أو المحادثة" style="margin:0;" />
                    <button class="btn alt" onclick="openThread(document.getElementById('activeTidInput').value.trim())">فتح</button>
                  </div>
                  <div id="threadMsgsBox" class="msg-stream">
                    <div class="msg-item"><span>النظام</span>اختر غروباً من القائمة أو أدخل Thread ID.</div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <input id="threadSendInput" placeholder="اكتب رسالة أو أمراً لإرساله بحساب البوت..." style="margin:0;" onkeydown="if(event.key==='Enter') sendThreadMsg()" />
                    <button class="btn" onclick="sendThreadMsg()">إرسال</button>
                  </div>

                  <hr style="border:none;border-top:1px solid var(--line);margin:14px 0;" />
                  <h3>تشغيل أمر داخل الغروب المحدد دون إرساله في الغروب</h3>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <input id="cmdTidInput" placeholder="ID الغروب" style="width:180px;margin:0;" />
                    <input id="cmdValueInput" placeholder="الأمر مثل: !help أو !ping" style="flex:1;min-width:170px;margin:0;" onkeydown="if(event.key==='Enter') runCmdInGroup()" />
                    <button class="btn" onclick="runCmdInGroup()">⚡ تشغيل الأمر</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. رسائل الخاص -->
          <div id="secDm" class="section-pane hidden">
            <div class="card">
              <h3>الرسائل الخاصة (شخص لشخص - بدون مجموعات)</h3>
              <div class="flex-row">
                <div class="flex-col" style="max-width:340px;">
                  <div style="display:flex;gap:6px;margin-bottom:8px;">
                    <button class="btn" onclick="fetchDmThreads()">تحديث الخاص</button>
                    <input id="dmUidInput" placeholder="User ID الشخص" style="margin:0;" />
                    <button class="btn alt" onclick="openDm(document.getElementById('dmUidInput').value.trim())">فتح</button>
                  </div>
                  <div id="dmListBox" class="list-box">
                    <div class="list-row">اضغط تحديث الخاص لعرض الأشخاص...</div>
                  </div>
                </div>
                <div class="flex-col">
                  <div id="dmMsgsBox" class="msg-stream">
                    <div class="msg-item"><span>الخاص</span>اختر شخصاً أو أدخل User ID للمراسلة الخاصة.</div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <input id="dmSendInput" placeholder="اكتب رسالة خاصة..." style="margin:0;" onkeydown="if(event.key==='Enter') sendDm()" />
                    <button class="btn" onclick="sendDm()">إرسال خاص</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. فك ضغط وإكمال ملف ZIP للبوت بالذي يحتاجه -->
          <div id="secZipBuilder" class="section-pane hidden">
            <div class="card">
              <h3>📦 فك ضغط ملف ZIP وإكمال البوت بأوامر بوتك الحالي وما يحتاجه</h3>
              <label>ملف ZIP للبوت الذي صنعته</label>
              <input type="file" id="zipUploadInput" accept=".zip" />

              <div class="flex-row">
                <div class="flex-col">
                  <label>اسم البوت</label>
                  <input id="targetBotName" placeholder="مثال: SHADOW_PRO" />
                </div>
                <div class="flex-col">
                  <label>المكتبة المستخدمة</label>
                  <input id="targetBotLib" placeholder="مثال: ws3-fca أو fca-unofficial" />
                </div>
              </div>

              <label>الأوامر المطلوب إضافتها من بوتك الحالي (مفصولة بفاصلة، أو اتركها فارغة لإضافة الأوامر تلقائياً)</label>
              <input id="targetCmdsList" placeholder="مثال: help, ping, uptime" />
              <div id="availableCmdsText" style="font-size:0.82rem;color:var(--sub);margin-bottom:10px;"></div>

              <label>ما الذي يحتاجه البوت ليكتمل؟ (مثال: إضافة ملف تشغيل رئيسي، package.json، معالج أوامر، ربط الغروبات...)</label>
              <textarea id="botNeedsText" rows="3" placeholder="اكتب متطلبات إكمال البوت..."></textarea>

              <button class="btn" onclick="completeZipBot()">🚀 فك الضغط وإكمال البوت وتوليد رابط التحميل</button>
              <div id="zipResultLink" style="margin-top:12px;"></div>
              <textarea id="zipReportBox" rows="10" style="margin-top:10px;" placeholder="تقرير فك الضغط والملفات والأوامر المضافة سيظهر هنا..."></textarea>
            </div>
          </div>

          <!-- 4. الأسماء والكنيات -->
          <div id="secGroupsNicks" class="section-pane hidden">
            <div class="card">
              <h3>تغيير اسم الغروب وتغيير الكنيات</h3>
              <div class="flex-row">
                <div class="flex-col">
                  <label>رقم الغروب (Thread ID)</label>
                  <input id="editGrpId" placeholder="Thread ID الغروب" />
                  <label>اسم الغروب الجديد</label>
                  <input id="editGrpTitle" placeholder="الاسم الجديد" />
                  <button class="btn" onclick="saveGroupTitle()">تغيير اسم الغروب</button>
                </div>
                <div class="flex-col">
                  <label>معرّف العضو (اتركه فارغاً لتغيير كنية البوت)</label>
                  <input id="editNickUid" placeholder="User ID العضو أو اتركه فارغاً" />
                  <label>الكنية الجديدة (اتركها فارغة لإزالتها)</label>
                  <input id="editNickVal" placeholder="الكنية الجديدة" />
                  <button class="btn" onclick="saveMemberNick()">تغيير الكنية</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 5. المطورين والكوكيز والسجل -->
          <div id="secSettings" class="section-pane hidden">
            <div class="card">
              <h3>المطورون والبادئة والكوكيز</h3>
              <label>معرّفات المطورين (مفصولة بفاصلة، حتى 2)</label>
              <input id="devsField" placeholder="1000..., 1000..." />
              <button class="btn" onclick="saveDevs()">حفظ المطورين</button>

              <hr style="border:none;border-top:1px solid var(--line);margin:14px 0;" />
              <label>البادئة (Prefix)</label>
              <input id="prefixField" maxlength="5" />
              <label><input type="checkbox" id="freePrefixField" style="width:auto;" /> بادئة حرة</label>
              <button class="btn" onclick="savePrefixCfg()">حفظ البادئة</button>

              <hr style="border:none;border-top:1px solid var(--line);margin:14px 0;" />
              <label>كوكيز / appState للجلسة</label>
              <textarea id="cookiesField" rows="5" placeholder='[{"key":"c_user","value":"..."},{"key":"xs","value":"..."}]'></textarea>
              <button class="btn" onclick="saveCookiesData()">حفظ الكوكيز</button>
            </div>

            <div class="card">
              <h3>سجل التشغيل</h3>
              <div id="liveLogs" class="log-area">جاري التحميل...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toastBar" class="toast"></div>

  <script>
    let threadsCache = [];
    let currentTid = "";
    let currentDmUid = "";

    function notify(msg) {
      const el = document.getElementById("toastBar");
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(window.__nt);
      window.__nt = setTimeout(() => { el.style.display = "none"; }, 3500);
    }

    function curSid() { return document.getElementById("sessionSel").value || "1"; }

    function showSection(id, btn) {
      document.querySelectorAll(".section-pane").forEach(p => p.classList.add("hidden"));
      document.getElementById(id).classList.remove("hidden");
      document.querySelectorAll(".menu-btn").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
    }

    async function reqApi(url, opts = {}) {
      const t0 = performance.now();
      const isFd = opts.body instanceof FormData;
      const headers = isFd ? { ...(opts.headers || {}) } : { "Content-Type": "application/json", ...(opts.headers || {}) };
      const res = await fetch(url, { ...opts, headers });
      document.getElementById("latencyChip").textContent = "Ping: " + Math.round(performance.now() - t0) + "ms";
      if (res.status === 401) {
        document.getElementById("workspaceBox").classList.add("hidden");
        document.getElementById("loginBox").classList.remove("hidden");
        throw new Error("يلزم تسجيل الدخول");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "حدث خطأ");
      return data;
    }

    async function loginUser() {
      try {
        const password = document.getElementById("loginPass").value;
        const r = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return notify(j.error || "كلمة المرور غير صحيحة");
        document.getElementById("loginBox").classList.add("hidden");
        document.getElementById("workspaceBox").classList.remove("hidden");
        await refreshState();
      } catch (e) { notify(e.message); }
    }

    async function refreshState() {
      try {
        await reqApi("/api/me");
        document.getElementById("loginBox").classList.add("hidden");
        document.getElementById("workspaceBox").classList.remove("hidden");
      } catch { return; }

      try {
        const d = await reqApi("/api/sessions/" + curSid() + "/dashboard");
        const chip = document.getElementById("botStateChip");
        chip.textContent = d.bot.online ? ("متصل: " + (d.bot.botId || curSid())) : "متوقف";
        chip.style.borderColor = d.bot.online ? "#22c55e" : "#ef4444";

        document.getElementById("devsField").value = (d.developerIds || []).join(", ");
        document.getElementById("prefixField").value = d.prefix || "!";
        document.getElementById("freePrefixField").checked = !!d.freePrefix;
        document.getElementById("availableCmdsText").textContent =
          "الأوامر الموجودة في بوتك الحالي: " + ((d.commands && d.commands.length) ? d.commands.join(", ") : "لا توجد ملفات أوامر");
      } catch (e) { notify(e.message); }

      try {
        const l = await reqApi("/api/sessions/" + curSid() + "/logs");
        document.getElementById("liveLogs").textContent =
          (l.logs || []).map(x => "[" + x.time.slice(11, 19) + "] " + x.text).join("\\n") || "لا توجد سجلات";
      } catch {}
    }

    async function controlBot(action) {
      try {
        const r = await reqApi("/api/sessions/" + curSid() + "/" + action, { method: "POST" });
        notify(r.message || "تم");
        refreshState();
      } catch (e) { notify(e.message); }
    }

    function renderFilteredThreads() {
      const q = document.getElementById("threadSearch").value.trim().toLowerCase();
      const list = q ? threadsCache.filter(t => String(t.name).toLowerCase().includes(q) || String(t.threadID).includes(q)) : threadsCache;
      const box = document.getElementById("threadsBox");
      if (!list.length) {
        box.innerHTML = '<div class="list-row">لا توجد غروبات أو محادثات.</div>';
        return;
      }
      box.innerHTML = list.map(t =>
        '<div class="list-row ' + (t.threadID === currentTid ? "active" : "") + '" onclick="openThread(\\'' + t.threadID + '\\')">' +
        (t.isGroup ? "👥 " : "💬 ") + (t.name || t.threadID) + ' <small style="color:#93c5fd;">(' + t.threadID + ')</small></div>'
      ).join("");
    }

    async function fetchThreads() {
      try {
        const r = await reqApi("/api/sessions/" + curSid() + "/messenger/threads");
        threadsCache = r.threads || [];
        renderFilteredThreads();
        notify("تم جلب " + threadsCache.length + " محادثة/غروب");
      } catch (e) { notify(e.message); }
    }

    async function openThread(tid) {
      if (!tid) return notify("أدخل Thread ID");
      currentTid = String(tid);
      document.getElementById("activeTidInput").value = currentTid;
      document.getElementById("cmdTidInput").value = currentTid;
      document.getElementById("editGrpId").value = currentTid;
      renderFilteredThreads();

      try {
        const r = await reqApi("/api/sessions/" + curSid() + "/messenger/messages?threadID=" + encodeURIComponent(currentTid));
        const msgs = r.messages || [];
        const box = document.getElementById("threadMsgsBox");
        box.innerHTML = msgs.length
          ? msgs.map(m => '<div class="msg-item"><span>' + (m.senderName || m.senderID) + '</span>' + (m.body || "[مرفق/حدث]") + '</div>').join("")
          : '<div class="msg-item"><span>النظام</span>تم تحديد (' + currentTid + ') بنجاح.</div>';
        box.scrollTop = box.scrollHeight;
      } catch (e) { notify(e.message); }
    }

    async function sendThreadMsg() {
      const tid = currentTid || document.getElementById("activeTidInput").value.trim();
      const message = document.getElementById("threadSendInput").value.trim();
      if (!tid || !message) return notify("حدد المحادثة واكتب الرسالة");
      try {
        await reqApi("/api/sessions/" + curSid() + "/messenger/send", {
          method: "POST",
          body: JSON.stringify({ threadID: tid, message })
        });
        document.getElementById("threadSendInput").value = "";
        notify("تم الإرسال بحساب البوت");
        openThread(tid);
      } catch (e) { notify(e.message); }
    }

    async function runCmdInGroup() {
      const threadID = document.getElementById("cmdTidInput").value.trim() || currentTid;
      const command = document.getElementById("cmdValueInput").value.trim();
      if (!threadID || !command) return notify("حدد الغروب واكتب الأمر");
      try {
        await reqApi("/api/sessions/" + curSid() + "/messenger/run-command", {
          method: "POST",
          body: JSON.stringify({ threadID, command })
        });
        notify("تم إرسال الأمر للتنفيذ داخل الغروب");
      } catch (e) { notify(e.message); }
    }

    async function fetchDmThreads() {
      try {
        const r = await reqApi("/api/sessions/" + curSid() + "/messenger/private-threads");
        const list = r.threads || [];
        const box = document.getElementById("dmListBox");
        box.innerHTML = list.length
          ? list.map(u => '<div class="list-row ' + (u.userID === currentDmUid ? "active" : "") + '" onclick="openDm(\\'' + u.userID + '\\')">👤 ' + (u.name || u.userID) + ' <small style="color:#93c5fd;">(' + u.userID + ')</small></div>').join("")
          : '<div class="list-row">لا توجد محادثات خاصة حالياً.</div>';
        notify("تم جلب " + list.length + " محادثة خاصة");
      } catch (e) { notify(e.message); }
    }

    async function openDm(uid) {
      if (!uid) return notify("أدخل User ID");
      currentDmUid = String(uid);
      document.getElementById("dmUidInput").value = currentDmUid;
      try {
        const r = await reqApi("/api/sessions/" + curSid() + "/messenger/private-messages?userID=" + encodeURIComponent(currentDmUid));
        const msgs = r.messages || [];
        const box = document.getElementById("dmMsgsBox");
        box.innerHTML = msgs.length
          ? msgs.map(m => '<div class="msg-item"><span>' + (m.senderName || m.senderID) + '</span>' + (m.body || "[مرفق/حدث]") + '</div>').join("")
          : '<div class="msg-item"><span>الخاص</span>جاهز للمراسلة الخاصة مع ' + currentDmUid + '</div>';
        box.scrollTop = box.scrollHeight;
      } catch (e) { notify(e.message); }
    }

    async function sendDm() {
      const userID = currentDmUid || document.getElementById("dmUidInput").value.trim();
      const message = document.getElementById("dmSendInput").value.trim();
      if (!userID || !message) return notify("حدد الشخص واكتب الرسالة");
      try {
        await reqApi("/api/sessions/" + curSid() + "/messenger/private-send", {
          method: "POST",
          body: JSON.stringify({ userID, message })
        });
        document.getElementById("dmSendInput").value = "";
        notify("تم إرسال الرسالة الخاصة");
        openDm(userID);
      } catch (e) { notify(e.message); }
    }

    async function completeZipBot() {
      try {
        const zipFile = document.getElementById("zipUploadInput").files?.[0];
        if (!zipFile) return notify("اختر ملف ZIP للبوت أولاً");
        const fd = new FormData();
        fd.append("archive", zipFile);
        fd.append("botName", document.getElementById("targetBotName").value.trim());
        fd.append("libraryName", document.getElementById("targetBotLib").value.trim());
        fd.append("selectedCommands", document.getElementById("targetCmdsList").value.trim());
        fd.append("needs", document.getElementById("botNeedsText").value.trim());

        const r = await reqApi("/api/sessions/" + curSid() + "/ai/complete-zip", { method: "POST", body: fd });
        document.getElementById("zipResultLink").innerHTML = r.downloadUrl
          ? '✅ تم فك الضغط وإكمال البوت: <a class="dl" href="' + r.downloadUrl + '" download>تحميل الملف المكتمل (' + r.fileName + ')</a>'
          : "";
        document.getElementById("zipReportBox").value = r.summary || "";
        notify("تم فك ضغط ZIP وإكمال البوت بنجاح");
      } catch (e) { notify(e.message); }
    }

    async function saveGroupTitle() {
      const threadID = document.getElementById("editGrpId").value.trim() || currentTid;
      const title = document.getElementById("editGrpTitle").value.trim();
      if (!threadID || !title) return notify("أدخل رقم الغروب والاسم الجديد");
      try {
        await reqApi("/api/sessions/" + curSid() + "/messenger/group-name", {
          method: "PUT",
          body: JSON.stringify({ threadID, title })
        });
        notify("تم إرسال تغيير اسم الغروب");
      } catch (e) { notify(e.message); }
    }

    async function saveMemberNick() {
      const threadID = document.getElementById("editGrpId").value.trim() || currentTid;
      const userID = document.getElementById("editNickUid").value.trim();
      const nickname = document.getElementById("editNickVal").value;
      if (!threadID) return notify("أدخل رقم الغروب");
      try {
        await reqApi("/api/sessions/" + curSid() + "/messenger/nickname", {
          method: "PUT",
          body: JSON.stringify({ threadID, userID: userID || undefined, nickname })
        });
        notify("تم إرسال تغيير الكنية");
      } catch (e) { notify(e.message); }
    }

    async function saveDevs() {
      const ids = document.getElementById("devsField").value.split(",").map(s => s.trim()).filter(Boolean);
      try {
        const r = await reqApi("/api/sessions/" + curSid() + "/developer", {
          method: "PUT",
          body: JSON.stringify({ ids })
        });
        notify(r.message || "تم حفظ المطورين");
      } catch (e) { notify(e.message); }
    }

    async function savePrefixCfg() {
      try {
        await reqApi("/api/sessions/" + curSid() + "/settings", {
          method: "PUT",
          body: JSON.stringify({
            prefix: document.getElementById("prefixField").value.trim(),
            freePrefix: document.getElementById("freePrefixField").checked
          })
        });
        notify("تم حفظ الإعدادات");
      } catch (e) { notify(e.message); }
    }

    async function saveCookiesData() {
      try {
        const cookies = document.getElementById("cookiesField").value.trim();
        const r = await reqApi("/api/sessions/" + curSid() + "/cookies", {
          method: "POST",
          body: JSON.stringify({ cookies })
        });
        notify(r.message || "تم حفظ الكوكيز");
      } catch (e) { notify(e.message); }
    }

    document.getElementById("sessionSel").addEventListener("change", refreshState);
    refreshState();
  </script>
</body>
</html>`;
}

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
if (fs.existsSync(PUBLIC_DIR)) {
  app.use("/shadowxdiablos/assets", express.static(PUBLIC_DIR));
}

app.get("/", (_req, res) => res.redirect("/shadowxdiablos"));
app.get("/shadowxdiablos", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderBlueModernPanelHtml());
});

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function auth(req, res, next) {
  const token = (req.headers.cookie || "").split(";").map(x => x.trim())
    .find(x => x.startsWith("shadow_blue_panel="))?.slice("shadow_blue_panel=".length);
  const expiresAt = token ? sessions.get(token) : null;
  if (!token || !expiresAt || Date.now() >= expiresAt) {
    return res.status(401).json({ error: "يلزم تسجيل الدخول" });
  }
  next();
}

app.post("/api/login", (req, res) => {
  if (!safeEqual(req.body?.password || "", PASSWORD)) {
    return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", `shadow_blue_panel=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${isHttps ? "; Secure" : ""}`);
  res.json({ ok: true });
});

app.get("/api/me", auth, (_req, res) => res.json({ ok: true }));

function getSessionFiles(id) {
  id = String(id);
  if (!/^[123]$/.test(id)) throw new Error("رقم الجلسة غير صالح");
  const suffix = id === "1" ? "" : id;
  return {
    session: path.join(DATA_DIR, "appState" + suffix + ".json"),
    data: path.join(DATA_DIR, "data" + suffix + ".json"),
    status: path.join(DATA_DIR, "bot-status" + suffix + ".json"),
    bridgeQueue: path.join(DATA_DIR, "panel-bridge-queue" + suffix + ".json"),
    port: id === "1" ? 3000 : id === "2" ? 3002 : 3003
  };
}

function validSession(req, res) {
  const id = String(req.params.id);
  if (!/^[123]$/.test(id)) {
    res.status(400).json({ error: "رقم الجلسة غير صالح" });
    return null;
  }
  return id;
}

function sessionData(id) {
  const files = getSessionFiles(id);
  return { files, data: readJson(files.data, {}) };
}

function enqueueBridge(sessionId, payload) {
  const files = getSessionFiles(sessionId);
  const q = readJson(files.bridgeQueue, []);
  const item = { id: crypto.randomBytes(8).toString("hex"), createdAt: new Date().toISOString(), ...payload };
  q.push(item);
  writeJsonAtomic(files.bridgeQueue, q);
}

function callFca(fn, args = []) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error("انتهت المهلة")); }
    }, 15000);
    const cb = (err, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(data);
    };
    try {
      const r = fn(...args, cb);
      if (r && typeof r.then === "function") r.then(v => cb(null, v), e => cb(e));
      else if (fn.length <= args.length) cb(null, r);
    } catch (e) { cb(e); }
  });
}

function collectFallbackThreads(data) {
  const map = new Map();
  if (Array.isArray(data.botGroups)) {
    for (const g of data.botGroups) {
      if (g && g.id) map.set(String(g.id), { threadID: String(g.id), name: g.name || String(g.id), isGroup: true });
    }
  }
  if (data.protected && typeof data.protected === "object") {
    for (const [gid, g] of Object.entries(data.protected)) {
      map.set(String(gid), { threadID: String(gid), name: g?.threadName || String(gid), isGroup: true });
    }
  }
  return [...map.values()];
}

app.get("/api/sessions/:id/messenger/threads", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const { data } = sessionData(id);
  const liveApi = global.getShadowBridgeApi(id);
  if (liveApi && typeof liveApi.getThreadList === "function") {
    try {
      const raw = await callFca(liveApi.getThreadList.bind(liveApi), [40, null, ["INBOX"]]);
      const threads = (Array.isArray(raw) ? raw : []).map(t => ({
        threadID: String(t.threadID || ""),
        name: t.threadName || t.name || String(t.threadID || ""),
        isGroup: Boolean(t.isGroup)
      })).filter(t => t.threadID);
      if (threads.length) return res.json({ threads });
    } catch (_) {}
  }
  res.json({ threads: collectFallbackThreads(data) });
});

app.get("/api/sessions/:id/messenger/messages", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const threadID = String(req.query.threadID || "").trim();
  if (!threadID) return res.status(400).json({ error: "حدد threadID" });
  const liveApi = global.getShadowBridgeApi(id);
  if (liveApi && typeof liveApi.getThreadHistory === "function") {
    try {
      const hist = await callFca(liveApi.getThreadHistory.bind(liveApi), [threadID, 25, null]);
      return res.json({
        messages: (Array.isArray(hist) ? hist : []).map(m => ({
          senderID: String(m.senderID || ""),
          senderName: m.senderName || String(m.senderID || ""),
          body: m.body || ""
        }))
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ messages: [] });
});

app.get("/api/sessions/:id/messenger/private-threads", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const liveApi = global.getShadowBridgeApi(id);
  if (liveApi && typeof liveApi.getThreadList === "function") {
    try {
      const raw = await callFca(liveApi.getThreadList.bind(liveApi), [50, null, ["INBOX"]]);
      const threads = (Array.isArray(raw) ? raw : [])
        .filter(t => t && !t.isGroup)
        .map(t => ({ userID: String(t.threadID || ""), name: t.threadName || t.name || String(t.threadID || "") }))
        .filter(t => t.userID);
      return res.json({ threads });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ threads: [] });
});

app.get("/api/sessions/:id/messenger/private-messages", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const userID = String(req.query.userID || "").trim();
  if (!userID) return res.status(400).json({ error: "حدد userID" });
  const liveApi = global.getShadowBridgeApi(id);
  if (liveApi && typeof liveApi.getThreadHistory === "function") {
    try {
      const hist = await callFca(liveApi.getThreadHistory.bind(liveApi), [userID, 25, null]);
      return res.json({
        messages: (Array.isArray(hist) ? hist : []).map(m => ({
          senderID: String(m.senderID || ""),
          senderName: m.senderName || String(m.senderID || ""),
          body: m.body || ""
        }))
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ messages: [] });
});

app.post("/api/sessions/:id/messenger/send", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const threadID = String(req.body?.threadID || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!threadID || !message) return res.status(400).json({ error: "المحادثة والرسالة مطلوبة" });
  const liveApi = global.getShadowBridgeApi(id);
  if (liveApi && typeof liveApi.sendMessage === "function") {
    try { await callFca(liveApi.sendMessage.bind(liveApi), [message, threadID]); return res.json({ ok: true }); } catch (_) {}
  }
  enqueueBridge(id, { type: "sendMessage", threadID, message });
  res.json({ ok: true });
});

app.post("/api/sessions/:id/messenger/private-send", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const userID = String(req.body?.userID || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!userID || !message) return res.status(400).json({ error: "معرّف الشخص والرسالة مطلوبان" });
  const liveApi = global.getShadowBridgeApi(id);
  if (liveApi && typeof liveApi.sendMessage === "function") {
    try { await callFca(liveApi.sendMessage.bind(liveApi), [message, userID]); return res.json({ ok: true }); } catch (_) {}
  }
  enqueueBridge(id, { type: "sendMessage", threadID: userID, message, isPrivate: true });
  res.json({ ok: true });
});

app.post("/api/sessions/:id/messenger/run-command", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const threadID = String(req.body?.threadID || "").trim();
  const command = String(req.body?.command || "").trim();
  if (!threadID || !command) return res.status(400).json({ error: "معرّف الغروب والأمر مطلوبان" });
  enqueueBridge(id, { type: "runCommand", threadID, command });
  res.json({ ok: true });
});

app.put("/api/sessions/:id/messenger/group-name", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const threadID = String(req.body?.threadID || "").trim();
  const title = String(req.body?.title || "").trim();
  if (!threadID || !title) return res.status(400).json({ error: "رقم الغروب والاسم مطلوبان" });
  const liveApi = global.getShadowBridgeApi(id);
  const fn = liveApi && [liveApi.setTitle, liveApi.gcname, liveApi.changeGroupName].find(f => typeof f === "function");
  if (fn) {
    try { await callFca(fn.bind(liveApi), [title, threadID]); return res.json({ ok: true }); } catch (_) {}
  }
  enqueueBridge(id, { type: "setTitle", threadID, title });
  res.json({ ok: true });
});

app.put("/api/sessions/:id/messenger/nickname", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const threadID = String(req.body?.threadID || "").trim();
  const nickname = String(req.body?.nickname ?? "").trim();
  if (!threadID) return res.status(400).json({ error: "رقم الغروب مطلوب" });
  const liveApi = global.getShadowBridgeApi(id);
  const userID = String(req.body?.userID || (liveApi && typeof liveApi.getCurrentUserID === "function" ? liveApi.getCurrentUserID() : "") || "").trim();
  if (!userID) return res.status(400).json({ error: "معرّف المستخدم غير متوفر" });
  const fn = liveApi && [liveApi.changeNickname, liveApi.nickname, liveApi.setNickname].find(f => typeof f === "function");
  if (fn) {
    try { await callFca(fn.bind(liveApi), [nickname, threadID, userID]); return res.json({ ok: true }); } catch (_) {}
  }
  enqueueBridge(id, { type: "setNickname", threadID, userID, nickname });
  res.json({ ok: true });
});

/* =========================================================
   إكمال ملف ZIP بأوامر البوت الحالي وما يحتاجه البوت
   ========================================================= */
function getCurrentBotCommandFiles() {
  const cmdsDir = path.join(ROOT, "commands");
  if (!fs.existsSync(cmdsDir)) return [];
  return fs.readdirSync(cmdsDir)
    .filter(f => f.endsWith(".js"))
    .map(f => ({ name: f.slice(0, -3), fileName: f, content: fs.readFileSync(path.join(cmdsDir, f), "utf8") }));
}

app.post("/api/sessions/:id/ai/complete-zip", auth, upload.single("archive"), (req, res) => {
  const id = validSession(req, res);
  if (!id) return;

  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "ارفع ملف ZIP أولاً" });
    }

    const botName = String(req.body?.botName || "BOT").trim();
    const libraryName = String(req.body?.libraryName || "fca").trim();
    const selectedRaw = String(req.body?.selectedCommands || "").trim();
    const needs = String(req.body?.needs || "").trim();

    const availableCmds = getCurrentBotCommandFiles();
    const wanted = selectedRaw
      ? selectedRaw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
      : availableCmds.map(c => c.name.toLowerCase());

    const matchedCmds = availableCmds.filter(c => wanted.includes(c.name.toLowerCase()));
    const cmdsToInject = matchedCmds.length ? matchedCmds : availableCmds;

    const jobDir = path.join(WORKSPACE_ZIP_DIR, `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    const extractedDir = path.join(jobDir, "project");
    extractZipBuffer(req.file.buffer, extractedDir);

    // إذا كان داخل الأرشيف مجلد واحد فقط يضم الملفات، نستخدمه كجذر للمشروع
    let projectRoot = extractedDir;
    const topEntries = fs.readdirSync(extractedDir, { withFileTypes: true });
    if (topEntries.length === 1 && topEntries[0].isDirectory()) {
      projectRoot = path.join(extractedDir, topEntries[0].name);
    }

    // 1. إضافة أوامر بوتك الحالي داخل مجلد commands
    const cmdsTargetDir = path.join(projectRoot, "commands");
    fs.mkdirSync(cmdsTargetDir, { recursive: true });
    const injectedNames = [];
    for (const cmd of cmdsToInject) {
      fs.writeFileSync(path.join(cmdsTargetDir, cmd.fileName), cmd.content, "utf8");
      injectedNames.push(cmd.name);
    }

    // 2. إكمال ما يحتاجه البوت تلقائياً (package.json، محمّل الأوامر، وملف ربط/تشغيل إن لم يكن موجوداً)
    const addedSupportFiles = [];
    const pkgPath = path.join(projectRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      const pkgObj = {
        name: botName.toLowerCase().replace(/[^a-z0-9-_]/g, "-") || "bot-package",
        version: "1.0.0",
        main: "index.js",
        scripts: { start: "node index.js" },
        dependencies: { [libraryName]: "latest" }
      };
      fs.writeFileSync(pkgPath, JSON.stringify(pkgObj, null, 2), "utf8");
      addedSupportFiles.push("package.json");
    }

    const runnerFile = path.join(projectRoot, "bot-auto-loader.js");
    const runnerContent = `"use strict";
const fs = require("fs");
const path = require("path");

// مولّد تلقائياً لإكمال بوت: ${botName} | المكتبة: ${libraryName}
// الاحتياجات المذكورة: ${needs || "إكمال البوت بالأوامر وملفات التشغيل"}

function initBotCommands(commandsDir = path.join(__dirname, "commands")) {
  const registry = new Map();
  if (!fs.existsSync(commandsDir)) return registry;
  for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"))) {
    const mod = require(path.join(commandsDir, file));
    const cmdName = String(mod?.name || file.slice(0, -3)).toLowerCase();
    registry.set(cmdName, mod);
  }
  return registry;
}

module.exports = {
  botName: ${JSON.stringify(botName)},
  libraryName: ${JSON.stringify(libraryName)},
  initBotCommands
};
`;
    fs.writeFileSync(runnerFile, runnerContent, "utf8");
    addedSupportFiles.push("bot-auto-loader.js");

    const indexPath = path.join(projectRoot, "index.js");
    if (!fs.existsSync(indexPath)) {
      const defaultIndex = `"use strict";
const { initBotCommands, botName, libraryName } = require("./bot-auto-loader");

const commands = initBotCommands();
console.log(\`[\${botName}] جاهز | المكتبة: \${libraryName} | عدد الأوامر المحملة: \${commands.size}\`);
`;
      fs.writeFileSync(indexPath, defaultIndex, "utf8");
      addedSupportFiles.push("index.js");
    }

    const outZipName = `${botName.replace(/[^a-zA-Z0-9_-]/g, "_") || "bot"}-completed-${Date.now()}.zip`;
    const outZipPath = path.join(GENERATED_BOTS_DIR, outZipName);
    buildZipFromDirectory(projectRoot, outZipPath);

    const summary = [
      `اسم البوت: ${botName}`,
      `المكتبة: ${libraryName}`,
      `الأوامر المضافة من بوتك الحالي (${injectedNames.length}): ${injectedNames.join(", ") || "لا توجد"}`,
      `ملفات الإكمال المضافة: ${addedSupportFiles.join(", ") || "لا يوجد"}`,
      `المتطلبات: ${needs || "إكمال تلقائي"}`
    ].join("\n");

    res.json({
      ok: true,
      fileName: outZipName,
      downloadUrl: `/api/ai/download/${encodeURIComponent(outZipName)}`,
      summary
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "تعذر معالجة ملف ZIP" });
  }
});

app.get("/api/ai/download/:file", auth, (req, res) => {
  const fileName = path.basename(String(req.params.file || ""));
  const fullPath = path.join(GENERATED_BOTS_DIR, fileName);
  if (!fs.existsSync(fullPath)) return res.status(404).send("الملف غير موجود");
  res.download(fullPath, fileName);
});

const botStates = {
  "1": { process: null, startedAt: null, logs: [] },
  "2": { process: null, startedAt: null, logs: [] },
  "3": { process: null, startedAt: null, logs: [] }
};

function getBotState(id) {
  if (!/^[123]$/.test(String(id))) throw new Error("رقم الجلسة غير صالح");
  return botStates[String(id)];
}

function addBotLog(id, val) {
  const st = getBotState(id);
  for (const line of String(val).split(/\r?\n/).filter(Boolean)) {
    st.logs.push({ time: new Date().toISOString(), text: line });
    if (st.logs.length > 300) st.logs.shift();
    console.log("[BOT " + id + "]", line);
  }
}

function startManagedBot(id = "1") {
  id = String(id);
  const st = getBotState(id);
  const files = getSessionFiles(id);
  const entry = path.join(__dirname, "index.js");

  if (st.process && st.process.exitCode === null) throw new Error("الجلسة تعمل بالفعل");
  if (!fs.existsSync(entry)) throw new Error("ملف تشغيل البوت غير موجود");
  if (!fs.existsSync(files.session) || !fs.readFileSync(files.session, "utf8").trim()) {
    throw new Error("ارفع ملف appState لهذه الجلسة أولاً");
  }

  let appState;
  try { appState = JSON.parse(fs.readFileSync(files.session, "utf8")); }
  catch { throw new Error("ملف appState ليس JSON صالحاً"); }

  if (!Array.isArray(appState) ||
      !appState.some(x => x && [x.key, x.name].includes("c_user") && typeof x.value === "string" && x.value.trim()) ||
      !appState.some(x => x && [x.key, x.name].includes("xs") && typeof x.value === "string" && x.value.trim())) {
    throw new Error("ملف الجلسة يجب أن يحتوي على c_user و xs بقيم غير فارغة");
  }

  st.logs.length = 0;
  const child = spawn(process.execPath, [entry], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "",
      SHADOW_SESSION_ID: id,
      SHADOW_BOT_PORT: String(files.port),
      SHADOW_DATA_DIR: DATA_DIR
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  st.process = child;
  st.startedAt = new Date().toISOString();
  child.stdout.on("data", d => addBotLog(id, d.toString()));
  child.stderr.on("data", d => addBotLog(id, "[stderr] " + d.toString()));
  child.on("error", err => addBotLog(id, "خطأ تشغيل: " + err.message));
  child.on("exit", (code, sig) => {
    addBotLog(id, `انتهت العملية: code=${code} signal=${sig}`);
    if (st.process === child) st.process = null;
  });
  return child.pid;
}

function stopManagedBot(id = "1") {
  const st = getBotState(String(id));
  const child = st.process;
  if (!child || child.exitCode !== null) {
    st.process = null;
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3500);
    setTimeout(finish, 5000);
  });
}

app.get("/api/sessions/:id/dashboard", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const { data } = sessionData(id);
  const files = getSessionFiles(id);
  const st = getBotState(id);
  const status = readJson(files.status, {});
  const botConfig = readJson(CONFIG_FILE, {});
  const sCfg = botConfig.SESSIONS?.[id] || {};
  const commandsDir = path.join(ROOT, "commands");
  const commands = fs.existsSync(commandsDir)
    ? fs.readdirSync(commandsDir).filter(f => f.endsWith(".js")).map(f => f.slice(0, -3)).sort()
    : [];

  const devIds = Array.isArray(sCfg.DEV_IDS)
    ? sCfg.DEV_IDS
    : sCfg.DEV_ID
      ? [String(sCfg.DEV_ID)]
      : (Array.isArray(botConfig.DEV_IDS) ? botConfig.DEV_IDS : [String(botConfig.DEV_ID || "")].filter(Boolean));

  res.json({
    bot: { online: Boolean((st.process && st.process.exitCode === null) || status.online), botId: status.botId || null },
    developerIds: devIds,
    prefix: data.prefix || "!",
    freePrefix: !!data.freePrefix,
    commands
  });
});

app.put("/api/sessions/:id/developer", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(x => String(x).trim()).filter(Boolean) : [];
  if (ids.length < 1 || ids.length > 2 || ids.some(v => !/^[0-9]{5,25}$/.test(v)) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "أدخل معرفاً أو معرفين صحيحين" });
  }
  const config = readJson(CONFIG_FILE, {});
  config.DEV_ID = ids[0];
  config.DEV_IDS = ids;
  config.SESSIONS = config.SESSIONS || {};
  config.SESSIONS[id] = config.SESSIONS[id] || {};
  config.SESSIONS[id].DEV_ID = ids[0];
  config.SESSIONS[id].DEV_IDS = ids;
  writeJsonAtomic(CONFIG_FILE, config);
  res.json({ ok: true, message: "تم حفظ معرفات المطورين" });
});

app.put("/api/sessions/:id/settings", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const { files, data } = sessionData(id);
  if (typeof req.body.prefix === "string" && req.body.prefix.trim()) data.prefix = req.body.prefix.trim().slice(0, 5);
  if (typeof req.body.freePrefix === "boolean") data.freePrefix = req.body.freePrefix;
  writeJsonAtomic(files.data, data);
  res.json({ ok: true });
});

app.post("/api/sessions/:id/cookies", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const raw = String(req.body?.cookies || "").trim();
  if (!raw) return res.status(400).json({ error: "ألصق الكوكيز أولاً" });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return res.status(400).json({ error: "JSON غير صالح" }); }
  if (!Array.isArray(parsed) || !parsed.length) return res.status(400).json({ error: "يجب أن تكون مصفوفة" });
  const appState = parsed.map(x => ({
    ...x,
    key: String(x.key || x.name || ""),
    value: String(x.value || ""),
    domain: x.domain || "facebook.com",
    path: x.path || "/"
  }));
  const cookieMap = new Map(appState.map(x => [x.key, x.value]));
  if (!cookieMap.has("c_user") || !cookieMap.has("xs")) {
    return res.status(400).json({ error: "الكوكيز يجب أن تحتوي على c_user و xs" });
  }
  writeJsonAtomic(getSessionFiles(id).session, appState);
  res.json({ ok: true, message: "تم حفظ الكوكيز بنجاح" });
});

app.get("/api/sessions/:id/logs", auth, (req, res) => {
  try { res.json({ logs: getBotState(String(req.params.id)).logs.slice(-200) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/sessions/:id/start", auth, (req, res) => {
  try { res.json({ ok: true, message: "تم تشغيل الجلسة", pid: startManagedBot(String(req.params.id)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/sessions/:id/stop", auth, async (req, res) => {
  try { res.json({ ok: true, message: (await stopManagedBot(String(req.params.id))) ? "تم إيقاف الجلسة" : "متوقفة بالفعل" }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/sessions/:id/restart", auth, async (req, res) => {
  try {
    const id = String(req.params.id);
    await stopManagedBot(id);
    res.json({ ok: true, message: "تمت إعادة التشغيل", pid: startManagedBot(id) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, "0.0.0.0", () => {
  try { writeJsonAtomic(PANEL_STATUS_FILE, { startedAt: new Date().toISOString(), pid: process.pid }); } catch {}
  console.log(`BLUE BOT STUDIO PANEL -> http://0.0.0.0:${PORT}/shadowxdiablos`);
});
