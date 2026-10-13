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
  $('pageDate').textContent = now.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
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

// ---------- شؤون الموظفين (مدير) ----------
const EMP_STATUS = { active: ['على رأس العمل', ''], leave: ['في إجازة', 'late'], terminated: ['منتهي الخدمة', 'off'] };
const uniq = list => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
let empCache = [];

function filteredEmployees() {
  const q = $('hSearch').value.trim().toLowerCase(), st = $('hStatus').value, dp = $('hDept').value;
  return empCache.filter(e => (!st || e.status === st) && (!dp || e.department === dp) &&
    (!q || [e.name, e.empNo, e.nationalId, e.phone, e.email].some(v => String(v || '').toLowerCase().includes(q))));
}
function renderHr() {
  empCache = Store.employees();
  $('hTotal').textContent = empCache.length;
  $('hActive').textContent = empCache.filter(e => e.status === 'active').length;
  $('hLeave').textContent = empCache.filter(e => e.status === 'leave').length;
  const depts = uniq(empCache.map(e => e.department));
  $('hDepts').textContent = depts.length;
  const sel = $('hDept'), keep = sel.value;
  sel.replaceChildren(new Option('الكل', ''), ...depts.map(d => new Option(d, d)));
  sel.value = depts.includes(keep) ? keep : '';
  const usersById = Object.fromEntries(Store.users().map(u => [u.id, u]));
  const rows = filteredEmployees();
  fillRows($('hrBody'), rows, (tr, e) => {
    numCell(tr, e.empNo);
    const td = cell(tr, e.name); if (e.phone) { const sub = document.createElement('span'); sub.className = 'cell-sub num'; sub.textContent = e.phone; td.appendChild(sub); }
    cell(tr, e.department || '—'); cell(tr, e.jobTitle || '—'); numCell(tr, e.hireDate || '—');
    if (e.userId && usersById[e.userId]) numCell(tr, usersById[e.userId].username); else cell(tr, '—');
    badgeCell(tr, EMP_STATUS[e.status][0], EMP_STATUS[e.status][1]);
    actionsCell(tr,
      iconBtn('pencil', 'تعديل بيانات الموظف', () => openEmpDialog(e)),
      iconBtn('trash', 'حذف الموظف', async () => {
        hideAlert('hrMsg');
        if (!confirm(`حذف ملف الموظف «${e.name}» نهائياً؟ للاحتفاظ بالسجل يمكنك تغيير حالته إلى «منتهي الخدمة» بدلاً من الحذف.`)) return;
        try { await Store.deleteEmployee(e.id); renderHr(); } catch (err) { showAlert('hrMsg', err.message); }
      }, true));
  }, empCache.length ? 'لا توجد نتائج مطابقة للبحث' : 'لا يوجد موظفون بعد. ابدأ بإضافة أول موظف', 8);
}
function openEmpDialog(emp) {
  hideAlert('empMsg');
  $('empForm').reset();
  $('empForm').dataset.id = emp ? emp.id : '';
  $('empTitle').textContent = emp ? `تعديل بيانات ${emp.name}` : 'إضافة موظف';
  const taken = new Set(empCache.filter(x => x.userId && (!emp || x.id !== emp.id)).map(x => x.userId));
  $('e_userId').replaceChildren(new Option('بدون حساب', ''), ...Store.users()
    .filter(u => !taken.has(u.id) && (u.active || u.id === emp?.userId) && (me.role === 'admin' || u.id !== me.id))
    .map(u => new Option(`${u.name} (${u.username})`, u.id)));
  // الأدلة: الأقسام والمسميات والرؤساء المحتملون
  const depts = Store.departments(), titles = Store.jobTitles();
  $('e_departmentId').replaceChildren(new Option('بدون قسم', ''), ...depts.map(d => new Option(d.name, d.id)));
  $('e_jobTitleId').replaceChildren(new Option('بدون مسمى', ''), ...titles.filter(t => t.active || t.id === emp?.jobTitleId).map(t => new Option(t.name, t.id)));
  const blocked = new Set(emp ? [emp.id, ...descendantIds(emp.id)] : []); // لا يكون الموظف أو أحد مرؤوسيه رئيساً له
  $('e_managerId').replaceChildren(new Option('بدون رئيس مباشر', ''), ...empCache
    .filter(x => !blocked.has(x.id) && (x.status !== 'terminated' || x.id === emp?.managerId))
    .map(x => new Option(`${x.name}${x.jobTitle ? ' — ' + x.jobTitle : ''}`, x.id)));
  document.querySelectorAll('#empForm [data-f]').forEach(el => { el.value = emp ? (emp[el.dataset.f] ?? '') : (el.dataset.f === 'status' ? 'active' : ''); });
  if (!emp) $('e_empNo').placeholder = Store.nextEmpNo();
  const subs = emp ? empCache.filter(x => x.managerId === emp.id) : [];
  $('empSubs').textContent = subs.length ? `يرأس ${subs.length} موظف: ${subs.slice(0, 8).map(x => x.name).join('، ')}${subs.length > 8 ? '…' : ''}` : (emp ? 'لا يوجد مرؤوسون لهذا الموظف' : '');
  updateEmpAtt(); updateGradeHint();
  $('empDialog').showModal();
  $('e_name').focus();
}
// ملخص حضور الحساب المرتبط (الشهر الحالي)
function updateEmpAtt() {
  const uid = $('e_userId').value, box = $('empAtt');
  box.classList.toggle('hidden', !uid);
  if (!uid) return;
  const a = Store.attendanceSummary(uid, thisMonth());
  box.replaceChildren(...[[a.present, 'أيام الحضور'], [a.absent, 'أيام الغياب'], [a.late, 'مرات التأخير'], [a.hours.toFixed(1), 'ساعات العمل']].map(([v, l]) => {
    const d = document.createElement('div'), b = document.createElement('b'), sp = document.createElement('span');
    b.textContent = v; sp.textContent = l; d.append(b, sp); return d;
  }));
  const note = document.createElement('div'); note.className = 'att-note';
  note.textContent = `ملخص الشهر الحالي (${thisMonth()}) من سجل حضور الحساب المرتبط`; box.appendChild(note);
}
// كل مرؤوسي الموظف مباشرة وغير مباشرة
function descendantIds(id, seen = new Set()) {
  empCache.filter(x => x.managerId === id && !seen.has(x.id)).forEach(x => { seen.add(x.id); descendantIds(x.id, seen); });
  return seen;
}
// تلميح نطاق الراتب حسب درجة المسمى المختار
function updateGradeHint() {
  const box = $('e_gradeHint'), t = Store.jobTitles().find(x => x.id === $('e_jobTitleId').value), g = t && Store.grades().find(x => x.id === t.gradeId);
  box.className = 'hint-line';
  if (!g) { box.textContent = t ? 'هذا المسمى غير مرتبط بدرجة في سلم الرواتب' : ''; return; }
  const sal = $('e_salary').value === '' ? null : Number($('e_salary').value);
  box.textContent = `الدرجة: ${g.name} (${g.code}) — نطاق الراتب ${money(g.min)} إلى ${money(g.max)}`;
  if (sal !== null && (sal < g.min || sal > g.max)) { box.textContent += ' — الراتب المدخل خارج النطاق'; box.classList.add('warn'); }
}
function employeeFromForm() {
  const e = { id: $('empForm').dataset.id || undefined };
  document.querySelectorAll('#empForm [data-f]').forEach(el => { e[el.dataset.f] = el.value; });
  return e;
}

// ---------- العقود (موارد بشرية) ----------
const CT_STATUS = { active: ['ساري', ''], expiring: ['ينتهي قريباً', 'late'], upcoming: ['لم يبدأ', 'open'], expired: ['منتهي', 'bad'], cancelled: ['ملغى', 'off'] };
const money = n => Number(n).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
let ctCache = [], ctEmps = {}, ctGrades = {};

function filteredContracts() {
  const q = $('cSearch').value.trim().toLowerCase(), st = $('cStatus').value;
  return ctCache.filter(c => (!st || Store.contractStatus(c) === st) && (!q || `${c.contractNo} ${ctEmps[c.employeeId]?.name || ''}`.toLowerCase().includes(q)));
}
function renderContracts() {
  hideAlert('contractsMsg');
  ctCache = Store.contracts();
  ctEmps = Object.fromEntries(Store.employees().map(e => [e.id, e]));
  ctGrades = Object.fromEntries(Object.keys(ctEmps).map(id => [id, Store.gradeRange(id)]));
  const count = k => ctCache.filter(c => Store.contractStatus(c) === k).length;
  $('cTotal').textContent = ctCache.length;
  $('cActive').textContent = count('active') + count('expiring');
  $('cExpiring').textContent = count('expiring');
  $('cExpired').textContent = count('expired');
  fillRows($('contractsBody'), filteredContracts(), (tr, c) => {
    const st = Store.contractStatus(c);
    numCell(tr, c.contractNo); cell(tr, ctEmps[c.employeeId]?.name || '؟');
    const tdType = cell(tr, c.type), chip = document.createElement('span');
    chip.className = 'chip' + (c.payBasis === 'volunteer' ? ' gold' : ''); chip.style.marginInlineStart = '6px'; chip.textContent = PAY_LABEL[c.payBasis]; tdType.appendChild(chip);
    numCell(tr, c.startDate); numCell(tr, c.endDate || 'غير محدد');
    const tdAmt = cell(tr, c.payBasis === 'volunteer' ? 'تطوعي' : `${money(c.basicSalary + c.allowances)} ${c.payBasis === 'daily' ? '/ يوم' : '/ شهر'}`);
    const g = c.payBasis === 'monthly' ? ctGrades[c.employeeId] : null;
    if (g && (c.basicSalary < g.min || c.basicSalary > g.max)) { const w = document.createElement('span'); w.className = 'cell-sub'; w.style.color = 'var(--warning-ink)'; w.textContent = 'خارج نطاق الدرجة'; tdAmt.appendChild(w); }
    badgeCell(tr, CT_STATUS[st][0], CT_STATUS[st][1]);
    actionsCell(tr,
      iconBtn('pencil', 'تعديل العقد', () => openContractDialog(c)),
      iconBtn('plus', 'تجديد العقد', () => openContractDialog(null, c)),
      iconBtn('trash', 'حذف العقد', async () => {
        hideAlert('contractsMsg');
        if (!confirm(`حذف العقد ${c.contractNo} نهائياً؟ لإيقافه مع بقاء السجل غيّر حالته إلى «ملغى».`)) return;
        try { await Store.deleteContract(c.id); renderContracts(); } catch (err) { showAlert('contractsMsg', err.message); }
      }, true));
  }, ctCache.length ? 'لا توجد عقود مطابقة' : 'لا توجد عقود بعد. أضف أول عقد', 8);
}
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return Store.dateKey(d); };
const PAY_LABEL = { monthly: 'شهري', daily: 'يومي', volunteer: 'متطوع' };
function updateContractSum() {
  const basis = $('c_payBasis').value, vol = basis === 'volunteer';
  $('c_basicLabel').textContent = basis === 'daily' ? 'الأجر اليومي *' : 'الراتب الشهري الأساسي *';
  $('c_basicSalary').disabled = $('c_allowances').disabled = vol;
  if (vol) $('c_basicSalary').value = $('c_allowances').value = '';
  const t = (Number($('c_basicSalary').value) || 0) + (Number($('c_allowances').value) || 0);
  $('cSum').textContent = vol ? 'عقد تطوعي: بلا أجر' : t ? (basis === 'daily' ? `الأجر اليومي الإجمالي: ${money(t)}` : `الراتب الإجمالي: ${money(t)} شهرياً`) : '';
  // مقارنة الراتب الشهري بنطاق درجة الموظف
  const box = $('cGrade'); box.className = 'hint-line'; box.textContent = '';
  const g = basis === 'monthly' && $('c_employeeId').value ? Store.gradeRange($('c_employeeId').value) : null;
  if (g) {
    box.textContent = `درجة الموظف: ${g.name} (${g.code}) — نطاق الراتب الأساسي ${money(g.min)} إلى ${money(g.max)}`;
    const b = $('c_basicSalary').value === '' ? null : Number($('c_basicSalary').value);
    if (b !== null && (b < g.min || b > g.max)) { box.textContent += ' — الراتب خارج النطاق'; box.classList.add('warn'); } else if (b !== null) box.classList.add('good');
  }
}
// c: عقد للتعديل، renewFrom: عقد يُجدَّد (يُملأ تلقائياً بعقد جديد يبدأ بعد انتهائه)
function openContractDialog(c, renewFrom) {
  hideAlert('contractMsg'); $('contractForm').reset();
  const emps = Store.employees().filter(e => (me.role === 'admin' || e.userId !== me.id));
  $('c_employeeId').replaceChildren(...emps.map(e => new Option(`${e.name} (${e.empNo})`, e.id)));
  $('c_type').replaceChildren(...Store.contractTypes.map(t => new Option(t)));
  $('c_payBasis').replaceChildren(...Store.payBases.map(k => new Option(PAY_LABEL[k], k)));
  $('contractForm').dataset.id = c ? c.id : '';
  $('contractTitle').textContent = c ? `تعديل العقد ${c.contractNo}` : renewFrom ? `تجديد العقد ${renewFrom.contractNo}` : 'إضافة عقد';
  $('c_contractNo').placeholder = Store.nextContractNo();
  const src = c || renewFrom;
  document.querySelectorAll('#contractForm [data-c]').forEach(el => { el.value = src ? (src[el.dataset.c] ?? '') : (el.dataset.c === 'status' ? 'active' : el.dataset.c === 'payBasis' ? 'monthly' : ''); });
  if (renewFrom) {
    $('c_contractNo').value = ''; $('c_status').value = 'active';
    const start = renewFrom.endDate ? addDays(renewFrom.endDate, 1) : Store.dateKey(new Date());
    $('c_startDate').value = start;
    $('c_endDate').value = renewFrom.endDate ? addDays(start, Math.round((new Date(renewFrom.endDate) - new Date(renewFrom.startDate)) / 86400000)) : '';
  }
  if (!src && emps[0]) $('c_employeeId').value = emps[0].id;
  updateContractSum();
  $('contractDialog').showModal();
}
function contractFromForm() {
  const c = { id: $('contractForm').dataset.id || undefined };
  document.querySelectorAll('#contractForm [data-c]').forEach(el => { c[el.dataset.c] = el.value; });
  return c;
}

// ---------- المسميات الوظيفية (موارد بشرية) ----------
let titleCache = [], gradeCache = [];
const countBy = (list, key) => list.reduce((m, x) => (x[key] && (m[x[key]] = (m[x[key]] || 0) + 1), m), {});

function renderTitles() {
  hideAlert('titlesMsg');
  titleCache = Store.jobTitles(); gradeCache = Store.grades();
  const grades = Object.fromEntries(gradeCache.map(g => [g.id, g])), used = countBy(Store.employees(), 'jobTitleId');
  const sel = $('tGrade'), keep = sel.value;
  sel.replaceChildren(new Option('الكل', ''), new Option('بدون درجة', 'none'), ...gradeCache.map(g => new Option(`${g.code} — ${g.name}`, g.id)));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
  const q = $('tSearch').value.trim().toLowerCase(), gf = sel.value;
  const rows = titleCache.filter(t => (!gf || (gf === 'none' ? !t.gradeId : t.gradeId === gf)) && (!q || `${t.name} ${t.code}`.toLowerCase().includes(q)));
  fillRows($('titlesBody'), rows, (tr, t) => {
    const g = grades[t.gradeId];
    numCell(tr, t.code);
    const td = cell(tr, t.name); if (t.description) { const sub = document.createElement('span'); sub.className = 'cell-sub'; sub.textContent = t.description; td.appendChild(sub); }
    cell(tr, g ? `${g.code} — ${g.name}` : '—');
    cell(tr, g ? `${money(g.min)} – ${money(g.max)}` : '—');
    numCell(tr, used[t.id] || 0);
    badgeCell(tr, t.active ? 'فعّال' : 'معطّل', t.active ? '' : 'off');
    actionsCell(tr,
      iconBtn('pencil', 'تعديل المسمى', () => openTitleDialog(t)),
      iconBtn('trash', 'حذف المسمى', async () => {
        hideAlert('titlesMsg');
        if (!confirm(`حذف المسمى «${t.name}»؟`)) return;
        try { await Store.deleteJobTitle(t.id); renderTitles(); } catch (e) { showAlert('titlesMsg', e.message); }
      }, true));
  }, titleCache.length ? 'لا توجد نتائج مطابقة' : 'لا توجد مسميات وظيفية بعد. أضف أول مسمى', 7);
}
function openTitleDialog(t) {
  hideAlert('titleMsg'); $('titleForm').reset();
  $('titleForm').dataset.id = t ? t.id : '';
  $('titleDlgTitle').textContent = t ? `تعديل المسمى ${t.name}` : 'إضافة مسمى وظيفي';
  $('t_code').placeholder = Store.nextTitleCode();
  $('t_gradeId').replaceChildren(new Option('بدون درجة', ''), ...Store.grades().map(g => new Option(`${g.code} — ${g.name} (${money(g.min)} – ${money(g.max)})`, g.id)));
  document.querySelectorAll('#titleForm [data-t]').forEach(el => { el.value = t ? String(t[el.dataset.t] ?? '') : (el.dataset.t === 'active' ? '1' : ''); });
  $('titleDialog').showModal(); $('t_name').focus();
}

// ---------- سلم الرواتب (موارد بشرية) ----------
function renderGrades() {
  hideAlert('gradesMsg');
  gradeCache = Store.grades();
  const titles = countBy(Store.jobTitles(), 'gradeId'), top = Math.max(...gradeCache.map(g => g.max), 1);
  const ladder = $('ladder'); ladder.replaceChildren();
  if (!gradeCache.length) { ladder.innerHTML = '<div class="tree-empty">' + icon('inbox') + '<div>لا توجد درجات بعد. أضف أول درجة لبناء سلم الرواتب</div></div>'; }
  gradeCache.forEach(g => {
    const row = document.createElement('div'), lab = document.createElement('div'), body = document.createElement('div'), track = document.createElement('div'), bar = document.createElement('div'), nums = document.createElement('div');
    row.className = 'ladder-row'; lab.className = 'ladder-label'; track.className = 'ladder-track'; bar.className = 'ladder-bar'; nums.className = 'ladder-nums';
    const b = document.createElement('b'), sp = document.createElement('span'); b.textContent = g.name; sp.textContent = g.code; lab.append(b, sp);
    bar.style.left = (g.min / top * 100) + '%'; bar.style.width = Math.max(1.5, (g.max - g.min) / top * 100) + '%';
    bar.title = `${money(g.min)} – ${money(g.max)}`;
    track.appendChild(bar);
    const n1 = document.createElement('span'), n2 = document.createElement('span'); n1.textContent = money(g.min); n2.textContent = money(g.max); nums.append(n1, n2);
    body.append(track, nums); row.append(lab, body); ladder.appendChild(row);
  });
  fillRows($('gradesBody'), gradeCache, (tr, g) => {
    numCell(tr, g.code); cell(tr, g.name); numCell(tr, money(g.min)); numCell(tr, money(g.max));
    numCell(tr, g.increment ? money(g.increment) : '—'); numCell(tr, g.increment ? Math.floor((g.max - g.min) / g.increment) : '—'); numCell(tr, titles[g.id] || 0);
    actionsCell(tr,
      iconBtn('pencil', 'تعديل الدرجة', () => openGradeDialog(g)),
      iconBtn('trash', 'حذف الدرجة', async () => {
        hideAlert('gradesMsg');
        if (!confirm(`حذف الدرجة «${g.name}»؟`)) return;
        try { await Store.deleteGrade(g.id); renderGrades(); } catch (e) { showAlert('gradesMsg', e.message); }
      }, true));
  }, 'لا توجد درجات بعد', 8);
}
function openGradeDialog(g) {
  hideAlert('gradeMsg'); $('gradeForm').reset();
  $('gradeForm').dataset.id = g ? g.id : '';
  $('gradeDlgTitle').textContent = g ? `تعديل ${g.name}` : 'إضافة درجة';
  $('g_code').placeholder = Store.nextGradeCode();
  document.querySelectorAll('#gradeForm [data-g]').forEach(el => { el.value = g ? String(g[el.dataset.g] ?? '') : ''; });
  $('gradeDialog').showModal(); $('g_name').focus();
}

// ---------- الهيكل التنظيمي (موارد بشرية) ----------
let orgView = 'dept';
function nodeEl({ icon: ic, title, sub, chips = [], actions = [], hasKids, open }) {
  const wrap = document.createElement(hasKids ? 'summary' : 'div'), card = document.createElement('div');
  card.className = 'node';
  const caret = document.createElement('span'); caret.innerHTML = icon('chevron-down', 'i caret' + (hasKids ? '' : ' none'));
  const ico = document.createElement('div'); ico.className = 'node-ico'; ico.innerHTML = icon(ic);
  const main = document.createElement('div'), t = document.createElement('b'), sb = document.createElement('span');
  main.className = 'node-main'; t.textContent = title; sb.textContent = sub || ''; main.append(t, sb);
  const meta = document.createElement('div'); meta.className = 'node-meta';
  chips.forEach(([text, cls]) => { const c = document.createElement('span'); c.className = 'chip ' + (cls || ''); c.textContent = text; meta.appendChild(c); });
  const act = document.createElement('div'); act.className = 'row-actions no-print';
  actions.forEach(a => { const b = iconBtn(a.icon, a.title, e => { e.preventDefault(); e.stopPropagation(); a.fn(); }, a.danger); act.appendChild(b); });
  card.append(caret.firstChild, ico, main, meta, act);
  wrap.appendChild(card); return wrap;
}
function treeList(items, build) { // items: عقد الشجرة، build(item) => { el, kids }
  const ul = document.createElement('ul');
  items.forEach(it => {
    const li = document.createElement('li'), { el, kids, open } = build(it);
    if (kids && kids.length) { const d = document.createElement('details'); d.open = open !== false; d.append(el, treeList(kids, build)); li.appendChild(d); } else li.appendChild(el);
    ul.appendChild(li);
  });
  return ul;
}
function renderOrg() {
  hideAlert('orgMsg');
  const emps = Store.employees(), depts = Store.departments(), box = $('orgTree'), note = $('orgNote');
  $('orgDept').setAttribute('aria-pressed', String(orgView === 'dept')); $('orgLine').setAttribute('aria-pressed', String(orgView === 'line'));
  $('addDept').classList.toggle('hidden', orgView !== 'dept');
  box.replaceChildren();
  const byId = Object.fromEntries(emps.map(e => [e.id, e]));
  if (orgView === 'dept') {
    const kidsOf = {}; depts.forEach(d => (kidsOf[d.parentId || ''] ||= []).push(d));
    const direct = countBy(emps.filter(e => e.status !== 'terminated'), 'departmentId');
    const total = d => (direct[d.id] || 0) + (kidsOf[d.id] || []).reduce((n, k) => n + total(k), 0);
    const roots = depts.filter(d => !d.parentId || !depts.some(x => x.id === d.parentId));
    note.textContent = `${depts.length} قسم · ${emps.filter(e => e.status !== 'terminated').length} موظف على رأس العمل${emps.some(e => !e.departmentId && e.status !== 'terminated') ? ` · ${emps.filter(e => !e.departmentId && e.status !== 'terminated').length} بلا قسم` : ''}`;
    if (!depts.length) { box.innerHTML = '<div class="tree-empty">' + icon('network') + '<div>لا توجد أقسام بعد. أضف أول قسم لبناء الهيكل</div></div>'; return; }
    const ul = treeList(roots, d => ({
      kids: kidsOf[d.id], el: nodeEl({ icon: 'building', title: d.name, sub: `${d.code}${d.managerId && byId[d.managerId] ? ' · المدير: ' + byId[d.managerId].name : ''}`, hasKids: !!(kidsOf[d.id] || []).length,
        chips: [[`${total(d)} موظف`, 'gold'], ...((kidsOf[d.id] || []).length ? [[`${kidsOf[d.id].length} قسم فرعي`]] : [])],
        actions: [{ icon: 'plus', title: 'إضافة قسم فرعي', fn: () => openDeptDialog(null, d.id) }, { icon: 'pencil', title: 'تعديل القسم', fn: () => openDeptDialog(d) },
          { icon: 'trash', title: 'حذف القسم', danger: true, fn: async () => { hideAlert('orgMsg'); if (!confirm(`حذف القسم «${d.name}»؟`)) return; try { await Store.deleteDepartment(d.id); renderOrg(); } catch (e) { showAlert('orgMsg', e.message); } } }] }) }));
    ul.classList.add('tree'); box.appendChild(ul);
  } else {
    const live = emps.filter(e => e.status !== 'terminated'), liveIds = new Set(live.map(e => e.id));
    const kidsOf = {}; live.forEach(e => (kidsOf[liveIds.has(e.managerId) ? e.managerId : ''] ||= []).push(e));
    const roots = kidsOf[''] || [], seen = new Set();
    note.textContent = `${live.length} موظف · ${roots.length} في قمة الهيكل (بلا رئيس مباشر)`;
    if (!live.length) { box.innerHTML = '<div class="tree-empty">' + icon('users') + '<div>لا يوجد موظفون لعرض التسلسل الإداري</div></div>'; return; }
    const ul = treeList(roots, e => {
      seen.add(e.id); const subs = (kidsOf[e.id] || []).filter(x => !seen.has(x.id));
      return { kids: subs, el: nodeEl({ icon: 'id-card', title: e.name, sub: [e.jobTitle, e.department].filter(Boolean).join(' · ') || e.empNo, hasKids: !!subs.length,
        chips: [...(subs.length ? [[`يرأس ${subs.length}`, 'gold']] : []), ...(e.status === 'leave' ? [['في إجازة']] : [])],
        actions: [{ icon: 'pencil', title: 'تعديل ملف الموظف', fn: () => { empCache = Store.employees(); openEmpDialog(e); } }] }) };
    });
    ul.classList.add('tree'); box.appendChild(ul);
  }
}
function openDeptDialog(d, parentId) {
  hideAlert('deptMsg'); $('deptForm').reset();
  $('deptForm').dataset.id = d ? d.id : '';
  $('deptDlgTitle').textContent = d ? `تعديل القسم ${d.name}` : parentId ? 'إضافة قسم فرعي' : 'إضافة قسم';
  $('d_code').placeholder = Store.nextDepartmentCode();
  const depts = Store.departments(), kids = {}; depts.forEach(x => (kids[x.parentId || ''] ||= []).push(x.id));
  const bad = new Set(); const walk = id => (kids[id] || []).forEach(k => { bad.add(k); walk(k); }); if (d) { bad.add(d.id); walk(d.id); }
  $('d_parentId').replaceChildren(new Option('قسم رئيسي (بلا قسم أعلى)', ''), ...depts.filter(x => !bad.has(x.id)).map(x => new Option(x.name, x.id)));
  $('d_managerId').replaceChildren(new Option('بدون مدير', ''), ...Store.employees().filter(e => e.status !== 'terminated' || e.id === d?.managerId).map(e => new Option(`${e.name}${e.jobTitle ? ' — ' + e.jobTitle : ''}`, e.id)));
  document.querySelectorAll('#deptForm [data-d]').forEach(el => { el.value = d ? String(d[el.dataset.d] ?? '') : ''; });
  if (!d && parentId) $('d_parentId').value = parentId;
  $('deptDialog').showModal(); $('d_name').focus();
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
function permCell(tr, u) {
  const td = document.createElement('td');
  const add = (text, cls) => { const b = document.createElement('span'); b.className = 'badge ' + cls; b.textContent = text; b.style.marginInlineEnd = '4px'; td.appendChild(b); };
  if (u.role === 'admin') add('كاملة', 'admin');
  else { if (u.canHr) add('موارد بشرية', 'perm'); if (u.canEdit) add('تعديل الحضور', 'perm'); if (!u.canHr && !u.canEdit) add('—', 'off'); }
  tr.appendChild(td);
}
function renderUsers() {
  fillRows($('usersBody'), Store.users(), (tr, u) => {
    cell(tr, u.name); numCell(tr, u.username);
    badgeCell(tr, u.role === 'admin' ? 'مدير' : 'موظف', u.role === 'admin' ? 'admin' : 'off');
    badgeCell(tr, u.active ? 'فعّال' : 'معطّل', u.active ? '' : 'bad');
    permCell(tr, u);
    actionsCell(tr,
      u.role === 'admin' ? iconBtn('briefcase', 'المدير يملك كل الصلاحيات', null, false, true) : iconBtn('briefcase', u.canHr ? 'سحب صلاحية الموارد البشرية' : 'منح صلاحية الموارد البشرية', async () => {
        hideAlert('usersMsg');
        try { await Store.setPermission(u.id, 'hr', !u.canHr); renderUsers(); } catch (e) { showAlert('usersMsg', e.message); }
      }, !!u.canHr),
      u.role === 'admin' ? iconBtn('pencil', 'المدير يملك كل الصلاحيات', null, false, true) : iconBtn('pencil', u.canEdit ? 'سحب صلاحية تعديل الحضور' : 'منح صلاحية تعديل الحضور', async () => {
        hideAlert('usersMsg');
        try { await Store.setPermission(u.id, 'edit', !u.canEdit); renderUsers(); } catch (e) { showAlert('usersMsg', e.message); }
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

// ---------- التنقل والقائمة الجانبية ----------
const RENDER = { contracts: renderContracts, hr: renderHr, titles: renderTitles, grades: renderGrades, org: renderOrg,
  me: () => { renderToday(); renderMine(); }, daily: renderAdmin, report: renderReport, users: renderUsers, settings: renderSettings };
const HR_TABS = ['hr', 'contracts', 'titles', 'grades', 'org'];
const PAGES = { me: ['لوحتي', ''], hr: ['ملفات الموظفين', 'شؤون الموظفين'], contracts: ['العقود', 'شؤون الموظفين'], titles: ['المسميات الوظيفية', 'شؤون الموظفين'],
  grades: ['سلم الرواتب', 'شؤون الموظفين'], org: ['الهيكل التنظيمي', 'شؤون الموظفين'], daily: ['الحضور اليومي', 'الحضور والانصراف'],
  report: ['التقارير الشهرية', 'الحضور والانصراف'], users: ['حسابات المستخدمين', 'النظام'], settings: ['الإعدادات', 'النظام'] };
const canView = name => me.role === 'admin' || name === 'me' || (HR_TABS.includes(name) && Store.canHr(me)) || (name === 'daily' && Store.canEditAttendance(me));

function showTab(name) {
  if (!RENDER[name] || !canView(name)) name = 'me';
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  document.querySelectorAll('.nav-item[data-tab]').forEach(t => { if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $('pageTitle').textContent = PAGES[name][0]; $('pageCrumb').textContent = PAGES[name][1];
  document.title = `${PAGES[name][0]} — نظام شؤون الموظفين`;
  history.replaceState(null, '', '#' + name);
  closeDrawer(); window.scrollTo(0, 0);
  RENDER[name]();
}
const currentTab = () => document.querySelector('.nav-item[aria-current=page]')?.dataset.tab || 'me';
function refresh() { RENDER[currentTab()](); renderToday(); }

// قائمة جانبية: شريط قابل للطي على الحاسوب، ودرج منزلق على الجوال واللوحي
function updateNavGroups() {
  document.querySelectorAll('[data-group]').forEach(g => g.classList.toggle('hidden', ![...g.querySelectorAll('.nav-item')].some(i => !i.classList.contains('hidden'))));
}
function setCollapsed(v, save) {
  $('app').classList.toggle('collapsed', v);
  $('sbCollapse').setAttribute('aria-expanded', String(!v));
  $('sbCollapse').title = $('sbCollapse').ariaLabel = v ? 'توسيع القائمة' : 'طيّ القائمة';
  document.querySelectorAll('.nav-item[data-label]').forEach(i => { if (v) i.title = i.dataset.label; else i.removeAttribute('title'); });
  if (save) try { localStorage.setItem('sb_collapsed', v ? '1' : '0'); } catch {}
}
function openDrawer() {
  $('app').classList.add('nav-open'); document.body.classList.add('nav-lock'); $('menuBtn').setAttribute('aria-expanded', 'true');
  ($('sidebar').querySelector('.nav-item[aria-current=page]') || $('sbClose')).focus();
}
function closeDrawer(returnFocus) {
  if (!$('app').classList.contains('nav-open')) return;
  $('app').classList.remove('nav-open'); document.body.classList.remove('nav-lock'); $('menuBtn').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('menuBtn').focus();
}
function initSidebar() {
  let pref = null; try { pref = localStorage.getItem('sb_collapsed'); } catch {}
  setCollapsed(pref === null ? innerWidth >= 992 && innerWidth < 1200 : pref === '1');
  $('sbCollapse').onclick = () => setCollapsed(!$('app').classList.contains('collapsed'), true);
  $('menuBtn').onclick = openDrawer;
  $('sbClose').onclick = () => closeDrawer(true);
  $('sbOverlay').onclick = () => closeDrawer(true);
  matchMedia('(max-width: 991px)').addEventListener('change', e => { if (!e.matches) closeDrawer(); });
  document.addEventListener('keydown', e => {
    if (!$('app').classList.contains('nav-open')) return;
    if (e.key === 'Escape') return closeDrawer(true);
    if (e.key !== 'Tab') return; // حصر التنقل بالكيبورد داخل الدرج
    const f = [...$('sidebar').querySelectorAll('button:not([disabled])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

async function act(fn) {
  hideAlert('msg');
  try { await fn(me.id); } catch (e) { showAlert('msg', e.message); }
  refresh();
}

function init() {
  me = Store.currentUser();
  if (!me) return location.replace('login.html');
  $('userName').textContent = me.name;
  const myEmp = Store.employeeOfUser(me.id);
  $('userRole').textContent = [myEmp?.jobTitle, myEmp?.department].filter(Boolean).join(' · ') || (me.role === 'admin' ? 'مدير' : 'موظف');
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

  if (Store.canHr(me)) {
    document.querySelectorAll('.hr-only').forEach(el => el.classList.remove('hidden'));

    // شؤون الموظفين
    $('addEmp').onclick = () => openEmpDialog(null);
    $('empCancel').onclick = () => $('empDialog').close();
    $('empForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('empMsg');
      try { await Store.saveEmployee(employeeFromForm()); $('empDialog').close(); refresh(); }
      catch (err) { showAlert('empMsg', err.message); $('empDialog').scrollTo({ top: $('empDialog').scrollHeight }); }
    };
    ['hSearch', 'hStatus', 'hDept'].forEach(id => $(id).addEventListener('input', renderHr));
    $('exportEmp').onclick = () => downloadCsv(`employees-${Store.dateKey(new Date())}.csv`,
      [['رقم الموظف', 'الاسم', 'الهوية', 'الجنس', 'تاريخ الميلاد', 'الجنسية', 'الحالة الاجتماعية', 'الهاتف', 'البريد', 'العنوان', 'القسم', 'المسمى الوظيفي', 'نوع التوظيف', 'تاريخ التعيين', 'الحالة']]
        .concat(filteredEmployees().map(x => [x.empNo, x.name, x.nationalId, x.gender, x.birthDate, x.nationality, x.marital, x.phone, x.email, x.address, x.department, x.jobTitle, x.empType, x.hireDate, EMP_STATUS[x.status][0]])));

    $('e_userId').onchange = updateEmpAtt;
    $('e_jobTitleId').onchange = updateGradeHint;
    $('e_salary').addEventListener('input', updateGradeHint);
    $('e_departmentId').onchange = () => { // اقتراح مدير القسم رئيساً إن لم يُحدَّد رئيس
      const d = Store.departments().find(x => x.id === $('e_departmentId').value), id = $('empForm').dataset.id;
      if (d?.managerId && d.managerId !== id && !$('e_managerId').value && [...$('e_managerId').options].some(o => o.value === d.managerId)) $('e_managerId').value = d.managerId;
    };

    // المسميات والدرجات والهيكل
    $('addTitle').onclick = () => openTitleDialog(null);
    $('titleCancel').onclick = () => $('titleDialog').close();
    $('titleForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('titleMsg');
      const t = { id: e.target.dataset.id || undefined }; document.querySelectorAll('#titleForm [data-t]').forEach(el => { t[el.dataset.t] = el.value; });
      try { await Store.saveJobTitle(t); $('titleDialog').close(); renderTitles(); } catch (err) { showAlert('titleMsg', err.message); }
    };
    ['tSearch', 'tGrade'].forEach(id => $(id).addEventListener('input', renderTitles));
    $('addGrade').onclick = () => openGradeDialog(null);
    $('gradeCancel').onclick = () => $('gradeDialog').close();
    $('gradeForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('gradeMsg');
      const g = { id: e.target.dataset.id || undefined }; document.querySelectorAll('#gradeForm [data-g]').forEach(el => { g[el.dataset.g] = el.value; });
      try { await Store.saveGrade(g); $('gradeDialog').close(); renderGrades(); } catch (err) { showAlert('gradeMsg', err.message); }
    };
    $('addDept').onclick = () => openDeptDialog(null);
    $('deptCancel').onclick = () => $('deptDialog').close();
    $('deptForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('deptMsg');
      const d = { id: e.target.dataset.id || undefined }; document.querySelectorAll('#deptForm [data-d]').forEach(el => { d[el.dataset.d] = el.value; });
      try { await Store.saveDepartment(d); $('deptDialog').close(); renderOrg(); } catch (err) { showAlert('deptMsg', err.message); }
    };
    $('orgDept').onclick = () => { orgView = 'dept'; renderOrg(); };
    $('orgLine').onclick = () => { orgView = 'line'; renderOrg(); };

    // العقود
    $('addContract').onclick = () => openContractDialog(null);
    $('contractCancel').onclick = () => $('contractDialog').close();
    ['c_basicSalary', 'c_allowances'].forEach(id => $(id).addEventListener('input', updateContractSum));
    ['c_payBasis', 'c_employeeId'].forEach(id => $(id).addEventListener('change', updateContractSum));
    $('contractForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('contractMsg');
      try { await Store.saveContract(contractFromForm()); $('contractDialog').close(); renderContracts(); }
      catch (err) { showAlert('contractMsg', err.message); $('contractDialog').scrollTo({ top: $('contractDialog').scrollHeight }); }
    };
    ['cSearch', 'cStatus'].forEach(id => $(id).addEventListener('input', renderContracts));
    $('exportContracts').onclick = () => downloadCsv(`contracts-${Store.dateKey(new Date())}.csv`,
      [['رقم العقد', 'الموظف', 'مدة العقد', 'نوع الأجر', 'البداية', 'النهاية', 'الراتب/الأجر الأساسي', 'البدلات', 'الحالة']]
        .concat(filteredContracts().map(c => [c.contractNo, ctEmps[c.employeeId]?.name || '', c.type, PAY_LABEL[c.payBasis], c.startDate, c.endDate || '', c.basicSalary, c.allowances, CT_STATUS[Store.contractStatus(c)][0]])));
  }

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

  updateNavGroups(); initSidebar();
  tickClock(); setInterval(tickClock, 1000);
  showTab(location.hash.slice(1) || (Store.canHr(me) ? 'hr' : 'me'));
}

skeleton($('myBody'));
Store.ready.then(init).catch(e => { console.error(e); document.body.textContent = 'تعذر تحميل قاعدة البيانات'; });
