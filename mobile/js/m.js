// بصمة: تطبيق تسجيل الحضور والانصراف. يعمل دون اتصال: التسجيل يُحفظ مع الموقع في طابور محلي ثم يُرسل للخادم عند توفر الإنترنت.
'use strict';
(() => {
  const VERSION = '2.1';
  const $ = id => document.getElementById(id);
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem('hrm_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('hrm_' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('hrm_' + k); } catch {} },
  };
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // ---------- الحالة ----------
  let session = LS.get('session');           // { token, user:{id,name,...} }
  let me = LS.get('me');                     // آخر رد من /api/m/me (للعمل دون اتصال)
  let outbox = LS.get('outbox', []);         // تسجيلات لم تصل للخادم: { clientId, type, at, date, lat, lng, acc, state, error }
  let lastSync = LS.get('lastSync');
  let busy = false, flushing = false, fix = null, watchId = null, netErr = false, authErr = false;

  const serverUrl = () => (LS.get('url') || window.HR_SERVER || '').trim().replace(/\/+$/, '');

  // ---------- الشبكة ----------
  async function api(method, path, body, token) {
    const base = serverUrl(); if (!base) { const e = new Error('أدخل عنوان الخادم من «إعدادات الخادم»'); e.config = true; throw e; }
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    let res;
    try { res = await fetch(base + path, { method, signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { const e = new Error('تعذّر الاتصال بالخادم'); e.offline = true; throw e; } finally { clearTimeout(t); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || 'خطأ من الخادم'); e.status = res.status; throw e; }
    return j;
  }

  // ---------- الموقع ----------
  function startWatch() {
    if (watchId != null || !navigator.geolocation) return;
    try {
      watchId = navigator.geolocation.watchPosition(p => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; renderGps(); },
        e => { fix = fix && Date.now() - fix.t < 5 * 60e3 ? fix : { err: e.code === 1 ? 'denied' : 'unavail', t: Date.now() }; renderGps(); },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
    } catch {}
  }
  function stopWatch() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
  function renderGps() {
    const g = $('gps'), t = $('gpsTxt'); g.className = 'gps';
    if (!navigator.geolocation) { g.classList.add('bad'); t.textContent = 'الجهاز لا يدعم تحديد الموقع'; return; }
    if (!fix) { t.textContent = 'جارٍ تحديد الموقع…'; return; }
    if (fix.err) { g.classList.add('bad'); t.textContent = fix.err === 'denied' ? 'إذن الموقع مرفوض — فعّله من إعدادات التطبيق' : 'تعذّر تحديد الموقع — شغّل GPS'; return; }
    const age = Date.now() - fix.t, a = Math.round(fix.acc);
    g.classList.add(a <= 50 ? 'ok' : a <= 150 ? 'warn' : 'bad');
    t.textContent = age > 90e3 ? `آخر موقع قبل ${Math.round(age / 60e3)} د (±${a} م)` : `الموقع جاهز — الدقة ±${a} م`;
  }
  // أفضل موقع متاح للتسجيل
  function getFix() {
    return new Promise((resolve, reject) => {
      if (fix && !fix.err && Date.now() - fix.t < 45e3 && fix.acc <= 150) return resolve(fix);
      const deny = c => reject(new Error(c === 1 ? 'إذن الموقع مرفوض. فعّل إذن الموقع للتطبيق ثم أعد المحاولة' : 'تعذّر تحديد موقعك. شغّل GPS وتأكد أنك في مكان مكشوف ثم أعد المحاولة'));
      if (!navigator.geolocation) return reject(new Error('الجهاز لا يدعم تحديد الموقع'));
      navigator.geolocation.getCurrentPosition(p => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; renderGps(); resolve(fix); },
        e => { if (fix && !fix.err && Date.now() - fix.t < 5 * 60e3) return resolve(fix); deny(e.code); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  // ---------- بيانات اليوم (مدمجة من الخادم والطابور) ----------
  const queued = (date, type) => outbox.find(o => o.date === date && o.type === type && o.state === 'pending');
  function dayView(date) {
    const rec = me?.records?.find(r => r.date === date) || null;
    const qi = queued(date, 'in'), qo = queued(date, 'out');
    const inAt = rec?.checkIn || qi?.at || null, outAt = rec?.checkOut || qo?.at || null;
    return { rec, inAt, outAt, inPending: !rec?.checkIn && !!qi, outPending: !rec?.checkOut && !!qo };
  }
  const isLate = iso => { const s = me?.settings; if (!s || !iso) return false; return toMin(hm(iso)) > toMin(s.workStart) + (s.graceMin || 0); };
  const fmtHrs = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };

  // ---------- العرض ----------
  function show(id) { ['scrLogin', 'scrPw', 'scrMain'].forEach(s => { $(s).hidden = s !== id; }); }
  function toast(msg, bad) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 3600); }

  function tick() {
    const n = new Date();
    $('tClock').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
    $('tDate').textContent = `${AR_DAYS[n.getDay()]}، ${n.getDate()} ${AR_MONTHS[n.getMonth()]} ${n.getFullYear()}`;
  }

  function renderNet() {
    const c = $('chipNet'), pend = outbox.filter(o => o.state === 'pending').length, rej = outbox.filter(o => o.state === 'rejected').length;
    c.className = 'chip'; let txt;
    if (authErr) { c.classList.add('err'); txt = 'انتهت الجلسة'; }
    else if (!navigator.onLine || netErr) { c.classList.add('off'); txt = pend ? `دون اتصال (${pend})` : 'دون اتصال'; }
    else if (pend) { c.classList.add('off'); txt = `جارٍ الإرسال (${pend})`; }
    else { c.classList.add('on'); txt = rej ? 'تسجيل مرفوض' : 'متصل'; }
    c.lastElementChild.textContent = txt;
  }

  function renderToday() {
    if (!me) return;
    const today = dayKey(new Date()), v = dayView(today), el = me.eligibility || {}, s = me.settings;
    const btn = $('punch'), banner = $('banner');
    $('tShift').innerHTML = `الدوام من <bdi>${s.workStart}</bdi> إلى <bdi>${s.workEnd}</bdi>`;
    let mode = 'in', lbl = 'تسجيل حضور', sub = 'اضغط للتسجيل', dis = false;
    if (v.inAt && !v.outAt) { mode = 'out'; lbl = 'تسجيل انصراف'; sub = `منذ ${hm(v.inAt)}`; }
    else if (v.inAt && v.outAt) { mode = 'done'; lbl = 'اكتمل اليوم'; sub = `${hm(v.inAt)} ← ${hm(v.outAt)}`; dis = true; }
    if (!el.ok && !v.inAt) { mode = 'off'; lbl = 'غير متاح'; sub = ''; dis = true; }
    btn.className = 'punch ' + mode + (busy ? ' busy' : ''); btn.disabled = dis || busy;
    $('punchLbl').textContent = lbl; $('punchSub').textContent = sub;
    $('punchIcon').setAttribute('d', mode === 'out' ? 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' : mode === 'done' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3');
    // التنبيهات
    const rej = outbox.filter(o => o.state === 'rejected');
    banner.className = 'banner hidden'; banner.textContent = '';
    if (authErr) { banner.className = 'banner bad'; banner.textContent = 'انتهت جلسة الدخول. سجّل الدخول من جديد لإرسال التسجيلات المحفوظة (لن تضيع).'; }
    else if (rej.length) { banner.className = 'banner bad'; banner.textContent = `رفض الخادم تسجيلاً: ${rej[rej.length - 1].error}`; }
    else if (!el.ok) { banner.className = 'banner bad'; banner.textContent = `لا يمكنك التسجيل: ${el.reason || 'غير مؤهل'}`; }
    else if (el.contractEnd) { const d = Math.round((new Date(el.contractEnd) - new Date(today)) / 86400000); if (d >= 0 && d <= 30) { banner.className = 'banner'; banner.textContent = `ينتهي عقدك بعد ${d} يوماً.`; } }
    // البطاقات
    $('tIn').textContent = v.inAt ? hm(v.inAt) : '—'; $('tOut').textContent = v.outAt ? hm(v.outAt) : '—';
    $('tInTag').textContent = v.inPending ? 'بانتظار الإرسال' : v.inAt ? (isLate(v.inAt) ? 'متأخر' : 'في الوقت') : ''; $('tInTag').className = v.inPending ? 'pend' : isLate(v.inAt) ? 'late' : 'ok';
    $('tOutTag').textContent = v.outPending ? 'بانتظار الإرسال' : ''; $('tOutTag').className = v.outPending ? 'pend' : '';
    const end = v.outAt ? new Date(v.outAt) : new Date();
    $('tHrs').textContent = v.inAt ? fmtHrs(end - new Date(v.inAt)) : '0:00'; $('tHrsTag').textContent = v.inAt && !v.outAt ? 'مستمرة' : '';
  }

  function renderHistory() {
    if (!me) return;
    const list = $('histList'); list.replaceChildren();
    const byDate = new Map((me.records || []).map(r => [r.date, { ...r }]));
    outbox.filter(o => o.state !== 'rejected').forEach(o => { const r = byDate.get(o.date) || { date: o.date }; if (o.type === 'in' && !r.checkIn) { r.checkIn = o.at; r.inLat = o.lat; r.inLng = o.lng; r.inAcc = Math.round(o.acc); r.pend = true; } if (o.type === 'out' && !r.checkOut) { r.checkOut = o.at; r.outLat = o.lat; r.outLng = o.lng; r.outAcc = Math.round(o.acc); r.pend = true; } byDate.set(o.date, r); });
    const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    const ym = dayKey(new Date()).slice(0, 7), month = days.filter(d => d.date.startsWith(ym));
    $('sDays').textContent = month.length; $('sLate').textContent = month.filter(d => isLate(d.checkIn)).length;
    $('sHrs').textContent = (month.reduce((t, d) => t + (d.checkIn && d.checkOut ? new Date(d.checkOut) - new Date(d.checkIn) : 0), 0) / 3600e3).toFixed(1);
    outbox.filter(o => o.state === 'rejected').forEach(o => list.appendChild(rejCard(o)));
    if (!days.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'لا توجد تسجيلات بعد. ابدأ يومك بتسجيل الحضور.'; list.appendChild(e); return; }
    days.forEach(d => {
      const dt = new Date(d.date + 'T00:00:00'), b = document.createElement('button'); b.className = 'day'; b.type = 'button';
      const dn = document.createElement('div'); dn.className = 'dn'; dn.innerHTML = '<b></b><small></small>'; dn.firstChild.textContent = dt.getDate(); dn.lastChild.textContent = AR_DAYS[dt.getDay()];
      const tm = document.createElement('div'); tm.className = 'tm';
      [['حضور', d.checkIn], ['انصراف', d.checkOut]].forEach(([l, v]) => { const sp = document.createElement('span'); sp.dir = 'ltr'; sp.innerHTML = '<small></small>'; sp.firstChild.textContent = l; sp.append(v ? hm(v) : '—'); tm.appendChild(sp); });
      const bd = document.createElement('span'); bd.className = 'badge' + (d.pend ? ' pend' : isLate(d.checkIn) ? ' late' : ''); bd.textContent = d.pend ? 'بانتظار الإرسال' : isLate(d.checkIn) ? 'متأخر' : 'في الوقت';
      b.append(dn, tm, bd); b.onclick = () => openDay(d); list.appendChild(b);
    });
  }
  function rejCard(o) {
    const b = document.createElement('div'); b.className = 'day'; b.style.gridTemplateColumns = '1fr auto';
    const t = document.createElement('div'); t.innerHTML = '<b></b><div class="sub" style="color:var(--muted);font-size:13px;margin-top:4px"></div>';
    t.firstChild.textContent = `${o.type === 'in' ? 'حضور' : 'انصراف'} ${o.date} ${hm(o.at)}`; t.lastChild.textContent = o.error;
    const x = document.createElement('button'); x.className = 'badge rej'; x.textContent = 'إخفاء'; x.onclick = () => { outbox = outbox.filter(e => e !== o); LS.set('outbox', outbox); render(); };
    b.append(t, x); return b;
  }
  function openDay(d) {
    const body = $('sheetBody'); body.replaceChildren();
    const dt = new Date(d.date + 'T00:00:00'), h = document.createElement('h3'); h.textContent = `${AR_DAYS[dt.getDay()]} ${dt.getDate()} ${AR_MONTHS[dt.getMonth()]}`;
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = d.checkIn && d.checkOut ? `مدة العمل ${fmtHrs(new Date(d.checkOut) - new Date(d.checkIn))}` : 'اليوم غير مكتمل';
    body.append(h, sub);
    const kv = (l, v) => { const r = document.createElement('div'); r.className = 'kv'; r.innerHTML = '<span></span><b dir="ltr"></b>'; r.firstChild.textContent = l; r.lastChild.textContent = v; body.appendChild(r); };
    kv('الحضور', d.checkIn ? hm(d.checkIn) : '—'); kv('الانصراف', d.checkOut ? hm(d.checkOut) : '—');
    if (d.inAcc != null) kv('دقة موقع الحضور', `±${d.inAcc} م`); if (d.outAcc != null) kv('دقة موقع الانصراف', `±${d.outAcc} م`);
    const lat = d.inLat ?? d.outLat, lng = d.inLng ?? d.outLng;
    if (lat != null) { const a = document.createElement('a'); a.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'عرض موقع التسجيل على الخريطة'; body.appendChild(a); }
    $('sheet').hidden = $('sheetBg').hidden = false;
  }
  const closeSheet = () => { $('sheet').hidden = $('sheetBg').hidden = true; };

  function renderMe() {
    if (!me) return;
    const e = me.employee, name = e?.name || me.user.name;
    $('pAvatar').textContent = [...name][0]; $('pName').textContent = name; $('pJob').textContent = e?.jobTitle || (me.user.role === 'admin' ? 'مدير النظام' : 'موظف');
    $('pNo').textContent = e?.empNo || '—'; $('pDept').textContent = e?.department || '—'; $('pOrg').textContent = me.settings.orgName || '—';
    const pend = outbox.filter(o => o.state === 'pending').length;
    $('mSync').textContent = authErr ? 'تحتاج تسجيل دخول' : (!navigator.onLine || netErr) ? 'دون اتصال' : 'متصل'; $('mLast').textContent = lastSync ? `${dayKey(new Date(lastSync))} ${hm(lastSync)}` : '—'; $('mPend').textContent = pend;
    $('ver').textContent = `بصمة ${VERSION}`;
  }
  function render() {
    if (!me) return;
    const name = me.employee?.name || me.user.name, h = new Date().getHours();
    $('hiName').textContent = `${h < 12 ? 'صباح الخير' : h < 18 ? 'مساء الخير' : 'مساء النور'}، ${name.split(' ')[0]}`;
    $('hiSub').textContent = me.employee?.jobTitle || me.employee?.department || ''; $('avatar').textContent = [...name][0];
    renderNet(); renderToday(); renderHistory(); renderMe(); renderGps();
  }

  // ---------- المزامنة ----------
  async function loadMe() {
    if (!session) return;
    try {
      const j = await api('GET', `/api/m/me?date=${dayKey(new Date())}`, null, session.token);
      me = j; LS.set('me', me); lastSync = new Date().toISOString(); LS.set('lastSync', lastSync); netErr = false; authErr = false;
      if (j.user.mustChange) return gotoPassword();
    } catch (e) { handleErr(e); }
  }
  function handleErr(e) {
    if (e.status === 401) authErr = true; else if (e.offline) netErr = true;
  }
  async function flush() {
    if (flushing || !session) return;
    const pending = () => outbox.find(o => o.state === 'pending');
    if (!pending() || !navigator.onLine) return;
    flushing = true;
    try {
      let o; // بالترتيب: الحضور قبل الانصراف
      while ((o = outbox.filter(x => x.state === 'pending').sort((a, b) => a.at.localeCompare(b.at))[0])) {
        try {
          await api('POST', '/api/m/punch', { clientId: o.clientId, type: o.type, at: o.at, date: o.date, lat: o.lat, lng: o.lng, acc: o.acc }, session.token);
          outbox = outbox.filter(x => x !== o); netErr = false; authErr = false;
        } catch (e) {
          if (e.status && e.status !== 401 && e.status !== 429 && e.status < 500) { o.state = 'rejected'; o.error = e.message; } // رفض نهائي من الخادم
          else { handleErr(e); break; }
        }
        LS.set('outbox', outbox);
      }
    } finally { flushing = false; LS.set('outbox', outbox); }
  }
  async function syncAll(manual) {
    if (!session) return;
    if (!navigator.onLine) { netErr = true; render(); if (manual) toast('لا يوجد اتصال بالإنترنت', true); return; }
    await flush(); await loadMe(); render();
    if (manual) toast(authErr ? 'انتهت الجلسة. سجّل الدخول من جديد' : netErr ? 'تعذّر الاتصال بالخادم' : 'تمت المزامنة', authErr || netErr);
  }

  // ---------- التسجيل ----------
  async function punch() {
    if (busy || !me) return;
    const today = dayKey(new Date()), v = dayView(today), el = me.eligibility || {};
    const type = v.inAt ? 'out' : 'in';
    if (v.inAt && v.outAt) return;
    if (!el.ok && type === 'in') return toast(el.reason || 'غير مؤهل للتسجيل', true);
    busy = true; renderToday(); $('punchSub').textContent = 'جارٍ تحديد موقعك…';
    try {
      const f = await getFix();
      const entry = { clientId: uuid(), type, at: new Date().toISOString(), date: today, lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6), acc: Math.round(f.acc), state: 'pending' };
      outbox.push(entry); LS.set('outbox', outbox);
      if (navigator.vibrate) navigator.vibrate(type === 'in' ? [40] : [40, 60, 40]);
      toast(type === 'in' ? 'تم تسجيل حضورك' + (navigator.onLine ? '' : ' — سيُرسل عند عودة الاتصال') : 'تم تسجيل انصرافك' + (navigator.onLine ? '' : ' — سيُرسل عند عودة الاتصال'));
      busy = false; render();
      await flush(); await loadMe();
    } catch (e) { toast(e.message, true); }
    busy = false; render();
  }

  // ---------- الدخول والخروج ----------
  function gotoPassword() {
    const forced = !!me?.user?.mustChange; show('scrPw'); $('pErr').textContent = ''; $('pwForm').reset();
    $('pOut').textContent = forced ? 'تسجيل الخروج' : 'رجوع'; $('pOut').onclick = forced ? logout : () => enterApp();
  }
  function enterApp() {
    show('scrMain'); startWatch(); tick(); render(); setTab(curTab);
  }
  let curTab = 'Today';
  function setTab(t) {
    curTab = t;
    ['Today', 'Hist', 'Me'].forEach(n => { $('pane' + n).hidden = n !== t; });
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('app').querySelector('main').scrollTop = 0;
  }
  function logout() {
    const pend = outbox.filter(o => o.state === 'pending').length;
    if (pend && !confirm(`يوجد ${pend} تسجيل لم يُرسل بعد، وسيُحذف إن خرجت الآن. هل تريد الخروج؟`)) return;
    stopWatch(); session = null; me = null; outbox = []; LS.del('session'); LS.del('me'); LS.del('outbox'); LS.del('lastSync'); authErr = netErr = false;
    show('scrLogin'); $('lPass').value = '';
  }

  async function doLogin(e) {
    e.preventDefault();
    const u = $('lUser').value.trim(), p = $('lPass').value, err = $('lErr'); err.textContent = '';
    const urlv = $('lUrl').value.trim();
    if (!$('lUrlBox').classList.contains('hidden') && urlv) { if (!/^https:\/\//.test(urlv) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(urlv)) { err.textContent = 'عنوان الخادم يجب أن يبدأ بـ https://'; return; } LS.set('url', urlv.replace(/\/+$/, '')); }
    if (!u || !p) { err.textContent = 'أدخل اسم المستخدم وكلمة المرور'; return; }
    $('lGo').disabled = true; $('lGo').textContent = 'جارٍ الدخول…';
    try {
      const j = await api('POST', '/api/login', { username: u, password: p });
      if (session && session.user.id !== j.user.id && outbox.some(o => o.state === 'pending')) { outbox = []; } // مستخدم مختلف: لا تُرسل تسجيلات غيره
      session = { token: j.token, user: j.user }; LS.set('session', session); LS.set('pw', 0); authErr = netErr = false;
      await loadMe();
      if (j.user.mustChange) { gotoPassword(); window.__curPw = p; $('pCur').value = p; }
      else { enterApp(); flush().then(loadMe).then(render); }
    } catch (ex) { err.textContent = ex.offline ? 'لا يوجد اتصال بالخادم. الدخول الأول يحتاج إنترنت.' : ex.message; if (ex.config) $('lUrlBox').classList.remove('hidden'); }
    $('lGo').disabled = false; $('lGo').textContent = 'دخول';
  }
  async function doPassword(e) {
    e.preventDefault(); const err = $('pErr'); err.textContent = '';
    $('pGo').disabled = true;
    try { await api('POST', '/api/m/password', { current: $('pCur').value, next: $('pNew').value }, session.token); await loadMe(); enterApp(); toast('تم تغيير كلمة المرور'); }
    catch (ex) { err.textContent = ex.message; }
    $('pGo').disabled = false;
  }

  // ---------- التهيئة ----------
  function init() {
    $('ver').textContent = `بصمة ${VERSION}`;
    $('lUrl').value = serverUrl(); if (!serverUrl()) $('lUrlBox').classList.remove('hidden');
    $('lUrlToggle').onclick = () => $('lUrlBox').classList.toggle('hidden');
    $('loginForm').onsubmit = doLogin; $('pwForm').onsubmit = doPassword;
    $('punch').onclick = punch; $('syncBtn').onclick = () => syncAll(true); $('outBtn').onclick = logout; $('pwBtn').onclick = () => { gotoPassword(); };
    $('chipNet').onclick = () => syncAll(true);
    document.querySelectorAll('.tabbar button').forEach(b => { b.onclick = () => { setTab(b.dataset.tab); if (b.dataset.tab === 'Hist') renderHistory(); }; });
    $('sheetBg').onclick = closeSheet;
    window.__back = () => { if (!$('sheet').hidden) { closeSheet(); return true; } if (!$('scrMain').hidden && curTab !== 'Today') { setTab('Today'); return true; } return false; };
    window.addEventListener('online', () => { netErr = false; syncAll(); });
    window.addEventListener('offline', () => { renderNet(); renderMe(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); if (session) { startWatch(); syncAll(); } } else stopWatch(); });
    setInterval(() => { tick(); if (!$('scrMain').hidden) { renderToday(); } }, 15000);
    setInterval(() => { if (session && outbox.some(o => o.state === 'pending')) syncAll(); else if (session && navigator.onLine) syncAll(); }, 60000);
    if (session && me) {
      if (me.user.mustChange) { show('scrPw'); } else enterApp();
      syncAll();
    } else if (session) { show('scrMain'); syncAll().then(() => me && enterApp()); }
    else show('scrLogin');
    tick();
  }
  init();
})();
