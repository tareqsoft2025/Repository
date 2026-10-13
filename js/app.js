const $ = id => document.getElementById(id);
let me = null;
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtHours = h => h ? h.toFixed(2) : '—';

function cell(tr, text) { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); }
function badgeCell(tr, rec) {
  const td = document.createElement('td'); const b = document.createElement('span');
  b.className = 'badge' + (!rec.checkOut ? ' open' : '') + (Store.isLate(rec) ? ' late' : '');
  b.textContent = Store.isLate(rec) ? 'متأخر' : (rec.checkOut ? 'حاضر' : 'داخل العمل');
  td.appendChild(b); tr.appendChild(td);
}
function fillRows(body, rows, rowFn) {
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = 5; td.className = 'empty'; td.textContent = 'لا توجد سجلات'; tr.appendChild(td); body.appendChild(tr);
    return;
  }
  rows.forEach(r => { const tr = document.createElement('tr'); rowFn(tr, r); body.appendChild(tr); });
}

function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('en-GB');
  $('today').textContent = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function renderToday() {
  const r = Store.todayRecord(me.id);
  $('btnIn').disabled = !!r;
  $('btnOut').disabled = !r || !!r.checkOut;
  $('status').textContent = !r ? 'لم تسجل حضورك اليوم بعد'
    : r.checkOut ? `حضور ${fmtTime(r.checkIn)} — انصراف ${fmtTime(r.checkOut)}`
    : `سجلت حضورك الساعة ${fmtTime(r.checkIn)}${Store.isLate(r) ? ' (متأخر)' : ''}`;
}

function renderMine() {
  const rows = Store.recordsFor(me.id, $('myMonth').value);
  fillRows($('myBody'), rows, (tr, r) => {
    cell(tr, r.date); cell(tr, fmtTime(r.checkIn)); cell(tr, fmtTime(r.checkOut)); cell(tr, fmtHours(Store.hours(r))); badgeCell(tr, r);
  });
  $('sDays').textContent = rows.length;
  $('sLate').textContent = rows.filter(Store.isLate).length;
  $('sHours').textContent = rows.reduce((s, r) => s + Store.hours(r), 0).toFixed(1);
}

function renderAdmin() {
  const names = Object.fromEntries(Store.users().map(u => [u.id, u.name]));
  const rows = Store.recordsOn($('adminDate').value);
  fillRows($('adminBody'), rows, (tr, r) => {
    cell(tr, names[r.userId] || '؟'); cell(tr, fmtTime(r.checkIn)); cell(tr, fmtTime(r.checkOut)); cell(tr, fmtHours(Store.hours(r))); badgeCell(tr, r);
  });
}

function refresh() { renderToday(); renderMine(); if (me.role === 'admin') renderAdmin(); }

async function act(fn) {
  $('msg').style.display = 'none';
  try { await fn(me.id); } catch (e) { $('msg').textContent = e.message; $('msg').style.display = 'block'; }
  refresh();
}

function init() {
  me = Store.currentUser();
  if (!me) return location.replace('login.html');
  $('userName').textContent = me.name;
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
      $('dbMsg').style.display = 'none';
      if (!confirm('سيتم استبدال كل البيانات الحالية بمحتوى الملف. هل أنت متأكد؟')) { e.target.value = ''; return; }
      try {
        await Store.importDb(file);
        if (!Store.currentUser()) { Store.logout(); return location.replace('login.html'); }
        me = Store.currentUser(); refresh();
      } catch (err) { $('dbMsg').textContent = err.message; $('dbMsg').style.display = 'block'; }
      e.target.value = '';
    };
    $('userForm').onsubmit = async e => {
      e.preventDefault();
      try {
        await Store.addUser({ name: $('uName').value.trim(), username: $('uUser').value.trim(), password: $('uPass').value, role: $('uRole').value });
        e.target.reset(); $('userMsg').style.display = 'none';
      } catch (err) { $('userMsg').textContent = err.message; $('userMsg').style.display = 'block'; }
    };
  }
  tickClock(); setInterval(tickClock, 1000);
  refresh();
}

Store.ready.then(init).catch(() => { document.body.textContent = 'تعذر تحميل قاعدة البيانات'; });
