const $ = id => document.getElementById(id);
const LOCALE = 'ar-EG-u-nu-latn'; // أرقام لاتينية (0-9) في كل الواجهة
const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
let me = null;

// ---------- أدوات عامة ----------
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtHours = h => h ? h.toFixed(2) : '—';
const hhmm = iso => { const d = new Date(iso); return `${Store.pad(d.getHours())}:${Store.pad(d.getMinutes())}`; };
const thisMonth = () => Store.dateKey(new Date()).slice(0, 7);

function showAlert(id, text) { $(id + 'Text').textContent = text; $(id).classList.add('show'); }
function hideAlert(id) { $(id).classList.remove('show'); }

function skeleton(body) {
  body.innerHTML = '<tr class="skeleton">' + '<td><i></i></td>'.repeat(5) + '</tr>';
  for (let n = 0; n < 2; n++) body.appendChild(body.firstChild.cloneNode(true));
}

function cell(tr, text, cls) {
  const td = document.createElement('td');
  if (cls) { const sp = document.createElement('span'); sp.className = cls; sp.textContent = text; td.appendChild(sp); }
  else td.textContent = text;
  tr.appendChild(td); return td;
}
const numCell = (tr, text) => cell(tr, text, 'num');
const timeCell = (tr, text) => cell(tr, text, 'tm');
function badgeCell(tr, text, cls = '') {
  const td = document.createElement('td'), b = document.createElement('span');
  b.className = 'badge ' + cls; b.textContent = text; td.appendChild(b); tr.appendChild(td);
}
function statusCell(tr, rec) {
  const late = Store.isLate(rec);
  badgeCell(tr, late ? 'متأخر' : rec.checkOut ? 'حاضر' : 'داخل العمل', (!rec.checkOut ? 'open ' : '') + (late ? 'late' : ''));
  if (rec.editedBy) { // سجل عُدّل يدوياً: يظهر من عدّله ومتى
    const b = document.createElement('span'), names = userNames();
    b.className = 'badge off'; b.style.marginInlineStart = '6px'; b.textContent = 'معدّل';
    b.title = `عُدّل بواسطة ${names[rec.editedBy] || '؟'} — ${new Date(rec.editedAt).toLocaleString(LOCALE)}`;
    tr.lastChild.appendChild(b);
  }
}
function iconBtn(name, title, onClick, danger, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'icon-btn' + (danger ? ' danger' : ''); b.title = title; b.setAttribute('aria-label', title);
  b.innerHTML = icon(name); b.onclick = onClick; b.disabled = disabled; return b;
}
function actionsCell(tr, ...btns) {
  const td = document.createElement('td'), d = document.createElement('div');
  d.className = 'row-actions'; btns.forEach(b => d.appendChild(b)); td.appendChild(d); td.className = 'no-print'; tr.appendChild(td);
}
function fillRows(body, rows, rowFn, emptyText, cols = 5) {
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = cols; td.className = 'empty'; td.innerHTML = icon('inbox') + '<span></span>'; td.lastChild.textContent = emptyText;
    tr.appendChild(td); body.appendChild(tr); return;
  }
  rows.forEach(r => { const tr = document.createElement('tr'); rowFn(tr, r); body.appendChild(tr); });
}
// CSV آمن: يمنع حقن الصيغ في Excel (= + - @) ويضيف BOM للعربية
function downloadCsv(filename, rows) {
  const safe = v => { v = String(v).replace(/"/g, '""'); return `"${/^[=+\-@]/.test(v) ? "'" + v : v}"`; };
  const blob = new Blob(['﻿' + rows.map(r => r.map(safe).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
const userNames = () => Object.fromEntries(Store.users().map(u => [u.id, u.name]));

// ---------- الساعة وحالة اليوم ----------
function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('en-GB');
  $('today').textContent = now.toLocaleDateString(LOCALE, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function renderToday() {
  const r = Store.todayRecord(me.id);
  $('btnIn').disabled = !!r;
  $('btnOut').disabled = !r || !!r.checkOut;
  $('statusText').textContent = !r ? 'لم تسجل حضورك اليوم بعد'
    : r.checkOut ? `حضور ${fmtTime(r.checkIn)} — انصراف ${fmtTime(r.checkOut)}`
    : `سجلت حضورك الساعة ${fmtTime(r.checkIn)}${Store.isLate(r) ? ' (متأخر)' : ''}`;
  $('status').className = 'status' + (!r ? '' : r.checkOut ? ' done' : Store.isLate(r) ? ' late' : ' on');
}

// ---------- لوحتي + الرسم البياني ----------
function renderChart(rows) {
  const box = $('chart'), data = [...rows].reverse();
  if (!data.length) { box.innerHTML = '<div class="empty">' + icon('inbox') + '<span>لا توجد بيانات لعرضها في هذا الشهر</span></div>'; return; }
  const W = 640, H = 190, L = 30, B = 22, T = 12, goal = Store.dailyHours();
  const max = Math.max(goal * 1.25, ...data.map(Store.hours)), plotH = H - B - T, slot = (W - L - 8) / data.length, bw = Math.min(28, slot * 0.6);
  const y = h => T + plotH - (h / max) * plotH;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ساعات العمل اليومية"><line class="grid" x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
  svg += `<line class="goal" x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/><text x="${L - 4}" y="${y(goal) + 3}" style="text-anchor:end">${+goal.toFixed(1)}</text><text x="${L - 4}" y="${y(0) + 3}" style="text-anchor:end">0</text>`;
  data.forEach((r, i) => {
    const h = Store.hours(r), cx = L + slot * i + slot / 2;
    svg += `<rect class="bar${Store.isLate(r) ? ' late' : ''}" x="${cx - bw / 2}" y="${y(h)}" width="${bw}" height="${Math.max(0, y(0) - y(h))}" rx="3"><title>${r.date}: ${h.toFixed(2)}</title></rect>`;
    svg += `<text x="${cx}" y="${H - 6}">${Number(r.date.slice(8))}</text>`;
  });
  box.innerHTML = svg + '</svg>';
}
function renderMine() {
  const rows = Store.recordsFor(me.id, $('myMonth').value);
  fillRows($('myBody'), rows, (tr, r) => {
    numCell(tr, r.date); timeCell(tr, fmtTime(r.checkIn)); timeCell(tr, fmtTime(r.checkOut)); numCell(tr, fmtHours(Store.hours(r))); statusCell(tr, r);
  }, 'لا توجد سجلات في هذا الشهر');
  $('sDays').textContent = rows.length;
  $('sLate').textContent = rows.filter(Store.isLate).length;
  $('sHours').textContent = rows.reduce((s, r) => s + Store.hours(r), 0).toFixed(1);
  renderChart(rows);
}

// ---------- الحضور اليومي (مدير) ----------
function renderAdmin() {
  const names = userNames();
  fillRows($('adminBody'), Store.recordsOn($('adminDate').value), (tr, r) => {
    cell(tr, names[r.userId] || '؟'); timeCell(tr, fmtTime(r.checkIn)); timeCell(tr, fmtTime(r.checkOut)); numCell(tr, fmtHours(Store.hours(r))); statusCell(tr, r);
    actionsCell(tr,
      iconBtn('pencil', 'تعديل السجل', () => openRecDialog(r)),
      iconBtn('trash', 'حذف السجل', async () => {
        if (!confirm(`حذف سجل ${names[r.userId] || ''} بتاريخ ${r.date}؟`)) return;
        await Store.deleteRecord(r.id); refresh();
      }, true));
  }, 'لم يسجّل أي موظف حضوراً في هذا اليوم', 6);
}
function openRecDialog(rec) {
  hideAlert('recMsg');
  const sel = $('recUser'); sel.replaceChildren();
  Store.users().filter(u => (u.active || (rec && u.id === rec.userId)) && (me.role === 'admin' || u.id !== me.id)).forEach(u => sel.add(new Option(u.name, u.id)));
  $('recTitle').textContent = rec ? 'تعديل سجل' : 'إضافة سجل يدوي';
  $('recForm').dataset.id = rec ? rec.id : '';
  sel.value = rec ? rec.userId : sel.options[0]?.value;
  $('recDate').value = rec ? rec.date : $('adminDate').value;
  $('recIn').value = rec ? hhmm(rec.checkIn) : Store.settings.workStart;
  $('recOut').value = rec?.checkOut ? hhmm(rec.checkOut) : '';
  $('recDialog').showModal();
}

// ---------- التقرير الشهري (مدير) ----------
function renderReport() {
  const month = $('reportMonth').value || thisMonth(), rows = Store.report(month);
  $('reportNote').textContent = `أيام الدوام حتى اليوم: ${rows[0]?.workingDays ?? Store.workingDays(month)} (دون أيام الإجازة الأسبوعية)`;
  $('reportTitle').textContent = `تقرير الحضور — ${month}`;
  fillRows($('reportBody'), rows, (tr, r) => {
    cell(tr, r.name); numCell(tr, r.workingDays); numCell(tr, r.present);
    badgeCell(tr, String(r.absent), r.absent ? 'bad' : 'off'); badgeCell(tr, String(r.late), r.late ? 'late' : 'off'); numCell(tr, r.hours.toFixed(1));
  }, 'لا يوجد موظفون', 6);
}

// ---------- الموظفون (مدير) ----------
function renderUsers() {
  fillRows($('usersBody'), Store.users(), (tr, u) => {
    cell(tr, u.name); numCell(tr, u.username);
    badgeCell(tr, u.role === 'admin' ? 'مدير' : 'موظف', u.role === 'admin' ? 'admin' : 'off');
    badgeCell(tr, u.active ? 'فعّال' : 'معطّل', u.active ? '' : 'bad');
    badgeCell(tr, u.role === 'admin' ? 'كاملة' : u.canEdit ? 'مسموح' : 'غير مسموح', u.role === 'admin' ? 'admin' : u.canEdit ? '' : 'off');
    actionsCell(tr,
      u.role === 'admin' ? iconBtn('pencil', 'المدير يملك صلاحية التعديل دائماً', null, false, true) : iconBtn('pencil', u.canEdit ? 'سحب صلاحية تعديل الحضور' : 'منح صلاحية تعديل الحضور', async () => {
        hideAlert('usersMsg');
        try { await Store.setCanEdit(u.id, !u.canEdit); renderUsers(); } catch (e) { showAlert('usersMsg', e.message); }
      }, !!u.canEdit),
      iconBtn('key', 'إعادة تعيين كلمة المرور', () => openPwDialog(u)),
      iconBtn(u.active ? 'ban' : 'check', u.active ? 'تعطيل الحساب' : 'تفعيل الحساب', async () => {
        hideAlert('usersMsg');
        try { await Store.setActive(u.id, !u.active); renderUsers(); } catch (e) { showAlert('usersMsg', e.message); }
      }, u.active));
  }, 'لا يوجد مستخدمون', 6);
}
function openPwDialog(user) {
  const self = user.id === me.id;
  hideAlert('pwMsg'); $('pwForm').reset();
  $('pwForm').dataset.id = user.id;
  $('pwTitle').textContent = self ? 'تغيير كلمة المرور' : `إعادة تعيين كلمة مرور ${user.name}`;
  $('pwOldWrap').classList.toggle('hidden', !self);
  $('pwOld').required = self;
  $('pwDialog').showModal();
}

// ---------- الإعدادات (مدير) ----------
function renderSettings() {
  const s = Store.settings, off = s.weekend.split(',');
  $('setStart').value = s.workStart; $('setEnd').value = s.workEnd; $('setGrace').value = s.graceMin;
  $('setWeekend').replaceChildren(...DAY_NAMES.map((name, i) => {
    const l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.value = i; c.checked = off.includes(String(i));
    l.append(c, name); return l;
  }));
}

// ---------- التبويبات ----------
const RENDER = { me: () => { renderToday(); renderMine(); }, daily: renderAdmin, report: renderReport, users: renderUsers, settings: renderSettings };
function showTab(name) {
  if (!RENDER[name] || (name !== 'me' && !(me.role === 'admin' || (name === 'daily' && Store.canEditAttendance(me))))) name = 'me';
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  history.replaceState(null, '', '#' + name);
  RENDER[name]();
}
const currentTab = () => document.querySelector('[data-tab][aria-selected=true]')?.dataset.tab || 'me';
function refresh() { RENDER[currentTab()](); renderToday(); }

async function act(fn) {
  hideAlert('msg');
  try { await fn(me.id); } catch (e) { showAlert('msg', e.message); }
  refresh();
}

function init() {
  me = Store.currentUser();
  if (!me) return location.replace('login.html');
  $('userName').textContent = me.name;
  $('userRole').textContent = me.role === 'admin' ? 'مدير' : 'موظف';
  $('avatar').textContent = [...me.name][0];
  $('logout').onclick = () => { Store.logout(); location.replace('login.html'); };
  $('btnPw').onclick = () => openPwDialog(me);
  $('btnIn').onclick = () => act(id => Store.checkIn(id));
  $('btnOut').onclick = () => act(id => Store.checkOut(id));

  $('myMonth').value = $('reportMonth').value = thisMonth();
  $('adminDate').value = Store.dateKey(new Date());
  $('myMonth').onchange = renderMine;
  $('adminDate').onchange = renderAdmin;
  $('reportMonth').onchange = renderReport;
  document.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => showTab(t.dataset.tab));

  // نافذة كلمة المرور
  $('pwCancel').onclick = () => $('pwDialog').close();
  $('pwForm').onsubmit = async e => {
    e.preventDefault(); hideAlert('pwMsg');
    const id = e.target.dataset.id;
    try {
      if (id === me.id) await Store.changeOwnPassword(id, $('pwOld').value, $('pwNew').value);
      else await Store.setPassword(id, $('pwNew').value);
      $('pwDialog').close();
    } catch (err) { showAlert('pwMsg', err.message); }
  };

  if (Store.canEditAttendance(me)) {
    document.querySelectorAll('.edit-only').forEach(el => el.classList.remove('hidden'));

    // سجل يدوي
    $('addRecord').onclick = () => openRecDialog(null);
    $('recCancel').onclick = () => $('recDialog').close();
    $('recForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('recMsg');
      try {
        await Store.saveRecord({ id: e.target.dataset.id || undefined, userId: $('recUser').value, date: $('recDate').value, checkIn: $('recIn').value, checkOut: $('recOut').value });
        $('recDialog').close(); refresh();
      } catch (err) { showAlert('recMsg', err.message); }
    };

    $('exportCsv').onclick = () => {
      const names = userNames();
      downloadCsv(`attendance-${$('adminDate').value}.csv`, [['الموظف', 'التاريخ', 'الحضور', 'الانصراف', 'الساعات']]
        .concat(Store.recordsOn($('adminDate').value).map(r => [names[r.userId] || '', r.date, fmtTime(r.checkIn), fmtTime(r.checkOut), fmtHours(Store.hours(r))])));
    };
  }

  if (me.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

    $('exportReport').onclick = () => downloadCsv(`report-${$('reportMonth').value}.csv`, [['الموظف', 'أيام الدوام', 'الحضور', 'الغياب', 'التأخير', 'ساعات العمل']]
      .concat(Store.report($('reportMonth').value).map(r => [r.name, r.workingDays, r.present, r.absent, r.late, r.hours.toFixed(1)])));
    $('printReport').onclick = () => window.print();

    // مستخدمون
    $('userForm').onsubmit = async e => {
      e.preventDefault();
      try {
        await Store.addUser({ name: $('uName').value.trim(), username: $('uUser').value.trim(), password: $('uPass').value, role: $('uRole').value });
        e.target.reset(); hideAlert('userMsg'); renderUsers();
      } catch (err) { showAlert('userMsg', err.message); }
    };

    // إعدادات
    $('settingsForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('setMsg'); $('setOk').classList.remove('show');
      try {
        await Store.saveSettings({ workStart: $('setStart').value, workEnd: $('setEnd').value, graceMin: $('setGrace').value,
          weekend: [...$('setWeekend').querySelectorAll('input:checked')].map(c => c.value).join(',') });
        $('setOk').classList.add('show');
      } catch (err) { showAlert('setMsg', err.message); }
    };

    // قاعدة البيانات
    $('exportDb').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(Store.exportDb());
      a.download = `attendance-${Store.dateKey(new Date())}.sqlite`; a.click(); URL.revokeObjectURL(a.href);
    };
    $('importDb').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      hideAlert('dbMsg');
      if (!confirm('سيتم استبدال كل البيانات الحالية بمحتوى الملف. هل أنت متأكد؟')) { e.target.value = ''; return; }
      try {
        await Store.importDb(file);
        if (!Store.currentUser()) { Store.logout(); return location.replace('login.html'); }
        me = Store.currentUser(); refresh();
      } catch (err) { showAlert('dbMsg', err.message); }
      e.target.value = '';
    };
  }

  tickClock(); setInterval(tickClock, 1000);
  showTab(location.hash.slice(1) || 'me');
}

skeleton($('myBody'));
Store.ready.then(init).catch(() => { document.body.textContent = 'تعذر تحميل قاعدة البيانات'; });
