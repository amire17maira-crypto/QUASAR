"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const vm = require("vm");
const { spawn } = require("child_process");
const multer = require("multer");

let stats = null;
try { stats = require("./stats"); } catch (_) {}

const app = express();
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.SHADOW_DATA_DIR || ROOT);
const GENERATED_BOTS_DIR = path.join(DATA_DIR, "generated-bots");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(GENERATED_BOTS_DIR, { recursive: true });

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
const PASSWORD = process.env.PANEL_PASSWORD || "ShadowRedPanel2026!";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const liveBridgeApis = new Map();
global.setShadowBridgeApi = (sessionId, apiInstance) => {
  liveBridgeApis.set(String(sessionId || "1"), apiInstance);
};
global.getShadowBridgeApi = (sessionId = "1") => {
  return liveBridgeApis.get(String(sessionId || "1")) || null;
};

function renderRedLitePanelHtml() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>لوحة SHADOW الحمراء — Lite & AI</title>
  <style>
    :root {
      --bg: #0b090a;
      --surface: #141012;
      --surface-2: #1c1518;
      --red: #ef4444;
      --red-dark: #991b1b;
      --red-glow: rgba(239, 68, 68, 0.22);
      --text: #fff5f5;
      --muted: #fca5a5;
      --line: #2e1d22;
      --ok: #22c55e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .topbar {
      background: #120c0e;
      border-bottom: 1px solid var(--red-dark);
      padding: 10px 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .brand-title {
      font-weight: 800;
      color: var(--red);
      font-size: 1.05rem;
    }
    .badge {
      font-size: 0.78rem;
      padding: 3px 10px;
      border-radius: 6px;
      background: var(--surface-2);
      border: 1px solid var(--line);
    }
    .nav {
      display: flex;
      overflow-x: auto;
      background: var(--surface);
      border-bottom: 1px solid var(--line);
      padding: 0 12px;
      gap: 4px;
    }
    .nav button {
      background: transparent;
      color: var(--muted);
      border: none;
      border-bottom: 2px solid transparent;
      padding: 11px 14px;
      cursor: pointer;
      font-weight: 700;
      white-space: nowrap;
    }
    .nav button.active {
      color: #fff;
      border-bottom-color: var(--red);
      background: rgba(239, 68, 68, 0.08);
    }
    .wrap {
      max-width: 1320px;
      margin: 14px auto;
      padding: 0 12px 32px;
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .panel h3 {
      margin: 0 0 10px;
      font-size: 0.98rem;
      color: var(--red);
    }
    .two-col {
      display: table;
      width: 100%;
      table-layout: fixed;
    }
    .col-side {
      display: table-cell;
      width: 310px;
      vertical-align: top;
      padding-left: 12px;
    }
    .col-main {
      display: table-cell;
      vertical-align: top;
    }
    @media (max-width: 820px) {
      .two-col, .col-side, .col-main { display: block; width: 100%; padding-left: 0; }
      .col-side { margin-bottom: 12px; }
    }
    .lite-list {
      max-height: 360px;
      overflow-y: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #0e0a0c;
    }
    .lite-item {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      cursor: pointer;
      font-size: 0.86rem;
    }
    .lite-item:hover, .lite-item.selected {
      background: rgba(239, 68, 68, 0.16);
      color: #fff;
    }
    .feed {
      height: 290px;
      overflow-y: auto;
      background: #0e0a0c;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .bubble {
      background: var(--surface-2);
      border-right: 3px solid var(--red);
      padding: 7px 10px;
      border-radius: 5px;
      margin-bottom: 7px;
      font-size: 0.88rem;
    }
    .bubble small {
      display: block;
      color: var(--muted);
      font-size: 0.74rem;
      margin-bottom: 2px;
    }
    input, select, textarea {
      width: 100%;
      background: #0e0a0c;
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 8px;
      font-size: 0.9rem;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--red);
    }
    .btn {
      background: var(--red);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 13px;
      font-weight: 700;
      cursor: pointer;
      font-size: 0.86rem;
    }
    .btn:hover { background: #dc2626; }
    .btn.ghost {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--line);
    }
    .btn.dark-red {
      background: var(--red-dark);
      color: #fff;
    }
    .toolbar { margin-bottom: 8px; }
    .toolbar .btn, .toolbar input, .toolbar select { display: inline-block; vertical-align: middle; margin-bottom: 4px; }
    .console-box {
      background: #080607;
      color: #fca5a5;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      height: 220px;
      overflow-y: auto;
      font-family: Consolas, monospace;
      font-size: 0.8rem;
      white-space: pre-wrap;
    }
    .toast {
      position: fixed;
      bottom: 16px;
      left: 16px;
      background: var(--red);
      color: #fff;
      padding: 9px 15px;
      border-radius: 6px;
      font-weight: 700;
      display: none;
      z-index: 999;
    }
    .hidden { display: none !important; }
    a.dl-link {
      color: #fca5a5;
      font-weight: 800;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <span class="brand-title">♦ SHADOW RED LITE</span>
      <span class="badge" id="statusPill">فحص الحالة...</span>
      <span class="badge" id="pingPill">Latency: -</span>
    </div>
    <div class="toolbar" style="margin:0;">
      <select id="sessionId" style="width:auto;margin:0 0 0 6px;">
        <option value="1">الجلسة 1</option>
        <option value="2">الجلسة 2</option>
        <option value="3">الجلسة 3</option>
      </select>
      <button class="btn ghost" onclick="botAction('start')">تشغيل</button>
      <button class="btn ghost" onclick="botAction('restart')">إعادة</button>
      <button class="btn dark-red" onclick="botAction('stop')">إيقاف</button>
      <button class="btn ghost" onclick="backupSessionFiles()">نسخة احتياطية</button>
    </div>
  </div>

  <div class="nav" id="mainNav">
    <button class="active" onclick="openTab('tabLiteChat', this)">💬 ماسنجر Lite وتشغيل أوامر الغروب</button>
    <button onclick="openTab('tabPrivateDm', this)">✉️ الرسائل الخاصة (DM)</button>
    <button onclick="openTab('tabGroupsNicks', this)">🏷️ الغروبات والكنيات</button>
    <button onclick="openTab('tabAiStudio', this)">🤖 استوديو الذكاء الاصطناعي وصناعة البوتات</button>
    <button onclick="openTab('tabConfig', this)">⚙️ الإعدادات والكوكيز والسجلات</button>
  </div>

  <div class="wrap">
    <div id="authBox" class="panel hidden" style="max-width:400px;margin:36px auto;">
      <h3>دخول لوحة SHADOW الحمراء</h3>
      <input type="password" id="passInput" placeholder="كلمة المرور" onkeydown="if(event.key==='Enter') doLogin()" />
      <button class="btn" style="width:100%;" onclick="doLogin()">تسجيل الدخول</button>
    </div>

    <div id="mainApp" class="hidden">
      <!-- 1. ماسنجر Lite + تشغيل أمر في غروب محدد -->
      <div id="tabLiteChat" class="tab-view">
        <div class="panel">
          <div class="two-col">
            <div class="col-side">
              <h3>الغروبات والمحادثات (Lite)</h3>
              <div class="toolbar">
                <button class="btn" onclick="loadGroupsAndThreads()">تحديث</button>
                <input id="filterGroupsInput" placeholder="بحث باسم أو ID..." oninput="filterThreadList()" style="width:185px;margin:0;" />
              </div>
              <div id="liteThreadsList" class="lite-list">
                <div class="lite-item">اضغط تحديث لعرض الغروبات والمحادثات...</div>
              </div>
            </div>
            <div class="col-main">
              <h3>محادثة الحساب / غروب نشط: <span id="activeThreadLabel" style="color:#fca5a5;">غير محدد</span></h3>
              <div class="toolbar">
                <input id="targetThreadInput" placeholder="Thread ID الغروب أو المحادثة" style="width:240px;margin:0 0 0 6px;" />
                <button class="btn ghost" onclick="setActiveThread(document.getElementById('targetThreadInput').value.trim())">فتح وقراءة</button>
              </div>
              <div id="liteFeed" class="feed">
                <div class="bubble"><small>النظام</small>اختر غروباً من القائمة أو أدخل Thread ID للتحكم المباشر بحساب البوت.</div>
              </div>
              <div class="toolbar">
                <input id="liteSendInput" placeholder="اكتب رسالة أو أمراً لإرساله بحساب البوت..." style="width:74%;margin:0 0 0 6px;" onkeydown="if(event.key==='Enter') sendLiteMessage()" />
                <button class="btn" onclick="sendLiteMessage()">إرسال</button>
              </div>

              <hr style="border:none;border-top:1px solid var(--line);margin:12px 0;" />
              <h3>تشغيل أمر داخل الغروب المحدد دون كتابته في الغروب</h3>
              <div class="toolbar">
                <input id="runCmdThread" placeholder="ID الغروب" style="width:190px;margin:0 0 0 6px;" />
                <input id="runCmdText" placeholder="الأمر مثل: !help أو !ping أو اسم الأمر..." style="width:250px;margin:0 0 0 6px;" onkeydown="if(event.key==='Enter') runGroupCommand()" />
                <button class="btn" onclick="runGroupCommand()">⚡ تشغيل الأمر في الغروب</button>
              </div>
              <div class="toolbar">
                <button class="btn ghost" onclick="quickRun('!help')">!help</button>
                <button class="btn ghost" onclick="quickRun('!ping')">!ping</button>
                <button class="btn ghost" onclick="quickRun('!uptime')">!uptime</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. الرسائل الخاصة فقط (شخص لشخص) -->
      <div id="tabPrivateDm" class="tab-view hidden">
        <div class="panel">
          <div class="two-col">
            <div class="col-side">
              <h3>رسائل الخاص (أشخاص فقط)</h3>
              <div class="toolbar">
                <button class="btn" onclick="loadPrivateDmList()">تحديث الخاص</button>
                <input id="dmUserIdInput" placeholder="User ID الشخص" style="width:175px;margin:0;" />
                <button class="btn ghost" onclick="selectDmUser(document.getElementById('dmUserIdInput').value.trim())">فتح</button>
              </div>
              <div id="dmPeopleList" class="lite-list">
                <div class="lite-item">اضغط تحديث الخاص لعرض محادثات الأشخاص فقط...</div>
              </div>
            </div>
            <div class="col-main">
              <h3>محادثة خاصة مع: <span id="activeDmLabel" style="color:#fca5a5;">غير محدد</span></h3>
              <div id="dmFeed" class="feed">
                <div class="bubble"><small>الخاص</small>اختر شخصاً من القائمة أو أدخل User ID لقراءة الرسائل الخاصة وإرسال رسالة من حساب البوت.</div>
              </div>
              <div class="toolbar">
                <input id="dmMsgInput" placeholder="اكتب رسالة خاصة لهذا الشخص..." style="width:76%;margin:0 0 0 6px;" onkeydown="if(event.key==='Enter') sendDmMessage()" />
                <button class="btn" onclick="sendDmMessage()">إرسال خاص</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. الغروبات وتغيير الأسماء والكنيات -->
      <div id="tabGroupsNicks" class="tab-view hidden">
        <div class="panel">
          <h3>تغيير اسم الغروب وتغيير الكنيات</h3>
          <div class="two-col">
            <div class="col-side" style="width:50%;">
              <label>رقم الغروب (Thread ID)</label>
              <input id="grpActionId" placeholder="أدخل Thread ID الغروب" />
              <label>اسم الغروب الجديد</label>
              <input id="grpNewTitle" placeholder="الاسم الجديد للغروب" />
              <button class="btn" onclick="applyGroupTitle()">تغيير اسم الغروب</button>
            </div>
            <div class="col-main" style="padding-left:0;">
              <label>معرّف الشخص في الغروب (اتركه فارغاً لتغيير كنية البوت)</label>
              <input id="nickTargetUid" placeholder="User ID العضو أو اتركه فارغاً للبوت" />
              <label>الكنية الجديدة (اتركها فارغة لإزالة الكنية)</label>
              <input id="nickNewVal" placeholder="الكنية الجديدة" />
              <button class="btn" onclick="applyNicknameChange()">تغيير الكنية فوراً</button>
            </div>
          </div>
        </div>

        <div class="panel">
          <h3>الكنيات الافتراضية وحماية الكنيات</h3>
          <div class="two-col">
            <div class="col-side" style="width:50%;">
              <label>كنية البوت الافتراضية</label>
              <input id="cfgBotNick" />
              <label><input type="checkbox" id="cfgBotGuard" style="width:auto;" /> حماية كنية البوت</label>
            </div>
            <div class="col-main" style="padding-left:0;">
              <label>كنية المطور الافتراضية</label>
              <input id="cfgDevNick" />
              <label><input type="checkbox" id="cfgDevGuard" style="width:auto;" /> حماية كنية المطور</label>
            </div>
          </div>
          <button class="btn" onclick="saveNickConfig()">حفظ إعدادات الكنيات</button>
        </div>
      </div>

      <!-- 4. استوديو الذكاء الاصطناعي: إضافة أوامر + صناعة بوت ورابط تحميل + تعديل بوت -->
      <div id="tabAiStudio" class="tab-view hidden">
        <div class="panel">
          <h3>🤖 مساعد الذكاء الاصطناعي (إضافة أوامر / صناعة بوت / تعديل كود بوت)</h3>
          <label>وضع العمل</label>
          <select id="aiModeSelect" onchange="toggleAiModeFields()">
            <option value="add-command">إضافة أمر جديد للبوت الحالي</option>
            <option value="build-bot">صناعة بوت كامل جديد + رابط تحميل</option>
            <option value="edit-bot">تعديل كود بوت مرفوع/ملصوق + رابط تحميل</option>
          </select>

          <div id="aiCmdNameRow">
            <label>اسم الأمر الجديد (بدون بادئة، مثل: زخرفة أو تحدي)</label>
            <input id="aiCmdName" placeholder="اسم الأمر" />
          </div>

          <div id="aiSourceCodeRow" class="hidden">
            <label>كود البوت المراد تعديله (أو ارفع ملف .js)</label>
            <input type="file" id="aiBotFileInput" accept=".js,.txt,.json" onchange="loadAiUploadedFile(this)" />
            <textarea id="aiSourceCode" rows="7" placeholder="الصق كود البوت هنا أو ارفع ملف..."></textarea>
          </div>

          <label>وصف المطلوب أو التعديلات للذكاء الاصطناعي</label>
          <textarea id="aiPromptText" rows="4" placeholder="مثال: اصنع بوت ماسنجر يرد تلقائياً ويدعم أوامر الترحيب والمنشن والصور، أو أضف أمر حساب العمر..."></textarea>

          <div class="toolbar">
            <button class="btn" onclick="runAiStudio()">⚡ تنفيذ عبر الذكاء الاصطناعي</button>
            <button class="btn ghost" onclick="saveGeneratedCommandToBot()">حفظ كأمر في البوت</button>
          </div>

          <div id="aiDownloadArea" style="margin-top:8px;"></div>
          <label style="margin-top:10px;">النتيجة / الكود المولّد</label>
          <textarea id="aiOutputCode" rows="12" placeholder="سيظهر الكود الجاهز هنا..."></textarea>
        </div>
      </div>

      <!-- 5. الإعدادات والكوكيز والسجلات -->
      <div id="tabConfig" class="tab-view hidden">
        <div class="panel">
          <h3>البادئة والمطورون والكوكيز</h3>
          <label>البادئة (Prefix)</label>
          <input id="cfgPrefix" maxlength="5" />
          <label><input type="checkbox" id="cfgFreePrefix" style="width:auto;" /> بادئة حرة</label>
          <button class="btn" onclick="saveGeneralCfg()">حفظ الإعدادات</button>

          <hr style="border:none;border-top:1px solid var(--line);margin:12px 0;" />
          <label>كوكيز / appState للجلسة</label>
          <textarea id="cfgCookies" rows="5" placeholder='[{"key":"c_user","value":"..."},{"key":"xs","value":"..."}]'></textarea>
          <button class="btn" onclick="saveCookiesAction()">حفظ الكوكيز</button>
        </div>

        <div class="panel">
          <h3>سجل التشغيل المباشر</h3>
          <div id="logsConsole" class="console-box">جاري التحميل...</div>
        </div>
      </div>
    </div>
  </div>

  <div id="toastEl" class="toast"></div>

  <script>
    let allThreadsCache = [];
    let selectedThread = "";
    let selectedDmUser = "";

    function toast(msg) {
      const el = document.getElementById("toastEl");
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(window.__t);
      window.__t = setTimeout(() => { el.style.display = "none"; }, 3500);
    }

    function sid() {
      return document.getElementById("sessionId").value || "1";
    }

    function openTab(id, btn) {
      document.querySelectorAll(".tab-view").forEach(x => x.classList.add("hidden"));
      document.getElementById(id).classList.remove("hidden");
      document.querySelectorAll("#mainNav button").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
    }

    async function api(url, opts = {}) {
      const t0 = performance.now();
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        ...opts
      });
      const ms = Math.round(performance.now() - t0);
      document.getElementById("pingPill").textContent = "Latency: " + ms + "ms";

      if (res.status === 401) {
        document.getElementById("mainApp").classList.add("hidden");
        document.getElementById("authBox").classList.remove("hidden");
        throw new Error("يلزم تسجيل الدخول");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "خطأ في الطلب");
      return data;
    }

    async function doLogin() {
      try {
        const password = document.getElementById("passInput").value;
        const r = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return toast(j.error || "كلمة المرور غير صحيحة");
        document.getElementById("authBox").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
        await syncPanel();
      } catch (e) { toast(e.message); }
    }

    async function syncPanel() {
      try {
        await api("/api/me");
        document.getElementById("authBox").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
      } catch { return; }

      try {
        const d = await api("/api/sessions/" + sid() + "/dashboard");
        const st = document.getElementById("statusPill");
        st.textContent = d.bot.online ? ("متصل: " + (d.bot.botId || sid())) : "متوقف";
        st.style.borderColor = d.bot.online ? "#22c55e" : "#ef4444";

        document.getElementById("cfgPrefix").value = d.prefix || "!";
        document.getElementById("cfgFreePrefix").checked = !!d.freePrefix;
        document.getElementById("cfgBotNick").value = d.botNickname || "";
        document.getElementById("cfgBotGuard").checked = d.nicknameGuardEnabled !== false;
        document.getElementById("cfgDevNick").value = d.developerNickname || "";
        document.getElementById("cfgDevGuard").checked = d.developerNicknameGuardEnabled !== false;
      } catch (e) { toast(e.message); }

      try {
        const l = await api("/api/sessions/" + sid() + "/logs");
        document.getElementById("logsConsole").textContent =
          (l.logs || []).map(x => "[" + x.time.slice(11, 19) + "] " + x.text).join("\\n") || "لا توجد سجلات";
      } catch {}
    }

    async function botAction(act) {
      try {
        const r = await api("/api/sessions/" + sid() + "/" + act, { method: "POST" });
        toast(r.message || "تم");
        syncPanel();
      } catch (e) { toast(e.message); }
    }

    async function backupSessionFiles() {
      try {
        const r = await api("/api/sessions/" + sid() + "/backup", { method: "POST" });
        toast(r.message || "تم حفظ نسخة احتياطية");
      } catch (e) { toast(e.message); }
    }

    function renderThreadList(items) {
      const box = document.getElementById("liteThreadsList");
      if (!items.length) {
        box.innerHTML = '<div class="lite-item">لا توجد غروبات أو محادثات متاحة حالياً.</div>';
        return;
      }
      box.innerHTML = items.map(t =>
        '<div class="lite-item ' + (t.threadID === selectedThread ? "selected" : "") + '" onclick="setActiveThread(\\'' + t.threadID + '\\', ' + JSON.stringify(t.name || t.threadID).replace(/"/g, "&quot;") + ')">' +
        (t.isGroup ? "👥 " : "💬 ") + (t.name || t.threadID) + ' <span style="color:#fca5a5;font-size:0.75rem;">(' + t.threadID + ')</span></div>'
      ).join("");
    }

    function filterThreadList() {
      const q = document.getElementById("filterGroupsInput").value.trim().toLowerCase();
      if (!q) return renderThreadList(allThreadsCache);
      renderThreadList(allThreadsCache.filter(t =>
        String(t.name || "").toLowerCase().includes(q) || String(t.threadID || "").includes(q)
      ));
    }

    async function loadGroupsAndThreads() {
      try {
        const r = await api("/api/sessions/" + sid() + "/messenger/threads");
        allThreadsCache = r.threads || [];
        renderThreadList(allThreadsCache);
        toast("تم تحميل " + allThreadsCache.length + " محادثة/غروب");
      } catch (e) { toast(e.message); }
    }

    async function setActiveThread(tid, name = "") {
      if (!tid) return toast("أدخل Thread ID");
      selectedThread = String(tid);
      document.getElementById("targetThreadInput").value = selectedThread;
      document.getElementById("runCmdThread").value = selectedThread;
      document.getElementById("grpActionId").value = selectedThread;
      document.getElementById("activeThreadLabel").textContent = (name ? name + " - " : "") + selectedThread;
      filterThreadList();

      try {
        const r = await api("/api/sessions/" + sid() + "/messenger/messages?threadID=" + encodeURIComponent(selectedThread));
        const feed = document.getElementById("liteFeed");
        const msgs = r.messages || [];
        feed.innerHTML = msgs.length
          ? msgs.map(m => '<div class="bubble"><small>' + (m.senderName || m.senderID) + '</small>' + (m.body || "[رسالة/مرفق]") + '</div>').join("")
          : '<div class="bubble"><small>النظام</small>تم تحديد الغروب/المحادثة (' + selectedThread + ') بنجاح. يمكنك الإرسال أو تشغيل الأوامر الآن.</div>';
        feed.scrollTop = feed.scrollHeight;
      } catch (e) { toast(e.message); }
    }

    async function sendLiteMessage() {
      const tid = selectedThread || document.getElementById("targetThreadInput").value.trim();
      const message = document.getElementById("liteSendInput").value.trim();
      if (!tid || !message) return toast("حدد المحادثة واكتب الرسالة");
      try {
        await api("/api/sessions/" + sid() + "/messenger/send", {
          method: "POST",
          body: JSON.stringify({ threadID: tid, message })
        });
        document.getElementById("liteSendInput").value = "";
        toast("تم الإرسال بحساب البوت");
        setActiveThread(tid);
      } catch (e) { toast(e.message); }
    }

    function quickRun(cmd) {
      document.getElementById("runCmdText").value = cmd;
      runGroupCommand();
    }

    async function runGroupCommand() {
      const threadID = document.getElementById("runCmdThread").value.trim() || selectedThread;
      const command = document.getElementById("runCmdText").value.trim();
      if (!threadID || !command) return toast("حدد الغروب واكتب الأمر");
      try {
        await api("/api/sessions/" + sid() + "/messenger/run-command", {
          method: "POST",
          body: JSON.stringify({ threadID, command })
        });
        toast("تم إرسال الأمر للتنفيذ داخل الغروب");
      } catch (e) { toast(e.message); }
    }

    async function loadPrivateDmList() {
      try {
        const r = await api("/api/sessions/" + sid() + "/messenger/private-threads");
        const list = r.threads || [];
        const box = document.getElementById("dmPeopleList");
        box.innerHTML = list.length
          ? list.map(u => '<div class="lite-item ' + (u.userID === selectedDmUser ? "selected" : "") + '" onclick="selectDmUser(\\'' + u.userID + '\\', ' + JSON.stringify(u.name || u.userID).replace(/"/g, "&quot;") + ')">👤 ' + (u.name || u.userID) + ' <span style="color:#fca5a5;font-size:0.75rem;">(' + u.userID + ')</span></div>').join("")
          : '<div class="lite-item">لا توجد محادثات خاصة حالياً.</div>';
        toast("تم تحميل " + list.length + " محادثة خاصة");
      } catch (e) { toast(e.message); }
    }

    async function selectDmUser(uid, name = "") {
      if (!uid) return toast("أدخل User ID");
      selectedDmUser = String(uid);
      document.getElementById("dmUserIdInput").value = selectedDmUser;
      document.getElementById("activeDmLabel").textContent = (name ? name + " - " : "") + selectedDmUser;
      try {
        const r = await api("/api/sessions/" + sid() + "/messenger/private-messages?userID=" + encodeURIComponent(selectedDmUser));
        const feed = document.getElementById("dmFeed");
        const msgs = r.messages || [];
        feed.innerHTML = msgs.length
          ? msgs.map(m => '<div class="bubble"><small>' + (m.senderName || m.senderID) + '</small>' + (m.body || "[رسالة/مرفق]") + '</div>').join("")
          : '<div class="bubble"><small>الخاص</small>جاهز للمراسلة الخاصة مع ' + selectedDmUser + '</div>';
        feed.scrollTop = feed.scrollHeight;
      } catch (e) { toast(e.message); }
    }

    async function sendDmMessage() {
      const userID = selectedDmUser || document.getElementById("dmUserIdInput").value.trim();
      const message = document.getElementById("dmMsgInput").value.trim();
      if (!userID || !message) return toast("حدد الشخص واكتب الرسالة");
      try {
        await api("/api/sessions/" + sid() + "/messenger/private-send", {
          method: "POST",
          body: JSON.stringify({ userID, message })
        });
        document.getElementById("dmMsgInput").value = "";
        toast("تم إرسال الرسالة الخاصة");
        selectDmUser(userID);
      } catch (e) { toast(e.message); }
    }

    async function applyGroupTitle() {
      const threadID = document.getElementById("grpActionId").value.trim() || selectedThread;
      const title = document.getElementById("grpNewTitle").value.trim();
      if (!threadID || !title) return toast("أدخل رقم الغروب والاسم الجديد");
      try {
        await api("/api/sessions/" + sid() + "/messenger/group-name", {
          method: "PUT",
          body: JSON.stringify({ threadID, title })
        });
        toast("تم إرسال تغيير اسم الغروب");
      } catch (e) { toast(e.message); }
    }

    async function applyNicknameChange() {
      const threadID = document.getElementById("grpActionId").value.trim() || selectedThread;
      const userID = document.getElementById("nickTargetUid").value.trim();
      const nickname = document.getElementById("nickNewVal").value;
      if (!threadID) return toast("أدخل رقم الغروب");
      try {
        await api("/api/sessions/" + sid() + "/messenger/nickname", {
          method: "PUT",
          body: JSON.stringify({ threadID, userID: userID || undefined, nickname })
        });
        toast("تم إرسال تغيير الكنية");
      } catch (e) { toast(e.message); }
    }

    async function saveNickConfig() {
      try {
        await api("/api/sessions/" + sid() + "/nickname", {
          method: "PUT",
          body: JSON.stringify({
            nickname: document.getElementById("cfgBotNick").value.trim(),
            enabled: document.getElementById("cfgBotGuard").checked
          })
        });
        await api("/api/sessions/" + sid() + "/developer-nickname", {
          method: "PUT",
          body: JSON.stringify({
            nickname: document.getElementById("cfgDevNick").value.trim(),
            enabled: document.getElementById("cfgDevGuard").checked
          })
        });
        toast("تم حفظ إعدادات الكنيات");
      } catch (e) { toast(e.message); }
    }

    async function saveGeneralCfg() {
      try {
        await api("/api/sessions/" + sid() + "/settings", {
          method: "PUT",
          body: JSON.stringify({
            prefix: document.getElementById("cfgPrefix").value.trim(),
            freePrefix: document.getElementById("cfgFreePrefix").checked
          })
        });
        toast("تم حفظ الإعدادات");
      } catch (e) { toast(e.message); }
    }

    async function saveCookiesAction() {
      try {
        const cookies = document.getElementById("cfgCookies").value.trim();
        const r = await api("/api/sessions/" + sid() + "/cookies", {
          method: "POST",
          body: JSON.stringify({ cookies })
        });
        toast(r.message || "تم حفظ الكوكيز");
      } catch (e) { toast(e.message); }
    }

    function toggleAiModeFields() {
      const mode = document.getElementById("aiModeSelect").value;
      document.getElementById("aiCmdNameRow").classList.toggle("hidden", mode !== "add-command");
      document.getElementById("aiSourceCodeRow").classList.toggle("hidden", mode !== "edit-bot");
    }

    function loadAiUploadedFile(input) {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { document.getElementById("aiSourceCode").value = String(reader.result || ""); };
      reader.readAsText(file);
    }

    async function runAiStudio() {
      try {
        const mode = document.getElementById("aiModeSelect").value;
        const commandName = document.getElementById("aiCmdName").value.trim();
        const sourceCode = document.getElementById("aiSourceCode").value;
        const prompt = document.getElementById("aiPromptText").value.trim();
        if (!prompt && mode !== "edit-bot") return toast("اكتب وصف المطلوب للذكاء الاصطناعي");

        const r = await api("/api/sessions/" + sid() + "/ai/studio", {
          method: "POST",
          body: JSON.stringify({ mode, commandName, sourceCode, prompt })
        });
        document.getElementById("aiOutputCode").value = r.code || "";
        const dlArea = document.getElementById("aiDownloadArea");
        dlArea.innerHTML = r.downloadUrl
          ? '✅ جاهز للتحميل: <a class="dl-link" href="' + r.downloadUrl + '" download>تحميل الملف (' + (r.fileName || "bot.js") + ')</a>'
          : "";
        toast("تم التوليد بنجاح");
      } catch (e) { toast(e.message); }
    }

    async function saveGeneratedCommandToBot() {
      try {
        const name = document.getElementById("aiCmdName").value.trim();
        const code = document.getElementById("aiOutputCode").value.trim();
        if (!name || !code) return toast("أدخل اسم الأمر وتأكد من وجود الكود");
        await api("/api/sessions/" + sid() + "/ai/save-command", {
          method: "POST",
          body: JSON.stringify({ name, code })
        });
        toast("تمت إضافة الأمر '" + name + "' للبوت");
      } catch (e) { toast(e.message); }
    }

    document.getElementById("sessionId").addEventListener("change", syncPanel);
    syncPanel();
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
  res.send(renderRedLitePanelHtml());
});

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

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
    .find(x => x.startsWith("shadow_red_panel="))?.slice("shadow_red_panel=".length);
  const expiresAt = token ? sessions.get(token) : null;
  if (!token || !expiresAt || Date.now() >= expiresAt) {
    return res.status(401).json({ error: "يلزم تسجيل الدخول" });
  }
  next();
}

const loginFailures = new Map();
function loginRateLimit(req, res, next) {
  const now = Date.now();
  const key = String(req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
  const st = loginFailures.get(key);
  if (st && st.blockedUntil > now) {
    return res.status(429).json({ error: "محاولات كثيرة، انتظر قليلاً" });
  }
  req.loginKey = key;
  next();
}

app.post("/api/login", loginRateLimit, (req, res) => {
  if (!safeEqual(req.body?.password || "", PASSWORD)) {
    const now = Date.now();
    const prev = loginFailures.get(req.loginKey);
    const count = prev && prev.windowUntil > now ? prev.count + 1 : 1;
    loginFailures.set(req.loginKey, {
      count,
      windowUntil: prev && prev.windowUntil > now ? prev.windowUntil : now + 15 * 60 * 1000,
      blockedUntil: count >= 5 ? now + 15 * 60 * 1000 : 0
    });
    return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  }
  loginFailures.delete(req.loginKey);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", `shadow_red_panel=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${isHttps ? "; Secure" : ""}`);
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
  return item;
}

function callFca(fn, args = []) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error("انتهت مهلة الاستجابة من الحساب")); }
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
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
        .map(t => ({
          userID: String(t.threadID || ""),
          name: t.threadName || t.name || String(t.threadID || "")
        }))
        .filter(t => t.userID);
      return res.json({ threads });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
    try {
      await callFca(liveApi.sendMessage.bind(liveApi), [message, threadID]);
      return res.json({ ok: true });
    } catch (_) {}
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
    try {
      await callFca(liveApi.sendMessage.bind(liveApi), [message, userID]);
      return res.json({ ok: true });
    } catch (_) {}
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
    try {
      await callFca(fn.bind(liveApi), [title, threadID]);
      return res.json({ ok: true });
    } catch (_) {}
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
    try {
      await callFca(fn.bind(liveApi), [nickname, threadID, userID]);
      return res.json({ ok: true });
    } catch (_) {}
  }
  enqueueBridge(id, { type: "setNickname", threadID, userID, nickname });
  res.json({ ok: true });
});

// الذكاء الاصطناعي: إضافة أوامر / صناعة بوت مع رابط تحميل / تعديل بوت
async function callAiModel(systemPrompt, userPrompt) {
  if (OPENAI_API_KEY) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.35,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });
    const json = await resp.json();
    const txt = json?.choices?.[0]?.message?.content;
    if (txt) return txt.replace(/^```(?:javascript|js)?\s*/i, "").replace(/```$/i, "").trim();
  }
  return null;
}

function buildSmartFallbackCode(mode, commandName, sourceCode, prompt) {
  if (mode === "add-command") {
    const cmd = (commandName || "custom").replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, "");
    return `module.exports = {
  name: "${cmd}",
  description: ${JSON.stringify(prompt || "أمر مخصص")},
  async run(api, event, args) {
    const text = args.join(" ").trim();
    return api.sendMessage("⚡ تم تشغيل الأمر (${cmd}) بنجاح" + (text ? "\\nالمدخل: " + text : ""), event.threadID, event.messageID);
  }
};`;
  }
  if (mode === "edit-bot") {
    const base = String(sourceCode || "").trim() || `const fs = require("fs");\n// بوت أساسي\n`;
    return `${base}\n\n// --- تعديلات الذكاء الاصطناعي ---\n// المطلوب: ${String(prompt || "تحسين الأداء وإضافة أوامر").replace(/\r?\n/g, " ")}\nmodule.exports.__aiUpdatedAt = ${JSON.stringify(new Date().toISOString())};\n`;
  }
  return `"use strict";
const fs = require("fs");
const path = require("path");

// بوت منشأ بواسطة استوديو SHADOW الذكي
// الوصف: ${String(prompt || "بوت ماسنجر متكامل").replace(/\r?\n/g, " ")}

function createBot(loginFn, appStatePath) {
  const appState = JSON.parse(fs.readFileSync(appStatePath, "utf8"));
  loginFn({ appState }, (err, api) => {
    if (err || !api) return console.error("فشل تسجيل الدخول:", err);
    api.setOptions({ listenEvents: true, selfListen: false });
    console.log("✅ البوت جاهز ويعمل!");

    api.listenMqtt((listenErr, event) => {
      if (listenErr || !event || !event.body) return;
      const body = String(event.body).trim();
      if (body === "!ping" || body === "بينغ") {
        api.sendMessage("🏓 شغال بسرعة ممتازة!", event.threadID, event.messageID);
      } else if (body === "!مساعدة" || body === "!help") {
        api.sendMessage("📌 الأوامر المتاحة:\\n• !ping\\n• !مساعدة", event.threadID, event.messageID);
      }
    });
  });
}

module.exports = { createBot };
`;
}

app.post("/api/sessions/:id/ai/studio", auth, async (req, res) => {
  const id = validSession(req, res);
  if (!id) return;

  const mode = String(req.body?.mode || "add-command");
  const commandName = String(req.body?.commandName || "custom").trim();
  const sourceCode = String(req.body?.sourceCode || "");
  const prompt = String(req.body?.prompt || "").trim();

  let systemPrompt = "أنت مهندس برمجيات خبير في Node.js وبوتات ماسنجر. أعد كود JavaScript نظيفاً ومباشراً فقط دون شرح زائد.";
  let userPrompt = prompt;
  if (mode === "add-command") {
    userPrompt = `اكتب ملف أمر Node.js باسم "${commandName}" يقبل (api, event, args) وينفذ المطلوب: ${prompt}`;
  } else if (mode === "edit-bot") {
    userPrompt = `عدّل كود البوت التالي حسب المطلوب:\nالمطلوب: ${prompt}\n\nالكود الحالي:\n${sourceCode}`;
  } else {
    userPrompt = `اصنع كود بوت Node.js كامل بناءً على الوصف التالي: ${prompt}`;
  }

  const aiResult = await callAiModel(systemPrompt, userPrompt);
  const code = aiResult || buildSmartFallbackCode(mode, commandName, sourceCode, prompt);

  const safeFile = `${mode}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.js`;
  fs.writeFileSync(path.join(GENERATED_BOTS_DIR, safeFile), code, "utf8");

  res.json({
    ok: true,
    code,
    fileName: safeFile,
    downloadUrl: `/api/ai/download/${encodeURIComponent(safeFile)}`
  });
});

app.get("/api/ai/download/:file", auth, (req, res) => {
  const fileName = path.basename(String(req.params.file || ""));
  const fullPath = path.join(GENERATED_BOTS_DIR, fileName);
  if (!fs.existsSync(fullPath)) return res.status(404).send("الملف غير موجود");
  res.download(fullPath, fileName);
});

app.post("/api/sessions/:id/ai/save-command", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const name = String(req.body?.name || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  if (!/^[a-z0-9_\u0600-\u06FF]{1,24}$/.test(name) || !code) {
    return res.status(400).json({ error: "اسم الأمر أو الكود غير صالح" });
  }
  const cmdsDir = path.join(ROOT, "commands");
  fs.mkdirSync(cmdsDir, { recursive: true });
  fs.writeFileSync(path.join(cmdsDir, name + ".js"), code, "utf8");
  res.json({ ok: true, name });
});

app.post("/api/sessions/:id/backup", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const files = getSessionFiles(id);
  const bDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(bDir, { recursive: true });
  const stamp = Date.now();
  if (fs.existsSync(files.data)) fs.copyFileSync(files.data, path.join(bDir, `data-${id}-${stamp}.json`));
  if (fs.existsSync(files.session)) fs.copyFileSync(files.session, path.join(bDir, `appState-${id}-${stamp}.json`));
  res.json({ ok: true, message: "تم أخذ نسخة احتياطية للجلسة " + id });
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
  }
}

function startManagedBot(id = "1") {
  id = String(id);
  const st = getBotState(id);
  const files = getSessionFiles(id);
  const entry = path.join(__dirname, "index.js");
  if (st.process && st.process.exitCode === null) throw new Error("الجلسة تعمل بالفعل");
  if (!fs.existsSync(entry)) throw new Error("ملف تشغيل البوت غير موجود");
  if (!fs.existsSync(files.session)) throw new Error("ارفع appState لهذه الجلسة أولاً");

  st.logs.length = 0;
  const child = spawn(process.execPath, [entry], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "", SHADOW_SESSION_ID: id, SHADOW_DATA_DIR: DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"]
  });
  st.process = child;
  st.startedAt = new Date().toISOString();
  child.stdout.on("data", d => addBotLog(id, d.toString()));
  child.stderr.on("data", d => addBotLog(id, "[stderr] " + d.toString()));
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
  res.json({
    bot: {
      online: Boolean((st.process && st.process.exitCode === null) || status.online),
      botId: status.botId || null
    },
    prefix: data.prefix || "!",
    freePrefix: !!data.freePrefix,
    botNickname: String(sCfg.BOT_NICK || botConfig.BOT_NICK || ""),
    nicknameGuardEnabled: (sCfg.NICK_GUARD_ENABLED ?? botConfig.NICK_GUARD_ENABLED) !== false,
    developerNickname: String(sCfg.DEV_NICK || botConfig.DEV_NICK || ""),
    developerNicknameGuardEnabled: (sCfg.DEV_NICK_GUARD_ENABLED ?? botConfig.DEV_NICK_GUARD_ENABLED) !== false
  });
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

app.put("/api/sessions/:id/nickname", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const cfg = readJson(CONFIG_FILE, {});
  cfg.SESSIONS = cfg.SESSIONS || {};
  cfg.SESSIONS[id] = cfg.SESSIONS[id] || {};
  if (typeof req.body.nickname === "string") cfg.SESSIONS[id].BOT_NICK = req.body.nickname.trim();
  if (typeof req.body.enabled === "boolean") cfg.SESSIONS[id].NICK_GUARD_ENABLED = req.body.enabled;
  writeJsonAtomic(CONFIG_FILE, cfg);
  res.json({ ok: true });
});

app.put("/api/sessions/:id/developer-nickname", auth, (req, res) => {
  const id = validSession(req, res);
  if (!id) return;
  const cfg = readJson(CONFIG_FILE, {});
  cfg.SESSIONS = cfg.SESSIONS || {};
  cfg.SESSIONS[id] = cfg.SESSIONS[id] || {};
  if (typeof req.body.nickname === "string") cfg.SESSIONS[id].DEV_NICK = req.body.nickname.trim();
  if (typeof req.body.enabled === "boolean") cfg.SESSIONS[id].DEV_NICK_GUARD_ENABLED = req.body.enabled;
  writeJsonAtomic(CONFIG_FILE, cfg);
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
  console.log(`SHADOW RED LITE PANEL -> http://0.0.0.0:${PORT}/shadowxdiablos`);
});
