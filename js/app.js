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
  const r = Store.todayRecord(me.id), el = Store.attendanceEligibility(me.id);
  $('btnIn').disabled = !!r || !el.ok; // لا حضور بدون عقد ساري
  $('btnOut').disabled = !r || !!r.checkOut;
  $('statusText').textContent = !r ? 'لم تسجل حضورك اليوم بعد'
    : r.checkOut ? `حضور ${fmtTime(r.checkIn)} — انصراف ${fmtTime(r.checkOut)}`
    : `سجلت حضورك الساعة ${fmtTime(r.checkIn)}${Store.isLate(r) ? ' (متأخر)' : ''}`;
  $('status').className = 'status' + (!r ? '' : r.checkOut ? ' done' : Store.isLate(r) ? ' late' : ' on');
  if (!r && !el.ok) { // سبب المنع يظهر للموظف بدل رسالة «لم تسجل بعد»
    $('statusText').textContent = `لا يمكنك تسجيل الحضور: ${Store.eligibilityReason(el, true)}. تواصل مع الموارد البشرية`;
    $('status').className = 'status blocked';
  }
}

// ---------- عقدي ----------
function fact(label, value) {
  const d = document.createElement('div'), l = document.createElement('span'), v = document.createElement('b');
  d.className = 'fact'; l.textContent = label; v.textContent = value; d.append(l, v); return d;
}
function renderMyContract() {
  const box = $('myContract'), el = Store.attendanceEligibility(me.id), cs = Store.myContracts(), emp = Store.employeeOfUser(me.id);
  box.replaceChildren(); $('printMine').classList.add('hidden');
  $('contractCard').classList.toggle('hidden', !!el.exempt && !cs.length); // حساب إدارة بلا ملف موظف: لا بطاقة
  if (!cs.length) { // لا عقد: تُشرح النتيجة
    box.innerHTML = '<div class="notice bad">' + icon('alert') + '<span></span></div>';
    box.querySelector('span').textContent = emp ? 'لا يوجد عقد مرتبط بحسابك. لا يمكنك تسجيل الحضور حتى تُنشئ الموارد البشرية عقدك.' : 'حسابك غير مرتبط بملف موظف، ولا يمكنك تسجيل الحضور حتى يُربط بملفك.';
    return;
  }
  const cur = el.contract || cs.find(c => c.status === 'active') || cs[0], st = Store.contractStatus(cur);
  $('printMine').classList.remove('hidden'); $('printMine').onclick = () => printContract(cur.id);
  const head = document.createElement('div'); head.className = 'contract-head';
  const no = document.createElement('span'); no.className = 'no'; no.textContent = cur.contractNo;
  const badge = document.createElement('span'); badge.className = 'badge ' + CT_STATUS[st][1]; badge.textContent = CT_STATUS[st][0];
  const chip = document.createElement('span'); chip.className = 'chip' + (cur.payBasis === 'volunteer' ? ' gold' : ''); chip.textContent = PAY_LABEL[cur.payBasis];
  head.append(no, badge, chip); box.appendChild(head);

  const days = cur.endDate ? Math.round((new Date(cur.endDate) - new Date(Store.dateKey(new Date()))) / 86400000) : null;
  if (!el.ok) { const n = document.createElement('div'); n.className = 'notice bad'; n.innerHTML = icon('alert') + '<span></span>'; n.lastChild.textContent = `لا يمكنك تسجيل الحضور: ${Store.eligibilityReason(el, true)}.`; box.appendChild(n); }
  else if (st === 'expiring') { const n = document.createElement('div'); n.className = 'notice'; n.innerHTML = icon('alert') + '<span></span>'; n.lastChild.textContent = `ينتهي عقدك بعد ${days} يوماً. بعد انتهائه لن تتمكن من تسجيل الحضور حتى يُجدَّد.`; box.appendChild(n); }

  const facts = document.createElement('div'); facts.className = 'facts';
  facts.append(fact('مدة العقد', cur.type), fact('تاريخ البداية', cur.startDate), fact('تاريخ الانتهاء', cur.endDate || 'غير محدد'));
  if (cur.payBasis === 'volunteer') facts.append(fact('الأجر', 'تطوعي — بلا أجر'));
  else if (cur.payBasis === 'daily') facts.append(fact('الأجر اليومي', money(cur.basicSalary)), fact('البدلات اليومية', money(cur.allowances)), fact('الإجمالي اليومي', money(cur.basicSalary + cur.allowances)));
  else facts.append(fact('الراتب الأساسي', money(cur.basicSalary)), fact('البدلات', money(cur.allowances)), fact('الإجمالي الشهري', money(cur.basicSalary + cur.allowances)));
  if (emp) facts.append(fact('رقم الموظف', emp.empNo));
  const job = cur.jobTitle || emp?.jobTitle; if (job) facts.append(fact('المسمى الوظيفي', job));
  if (emp?.department) facts.append(fact('القسم', emp.department));
  if (days !== null && st !== 'expired' && st !== 'cancelled') facts.append(fact('المتبقي على الانتهاء', days >= 0 ? `${days} يوم` : '—'));
  box.appendChild(facts);
  if (cur.notes) { const p = document.createElement('p'); p.className = 'card-note'; p.style.marginTop = '12px'; p.textContent = 'ملاحظات: ' + cur.notes; box.appendChild(p); }

  const others = cs.filter(c => c.id !== cur.id);
  if (others.length) { // سجل العقود السابقة
    const t = document.createElement('div'); t.className = 'sub-title'; t.textContent = 'العقود السابقة'; box.appendChild(t);
    const wrap = document.createElement('div'), table = document.createElement('table'), tb = document.createElement('tbody');
    wrap.className = 'table-wrap'; table.innerHTML = '<thead><tr><th>الرقم</th><th>المدة</th><th>نوع الأجر</th><th>الفترة</th><th>الحالة</th></tr></thead>';
    others.forEach(c => { const tr = document.createElement('tr'), s2 = Store.contractStatus(c);
      numCell(tr, c.contractNo); cell(tr, c.type); cell(tr, PAY_LABEL[c.payBasis]); periodCell(tr, c.startDate, c.endDate); badgeCell(tr, CT_STATUS[s2][0], CT_STATUS[s2][1]); tb.appendChild(tr); });
    table.appendChild(tb); wrap.appendChild(table); box.appendChild(wrap);
  }
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
  $('hrOk').classList.remove('show');
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
  $('e_departmentId').replaceChildren(new Option('-- اختر --', ''), ...depts.map(d => new Option(d.name, d.id)));
  $('e_jobTitleId').replaceChildren(new Option('-- اختر --', ''), ...titles.filter(t => t.active || t.id === emp?.jobTitleId).map(t => new Option(t.name, t.id)));
  const blocked = new Set(emp ? [emp.id, ...descendantIds(emp.id)] : []); // لا يكون الموظف أو أحد مرؤوسيه رئيساً له
  const candidates = empCache.filter(x => !blocked.has(x.id) && (x.status !== 'terminated' || x.id === emp?.managerId));
  mgrMap = Object.fromEntries(candidates.map(x => [mgrLabel(x), x.id]));
  $('mgrList').replaceChildren(...candidates.map(x => { const o = document.createElement('option'); o.value = mgrLabel(x); o.label = x.jobTitle || ''; return o; }));
  document.querySelectorAll('#empForm [data-f]').forEach(el => { el.value = emp ? (emp[el.dataset.f] ?? '') : (el.dataset.f === 'status' ? 'active' : ''); });
  $('e_empNo').value = emp ? emp.empNo : Store.nextEmpNo();
  setManager(emp?.managerId);
  fillExtras(emp);
  const canCreate = !emp?.userId; // لا يُنشأ حساب إن كان الموظف مرتبطاً بحساب
  $('e_createWrap').classList.toggle('hidden', !canCreate);
  $('e_accHint').classList.toggle('hidden', !canCreate);
  $('e_createAccount').checked = canCreate && !emp; // الافتراضي: حساب تلقائي للموظف الجديد فقط
  syncCreateAccount();
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
// ---------- المدير المباشر: بحث بالاسم ----------
let mgrMap = {};
const mgrLabel = x => `${x.name} — ${x.empNo}`;
function setManager(id) {
  const e = empCache.find(x => x.id === id);
  $('e_managerId').value = e ? id : ''; $('e_managerSearch').value = e ? mgrLabel(e) : '';
}
function syncManager() { const v = $('e_managerSearch').value.trim(); $('e_managerId').value = v ? (mgrMap[v] || '') : ''; }

// ---------- أقسام قابلة للتكرار: مؤهلات / دورات / خبرات + المرفقات ----------
let repSeq = 0;
const DEGREES = ['ثانوية عامة', 'دبلوم', 'بكالوريوس', 'ماجستير', 'دكتوراه'];
function downloadDoc(id) {
  try { const d = Store.getDocument(id), a = document.createElement('a'); a.href = URL.createObjectURL(d.blob); a.download = d.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  catch (e) { showAlert('empMsg', e.message); }
}
// عرض المرفق الحالي مع رابط تحميله وخيار حذفه
function currentFile(doc, removeKey) {
  const box = document.createElement('div'); box.className = 'file-cur';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = `تحميل: ${doc.name} (${Math.max(1, Math.round(doc.size / 1024))} ك.ب)`; b.onclick = () => downloadDoc(doc.id);
  const l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.dataset.k = removeKey; l.append(c, ' حذف المرفق');
  box.append(b, l); return box;
}
function repRow(listId, label, fields, data = {}, doc) {
  const list = $(listId), row = document.createElement('div'); row.className = 'rep'; row.dataset.id = data.id || '';
  const head = document.createElement('div'), t = document.createElement('span'), rm = document.createElement('button');
  head.className = 'rep-head'; rm.type = 'button'; rm.className = 'icon-btn danger'; rm.title = 'حذف هذا الصف'; rm.setAttribute('aria-label', 'حذف هذا الصف'); rm.innerHTML = icon('trash');
  rm.onclick = () => { row.remove(); renumber(list, label); }; head.append(t, rm);
  const grid = document.createElement('div'); grid.className = 'form-grid';
  fields.forEach(f => {
    const fw = document.createElement('div'), lb = document.createElement('label'); fw.className = 'field' + (f.span ? ' span2' : ''); lb.textContent = f.label;
    let ctl;
    if (f.options) { ctl = document.createElement('select'); ctl.add(new Option('-- اختر --', '')); f.options.forEach(o => ctl.add(new Option(o))); }
    else { ctl = document.createElement('input'); ctl.type = f.type || 'text'; if (f.min != null) ctl.min = f.min; if (f.max != null) ctl.max = f.max; if (f.step) ctl.step = f.step; }
    ctl.dataset.k = f.k; ctl.value = data[f.k] ?? ''; ctl.id = `${listId}-${++repSeq}-${f.k}`; lb.htmlFor = ctl.id;
    fw.append(lb, ctl); grid.appendChild(fw);
  });
  if (fields.withFile) {
    const fw = document.createElement('div'), lb = document.createElement('label'), fi = document.createElement('input');
    fw.className = 'field span2'; lb.textContent = 'رابط تحميل المؤهل: ارفع الملف (PDF أو صورة، حتى 2 ميغابايت)';
    fi.type = 'file'; fi.dataset.k = 'file'; fi.accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'; fi.id = `${listId}-${++repSeq}-file`; lb.htmlFor = fi.id;
    fw.append(lb, fi); if (doc) fw.appendChild(currentFile(doc, 'removeDoc')); grid.appendChild(fw);
  }
  row.append(head, grid); list.appendChild(row); renumber(list, label); return row;
}
function renumber(list, label) { [...list.children].forEach((r, i) => { r.querySelector('.rep-head span').textContent = `${label} ${i + 1}`; }); }
const QUAL = Object.assign([
  { k: 'degree', label: 'المؤهل العلمي *', options: DEGREES }, { k: 'major', label: 'التخصص *' }, { k: 'university', label: 'الجامعة *' },
  { k: 'gradYear', label: 'سنة التخرج *', type: 'number', min: 1950, max: new Date().getFullYear() + 1 }, { k: 'gpa', label: 'المعدل *', type: 'number', min: 0, max: 100, step: '0.01' }], { withFile: true });
const COURSE = [{ k: 'name', label: 'اسم الدورة *' }, { k: 'hours', label: 'عدد الساعات *', type: 'number', min: 1, step: '0.5' }, { k: 'from', label: 'من *', type: 'date' }, { k: 'to', label: 'إلى *', type: 'date' }, { k: 'organizer', label: 'الجهة المنظمة *' }];
const EXPER = [{ k: 'employer', label: 'اسم الجهة *' }, { k: 'jobTitle', label: 'المسمى الوظيفي *' }, { k: 'from', label: 'من *', type: 'date' }, { k: 'to', label: 'إلى (فارغ = حتى الآن)', type: 'date' }];
const addQualRow = (q, doc) => repRow('qualList', 'المؤهل', QUAL, q, doc);
const addCourseRow = c => repRow('courseList', 'الدورة', COURSE, c);
const addExpRow = x => repRow('expList', 'الخبرة', EXPER, x);

// تعبئة الأقسام الفرعية والمرفقات من ملف الموظف عند التعديل
function fillExtras(emp) {
  ['qualList', 'courseList', 'expList'].forEach(id => { $(id).replaceChildren(); });
  $('qualList').dataset.empty = 'لا توجد مؤهلات مضافة'; $('courseList').dataset.empty = 'لا توجد دورات مضافة'; $('expList').dataset.empty = 'لا توجد خبرات مضافة';
  $('e_idFile').value = ''; $('e_idCur').replaceChildren(); $('e_idCur').classList.add('hidden');
  if (!emp) return;
  const d = Store.employeeDetails(emp.id), docOf = id => d.docs.find(x => x.kind === 'qualification' && x.refId === id);
  d.qualifications.forEach(q => addQualRow(q, docOf(q.id)));
  d.courses.forEach(addCourseRow); d.experiences.forEach(addExpRow);
  const idDoc = d.docs.find(x => x.kind === 'id');
  if (idDoc) { $('e_idCur').appendChild(currentFile(idDoc, 'idRemove')); $('e_idCur').classList.remove('hidden'); }
}
async function readFile(inp) {
  const f = inp?.files?.[0]; if (!f) return null;
  const ext = f.name.split('.').pop().toLowerCase(), guess = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || '';
  return { name: f.name, mime: f.type || guess, data: new Uint8Array(await f.arrayBuffer()) };
}
async function collectRows(listId, keys) {
  const out = [];
  for (const row of $(listId).children) {
    const o = { id: row.dataset.id || undefined };
    keys.forEach(k => { o[k] = row.querySelector(`[data-k="${k}"]`).value; });
    const fi = row.querySelector('[data-k="file"]');
    if (fi) { o.file = await readFile(fi); o.removeDoc = !!row.querySelector('[data-k="removeDoc"]')?.checked; }
    out.push(o);
  }
  return out;
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
// عند اختيار إنشاء الحساب تلقائياً يُعطَّل اختيار حساب موجود
function syncCreateAccount() {
  const on = $('e_createAccount').checked && !$('e_createWrap').classList.contains('hidden');
  if (on) $('e_userId').value = '';
  $('e_userId').disabled = on;
}
async function employeeFromForm() {
  const e = { id: $('empForm').dataset.id || undefined };
  document.querySelectorAll('#empForm [data-f]').forEach(el => { e[el.dataset.f] = el.value; });
  e.createAccount = $('e_createAccount').checked && !$('e_createWrap').classList.contains('hidden');
  e.qualifications = await collectRows('qualList', ['degree', 'major', 'university', 'gradYear', 'gpa']);
  e.courses = await collectRows('courseList', ['name', 'hours', 'from', 'to', 'organizer']);
  e.experiences = await collectRows('expList', ['employer', 'jobTitle', 'from', 'to']);
  e.idDoc = { file: await readFile($('e_idFile')), remove: !!$('e_idCur').querySelector('[data-k="idRemove"]')?.checked };
  return e;
}

// ---------- العقود (موارد بشرية) ----------
const CT_STATUS = { active: ['ساري', ''], expiring: ['ينتهي قريباً', 'late'], upcoming: ['لم يبدأ', 'open'], expired: ['منتهي', 'bad'], cancelled: ['ملغى', 'off'] };
const money = n => Number(n).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
const PAY_LABEL = { monthly: 'شهري', daily: 'يومي', volunteer: 'متطوع' };
const KIND = { monthly: { tab: 'عقود موظفين', one: 'عقد موظف', who: 'الموظف' }, daily: { tab: 'عقود يومي', one: 'عقد يومي', who: 'العامل' }, volunteer: { tab: 'عقود متطوعين', one: 'عقد متطوع', who: 'المتطوع' } };
let ctTab = 'monthly', ctTodayOnly = false;
let ctCache = [], ctEmps = {}, ctGrades = {};
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return Store.dateKey(d); };
// عقد اليوم: فعّال وتاريخ اليوم داخل مدته
const validToday = c => { const t = Store.dateKey(new Date()); return c.status === 'active' && c.startDate <= t && (!c.endDate || c.endDate >= t); };
const printContract = id => window.open(`print.html?id=${encodeURIComponent(id)}&print=1`, '_blank');

function filteredContracts() {
  const q = $('cSearch').value.trim().toLowerCase(), st = $('cStatus').value;
  return ctCache.filter(c => c.payBasis === ctTab && (!st || Store.contractStatus(c) === st) && (!ctTodayOnly || validToday(c)) &&
    (!q || `${c.contractNo} ${ctEmps[c.employeeId]?.name || ''} ${c.projectName} ${c.projectCode}`.toLowerCase().includes(q)));
}
const CT_HEAD = {
  monthly: ['رقم العقد', 'الموظف', 'المنصب والقسم', 'الدرجة', 'الفترة', 'الراتب الإجمالي', 'الحالة'],
  daily: ['رقم العقد', 'العامل', 'المشروع', 'المشرف', 'الفترة', 'الأجر اليومي', 'الحالة'],
  volunteer: ['رقم العقد', 'المتطوع', 'المشروع', 'المشرف', 'الفترة', 'الحالة'],
};
// الفترة: «من ... إلى ...» مع تاريخين بعرض ثابت من اليسار لليمين (يمنع انعكاس الترتيب في النص العربي)
function periodCell(tr, start, end) {
  const td = document.createElement('td'), d = t => { const sp = document.createElement('span'); sp.className = 'num'; sp.textContent = t; return sp; };
  td.append('من ', d(start), ' إلى ', end ? d(end) : 'غير محدد'); tr.appendChild(td); return td;
}
function subCell(tr, main, sub, cls) {
  const td = cell(tr, main, cls);
  if (sub) { const sp = document.createElement('span'); sp.className = 'cell-sub'; sp.textContent = sub; td.appendChild(sp); }
  return td;
}
function renderContracts() {
  hideAlert('contractsMsg');
  ctCache = Store.contracts();
  const emps = Store.employees(), grades = Object.fromEntries(Store.grades().map(g => [g.id, g]));
  ctEmps = Object.fromEntries(emps.map(e => [e.id, e]));
  ctGrades = Object.fromEntries(emps.map(e => [e.id, Store.gradeRange(e.id)]));
  // تبويبات الأنواع مع العدّادات
  const by = k => ctCache.filter(c => c.payBasis === k);
  $('cnMonthly').textContent = by('monthly').length; $('cnDaily').textContent = by('daily').length; $('cnVolunteer').textContent = by('volunteer').length;
  document.querySelectorAll('[data-ct]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ct === ctTab)));
  $('addContractLbl').textContent = 'إضافة ' + KIND[ctTab].one;
  // بطاقات الإحصاء للتبويب الحالي
  const mine = by(ctTab), count = k => mine.filter(c => Store.contractStatus(c) === k).length;
  $('cTotalLbl').textContent = 'إجمالي ' + KIND[ctTab].tab; $('cTotal').textContent = mine.length;
  $('cToday').textContent = mine.filter(validToday).length;
  $('cExpiring').textContent = count('expiring'); $('cExpired').textContent = count('expired');
  $('cTodayOnly').setAttribute('aria-pressed', String(ctTodayOnly));
  // رأس الجدول بحسب النوع
  const tr0 = document.createElement('tr');
  [...CT_HEAD[ctTab], ''].forEach((h, i, a) => { const th = document.createElement('th'); th.textContent = h; if (i === a.length - 1) th.className = 'no-print'; tr0.appendChild(th); });
  $('contractsHead').replaceChildren(tr0);
  fillRows($('contractsBody'), filteredContracts(), (tr, c) => {
    const e = ctEmps[c.employeeId], st = Store.contractStatus(c);
    numCell(tr, c.contractNo);
    if (ctTab === 'monthly') {
      subCell(tr, e?.name || '؟', e?.empNo, null); subCell(tr, c.jobTitle || e?.jobTitle || '—', e?.department);
      const g = grades[c.gradeId]; cell(tr, g ? `${g.code}${c.gradeStep ? ' / خطوة ' + c.gradeStep : ''}` : '—');
      periodCell(tr, c.startDate, c.endDate);
      const tdAmt = cell(tr, `${money(c.basicSalary + c.allowances)} ${c.currency} / شهر`), rg = ctGrades[c.employeeId];
      if (rg && (c.basicSalary < rg.min || c.basicSalary > rg.max)) { const w = document.createElement('span'); w.className = 'cell-sub'; w.style.color = 'var(--warning-ink)'; w.textContent = 'خارج نطاق الدرجة'; tdAmt.appendChild(w); }
    } else {
      subCell(tr, e?.name || '؟', e?.empNo); subCell(tr, c.projectName || '—', c.projectCode); cell(tr, ctEmps[c.supervisorId]?.name || '—'); periodCell(tr, c.startDate, c.endDate);
      if (ctTab === 'daily') cell(tr, `${money(c.basicSalary + c.allowances)} ${c.currency} / يوم`);
    }
    badgeCell(tr, CT_STATUS[st][0], CT_STATUS[st][1]);
    actionsCell(tr,
      iconBtn('printer', 'طباعة العقد (PDF)', () => printContract(c.id)),
      iconBtn('pencil', 'تعديل العقد', () => openContractDialog(c)),
      iconBtn('plus', 'تجديد العقد', () => openContractDialog(null, c)),
      iconBtn('trash', 'حذف العقد', async () => {
        hideAlert('contractsMsg');
        if (!confirm(`حذف العقد ${c.contractNo} نهائياً؟ لإيقافه مع بقاء السجل غيّر حالته إلى «ملغى».`)) return;
        try { await Store.deleteContract(c.id); renderContracts(); } catch (err) { showAlert('contractsMsg', err.message); }
      }, true));
  }, mine.length ? (ctTodayOnly ? 'لا توجد عقود سارية اليوم ضمن هذا النوع' : 'لا توجد عقود مطابقة') : `لا توجد ${KIND[ctTab].tab} بعد. أضف أول ${KIND[ctTab].one}`, CT_HEAD[ctTab].length + 1);
}

// ----- نموذج العقد -----
let cEmpMap = {};
const cLabel = e => `${e.name} — ${e.empNo}`;
function setContractPerson(kind, id) { // kind: employee | supervisor
  const e = ctEmps[id], [search, hidden] = kind === 'employee' ? ['c_employeeSearch', 'c_employeeId'] : ['c_supervisorSearch', 'c_supervisorId'];
  $(hidden).value = e ? id : ''; $(search).value = e ? cLabel(e) : '';
}
function syncContractPerson(kind) {
  const [search, hidden] = kind === 'employee' ? ['c_employeeSearch', 'c_employeeId'] : ['c_supervisorSearch', 'c_supervisorId'], v = $(search).value.trim();
  $(hidden).value = v ? (cEmpMap[v] || '') : '';
}
const gLabel = g => [g.scaleType, g.scaleYear, g.edition && 'إصدار ' + g.edition, g.level && 'مستوى ' + g.level, 'درجة ' + g.name].filter(Boolean).join(' · ');
function fillGradeSteps(keep) {
  const g = Store.grades().find(x => x.id === $('c_gradeId').value), sel = $('c_gradeStep');
  sel.replaceChildren(...(g ? g.steps.map((v, i) => new Option(`${i + 1} — ${money(v)}`, i + 1)) : []));
  if (g) sel.value = keep && keep <= g.steps.length ? keep : 1;
}
// العقد الشهري: الراتب يُجلب مباشرة من خطوة الدرجة المختارة
function updateGradeSuggest() {
  const g = Store.grades().find(x => x.id === $('c_gradeId').value), box = $('cGradeSug');
  box.className = 'hint-line'; box.textContent = '';
  const linked = !!g && $('c_payBasis').value === 'monthly';
  $('c_gradeStep').disabled = !g; $('c_basicSalary').readOnly = linked; $('c_currency').disabled = linked && !!g.currency;
  if (!g) return;
  const step = Number($('c_gradeStep').value) || 1;
  $('c_basicSalary').value = g.steps[step - 1];
  if (g.currency) $('c_currency').value = g.currency;
  box.textContent = `الراتب الأساسي من سلم الرواتب: ${money(g.steps[step - 1])} (الخطوة ${step} من ${g.steps.length}) — نطاق الدرجة ${money(g.min)} إلى ${money(g.max)}`;
  box.classList.add('good'); updateContractSum();
}
function updateContractSum() {
  const basis = $('c_payBasis').value, vol = basis === 'volunteer', cur = $('c_currency').selectedOptions[0]?.textContent || '';
  $('c_basicLabel').textContent = basis === 'daily' ? 'الأجر اليومي *' : 'الراتب الشهري الأساسي *';
  $('c_basicSalary').disabled = $('c_allowances').disabled = vol;
  if (vol) $('c_basicSalary').value = $('c_allowances').value = '';
  const t = (Number($('c_basicSalary').value) || 0) + (Number($('c_allowances').value) || 0);
  $('cSum').textContent = vol ? 'عقد تطوعي: بلا أجر' : t ? (basis === 'daily' ? `الأجر اليومي الإجمالي: ${money(t)} ${cur}` : `الراتب الإجمالي: ${money(t)} ${cur} شهرياً`) : '';
  // مقارنة الراتب الشهري بنطاق درجة الموظف (تحذير غير مانع)
  const box = $('cGrade'); box.className = 'hint-line'; box.textContent = '';
  const g = basis === 'monthly' && $('c_employeeId').value ? Store.gradeRange($('c_employeeId').value) : null;
  if (g) {
    box.textContent = `درجة مسمى الموظف: ${g.name} (${g.code}) — نطاق الراتب الأساسي ${money(g.min)} إلى ${money(g.max)}`;
    const b = $('c_basicSalary').value === '' ? null : Number($('c_basicSalary').value);
    if (b !== null && (b < g.min || b > g.max)) { box.textContent += ' — الراتب خارج النطاق'; box.classList.add('warn'); } else if (b !== null) box.classList.add('good');
  }
}
function showContractEmployee() { // معلومات المنصب والقسم من ملف الموظف + درجة مقترحة
  const e = ctEmps[$('c_employeeId').value];
  $('c_empInfo').textContent = e ? [e.jobTitle || 'بلا مسمى', e.department || 'بلا قسم'].join(' · ') : '—';
  if (e && !$('contractForm').dataset.id && $('c_payBasis').value === 'monthly' && !$('c_gradeId').value) { // درجة مسمى الموظف مقترحة
    const r = Store.gradeRange(e.id);
    if (r) { $('c_gradeId').value = r.id; fillGradeSteps(); updateGradeSuggest(); }
  }
}
// c: عقد للتعديل، renewFrom: عقد يُجدَّد، kind: نوع العقد الجديد
function openContractDialog(c, renewFrom, kind) {
  hideAlert('contractMsg'); $('contractForm').reset();
  const src = c || renewFrom; kind = src?.payBasis || kind || ctTab;
  const dlg = $('contractDialog'); dlg.classList.toggle('is-monthly', kind === 'monthly'); dlg.classList.toggle('is-worker', kind !== 'monthly');
  const emps = Object.values(ctEmps).filter(e => (e.status !== 'terminated' || e.id === src?.employeeId) && (me.role === 'admin' || e.userId !== me.id));
  cEmpMap = Object.fromEntries(emps.map(e => [cLabel(e), e.id]));
  $('cEmpList').replaceChildren(...emps.map(e => { const o = document.createElement('option'); o.value = cLabel(e); o.label = e.jobTitle || ''; return o; }));
  $('c_type').replaceChildren(...Store.contractTypes.map(t => new Option(t)));
  $('c_currency').replaceChildren(...Object.entries(Store.currencies).map(([k, v]) => new Option(v, k)));
  $('c_gradeId').replaceChildren(new Option('-- بدون --', ''), ...Store.grades().map(g => new Option(gLabel(g), g.id)));
  $('contractForm').dataset.id = c ? c.id : '';
  $('contractTitle').textContent = `${c ? 'تعديل' : renewFrom ? 'تجديد' : 'إضافة'} ${KIND[kind].one}${c ? ' ' + c.contractNo : ''}`;
  $('c_empLabel').textContent = `${KIND[kind].who} *`;
  $('c_contractNo').value = c ? c.contractNo : Store.nextContractNo();
  document.querySelectorAll('#contractForm [data-c]').forEach(el => { el.value = src ? (src[el.dataset.c] ?? '') : ''; });
  $('c_payBasis').value = kind;
  if (!src) { $('c_status').value = 'active'; $('c_issueDate').value = Store.dateKey(new Date()); $('c_type').value = kind === 'monthly' ? 'دائم' : 'محدد المدة'; $('c_currency').value = Store.settings.currency; }
  if (renewFrom) {
    $('c_status').value = 'active'; $('c_issueDate').value = Store.dateKey(new Date());
    const start = renewFrom.endDate ? addDays(renewFrom.endDate, 1) : Store.dateKey(new Date());
    $('c_startDate').value = start;
    $('c_endDate').value = renewFrom.endDate ? addDays(start, Math.round((new Date(renewFrom.endDate) - new Date(renewFrom.startDate)) / 86400000)) : '';
  }
  setContractPerson('employee', src?.employeeId); setContractPerson('supervisor', src?.supervisorId);
  fillGradeSteps(src?.gradeStep); showContractEmployee();
  updateContractSum(); updateGradeSuggest();
  dlg.showModal();
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
  const titles = countBy(Store.jobTitles(), 'gradeId'), ysel = $('gYear'), keep = ysel.value;
  ysel.replaceChildren(new Option('كل السنوات', ''), ...[...new Set(gradeCache.map(g => g.scaleYear).filter(Boolean))].sort((a, b) => b - a).map(y => new Option(y, y)));
  ysel.value = [...ysel.options].some(o => o.value === keep) ? keep : '';
  const q = $('gSearch').value.trim().toLowerCase();
  const rows = gradeCache.filter(g => (!ysel.value || String(g.scaleYear) === ysel.value) && (!q || [g.scaleType, g.edition, g.description, g.level, g.name, g.code].join(' ').toLowerCase().includes(q)));
  fillRows($('gradesBody'), rows, (tr, g) => {
    cell(tr, g.scaleType || '—'); numCell(tr, g.scaleYear || '—'); cell(tr, g.edition || '—'); cell(tr, g.description || '—'); cell(tr, g.level || '—');
    cell(tr, g.name); cell(tr, Store.currencies[g.currency] || g.currency || '—');
    numCell(tr, `${money(g.min)} – ${money(g.max)}`);
    const td = document.createElement('td'), wrap = document.createElement('div'); wrap.className = 'step-chips';
    g.steps.forEach((v, i) => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = `${i + 1}: ${money(v)}`; wrap.appendChild(c); });
    td.appendChild(wrap); tr.appendChild(td);
    numCell(tr, titles[g.id] || 0);
    actionsCell(tr,
      iconBtn('pencil', 'تعديل الدرجة', () => openGradeDialog(g)),
      iconBtn('trash', 'حذف الدرجة', async () => {
        hideAlert('gradesMsg');
        if (!confirm(`حذف الدرجة «${g.name}»؟`)) return;
        try { await Store.deleteGrade(g.id); renderGrades(); } catch (e) { showAlert('gradesMsg', e.message); }
      }, true));
  }, 'لا توجد درجات بعد', 11);
}
function renderStepInputs(vals) {
  const box = $('gSteps'); box.replaceChildren();
  vals.forEach((v, i) => {
    const f = document.createElement('div'), l = document.createElement('label'), inp = document.createElement('input');
    f.className = 'field'; l.textContent = `الخطوة ${i + 1}`; inp.type = 'number'; inp.min = '0'; inp.step = '0.01'; inp.dir = 'ltr'; inp.value = v; inp.dataset.step = i;
    l.htmlFor = inp.id = 'g_step' + i; f.append(l, inp); box.appendChild(f);
  });
}
function genStepInputs() {
  const lo = Number($('g_min').value), hi = Number($('g_max').value), n = Number($('g_stepCount').value);
  if ($('g_min').value === '' || $('g_max').value === '' || !(hi >= lo) || !Number.isInteger(n) || n < 1 || n > 20) { showAlert('gradeMsg', 'أدخل الحد الأدنى والأقصى وعدد خطوات صحيحاً (1–20) لتوليد الخطوات'); return; }
  hideAlert('gradeMsg');
  renderStepInputs(Array.from({ length: n }, (_, i) => n === 1 ? lo : Math.round((lo + i * (hi - lo) / (n - 1)) * 100) / 100));
}
function openGradeDialog(g) {
  hideAlert('gradeMsg'); $('gradeForm').reset();
  $('gradeForm').dataset.id = g ? g.id : '';
  $('gradeDlgTitle').textContent = g ? `تعديل الدرجة ${g.name}` : 'إضافة درجة';
  $('g_code').placeholder = Store.nextGradeCode();
  $('g_currency').replaceChildren(...Object.entries(Store.currencies).map(([k, v]) => new Option(v, k)));
  document.querySelectorAll('#gradeForm [data-g]').forEach(el => { el.value = g ? String(g[el.dataset.g] ?? '') : ''; });
  if (!g) { $('g_currency').value = Store.settings.currency; $('g_scaleYear').value = new Date().getFullYear(); }
  $('g_min').value = g ? g.min : ''; $('g_max').value = g ? g.max : ''; $('g_stepCount').value = g ? g.steps.length : 8;
  renderStepInputs(g ? g.steps : []);
  $('gradeDialog').showModal(); $('g_scaleType').focus();
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
    { const td = document.createElement('td'); if (hasLoc(r, 'in') || hasLoc(r, 'out')) { const b = iconBtn('map-pin', 'عرض الموقع على الخريطة', () => showMap([r], `${names[r.userId] || ''} — ${r.date}`)); td.appendChild(b); } else td.textContent = '—'; tr.appendChild(td); }
    actionsCell(tr,
      iconBtn('pencil', 'تعديل السجل', () => openRecDialog(r)),
      iconBtn('trash', 'حذف السجل', async () => {
        if (!confirm(`حذف سجل ${names[r.userId] || ''} بتاريخ ${r.date}؟`)) return;
        await Store.deleteRecord(r.id); refresh();
      }, true));
  }, 'لم يسجّل أي موظف حضوراً في هذا اليوم', 7);
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
    if (u.mustChange) { const b = document.createElement('span'); b.className = 'badge late'; b.style.marginInlineStart = '6px'; b.textContent = 'كلمة مرور مؤقتة'; tr.lastChild.appendChild(b); }
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
  $('pwHint').textContent = self ? '' : 'سيُطلب من المستخدم تغيير كلمة المرور هذه عند أول دخول.';
  $('pwDialog').showModal();
}

// ---------- الإعدادات (مدير) ----------
// ---------- بيانات تجريبية ----------
function renderDemo() {
  const st = Store.demoStatus();
  $('demoStatus').textContent = st.loaded ? `البيانات التجريبية محمّلة: ${st.counts.employees} موظفاً، ${st.counts.contracts} عقداً، ${st.counts.accounts} حساباً، ${st.counts.records} سجل حضور.` : 'لم تُحمَّل بيانات تجريبية بعد.';
  $('loadDemo').disabled = st.loaded; $('removeDemo').disabled = !st.loaded;
  $('demoAccountsWrap').classList.toggle('hidden', !st.loaded);
  const rows = st.loaded ? [{ username: 'ahmed', name: 'أحمد محمد سالم', note: 'موظف (محاسب) — حساب النظام الأصلي', pw: '123456' }, ...st.accounts.filter(a => a.username !== 'ahmed').map(a => ({ username: a.username, name: a.name, note: a.canHr ? 'مسؤول موارد بشرية + تعديل الحضور' : 'موظف', pw: 'demo1234' }))] : [];
  fillRows($('demoAccounts'), rows, (tr, a) => { numCell(tr, a.username); numCell(tr, a.pw); cell(tr, a.name); cell(tr, a.note); }, '', 4);
}
function renderSync() {
  const st = Store.sync.state, url = Store.sync.url;
  if (document.activeElement !== $('syncUrl')) $('syncUrl').value = url;
  const when = st.lastSync ? new Date(st.lastSync).toLocaleString('ar-EG') : '—';
  $('syncStatus').textContent = !url ? 'غير مفعّلة: لا يوجد عنوان خادم. النظام يعمل محلياً على هذا الجهاز فقط.'
    : !st.linked ? 'عنوان الخادم مضبوط لكن هذا الجهاز غير مرتبط به بعد.'
    : `مرتبط بالخادم — آخر مزامنة: ${when} — تعديلات بانتظار الإرسال: ${st.pending}${st.error ? ' — ' + st.error : ''}`;
  $('syncBoot').disabled = !url || !!st.linked || me.role !== 'admin'; $('syncNow').disabled = !st.linked; $('syncReplace').disabled = !url;
  if (url) Store.sync.health().then(h => { $('syncStatus').textContent += ` — حالة الخادم: ${h.initialized ? 'مهيّأ وفيه بيانات' : 'فارغ (لم تُرفع بيانات بعد)'}`; }).catch(e => { $('syncStatus').textContent += ' — تعذّر الاتصال بالخادم: ' + e.message; });
  updateSyncBanner();
}
// شريط تنبيه أعلى الصفحة عندما يكون الخادم مضبوطاً ولم يُربط هذا الجهاز به
async function updateSyncBanner() {
  let bar = $('syncBanner');
  if (!bar) { bar = document.createElement('div'); bar.id = 'syncBanner'; bar.className = 'sync-banner hidden'; document.querySelector('main').prepend(bar); }
  const st = Store.sync.state;
  if (!Store.sync.url || st.linked) { bar.classList.add('hidden'); return; }
  let msg = '', goto = false;
  try {
    const h = await Store.sync.health();
    if (!h.initialized) msg = me.role === 'admin' ? 'الخادم المركزي فارغ: هذا الجهاز غير مرتبط به، فلا تظهر بياناتك على الأجهزة الأخرى. ارفع بيانات هذا الجهاز من «الإعدادات ← الخادم المركزي».' : 'الخادم المركزي لم يُهيَّأ بعد. اطلب من المدير رفع البيانات من الإعدادات.';
    else msg = 'الخادم المركزي يحتوي بيانات، لكن هذا الجهاز غير مرتبط به فتُعرض بيانات محلية فقط. ' + (me.role === 'admin' ? 'من «الإعدادات ← الخادم المركزي» اختر «استبدال بيانات الجهاز بنسخة الخادم».' : 'اخرج ثم سجّل الدخول من جديد.');
    goto = me.role === 'admin';
  } catch (e) { msg = 'تعذّر الاتصال بالخادم المركزي: ' + e.message; }
  bar.replaceChildren(); const sp = document.createElement('span'); sp.textContent = msg; bar.appendChild(sp);
  if (goto) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = 'فتح الإعدادات'; b.onclick = () => showTab('settings'); bar.appendChild(b); }
  bar.classList.remove('hidden');
}
let linkMode = '';
function openLinkDialog(mode) {
  linkMode = mode; hideAlert('linkMsg'); $('linkForm').reset();
  $('linkTitle').textContent = mode === 'boot' ? 'رفع بيانات هذا الجهاز إلى الخادم' : 'استبدال بيانات هذا الجهاز بنسخة الخادم';
  $('linkNote').textContent = mode === 'boot' ? 'يعمل مرة واحدة على خادم فارغ، وبعدها تصبح بيانات الخادم هي المرجع لكل الأجهزة.' : 'تُحذف بيانات هذا الجهاز المحلية وتُستبدل ببيانات الخادم. سجّل الدخول بحساب موجود على الخادم.';
  document.querySelectorAll('.lk-key').forEach(e => e.classList.toggle('hidden', mode !== 'boot'));
  document.querySelectorAll('.lk-acct').forEach(e => e.classList.toggle('hidden', mode === 'boot'));
  $('linkDialog').showModal();
}
function renderSettings() {
  renderSync();
  renderDemo();
  const s = Store.settings, off = s.weekend.split(',');
  $('setStart').value = s.workStart; $('setEnd').value = s.workEnd; $('setGrace').value = s.graceMin; $('setAnnual').value = s.annualLeave; $('setExitHrs').value = s.exitMonthlyHours;
  $('setOrg').value = s.orgName; $('setTerms').value = s.contractTerms;
  $('setCurrency').replaceChildren(...Object.entries(Store.currencies).map(([k, v]) => new Option(v, k))); $('setCurrency').value = s.currency;
  $('setWeekend').replaceChildren(...DAY_NAMES.map((name, i) => {
    const l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.value = i; c.checked = off.includes(String(i));
    l.append(c, name); return l;
  }));
}

// ---------- التنقل والقائمة الجانبية ----------
// ===== الإجازات ومهمات العمل والمغادرات الخاصة =====
const RQ = {
  leave: { one: 'إجازة', add: 'طلب إجازة', sub: 'نوع الإجازة', reason: 'السبب', amt: 'الأيام' },
  mission: { one: 'مهمة عمل', add: 'طلب مهمة عمل', sub: 'نوع المهمة', reason: 'غرض المهمة', amt: 'الأيام' },
  exit: { one: 'مغادرة خاصة', add: 'طلب مغادرة خاصة', sub: 'نوع المغادرة', reason: 'السبب', amt: 'الساعات' } };
const RQ_STATUS = { pending: ['بانتظار الاعتماد', 'late'], approved: ['معتمد', ''], rejected: ['مرفوض', 'bad'], cancelled: ['ملغى', 'off'] };
let rqTab = 'leave', rqCache = [], rqNames = {};
function renderRequests() {
  hideAlert('requestsMsg');
  const hr = Store.canHr(me);
  rqNames = hr ? Object.fromEntries(Store.employees().map(e => [e.id, e.name])) : {};
  rqCache = Store.requests();
  const by = k => rqCache.filter(r => r.kind === k);
  $('rnLeave').textContent = by('leave').length; $('rnMission').textContent = by('mission').length; $('rnExit').textContent = by('exit').length;
  document.querySelectorAll('[data-rq]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.rq === rqTab)));
  $('addRequestLbl').textContent = RQ[rqTab].add;
  const mine = by(rqTab), count = st => mine.filter(r => r.status === st).length;
  $('rPending').textContent = count('pending'); $('rApproved').textContent = count('approved'); $('rRejected').textContent = count('rejected');
  const own = Store.employeeOfUser(me.id);
  $('rBalCard').classList.toggle('hidden', !(rqTab === 'leave' && own));
  if (rqTab === 'leave' && own) { const b = Store.leaveBalance(own.id); $('rBalance').textContent = b.remaining; $('rBalLbl').textContent = `رصيدي المتبقي من ${b.total} يوماً (إجازة سنوية)`; }
  const q = $('rSearch').value.trim().toLowerCase(), st = $('rStatus').value;
  const rows = mine.filter(r => (!st || r.status === st) && (!q || `${rqNames[r.employeeId] || ''} ${r.reqNo} ${r.reason} ${r.destination}`.toLowerCase().includes(q)));
  const heads = [hr && 'الموظف', 'رقم الطلب', 'النوع', rqTab === 'exit' ? 'التاريخ والوقت' : 'الفترة', RQ[rqTab].amt, rqTab === 'mission' ? 'الوجهة والغرض' : 'السبب', 'الحالة'].filter(Boolean);
  const thead = $('requestsHead'); thead.replaceChildren(); const tr0 = document.createElement('tr');
  [...heads, ''].forEach((h, i, a) => { const th = document.createElement('th'); th.textContent = h; if (i === a.length - 1) th.className = 'no-print'; tr0.appendChild(th); }); thead.appendChild(tr0);
  fillRows($('requestsBody'), rows, (tr, r) => {
    if (hr) cell(tr, rqNames[r.employeeId] || '—');
    numCell(tr, r.reqNo); cell(tr, r.subType);
    if (r.kind === 'exit') { const td = cell(tr, ''); const d = document.createElement('span'); d.className = 'num'; d.textContent = `${r.startDate}  ${r.startTime} – ${r.endTime}`; td.appendChild(d); }
    else periodCell(tr, r.startDate, r.endDate);
    numCell(tr, r.amount);
    subCell(tr, r.kind === 'mission' ? r.destination : r.reason, r.kind === 'mission' ? r.reason : '');
    const td = document.createElement('td'), b = document.createElement('span'); b.className = 'badge ' + RQ_STATUS[r.status][1]; b.textContent = RQ_STATUS[r.status][0]; td.appendChild(b);
    if (r.decisionNote) { const sp = document.createElement('span'); sp.className = 'cell-sub'; sp.textContent = r.decisionNote; td.appendChild(sp); }
    tr.appendChild(td);
    const btns = [], own = Store.employeeOfUser(me.id)?.id === r.employeeId;
    if (r.status === 'pending' && hr && (me.role === 'admin' || !own)) {
      btns.push(iconBtn('check', 'اعتماد الطلب', async () => { hideAlert('requestsMsg'); try { await Store.decideRequest(r.id, true); renderRequests(); } catch (e) { showAlert('requestsMsg', e.message); } }),
        iconBtn('ban', 'رفض الطلب', () => { $('rejectForm').dataset.id = r.id; $('rejectNote').value = ''; hideAlert('rejectMsg'); $('rejectDialog').showModal(); $('rejectNote').focus(); }, true));
    }
    if (r.status === 'pending' ? (own || hr) : (r.status === 'approved' && hr && (me.role === 'admin' || !own))) {
      btns.push(iconBtn('x', 'إلغاء الطلب', async () => {
        hideAlert('requestsMsg'); if (!confirm(`إلغاء الطلب ${r.reqNo}؟`)) return;
        try { await Store.cancelRequest(r.id); renderRequests(); } catch (e) { showAlert('requestsMsg', e.message); }
      }, true));
    }
    actionsCell(tr, ...btns);
  }, `لا توجد طلبات ${RQ[rqTab].one === 'إجازة' ? 'إجازات' : RQ[rqTab].one === 'مهمة عمل' ? 'مهمات' : 'مغادرات'} بعد`, heads.length + 1);
}
function updateRequestHint() {
  const box = $('rHint'); box.className = 'hint-line'; box.textContent = '';
  const s = $('r_startDate').value, e = $('r_endDate').value || s;
  if (rqTab === 'exit') {
    const a = $('r_startTime').value, b = $('r_endTime').value;
    if (a && b && b > a) { const h = ((Number(b.slice(0, 2)) * 60 + Number(b.slice(3))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3)))) / 60; box.textContent = `مدة المغادرة: ${Math.round(h * 100) / 100} ساعة`; if (h > 4) box.classList.add('warn'); }
    return;
  }
  if (!s || !e || e < s) return;
  box.textContent = `عدد أيام العمل: ${Store.workDaysBetween(s, e)} (لا تُحتسب عطلة نهاية الأسبوع)`;
  const empId = $('r_employeeId').value || Store.employeeOfUser(me.id)?.id;
  if (rqTab === 'leave' && $('r_subType').value === 'سنوية' && empId) { try { const bl = Store.leaveBalance(empId, Number(s.slice(0, 4))); box.textContent += ` — رصيدك المتبقي ${bl.remaining} يوماً`; } catch {} }
}
function openRequestDialog() {
  hideAlert('requestMsg'); $('requestForm').reset();
  const dlg = $('requestDialog'), hr = Store.canHr(me);
  dlg.classList.remove('k-leave', 'k-mission', 'k-exit'); dlg.classList.add('k-' + rqTab);
  $('requestTitle').textContent = RQ[rqTab].add;
  $('r_subLbl').textContent = RQ[rqTab].sub + ' *'; $('r_reasonLbl').textContent = RQ[rqTab].reason + ' *';
  $('r_startLbl').textContent = rqTab === 'exit' ? 'التاريخ *' : 'من تاريخ *';
  $('r_subType').replaceChildren(...Store.requestTypes[rqTab].map(t => new Option(t)));
  dlg.querySelector('.rq-hr').classList.toggle('hidden', !hr);
  if (hr) {
    const own = Store.employeeOfUser(me.id)?.id;
    $('r_employeeId').replaceChildren(new Option(own ? 'أنا (ملفي)' : '-- اختر الموظف --', own || ''), ...Store.employees().filter(e => e.status !== 'terminated' && e.id !== own).map(e => new Option(`${e.empNo} — ${e.name}`, e.id)));
  }
  $('r_startDate').value = Store.dateKey(new Date());
  updateRequestHint(); dlg.showModal();
}
const RENDER = { contracts: renderContracts, hr: renderHr, titles: renderTitles, grades: renderGrades, org: renderOrg,
  me: () => { renderToday(); renderMyContract(); renderMine(); }, requests: renderRequests, daily: renderAdmin, report: renderReport, users: renderUsers, settings: renderSettings };
const HR_TABS = ['hr', 'contracts', 'titles', 'grades', 'org'];
const PAGES = { me: ['لوحتي', ''], requests: ['الإجازات والمغادرات', 'الطلبات'], hr: ['ملفات الموظفين', 'شؤون الموظفين'], contracts: ['العقود', 'شؤون الموظفين'], titles: ['المسميات الوظيفية', 'شؤون الموظفين'],
  grades: ['سلم الرواتب', 'شؤون الموظفين'], org: ['الهيكل التنظيمي', 'شؤون الموظفين'], daily: ['الحضور اليومي', 'الحضور والانصراف'],
  report: ['التقارير الشهرية', 'الحضور والانصراف'], users: ['حسابات المستخدمين', 'النظام'], settings: ['الإعدادات', 'النظام'] };
const canView = name => me.role === 'admin' || name === 'me' || name === 'requests' || (HR_TABS.includes(name) && Store.canHr(me)) || (name === 'daily' && Store.canEditAttendance(me));

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
window.addEventListener('store-sync', () => { try { updateSyncBanner(); if (currentTab() === 'settings') renderSync(); else if (!document.querySelector('dialog[open]')) refresh(); } catch (e) { console.error(e); } });

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

const IN_APP = /HRApp\//.test(navigator.userAgent);
// موقع الجهاز الحالي؛ داخل التطبيق يُشترط، وفي المتصفح يُسجَّل الحضور بدونه إن تعذّر
function getLocation() {
  return new Promise((resolve, reject) => {
    const fail = msg => IN_APP ? reject(new Error(msg)) : resolve(null);
    if (!navigator.geolocation) return fail('الجهاز لا يدعم تحديد الموقع');
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => fail(e.code === 1 ? 'لم يُسمح بالوصول إلى الموقع. فعّل إذن الموقع للتطبيق ثم أعد المحاولة' : 'تعذّر تحديد موقعك. تأكد من تشغيل GPS ثم أعد المحاولة'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}
async function act(fn) {
  hideAlert('msg');
  const b1 = $('btnIn'), b2 = $('btnOut'), d1 = b1.disabled, d2 = b2.disabled; b1.disabled = b2.disabled = true;
  try { await fn(me.id, await getLocation()); } catch (e) { showAlert('msg', e.message); b1.disabled = d1; b2.disabled = d2; }
  refresh();
}
// ===== خريطة مواقع التسجيل (Leaflet + OpenStreetMap) =====
let leafletReady = null, mapObj = null, mapLayer = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return leafletReady || (leafletReady = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'js/vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const sc = document.createElement('script'); sc.src = 'js/vendor/leaflet/leaflet.js'; sc.onload = res; sc.onerror = () => { leafletReady = null; rej(new Error('تعذّر تحميل الخريطة')); };
    document.head.appendChild(sc);
  }));
}
const hasLoc = (r, k) => r[k + 'Lat'] != null && r[k + 'Lng'] != null;
async function showMap(recs, title) {
  const pts = [];
  recs.forEach(r => { for (const k of ['in', 'out']) if (hasLoc(r, k)) pts.push({ k, r, lat: r[k + 'Lat'], lng: r[k + 'Lng'], acc: r[k + 'Acc'] }); });
  const names = userNames();
  try { await loadLeaflet(); } catch (e) { alert(e.message); return; }
  $('mapTitle').textContent = title; $('mapCount').textContent = `${pts.length} موقع`;
  $('mapDialog').showModal();
  if (!mapObj) {
    mapObj = L.map('mapBox', { zoomControl: true }).setView([31.5, 34.45], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© مساهمو OpenStreetMap' }).addTo(mapObj);
    mapLayer = L.layerGroup().addTo(mapObj);
  }
  mapLayer.clearLayers();
  const bounds = [];
  pts.forEach(p => {
    const color = p.k === 'in' ? '#16794B' : '#B42318', ll = [p.lat, p.lng]; bounds.push(ll);
    const t = p.k === 'in' ? p.r.checkIn : p.r.checkOut;
    const box = document.createElement('div'); box.style.direction = 'rtl';
    const b = document.createElement('b'); b.textContent = names[p.r.userId] || '؟';
    box.append(b, document.createElement('br'), `${p.k === 'in' ? 'حضور' : 'انصراف'} ${p.r.date} ${fmtTime(t)}`);
    if (p.acc != null) { box.append(document.createElement('br'), `الدقة ±${p.acc} م`); L.circle(ll, { radius: p.acc, color, weight: 1, fillOpacity: 0.08 }).addTo(mapLayer); }
    L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindPopup(box).addTo(mapLayer);
  });
  setTimeout(() => { mapObj.invalidateSize(); if (bounds.length) mapObj.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 }); }, 80);
}

// أول دخول بكلمة مرور مؤقتة: نافذة لا تُغلق حتى يغيّرها
function showFirstLogin() {
  $('app').setAttribute('inert', ''); $('app').style.visibility = 'hidden'; // لا شيء من النظام يظهر قبل تغيير كلمة المرور
  const dlg = $('firstDialog');
  dlg.addEventListener('cancel', e => e.preventDefault()); // لا يُسمح بتجاوزها بزر Esc
  $('firstLogout').onclick = () => { Store.logout(); location.replace('login.html'); };
  $('firstForm').onsubmit = async e => {
    e.preventDefault(); hideAlert('firstMsg');
    if ($('fpNew').value !== $('fpConfirm').value) return showAlert('firstMsg', 'تأكيد كلمة المرور غير مطابق');
    try { await Store.completeFirstLogin($('fpNew').value); location.reload(); }
    catch (err) { showAlert('firstMsg', err.message); }
  };
  dlg.showModal(); $('fpNew').focus();
}

function init() {
  me = Store.currentUser();
  if (!me) return location.replace('login.html');
  if (me.mustChange) return showFirstLogin();
  $('userName').textContent = me.name;
  const myEmp = Store.employeeOfUser(me.id);
  $('userRole').textContent = [myEmp?.jobTitle, myEmp?.department].filter(Boolean).join(' · ') || (me.role === 'admin' ? 'مدير' : 'موظف');
  $('avatar').textContent = [...me.name][0];
  $('logout').onclick = () => { Store.logout(); location.replace('login.html'); };
  $('btnPw').onclick = () => openPwDialog(me);
  updateSyncBanner();
  if (me.role === 'admin') {
    $('syncSaveUrl').onclick = () => { hideAlert('syncMsg'); try { Store.sync.setUrl($('syncUrl').value); renderSync(); } catch (e) { showAlert('syncMsg', e.message); } };
    $('syncBoot').onclick = () => openLinkDialog('boot'); $('syncReplace').onclick = () => openLinkDialog('replace');
    $('syncNow').onclick = async () => { hideAlert('syncMsg'); const r = await Store.sync.now(); if (r.error) showAlert('syncMsg', r.error); renderSync(); };
    $('linkCancel').onclick = () => $('linkDialog').close();
    $('linkForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('linkMsg'); $('linkGo').disabled = true;
      try {
        if (linkMode === 'boot') await Store.sync.bootstrap($('lk_key').value);
        else { if (!confirm('ستُحذف بيانات هذا الجهاز المحلية وتُستبدل بنسخة الخادم. متابعة؟')) { $('linkGo').disabled = false; return; } await Store.sync.replaceFromServer($('lk_user').value, $('lk_pass').value); location.replace('login.html'); return; }
        $('linkDialog').close(); renderSync();
      } catch (err) { showAlert('linkMsg', err.message); }
      $('linkGo').disabled = false;
    };
  }
  $('btnIn').onclick = () => act((id, loc) => Store.checkIn(id, loc));
  $('btnOut').onclick = () => act((id, loc) => Store.checkOut(id, loc));
  $('mapClose').onclick = () => $('mapDialog').close();
  $('mapAll').onclick = () => showMap(Store.recordsOn($('adminDate').value), 'مواقع تسجيل ' + $('adminDate').value);

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

  document.querySelectorAll('[data-rq]').forEach(b => b.addEventListener('click', () => { rqTab = b.dataset.rq; renderRequests(); }));
  ['rSearch', 'rStatus'].forEach(id => $(id).addEventListener('input', renderRequests));
  $('addRequest').onclick = openRequestDialog;
  $('requestCancel').onclick = () => $('requestDialog').close();
  ['r_startDate', 'r_endDate', 'r_startTime', 'r_endTime', 'r_subType', 'r_employeeId'].forEach(id => $(id).addEventListener('input', updateRequestHint));
  $('requestForm').onsubmit = async e => {
    e.preventDefault(); hideAlert('requestMsg');
    const r = { kind: rqTab }; document.querySelectorAll('#requestForm [data-r]').forEach(el => { r[el.dataset.r] = el.value; });
    try { await Store.saveRequest(r); $('requestDialog').close(); renderRequests(); } catch (err) { showAlert('requestMsg', err.message); }
  };
  $('rejectCancel').onclick = () => $('rejectDialog').close();
  $('rejectForm').onsubmit = async e => {
    e.preventDefault(); hideAlert('rejectMsg');
    try { await Store.decideRequest(e.target.dataset.id, false, $('rejectNote').value); $('rejectDialog').close(); renderRequests(); } catch (err) { showAlert('rejectMsg', err.message); }
  };
  if (Store.canHr(me)) {
    document.querySelectorAll('.hr-only').forEach(el => el.classList.remove('hidden'));

    // شؤون الموظفين
    $('addEmp').onclick = () => openEmpDialog(null);
    $('empCancel').onclick = () => $('empDialog').close();
    $('empForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('empMsg');
      try {
        syncManager();
        if ($('e_managerSearch').value.trim() && !$('e_managerId').value) throw new Error('اختر المدير المباشر من القائمة المقترحة');
        $('empSave').disabled = true;
        const res = await Store.saveEmployee(await employeeFromForm()); $('empDialog').close(); refresh();
        if (res.accountCreated && $('hrOk')) { $('hrOkText').textContent = `تم إنشاء حساب الدخول — اسم المستخدم: ${res.accountCreated} وكلمة المرور المؤقتة: رقم الهوية نفسه. سيُطلب من الموظف تغييرها عند أول دخول.`; $('hrOk').classList.add('show'); }
      }
      catch (err) { showAlert('empMsg', err.message); $('empDialog').scrollTo({ top: $('empDialog').scrollHeight }); }
      finally { $('empSave').disabled = false; }
    };
    ['hSearch', 'hStatus', 'hDept'].forEach(id => $(id).addEventListener('input', renderHr));
    $('exportEmp').onclick = () => downloadCsv(`employees-${Store.dateKey(new Date())}.csv`,
      [['رقم الموظف', 'الاسم', 'الاسم بالإنجليزية', 'الهوية', 'الجنس', 'تاريخ الميلاد', 'مكان الميلاد', 'الجنسية', 'الحالة الاجتماعية', 'الهاتف', 'البريد', 'العنوان', 'القسم', 'المسمى الوظيفي', 'نوع التوظيف', 'تاريخ التعيين', 'الحالة']]
        .concat(filteredEmployees().map(x => [x.empNo, x.name, x.nameEn, x.nationalId, x.gender, x.birthDate, x.birthPlace, x.nationality, x.marital, x.phone, x.email, x.address, x.department, x.jobTitle, x.empType, x.hireDate, EMP_STATUS[x.status][0]])));

    $('e_userId').onchange = updateEmpAtt;
    $('e_managerSearch').addEventListener('input', syncManager);
    $('addQual').onclick = () => addQualRow();
    $('addCourse').onclick = () => addCourseRow();
    $('addExp').onclick = () => addExpRow();
    $('e_createAccount').onchange = () => { syncCreateAccount(); updateEmpAtt(); };
    $('e_jobTitleId').onchange = updateGradeHint;
    $('e_salary').addEventListener('input', updateGradeHint);
    $('e_departmentId').onchange = () => { // اقتراح مدير القسم رئيساً إن لم يُحدَّد رئيس
      const d = Store.departments().find(x => x.id === $('e_departmentId').value), id = $('empForm').dataset.id;
      if (d?.managerId && d.managerId !== id && !$('e_managerId').value && Object.values(mgrMap).includes(d.managerId)) setManager(d.managerId);
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
    $('gGen').onclick = genStepInputs;
    ['gSearch', 'gYear'].forEach(id => $(id).addEventListener('input', renderGrades));
    $('gradeCancel').onclick = () => $('gradeDialog').close();
    $('gradeForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('gradeMsg');
      const g = { id: e.target.dataset.id || undefined }; document.querySelectorAll('#gradeForm [data-g]').forEach(el => { g[el.dataset.g] = el.value; });
      g.min = $('g_min').value; g.max = $('g_max').value; g.stepCount = $('g_stepCount').value;
      const inputs = [...document.querySelectorAll('#gSteps input')]; if (inputs.length) g.steps = inputs.map(i => i.value === '' ? NaN : i.value);
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
    $('addContract').onclick = () => openContractDialog(null, null, ctTab);
    $('contractCancel').onclick = () => $('contractDialog').close();
    ['c_basicSalary', 'c_allowances'].forEach(id => $(id).addEventListener('input', updateContractSum));
    $('c_currency').addEventListener('change', updateContractSum);
    $('c_employeeSearch').addEventListener('input', () => { syncContractPerson('employee'); showContractEmployee(); updateContractSum(); });
    $('c_supervisorSearch').addEventListener('input', () => syncContractPerson('supervisor'));
    $('c_gradeId').addEventListener('change', () => { fillGradeSteps(); updateGradeSuggest(); });
    $('c_gradeStep').addEventListener('change', updateGradeSuggest);
    $('contractForm').onsubmit = async e => {
      e.preventDefault(); hideAlert('contractMsg');
      const andPrint = e.submitter && e.submitter.id === 'contractSavePrint';
      try {
        syncContractPerson('employee'); syncContractPerson('supervisor');
        if ($('c_employeeSearch').value.trim() && !$('c_employeeId').value) throw new Error('اختر الموظف من القائمة المقترحة');
        if ($('c_supervisorSearch').value.trim() && !$('c_supervisorId').value) throw new Error('اختر المشرف من القائمة المقترحة');
        const res = await Store.saveContract(contractFromForm()); $('contractDialog').close(); renderContracts();
        if (andPrint) printContract(res.id);
      } catch (err) { showAlert('contractMsg', err.message); $('contractDialog').scrollTo({ top: $('contractDialog').scrollHeight }); }
    };
    document.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { ctTab = b.dataset.ct; renderContracts(); });
    $('cTodayOnly').onclick = () => { ctTodayOnly = !ctTodayOnly; renderContracts(); };
    ['cSearch', 'cStatus'].forEach(id => $(id).addEventListener('input', renderContracts));
    $('exportContracts').onclick = () => downloadCsv(`contracts-${ctTab}-${Store.dateKey(new Date())}.csv`,
      [['رقم العقد', 'الاسم', 'نوع العقد', 'مدة العقد', 'تاريخ التحرير', 'البداية', 'النهاية', 'الراتب/الأجر الأساسي', 'البدلات', 'العملة', 'المشروع', 'كود المشروع', 'المشرف', 'الحالة']]
        .concat(filteredContracts().map(c => [c.contractNo, ctEmps[c.employeeId]?.name || '', PAY_LABEL[c.payBasis], c.type, c.issueDate || '', c.startDate, c.endDate || '', c.basicSalary, c.allowances, c.currency, c.projectName, c.projectCode, ctEmps[c.supervisorId]?.name || '', CT_STATUS[Store.contractStatus(c)][0]])));
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
        await Store.saveSettings({ workStart: $('setStart').value, workEnd: $('setEnd').value, graceMin: $('setGrace').value, annualLeave: $('setAnnual').value, exitMonthlyHours: $('setExitHrs').value,
          orgName: $('setOrg').value, currency: $('setCurrency').value, contractTerms: $('setTerms').value,
          weekend: [...$('setWeekend').querySelectorAll('input:checked')].map(c => c.value).join(',') });
        $('setOk').classList.add('show');
      } catch (err) { showAlert('setMsg', err.message); }
    };

    // بيانات تجريبية
    $('loadDemo').onclick = async () => {
      hideAlert('demoMsg'); $('demoOk').classList.remove('show');
      if (!confirm('ستُضاف بيانات تجريبية (موظفون وعقود وحسابات وحضور). بياناتك الحالية لا تتأثر. متابعة؟')) return;
      $('loadDemo').disabled = true;
      try { const r = await Store.loadDemoData(); $('demoOkText').textContent = `تم تحميل ${r.employees} موظفاً و${r.contracts} عقداً و${r.accounts} حساباً و${r.records} سجل حضور.`; $('demoOk').classList.add('show'); }
      catch (e) { showAlert('demoMsg', e.message); }
      renderDemo();
    };
    $('removeDemo').onclick = async () => {
      hideAlert('demoMsg'); $('demoOk').classList.remove('show');
      if (!confirm('سيُحذف كل ما أُضيف كبيانات تجريبية فقط (بياناتك الحقيقية لا تُمس). متابعة؟')) return;
      try { await Store.removeDemoData(); $('demoOkText').textContent = 'تم حذف البيانات التجريبية.'; $('demoOk').classList.add('show'); }
      catch (e) { showAlert('demoMsg', e.message); }
      renderDemo();
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
