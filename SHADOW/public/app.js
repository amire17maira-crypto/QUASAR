const $ = id => document.getElementById(id);
let state = null;
let selectedSession = "1";
let editingCustomCommand = null;
let fileManagerPath = "";
function sessionApi(path) { return "/api/sessions/" + selectedSession + "/" + path; }
async function api(url, options={}) {
  const res = await fetch(url, {credentials:"same-origin", ...options,
    headers: {...(options.body instanceof FormData ? {} : {"Content-Type":"application/json"}), ...(options.headers||{})}});
  const data = await res.json().catch(()=>({}));
  if (res.status === 401 && url !== "/api/login") { showLogin(); throw new Error("انتهت الجلسة"); }
  if (!res.ok) throw new Error(data.error || "حدث خطأ");
  return data;
}
function showLogin(){ $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); }
function showApp(){ $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); }
function notify(el,msg){ if(el) el.textContent=msg; }
async function loadDashboard(){
  state=await api(sessionApi("dashboard"));
  const customData = await api(sessionApi("custom-commands"));
  state.customCommands = customData.customCommands || [];
  state.builtInCommands = customData.builtInCommands || [];
  $("botStatus").textContent=state.bot.online?"متصل":"غير متصل";
  $("botStatus").style.color=state.bot.online?"#5be0a0":"#ff6c83";
  $("commandCount").textContent=state.builtInCommands.length + state.customCommands.length;
  $("groupCount").textContent=state.groups.length;
  $("savedCount").textContent=state.savedMessagesCount;
  $("botId").textContent=state.bot.botId||"غير متاح";
  $("developerId").value=(state.developerIds||[])[0]||"";
  $("developerId2").value=(state.developerIds||[])[1]||"";
  const sessionNick = await api(sessionApi("nickname"));
  $("botNickname").value=sessionNick.nickname || "";
  $("developerNickname").value=state.developerNickname||"𝙻𝚘𝚛𝚍 𝚂𝚑𝚊𝚍𝚘𝚠⦓ ⚛️ ⦔";
  $("nicknameGuard").checked=sessionNick.enabled;
  $("nicknameStatus").textContent=sessionNick.enabled!==false
    ?"الاسترجاع التلقائي مفعّل • الفحص كل 7 ثوانٍ"
    :"الاسترجاع التلقائي متوقف";
  $("prefixInfo").textContent=state.prefix;
  $("freeInfo").textContent=state.freePrefix?"مفعّل":"متوقف";
  $("lockedInfo").textContent=state.lockedCount;
  $("prefix").value=state.prefix;
  $("freePrefix").checked=state.freePrefix;
  $("commandsList").innerHTML=state.customCommands.length
    ? state.customCommands.map(c=>`<div class="rowitem">
        <div><b>${escapeHtml(c.name)}</b><small>${c.enabled ? "مفعّل" : "متوقف"} • ${escapeHtml(c.code ? c.code.slice(0, 100) : (c.reply || "لا يوجد كود"))}</small></div>
        <div class="inline-form">
          <button type="button" data-edit-command="${escapeHtml(c.name)}">تعديل</button>
          <button type="button" data-toggle-command="${escapeHtml(c.name)}" data-enabled="${c.enabled}">${c.enabled ? "تعطيل" : "تفعيل"}</button>
          <button type="button" data-rename-command="${escapeHtml(c.name)}">إعادة تسمية</button>
          <button type="button" data-delete-command="${escapeHtml(c.name)}">حذف</button>
        </div>
      </div>`).join("")
    : "<p class='muted'>لا توجد أوامر مخصصة لهذه الجلسة.</p>";
  $("builtInCommandsList").innerHTML=state.builtInCommands.map(c=>`<div class="rowitem">
    <b>${escapeHtml(c)}</b>
    <div class="inline-form">
      <button type="button" data-edit-builtin="${escapeHtml(c)}">تعديل</button>
      <button type="button" data-rename-builtin="${escapeHtml(c)}">إعادة تسمية</button>
      <button type="button" data-delete-builtin="${escapeHtml(c)}">حذف</button>
    </div>
  </div>`).join("") || "<p class='muted'>لا توجد أوامر مدمجة.</p>";
  renderGroups(state.groups);
  $("adminsList").innerHTML=(state.admins||[]).map(id=>`<div class="rowitem"><b>${escapeHtml(id)}</b><button data-admin="${escapeHtml(id)}">حذف</button></div>`).join("")||"<p class='muted'>لا توجد معرّفات إضافية.</p>";
}
function escapeHtml(s){return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function renderGroups(groups = []) {
  const list = $("groupsList");
  if (!list) return;
  const safeGroups = Array.isArray(groups) ? groups : [];
  list.innerHTML = safeGroups.length ? safeGroups.map(g => {
    const id = escapeHtml(g.id);
    const name = escapeHtml(g.name || "مجموعة بلا اسم");
    const members = Number.isFinite(Number(g.members)) ? Number(g.members) : 0;
    const muted = g.muted === true;
    const active = g.active === true;
    return `<div class="rowitem">
      <div><b>${name}</b><small>ID: ${id} • ${members} كنية محفوظة</small>
      <small style="color:${muted ? "#f87171" : "#4ade80"}">${muted ? "● البوت مكتوم" : "● البوت يعمل في المجموعة"}</small></div>
      <div class="group-actions">${g.protected ? `<button type="button" data-group="${id}" data-active="${active}">${active ? "الحماية مفعّلة" : "الحماية متوقفة"}</button>` : ""}
      <button type="button" data-mute-group="${id}" data-muted="${muted}">${muted ? "إلغاء الكتم" : "كتم المجموعة"}</button></div>
    </div>`;
  }).join("") : "<p class='muted'>لا توجد مجموعات مكتشفة بعد.</p>";
  if ($("groupCount")) $("groupCount").textContent = safeGroups.length;
}

async function refreshGroupsData() {
  const button = $("refreshGroups");
  if (button) { button.disabled = true; button.textContent = "جارٍ التحديث…"; }
  try {
    const request = await api(sessionApi("groups/refresh"), { method: "POST" });
    if (button) button.textContent = "جارٍ جلب المجموعات…";
    const requestedAt = Date.parse(request.requestedAt || "");
    const deadline = Date.now() + 15000;
    let dashboard = null;
    do {
      await new Promise(resolve => setTimeout(resolve, 1000));
      dashboard = await api(sessionApi("dashboard"));
      const updatedAt = Date.parse(dashboard.groupsUpdatedAt || "");
      if (Number.isFinite(requestedAt) && Number.isFinite(updatedAt) && updatedAt >= requestedAt) break;
    } while (Date.now() < deadline);
    state = { ...(state || {}), ...dashboard };
    renderGroups(state.groups);
    if ($("lockedInfo")) $("lockedInfo").textContent = state.lockedCount ?? "—";
    const updatedAt = Date.parse(dashboard.groupsUpdatedAt || "");
    if (Number.isFinite(requestedAt) && (!Number.isFinite(updatedAt) || updatedAt < requestedAt)) {
      throw new Error("لم يكتمل تحديث المجموعات خلال المهلة؛ تحقق من سجل البوت.");
    }
    if (request.message && button) button.title = request.message;
  } catch (err) {
    const list = $("groupsList");
    if (list) list.textContent = "تعذر تحديث المجموعات: " + err.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = "تحديث ↻"; }
  }
}


function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h,m,s].map(x => String(x).padStart(2,"0")).join(":");
}

async function refreshProcess() {
  try {
    const p = await api(sessionApi("process"));
    $("processStatus").textContent = p.running
      ? (p.botId ? "البوت متصل" : "جاري التشغيل")
      : "البوت متوقف";
    $("processStatus").style.color = p.running ? "#5be0a0" : "#ff6c83";
    $("botUptime").textContent = p.running ? formatUptime(p.uptimeSeconds) : "00:00:00";
    $("botPid").textContent = p.pid || "—";
    $("botStatus").textContent = p.running
      ? (p.botId ? "متصل" : "جاري التشغيل")
      : "غير متصل";
    $("botStatus").style.color = p.running ? "#5be0a0" : "#ff6c83";

    const result = await api(sessionApi("logs"));
    const terminal = $("botTerminal");
    const logs = result.logs || [];
    terminal.textContent = logs.length
      ? logs.map(x => "[" + new Date(x.time).toLocaleTimeString() + "] " + x.text).join("\n")
      : "لا توجد سجلات حتى الآن.";
    terminal.scrollTop = terminal.scrollHeight;
  } catch (err) {
    if (err.message !== "انتهت الجلسة") {
      $("processStatus").textContent = "تعذر جلب الحالة";
    }
  }
}

async function botAction(action) {
  const labels = {
    start: "تشغيل",
    stop: "إيقاف",
    restart: "إعادة التشغيل"
  };
  const buttons = ["botStart", "botStop", "botRestart"];
  buttons.forEach(id => $(id).disabled = true);

  try {
    const result = await api(sessionApi(action), { method: "POST" });
    notify($("processStatus"), result.message);
    await refreshProcess();
  } catch (err) {
    notify($("processStatus"), err.message);
  } finally {
    buttons.forEach(id => $(id).disabled = false);
  }
}
document.querySelectorAll(".nav").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
  document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
  $("page-"+btn.dataset.page).classList.remove("hidden");
  $("pageTitle").textContent=btn.textContent.replace(/^[◈⌘▦♙⚙♧]\s*/,"");
}));
document.querySelectorAll('.nav[data-page="files"]').forEach(btn => {
  btn.addEventListener("click", () => loadFileManager(""));
});
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/login",{method:"POST",body:JSON.stringify({password:$("password").value})});$("password").value="";showApp();await loadDashboard();}catch(err){notify($("loginError"),err.message);}});
$("logout").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}finally{showLogin();}});
$("refresh").addEventListener("click",loadDashboard);
$("refreshGroups").addEventListener("click",refreshGroupsData);
document.querySelectorAll(".session-card").forEach(card => {
  card.addEventListener("click", async () => {
    selectedSession = card.dataset.session;

    try {
      await loadDashboard();
      await refreshProcess();

      document.querySelectorAll(".page").forEach(page => page.classList.add("hidden"));
      $("page-home").classList.remove("hidden");

      document.querySelectorAll(".nav").forEach(btn => btn.classList.remove("active"));
      const homeNav = document.querySelector('.nav[data-page="home"]');
      if (homeNav) homeNav.classList.add("active");

      $("pageTitle").textContent = "الرئيسية • الجلسة " + selectedSession;
    } catch (err) {
      notify($("pageTitle"), "تعذر تحميل الجلسة: " + err.message);
    }
  });
});
$("botStart").addEventListener("click", () => botAction("start"));
$("botStop").addEventListener("click", () => botAction("stop"));
$("botRestart").addEventListener("click", () => botAction("restart"));
$("clearTerminal").addEventListener("click", () => {
  $("botTerminal").textContent = "تم مسح العرض المحلي. السجلات الجديدة ستظهر هنا.";
});
$("settingsForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(sessionApi("settings"),{method:"PUT",body:JSON.stringify({prefix:$("prefix").value,freePrefix:$("freePrefix").checked})});notify($("settingsMsg"),"تم حفظ الإعدادات.");await loadDashboard();}catch(err){notify($("settingsMsg"),err.message);}});
$("developerForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try {
    const ids = [$("developerId").value.trim(), $("developerId2").value.trim()].filter(Boolean);
    const r = await api("/api/developer", {
      method:"PUT",
      body:JSON.stringify({ids})
    });
    notify($("developerMsg"), r.message);
  } catch(err) {
    notify($("developerMsg"), err.message);
  }
});
$("nicknameForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if (!$("botNickname").value.trim()) {
    notify($("nicknameMsg"), "اكتب كنية صحيحة قبل الحفظ.");
    return;
  }

  try {
    const r=await api(sessionApi("nickname"),{
      method:"PUT",
      body:JSON.stringify({
        nickname:$("botNickname").value.trim(),
        enabled:$("nicknameGuard").checked
      })
    });

    notify($("nicknameMsg"),r.message);
    await loadDashboard();
  } catch(err) {
    notify($("nicknameMsg"),err.message);
  }
});

$("developerNicknameForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!$("developerNickname").value.trim()) {
    notify($("developerNicknameMsg"), "اكتب كنية صحيحة قبل الحفظ.");
    return;
  }
  try {
    const r = await api("/api/developer-nickname", {
      method: "PUT",
      body: JSON.stringify({ nickname: $("developerNickname").value.trim() })
    });
    notify($("developerNicknameMsg"), r.message);
    await loadDashboard();
  } catch (err) {
    notify($("developerNicknameMsg"), err.message);
  }
});

$("adminForm").addEventListener("submit",async e=>{e.preventDefault();try{await api(sessionApi("admins"),{method:"PUT",body:JSON.stringify({id:$("adminId").value,action:"add"})});$("adminId").value="";await loadDashboard();}catch(err){alert(err.message);}});
$("adminsList").addEventListener("click",async e=>{const id=e.target.dataset.admin;if(!id)return;if(confirm("حذف هذا المعرّف؟")){await api(sessionApi("admins"),{method:"PUT",body:JSON.stringify({id,action:"remove"})});await loadDashboard();}});
$("groupsList").addEventListener("click",async e=>{
  const muteButton=e.target.closest("[data-mute-group]");
  const protectButton=e.target.closest("[data-group]");
  try {
    if(muteButton){
      const id=muteButton.dataset.muteGroup;
      const muted=muteButton.dataset.muted!=="true";
      await api(sessionApi("groups/"+encodeURIComponent(id)+"/mute"),{method:"PUT",body:JSON.stringify({muted})});
      await refreshGroupsData();
      return;
    }
    if(protectButton){
      const id=protectButton.dataset.group;
      const active=protectButton.dataset.active!=="true";
      await api(sessionApi("groups/"+encodeURIComponent(id)),{method:"PUT",body:JSON.stringify({active})});
      await refreshGroupsData();
    }
  } catch(err) { alert(err.message); }
});
$("cookiesForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const cookies=$("cookiesInput").value.trim();
  if(!cookies)return;
  try {
    const r=await api(sessionApi("cookies"),{method:"POST",body:JSON.stringify({cookies})});
    $("cookiesInput").value="";
    notify($("cookiesMsg"),r.message);
  } catch(err) { notify($("cookiesMsg"),err.message); }
});
$("sessionForm").addEventListener("submit",async e=>{e.preventDefault();const f=$("sessionFile").files[0];if(!f)return;const form=new FormData();form.append("session",f);try{const r=await api(sessionApi("session"),{method:"POST",body:form});notify($("sessionMsg"),r.message);}catch(err){notify($("sessionMsg"),err.message);}});

function resetCustomCommandForm() {
  editingCustomCommand = null;
  $("customCommandForm").reset();
  $("customCommandName").readOnly = false;
  $("saveCustomCommand").textContent = "حفظ الأمر";
  notify($("customCommandMsg"), "");
}

$("customCommandForm").addEventListener("submit", async e => {
  e.preventDefault();

  const name = editingCustomCommand || $("customCommandName").value.trim().toLowerCase();
  const code = $("customCommandCode").value;

  if (!name || !code.trim()) {
    notify($("customCommandMsg"), "اكتب اسم الأمر والكود البرمجي أولاً.");
    return;
  }

  try {
    await api(sessionApi("custom-commands/" + encodeURIComponent(name)), {
      method: "PUT",
      body: JSON.stringify({ code, enabled: true })
    });

    resetCustomCommandForm();
    notify($("customCommandMsg"), "تم حفظ الأمر بنجاح.");
    await loadDashboard();
  } catch (err) {
    notify($("customCommandMsg"), err.message);
  }
});

$("cancelCustomCommand").addEventListener("click", resetCustomCommandForm);

$("commandsList").addEventListener("click", async e => {
  const editButton = e.target.closest("[data-edit-command]");
  const toggleButton = e.target.closest("[data-toggle-command]");
  const renameButton = e.target.closest("[data-rename-command]");
  const deleteButton = e.target.closest("[data-delete-command]");

  if (editButton) {
    const name = editButton.dataset.editCommand;
    const command = state.customCommands.find(c => c.name === name);
    if (!command) return;

    editingCustomCommand = name;
    $("customCommandName").value = name;
    $("customCommandName").readOnly = true;
    $("customCommandCode").value = command.code || (
      command.reply
        ? `async function(api, event) {\n  api.sendMessage(${JSON.stringify(command.reply)}, event.threadID);\n}`
        : ""
    );
    $("saveCustomCommand").textContent = "حفظ التعديل";
    notify($("customCommandMsg"), "تعديل الأمر: " + name);
    $("customCommandForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (toggleButton) {
    const name = toggleButton.dataset.toggleCommand;
    const command = state.customCommands.find(c => c.name === name);
    if (!command) return;

    try {
      await api(sessionApi("custom-commands/" + encodeURIComponent(name)), {
        method: "PUT",
        body: JSON.stringify({ code: command.code || "", reply: command.reply || "", enabled: !command.enabled })
      });
      await loadDashboard();
    } catch (err) {
      notify($("customCommandMsg"), err.message);
    }
    return;
  }

  if (renameButton) {
    const name = renameButton.dataset.renameCommand;
    const newName = prompt("اكتب الاسم الجديد للأمر:", name);

    if (newName === null || !newName.trim()) return;

    try {
      await api(sessionApi("custom-commands/" + encodeURIComponent(name)), {
        method: "PATCH",
        body: JSON.stringify({ newName: newName.trim().toLowerCase() })
      });

      if (editingCustomCommand === name) resetCustomCommandForm();
      notify($("customCommandMsg"), "تمت إعادة تسمية الأمر بنجاح.");
      await loadDashboard();
    } catch (err) {
      notify($("customCommandMsg"), err.message);
    }
    return;
  }

  if (deleteButton) {
    const name = deleteButton.dataset.deleteCommand;
    if (!confirm("هل تريد حذف الأمر " + name + " نهائيًا؟")) return;

    try {
      await api(sessionApi("custom-commands/" + encodeURIComponent(name)), {
        method: "DELETE"
      });
      if (editingCustomCommand === name) resetCustomCommandForm();
      notify($("customCommandMsg"), "تم حذف الأمر.");
      await loadDashboard();
    } catch (err) {
      notify($("customCommandMsg"), err.message);
    }
  }
});



// ===== BUILT-IN COMMANDS UI =====
let editingBuiltInCommand = null;

function resetBuiltInCommandForm() {
  editingBuiltInCommand = null;
  $("builtInCommandForm").reset();
  $("builtInCommandName").readOnly = false;
  $("builtInEditor").classList.add("hidden");
  notify($("builtInCommandMsg"), "");
}

$("builtInCommandForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!editingBuiltInCommand) return;

  const code = $("builtInCommandCode").value;
  try {
    await api("/api/built-in-commands/" + encodeURIComponent(editingBuiltInCommand), {
      method: "PUT",
      body: JSON.stringify({ code })
    });
    notify($("builtInCommandMsg"), "تم حفظ الأمر وأخذ نسخة احتياطية.");
    await loadDashboard();
    resetBuiltInCommandForm();
  } catch (err) {
    notify($("builtInCommandMsg"), err.message);
  }
});

$("cancelBuiltInCommand").addEventListener("click", resetBuiltInCommandForm);

$("builtInCommandsList").addEventListener("click", async e => {
  const edit = e.target.closest("[data-edit-builtin]");
  const rename = e.target.closest("[data-rename-builtin]");
  const remove = e.target.closest("[data-delete-builtin]");

  if (edit) {
    const name = edit.dataset.editBuiltin;
    try {
      const command = await api("/api/built-in-commands/" + encodeURIComponent(name));
      editingBuiltInCommand = name;
      $("builtInCommandName").value = name;
      $("builtInCommandName").readOnly = true;
      $("builtInCommandCode").value = command.code || "";
      $("builtInEditorTitle").textContent = "تعديل الأمر: " + name;
      $("builtInEditor").classList.remove("hidden");
      notify($("builtInCommandMsg"), "عدّل الكود ثم اضغط حفظ التعديل.");
      $("builtInEditor").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      notify($("builtInCommandMsg"), err.message);
    }
    return;
  }

  if (rename) {
    const name = rename.dataset.renameBuiltin;
    const newName = prompt("اكتب الاسم الجديد للأمر:", name);
    if (newName === null || !newName.trim()) return;
    if (!confirm("إعادة تسمية الأمر " + name + " إلى " + newName.trim() + "؟")) return;

    try {
      await api("/api/built-in-commands/" + encodeURIComponent(name), {
        method: "PATCH",
        body: JSON.stringify({ newName: newName.trim() })
      });
      if (editingBuiltInCommand === name) resetBuiltInCommandForm();
      notify($("builtInCommandMsg"), "تمت إعادة تسمية الأمر مع حفظ نسخة احتياطية.");
      await loadDashboard();
    } catch (err) {
      notify($("builtInCommandMsg"), err.message);
    }
    return;
  }

  if (remove) {
    const name = remove.dataset.deleteBuiltin;
    if (!confirm("تحذير: سيتم حذف الأمر " + name + " من مجلد commands بعد حفظ نسخة احتياطية. هل تريد المتابعة؟")) return;

    try {
      await api("/api/built-in-commands/" + encodeURIComponent(name), {
        method: "DELETE"
      });
      if (editingBuiltInCommand === name) resetBuiltInCommandForm();
      notify($("builtInCommandMsg"), "تم حذف الأمر وحفظ نسخته الاحتياطية.");
      await loadDashboard();
    } catch (err) {
      notify($("builtInCommandMsg"), err.message);
    }
  }
});

// ===== FILE MANAGER UI: BROWSE AND READ =====
async function loadFileManager(nextPath = fileManagerPath) {
  const manager = $("fileManager");
  if (!manager) return;

  fileManagerPath = nextPath;
  manager.innerHTML = '<p class="muted">جارٍ تحميل الملفات...</p>';

  try {
    const data = await api(
      "/api/files?path=" + encodeURIComponent(fileManagerPath)
    );

    const entries = data.entries || [];
    const parent = fileManagerPath
      ? fileManagerPath.split("/").slice(0, -1).join("/")
      : null;

    manager.innerHTML = `
      <div class="inline-form" style="margin:12px 0">
        <button type="button" id="fileManagerRefresh">تحديث</button>
        ${parent !== null ? '<button type="button" id="fileManagerUp">رجوع للمجلد السابق</button>' : ""}
      </div>
      <p class="muted">المسار: <b>${escapeHtml(fileManagerPath || "مجلد المشروع الرئيسي")}</b></p>
      <div class="rows">
        ${entries.length ? entries.map(item => {
          const full = fileManagerPath
            ? fileManagerPath + "/" + item.name
            : item.name;

          if (item.type === "directory") {
            return `<div class="rowitem">
              <div><b>📁 ${escapeHtml(item.name)}</b><small>مجلد</small></div>
              <button type="button" data-file-dir="${escapeHtml(full)}">فتح</button>
            </div>`;
          }

          const size = item.size < 1024
            ? item.size + " B"
            : (item.size / 1024).toFixed(1) + " KB";

          return `<div class="rowitem">
            <div><b>📄 ${escapeHtml(item.name)}</b><small>${size}</small></div>
            <button type="button" data-file-open="${escapeHtml(full)}">عرض</button>
          </div>`;
        }).join("") : '<p class="muted">هذا المجلد فارغ أو لا يحتوي ملفات مسموحًا بعرضها.</p>'}
      </div>
      <div id="filePreview" class="panel-card" style="margin-top:14px">
        <p class="muted">اختر ملفًا نصيًا لعرض محتواه هنا.</p>
      </div>
    `;
  } catch (err) {
    manager.innerHTML =
      `<p class="muted">تعذر تحميل الملفات: ${escapeHtml(err.message)}</p>
       <button type="button" id="fileManagerRefresh">إعادة المحاولة</button>`;
  }
}

async function readFileManagerFile(filePath) {
  const preview = $("filePreview");
  if (!preview) return;

  preview.innerHTML = '<p class="muted">جارٍ قراءة الملف...</p>';

  try {
    const data = await api(
      "/api/files/read?path=" + encodeURIComponent(filePath)
    );

    preview.innerHTML = `
      <h3>📄 ${escapeHtml(filePath)}</h3>
      <p class="muted">عرض فقط • ${data.size} بايت</p>
      <textarea readonly spellcheck="false" rows="18"
        style="width:100%;direction:ltr;text-align:left;font-family:monospace;resize:vertical"
      >${escapeHtml(data.content)}</textarea>
    `;
  } catch (err) {
    preview.innerHTML =
      `<p class="muted">تعذرت قراءة الملف: ${escapeHtml(err.message)}</p>`;
  }
}

const fileManagerElement = $("fileManager");
if (fileManagerElement) {
  fileManagerElement.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.id === "fileManagerRefresh") {
      await loadFileManager();
      return;
    }

    if (button.id === "fileManagerUp") {
      const parent = fileManagerPath.split("/").slice(0, -1).join("/");
      await loadFileManager(parent);
      return;
    }

    if (button.dataset.fileDir !== undefined) {
      await loadFileManager(button.dataset.fileDir);
      return;
    }

    if (button.dataset.fileOpen !== undefined) {
      await readFileManagerFile(button.dataset.fileOpen);
    }
  });
}
// ===== END FILE MANAGER UI =====

setInterval(() => {
  if (!$("appView").classList.contains("hidden")) refreshProcess();
}, 3000);

(async()=>{try{await api("/api/me");showApp();await loadDashboard();await refreshProcess();}catch{showLogin();}})();
