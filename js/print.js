// صفحة طباعة العقد: تعرض مستنداً رسمياً جاهزاً للطباعة أو الحفظ كملف PDF من نافذة الطباعة في المتصفح
const $ = id => document.getElementById(id);
const LOCALE = 'ar-EG-u-nu-latn';
const money = n => Number(n).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
const fmtDate = d => d ? d.split('-').reverse().join('/') : '';
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر'];
const PAY_TITLE = { monthly: 'عقد عمل (راتب شهري)', daily: 'عقد عمل يومي', volunteer: 'عقد تطوع' };

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function kv(rows) { // rows: [label, value, {num, en, full}]
  // يُملأ الجدول بلا خلايا فارغة: أي حقل نصفي يليه حقل كامل أو يكون أخيراً يتمدد على العرض كله
  const items = rows.filter(r => r && r[1] !== '' && r[1] != null).map(([label, value, o = {}]) => ({ label, value, o: { ...o } }));
  let half = null;
  items.forEach(it => { if (it.o.full) { if (half) { half.o.full = true; half = null; } } else if (half) half = null; else half = it; });
  if (half) half.o.full = true;
  const g = el('div', 'kv');
  let col = 0; // عمود الحقول النصفية: h1 (الأول وله فاصل) ثم h2
  items.forEach(({ label, value, o }) => {
    const cls = o.full ? 'full' : col === 0 ? 'h1' : 'h2'; col = o.full ? 0 : 1 - col;
    const d = el('div', cls), s = el('span', '', label), b = el('b'), v = el('span', o.num ? 'num' : o.en ? 'en' : '', String(value));
    v.style.minWidth = '0'; b.appendChild(v); d.append(s, b); g.appendChild(d);
  });
  return g;
}
function section(title, ...kids) { const f = document.createDocumentFragment(); f.appendChild(el('h2', '', title)); kids.forEach(k => f.appendChild(k)); return f; }

function render(d) {
  const c = d.contract, e = d.employee || {}, root = $('doc'), cur = d.currencyLabel, basis = c.payBasis;
  root.replaceChildren();
  document.title = `عقد ${c.contractNo} - ${e.name || ''}`;

  const head = el('div', 'head'), org = el('div', 'org', d.org); org.appendChild(el('small', '', 'نظام شؤون الموظفين'));
  const meta = el('div', 'meta'); meta.innerHTML = '<div>رقم العقد: <b class="num"></b></div><div>تاريخ التحرير: <b class="num"></b></div>';
  meta.querySelectorAll('b')[0].textContent = c.contractNo; meta.querySelectorAll('b')[1].textContent = fmtDate(c.issueDate || c.startDate);
  head.append(org, meta); root.appendChild(head);
  root.appendChild(el('div', 'title', PAY_TITLE[basis]));
  root.appendChild(el('div', 'subtitle', `${c.type}${c.status === 'cancelled' ? ' — ملغى' : ''}`));
  root.appendChild(el('p', 'para intro', `تم الاتفاق في تاريخ ${fmtDate(c.issueDate || c.startDate)} بين كل من:`));

  const parties = el('div', 'parties'), p1 = el('div', 'party'), p2 = el('div', 'party');
  p1.appendChild(el('h3', '', 'الطرف الأول (الجهة المتعاقدة)')); p1.appendChild(el('div', '', d.org));
  p2.appendChild(el('h3', '', basis === 'volunteer' ? 'الطرف الثاني (المتطوع)' : 'الطرف الثاني (الموظف)'));
  p2.appendChild(el('div', '', e.name || ''));
  if (e.nameEn) { const en = el('div', 'en', e.nameEn); p2.appendChild(en); }
  parties.append(p1, p2); root.appendChild(parties);

  root.appendChild(section('بيانات الطرف الثاني', kv([
    ['رقم الموظف', e.empNo, { num: true }], ['رقم الهوية', e.nationalId, { num: true }], ['الجنسية', e.nationality], ['تاريخ الميلاد', fmtDate(e.birthDate), { num: true }],
    ['مكان الميلاد', e.birthPlace], ['الهاتف', e.phone, { num: true }], ['العنوان', e.address, { full: true }]])));

  const dur = c.endDate ? `من ${fmtDate(c.startDate)} إلى ${fmtDate(c.endDate)}` : `ابتداءً من ${fmtDate(c.startDate)} (غير محدد المدة)`;
  const rows = [['نوع العقد', `${c.type} — ${PAY_TITLE[basis].replace('عقد ', '')}`], ['مدة العقد', dur, { full: true }]];
  if (basis === 'monthly') {
    rows.push(['المسمى الوظيفي', c.jobTitle || e.jobTitle], ['القسم', d.department]);
    if (d.grade) rows.push(['الدرجة في سلم الرواتب', `${d.grade.name} (${d.grade.code})${c.gradeStep ? ` — الخطوة ${c.gradeStep}` : ''}`, { full: true }]);
    rows.push(['ساعات الدوام', `من ${d.workStart} إلى ${d.workEnd}`, { full: true }]);
  } else {
    rows.push(['اسم المشروع', c.projectName, { full: true }]);
    if (c.projectNameEn) rows.push(['Project name', c.projectNameEn, { en: true, full: true }]);
    rows.push(['كود المشروع', c.projectCode, { num: true }], ['المشرف', d.supervisor?.name]);
  }
  root.appendChild(section('بيانات العقد', kv(rows)));

  if (basis !== 'monthly' && (c.workDesc || c.workDescEn)) {
    const w = []; if (c.workDesc) w.push(el('div', 'box', c.workDesc)); if (c.workDescEn) { const b = el('div', 'box en', c.workDescEn); b.style.display = 'block'; w.push(b); }
    root.appendChild(section('وصف العمل', ...w));
  }

  let comp;
  if (basis === 'volunteer') comp = 'هذا العقد تطوعي؛ لا يترتب عليه أي أجر أو راتب، ولا ينشئ علاقة وظيفية دائمة، ويلتزم المتطوع بتنفيذ المهام المبيّنة أعلاه.';
  else if (basis === 'daily') comp = `يتقاضى الطرف الثاني أجراً يومياً أساسياً قدره ${money(c.basicSalary)} ${cur}${c.allowances ? ` وبدلات يومية قدرها ${money(c.allowances)} ${cur}` : ''}، بإجمالي ${money(c.basicSalary + c.allowances)} ${cur} عن كل يوم عمل فعلي.`;
  else comp = `يتقاضى الطرف الثاني راتباً شهرياً أساسياً قدره ${money(c.basicSalary)} ${cur}${c.allowances ? ` وبدلات قدرها ${money(c.allowances)} ${cur}` : ''}، بإجمالي ${money(c.basicSalary + c.allowances)} ${cur} شهرياً، يُصرف وفق نظام الرواتب المعتمد لدى الطرف الأول.`;
  root.appendChild(section(basis === 'volunteer' ? 'الأجر' : 'الأجر والمزايا', el('p', 'para', comp)));
  if (c.inclusions) root.appendChild(section('شمول العقد', el('div', 'box', c.inclusions)));

  const terms = (d.terms || '').split('\n').map(t => t.trim()).filter(Boolean);
  if (terms.length) {
    const ol = el('ol', 'clauses'); terms.forEach((t, i) => { const li = el('li', '', t); li.dataset.ord = ORD[i] || String(i + 1); ol.appendChild(li); });
    root.appendChild(section('البنود العامة', ol));
  }

  const sign = el('div', 'sign');
  [['الطرف الأول', d.org], ['الطرف الثاني', e.name || '']].forEach(([who, name]) => { const s = el('div'); s.append(el('div', 'who', who), el('div', '', name), el('div', 'line'), el('small', '', 'التوقيع والتاريخ')); sign.appendChild(s); });
  root.appendChild(sign);
  const foot = el('div', 'foot'); foot.append(el('span', '', `عقد رقم ${c.contractNo}`), el('span', '', `طُبع بتاريخ ${fmtDate(new Date().toISOString().slice(0, 10))}`));
  root.appendChild(foot);
  root.hidden = false;
}

(async () => {
  const q = new URLSearchParams(location.search), id = q.get('id');
  $('btnPrint').onclick = () => window.print();
  $('btnClose').onclick = () => { window.close(); if (!window.closed) history.length > 1 ? history.back() : location.replace('index.html#contracts'); };
  try {
    await Store.ready;
    if (!Store.currentUser()) return location.replace('login.html');
    render(Store.contractDocument(id));
    if (q.get('print') === '1') { await (document.fonts?.ready || Promise.resolve()); setTimeout(() => window.print(), 300); }
  } catch (e) { const er = $('error'); er.textContent = e.message || 'تعذر تحميل العقد'; er.hidden = false; }
})();
