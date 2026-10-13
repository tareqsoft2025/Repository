const $ = id => document.getElementById(id);
let me = null;
const LOCALE = 'ar-EG-u-nu-latn'; // أرقام لاتينية (0-9) في كل الواجهة
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '—';

function showAlert(id, text) { $(id + 'Text').textContent = text; $(id).classList.add('show'); }
function hideAlert(id) { $(id).classList.remove('show'); }

function skeleton(body) {
  body.innerHTML = '<tr class="skeleton">' + '<td><i></i></td>'.repeat(5) + '</tr>'.repeat(1);
  for (let n = 0; n < 2; n++) body.appendChild(body.firstChild.cloneNode(true));
}
const fmtHours = h => h ? h.toFixed(2) : '—';

function cell(tr, text) { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); }
function numCell(tr, text, cls = 'num') { const td = document.createElement('td'); const sp = document.createElement('span'); sp.className = cls; sp.textContent = text; td.appendChild(sp); tr.appendChild(td); }
function badgeCell(tr, rec) {
  const td = document.createElement('td'); const b = document.createElement('span');
  b.className = 'badge' + (!rec.checkOut ? ' open' : '') + (Store.isLate(rec) ? ' late' : '');
  b.textContent = Store.isLate(rec) ? 'متأخر' : (rec.checkOut ? 'حاضر' : 'داخل العمل');
  td.appendChild(b); tr.appendChild(td);
}
function fillRows(body, rows, rowFn, emptyText) {
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 5; td.className = 'empty'; td.innerHTML = icon('inbox') + '<span></span>'; td.lastChild.textContent = emptyText;
    tr.appendChild(td); body.appendChild(tr);
    return;
  }
  rows.forEach(r => { const tr = document.createElement('tr'); rowFn(tr, r); body.appendChild(tr); });
}

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

function renderMine() {
  const rows = Store.recordsFor(me.id, $('myMonth').value);
  fillRows($('myBody'), rows, (tr, r) => {
    numCell(tr, r.date); numCell(tr, fmtTime(r.checkIn), 'tm'); numCell(tr, fmtTime(r.checkOut), 'tm'); numCell(tr, fmtHours(Store.hours(r))); badgeCell(tr, r);
  }, 'لا توجد سجلات في هذا الشهر');
  $('sDays').textContent = rows.length;
  $('sLate').textContent = rows.filter(Store.isLate).length;
  $('sHours').textContent = rows.reduce((s, r) => s + Store.hours(r), 0).toFixed(1);
}

function renderAdmin() {
  const names = Object.fromEntries(Store.users().map(u => [u.id, u.name]));
  const rows = Store.recordsOn($('adminDate').value);
  fillRows($('adminBody'), rows, (tr, r) => {
    cell(tr, names[r.userId] || '؟'); numCell(tr, fmtTime(r.checkIn), 'tm'); numCell(tr, fmtTime(r.checkOut), 'tm'); numCell(tr, fmtHours(Store.hours(r))); badgeCell(tr, r);
  }, 'لم يسجّل أي موظف حضوراً في هذا اليوم');
}

function refresh() { renderToday(); renderMine(); if (me.role === 'admin') renderAdmin(); }

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
  $('btnIn').onclick = () => act(id => Store.checkIn(id));
  $('btnOut').onclick = () => act(id => Store.checkOut(id));

  const now = new Date();
  $('myMonth').value = Store.dateKey(now).slice(0, 7);
  $('adminDate').value = Store.dateKey(now);
  $('myMonth').onchange = renderMine;
  $('adminDate').onchange = renderAdmin;

  if (me.role === 'admin') {
    $('adminPanel').classList.remove('hidden');
    $('addUserPanel').classList.remove('hidden');
    $('exportCsv').onclick = () => {
      const names = Object.fromEntries(Store.users().map(u => [u.id, u.name]));
      // منع حقن الصيغ في Excel: أي خلية تبدأ بـ = + - @ تُسبق بفاصلة عليا
      const safe = v => { v = String(v).replace(/"/g, '""'); return `"${/^[=+\-@]/.test(v) ? "'" + v : v}"`; };
      const lines = [['الموظف', 'التاريخ', 'الحضور', 'الانصراف', 'الساعات']]
        .concat(Store.recordsOn($('adminDate').value).map(r =>
          [names[r.userId] || '', r.date, fmtTime(r.checkIn), fmtTime(r.checkOut), fmtHours(Store.hours(r))]));
      const blob = new Blob(['﻿' + lines.map(l => l.map(safe).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `attendance-${$('adminDate').value}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    };
    $('dbPanel').classList.remove('hidden');
    $('exportDb').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(Store.exportDb());
      a.download = `attendance-${Store.dateKey(new Date())}.sqlite`; a.click();
      URL.revokeObjectURL(a.href);
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
    $('userForm').onsubmit = async e => {
      e.preventDefault();
      try {
        await Store.addUser({ name: $('uName').value.trim(), username: $('uUser').value.trim(), password: $('uPass').value, role: $('uRole').value });
        e.target.reset(); hideAlert('userMsg');
      } catch (err) { showAlert('userMsg', err.message); }
    };
  }
  tickClock(); setInterval(tickClock, 1000);
  refresh();
}

skeleton($('myBody'));
Store.ready.then(init).catch(() => { document.body.textContent = 'تعذر تحميل قاعدة البيانات'; });
