// خادم المزامنة المركزي لنظام شؤون الموظفين: قاعدة بيانات واحدة للنظام وتطبيق الحضور.
// بلا اعتماديات خارجية وعلى أي Node 16+ (التخزين ملف سجل في DATA_DIR). التشغيل: node server.js
// المتغيرات: PORT، DATA_DIR (مسار حفظ القاعدة)، SETUP_KEY (مفتاح التهيئة الأولى، يُولَّد ويُطبع إن لم يُحدَّد)
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8080);
// لا تُحفظ البيانات داخل مجلد منشور على الويب (public_html) أبداً: تُوضع بجوارها في مجلد المستخدم
const DATA_DIR = process.env.DATA_DIR || (/public_html|www|htdocs/.test(__dirname) ? path.join(__dirname.split(/public_html|www|htdocs/)[0], 'hr-data') : path.join(__dirname, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- التخزين: سجل أحداث (JSON lines) يُلحَق به، وفهرس في الذاكرة. بلا أي اعتمادية وعلى أي إصدار Node حديث ----------
const LOG = path.join(DATA_DIR, 'hr.log');
const TABLES = ['users', 'records', 'settings', 'employees', 'contracts', 'qualifications', 'courses', 'experiences', 'documents', 'salary_grades', 'leave_requests', 'job_titles', 'departments'];
const rowsBy = Object.fromEntries(TABLES.map(t => [t, new Map()]));   // tbl -> id -> { data, deleted, seq }
let bySeq = [];                                                       // [{tbl,id,seq}] بترتيب seq (قد يحوي قديماً)
const metaMap = new Map(), sessions = new Map(), punches = new Map();
let journal = [], undo = null, logLines = 0;

function applyLine(o, record) {
  switch (o.k) {
    case 'row': { const prev = rowsBy[o.tbl].get(o.id); rowsBy[o.tbl].set(o.id, { data: o.data || null, deleted: !!o.deleted, seq: o.seq }); bySeq.push({ tbl: o.tbl, id: o.id, seq: o.seq });
      if (undo) undo.push(() => { if (prev) rowsBy[o.tbl].set(o.id, prev); else rowsBy[o.tbl].delete(o.id); bySeq.pop(); }); break; }
    case 'meta': { const prev = metaMap.get(o.key); metaMap.set(o.key, o.value); if (undo) undo.push(() => (prev === undefined ? metaMap.delete(o.key) : metaMap.set(o.key, prev))); break; }
    case 'sess': sessions.set(o.hash, { user_id: o.user_id, expires: o.expires }); break;
    case 'sessdel': sessions.delete(o.hash); break;
    case 'punch': punches.set(o.client_id, { result: o.result, created: o.created }); break;
    case 'punchdel': punches.delete(o.client_id); break;
  }
  if (record) journal.push(JSON.stringify(o));
}
// يكتب ما تراكم دفعة واحدة (ذرّياً قدر الإمكان)
function flush() { if (!journal.length) return; fs.appendFileSync(LOG, journal.join('\n') + '\n'); logLines += journal.length; journal = []; }
function load() {
  if (!fs.existsSync(LOG)) return;
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) { if (!line) continue; try { applyLine(JSON.parse(line), false); logLines++; } catch { /* سطر ناقص من انقطاع مفاجئ */ } }
  const live = Object.values(rowsBy).reduce((n, m) => n + m.size, 0) + metaMap.size + sessions.size + punches.size;
  if (logLines > live * 3 + 2000) compact();
}
function compact() { // إعادة كتابة السجل بالحالة الحالية فقط
  const out = [];
  for (const [k, v] of metaMap) out.push({ k: 'meta', key: k, value: v });
  for (const t of TABLES) for (const [id, r] of rowsBy[t]) out.push({ k: 'row', tbl: t, id, data: r.data, deleted: r.deleted, seq: r.seq });
  for (const [hash, s] of sessions) out.push({ k: 'sess', hash, ...s });
  for (const [client_id, p] of punches) out.push({ k: 'punch', client_id, ...p });
  fs.writeFileSync(LOG + '.tmp', out.map(o => JSON.stringify(o)).join('\n') + '\n'); fs.renameSync(LOG + '.tmp', LOG);
  logLines = out.length;
  bySeq = []; for (const t of TABLES) for (const [id, r] of rowsBy[t]) bySeq.push({ tbl: t, id, seq: r.seq }); bySeq.sort((a, b) => a.seq - b.seq);
}
load();
bySeq.sort((a, b) => a.seq - b.seq);
const meta = k => metaMap.get(k);
const setMeta = (k, v) => { applyLine({ k: 'meta', key: k, value: String(v) }, true); flush(); };
if (!meta('serverId')) setMeta('serverId', crypto.randomUUID());
if (!meta('seq')) setMeta('seq', 0);
const SERVER_ID = meta('serverId');
const SETUP_KEY = process.env.SETUP_KEY || meta('setupKey') || (() => { const k = crypto.randomBytes(9).toString('hex'); setMeta('setupKey', k); return k; })();
console.log(`مفتاح التهيئة الأولى: ${SETUP_KEY}`);

// ---------- تخزين الصفوف ----------
const nextSeq = () => { const n = Number(meta('seq')) + 1; applyLine({ k: 'meta', key: 'seq', value: String(n) }, true); return n; };
const getRow = (tbl, id) => { const r = rowsBy[tbl].get(id); return r && !r.deleted ? JSON.parse(r.data) : null; };
const putRow = (tbl, id, data) => applyLine({ k: 'row', tbl, id, data: JSON.stringify(data), deleted: false, seq: nextSeq() }, true);
const delRow = (tbl, id) => applyLine({ k: 'row', tbl, id, data: null, deleted: true, seq: nextSeq() }, true);
const allRows = tbl => { const out = []; for (const r of rowsBy[tbl].values()) if (!r.deleted) out.push(JSON.parse(r.data)); return out; };
// معاملة: عند الخطأ تُتراجع تغييرات الذاكرة ولا يُكتب شيء
const tx = fn => { undo = []; const j = journal.length; try { const r = fn(); undo = null; flush(); return r; } catch (e) { undo.reverse().forEach(f => f()); journal.length = j; undo = null; throw e; } };
const findUserByName = name => allRows('users').find(u => String(u.username).toLowerCase() === String(name).toLowerCase());
const userCount = () => { let n = 0; for (const r of rowsBy.users.values()) if (!r.deleted) n++; return n; };

// ---------- كلمات المرور (متوافقة مع المتصفح: pbkdf2$iter$salt$hash) ----------
function verifyPw(pw, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (!stored.startsWith('pbkdf2$')) return pw === stored; // بيانات قديمة نصية
  const [, it, salt, hash] = stored.split('$');
  const h = Buffer.from(crypto.pbkdf2Sync(pw, Buffer.from(salt, 'base64'), Number(it), 32, 'sha256').toString('base64')), want = Buffer.from(String(hash));
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
const hashPw = pw => { const salt = crypto.randomBytes(16); return `pbkdf2$100000$${salt.toString('base64')}$${crypto.pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('base64')}`; };

// ---------- الجلسات والحدّ من المحاولات ----------
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const newSession = userId => { const t = crypto.randomBytes(32).toString('base64url'); applyLine({ k: 'sess', hash: sha(t), user_id: userId, expires: Date.now() + 30 * 86400e3 }, true); if (!undo) flush(); return t; };
const fails = new Map();
const throttled = key => { const f = fails.get(key); return f && f.n >= 8 && Date.now() - f.t < 10 * 60e3; };
const noteFail = key => { const f = fails.get(key); fails.set(key, { n: (f && Date.now() - f.t < 10 * 60e3 ? f.n : 0) + 1, t: Date.now() }); };

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (code, msg) => { throw new HttpError(code, msg); };

function actorOf(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) bad(401, 'يلزم تسجيل الدخول');
  const s = sessions.get(sha(t));
  if (!s || s.expires < Date.now()) bad(401, 'انتهت الجلسة. سجّل الدخول من جديد');
  const u = getRow('users', s.user_id);
  if (!u || !u.active) bad(401, 'الحساب غير فعّال');
  return u;
}
const isAdmin = u => u.role === 'admin' && !u.must_change;
const isHr = u => isAdmin(u) || (u.can_hr === 1 && !u.must_change);
const canEdit = u => isAdmin(u) || (u.can_edit === 1 && !u.must_change);
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, mustChange: !!u.must_change, canHr: !!u.can_hr, canEdit: !!u.can_edit });
const ownEmployeeId = u => allRows('employees').find(e => e.user_id === u.id)?.id || null;

// ---------- صلاحيات المزامنة لكل جدول ----------
// يرجع الصف كما يُرسل للمستخدم، أو null إن لم يكن مسموحاً
function readFilter(u, tbl, row, ownEmp) {
  if (isAdmin(u)) return row;
  if (tbl === 'users') return row.id === u.id ? row : (isHr(u) || canEdit(u)) ? { ...row, password: '' } : null; // الأسرار لصاحبها وللمدير فقط
  if (tbl === 'settings') return /^(seq_|demo_)/.test(row.key) ? null : row;
  if (isHr(u)) return row;
  if (tbl === 'records' || tbl === 'employees') return canEdit(u) || (tbl === 'records' ? row.user_id : row.user_id) === u.id ? row : null;
  if (tbl === 'contracts' || tbl === 'leave_requests') return ownEmp && row.employee_id === ownEmp ? row : null;
  return null;
}
// يتحقق من صلاحية الكتابة؛ يرجع الصف المسموح (قد يُعدَّل) أو null
function writeFilter(u, tbl, id, data, ownEmp) {
  if (isAdmin(u)) return data;
  if (tbl === 'users') {
    const old = getRow('users', id);
    if (data && data.password === '' && old) data = { ...data, password: old.password }; // لا تُمحى كلمة مرور لم تصل كاملة
    if (id === u.id && old) return { ...old, password: data.password, must_change: data.password !== old.password ? 0 : old.must_change }; // الحساب يغيّر كلمة مروره فقط
    if (isHr(u) && data && data.role === 'employee' && !data.can_hr && !data.can_edit && (!old || old.role === 'employee')) return data;
    return null;
  }
  if (tbl === 'settings') return null;
  if (tbl === 'records') { const old = getRow('records', id); return canEdit(u) || (data && data.user_id === u.id && (!old || old.user_id === u.id)) ? data : null; }
  if (isHr(u)) return tbl === 'employees' && data && data.user_id === u.id ? null : data; // الموارد البشرية لا تعدّل ملفها
  if (tbl === 'leave_requests') return data && ownEmp && data.employee_id === ownEmp && ['pending', 'cancelled'].includes(data.status) ? data : null;
  return null;
}

// ---------- مسارات الواجهة ----------
const routes = {};
const route = (method, p, fn) => { routes[method + ' ' + p] = fn; };

route('GET', '/api/health', () => ({ ok: true, serverId: SERVER_ID, initialized: userCount() > 0 }));

route('POST', '/api/login', async (req, body, ip) => {
  const name = String(body.username || '').trim(), key = ip + '|' + name.toLowerCase();
  if (throttled(key)) bad(429, 'محاولات كثيرة. انتظر عشر دقائق');
  const u = findUserByName(name);
  if (!u || !verifyPw(String(body.password || ''), u.password)) { noteFail(key); bad(401, 'اسم المستخدم أو كلمة المرور غير صحيحة'); }
  if (!u.active) bad(403, 'هذا الحساب معطّل. تواصل مع المدير');
  if (!u.password.startsWith('pbkdf2$')) putRow('users', u.id, { ...u, password: hashPw(String(body.password)) });
  fails.delete(key);
  return { token: newSession(u.id), user: publicUser(u), serverId: SERVER_ID };
});

// التهيئة الأولى: رفع بيانات جهاز المدير الحالية (مرة واحدة والقاعدة فارغة)
route('POST', '/api/bootstrap', (req, body, ip) => {
  if (throttled('boot|' + ip)) bad(429, 'محاولات كثيرة');
  if (String(body.setupKey || '') !== SETUP_KEY) { noteFail('boot|' + ip); bad(403, 'مفتاح التهيئة غير صحيح'); }
  if (userCount() > 0) bad(409, 'الخادم مهيّأ مسبقاً');
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const admin = rows.find(r => r.tbl === 'users' && r.id === body.adminId && r.data?.role === 'admin' && r.data?.active);
  if (!admin) bad(400, 'لا يوجد حساب مدير فعّال في البيانات');
  tx(() => rows.forEach(r => { if (TABLES.includes(r.tbl) && r.id && r.data) putRow(r.tbl, String(r.id), r.data); }));
  return { token: newSession(admin.id), serverId: SERVER_ID, cursor: Number(meta('seq')) };
});

route('GET', '/api/sync/pull', (req, body, ip, url) => {
  const u = actorOf(req), since = Number(url.searchParams.get('since') || 0), limit = 400;
  const ownEmp = ownEmployeeId(u), out = [];
  let cursor = since, more = false;
  let lo = 0, hi = bySeq.length; // أول إدخال seq > since
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bySeq[mid].seq <= since) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < bySeq.length; i++) {
    const e = bySeq[i], r = rowsBy[e.tbl].get(e.id);
    if (!r || r.seq !== e.seq) continue; // إدخال قديم لصف عُدّل لاحقاً
    if (out.length >= limit) { more = true; break; }
    cursor = e.seq;
    if (r.deleted) { if (isHr(u) || ['users', 'records', 'employees', 'contracts', 'leave_requests', 'settings'].includes(e.tbl)) out.push({ tbl: e.tbl, id: e.id, deleted: true }); continue; }
    const d = readFilter(u, e.tbl, JSON.parse(r.data), ownEmp);
    if (d) out.push({ tbl: e.tbl, id: e.id, data: d });
  }
  return { rows: out, cursor, more, serverId: SERVER_ID, user: publicUser(u) };
});

route('POST', '/api/sync/push', (req, body) => {
  const u = actorOf(req), ownEmp = ownEmployeeId(u), rejected = [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  tx(() => rows.forEach(r => {
    if (!TABLES.includes(r.tbl) || !r.id) return rejected.push(r.id);
    if (r.deleted) {
      const old = getRow(r.tbl, r.id);
      if (old && writeFilter(u, r.tbl, r.id, old, ownEmp) && (r.tbl !== 'users' || isAdmin(u)) && !(r.tbl === 'settings')) return delRow(r.tbl, r.id);
      return old ? rejected.push(r.id) : undefined;
    }
    const d = writeFilter(u, r.tbl, r.id, r.data, ownEmp);
    if (!d) return rejected.push(r.id);
    putRow(r.tbl, r.id, d);
  }));
  return { ok: true, rejected, cursor: Number(meta('seq')) };
});

// ---------- واجهة تطبيق الحضور ----------
const FAR = '9999-12-31';
function eligibility(u, emp, date) {
  if (!emp) return isAdmin(u) ? { ok: true, exempt: true } : { ok: false, reason: 'حسابك غير مرتبط بملف موظف' };
  if (emp.status === 'terminated') return { ok: false, reason: 'انتهت خدمتك' };
  const cs = allRows('contracts').filter(c => c.employee_id === emp.id && c.status === 'active');
  const cur = cs.find(c => c.start_date <= date && (c.end_date || FAR) >= date);
  if (cur) return { ok: true, contractNo: cur.contract_no, contractEnd: cur.end_date || null };
  const next = cs.filter(c => c.start_date > date).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (next) return { ok: false, reason: `يبدأ عقدك في ${next.start_date}` };
  return { ok: false, reason: cs.length ? 'انتهى عقدك' : 'لا يوجد عقد ساري لك. تواصل مع الموارد البشرية' };
}
const cfgOf = () => Object.fromEntries(allRows('settings').map(s => [s.key, s.value]));
const recFor = (userId, date) => allRows('records').find(r => r.user_id === userId && r.date === date) || null;
const recOut = r => r && ({ id: r.id, date: r.date, checkIn: r.check_in, checkOut: r.check_out, inLat: r.in_lat, inLng: r.in_lng, inAcc: r.in_acc, outLat: r.out_lat, outLng: r.out_lng, outAcc: r.out_acc });
const dateOk = d => /^\d{4}-\d\d-\d\d$/.test(d) && !isNaN(new Date(d));

route('GET', '/api/m/me', (req, body, ip, url) => {
  const u = actorOf(req), emp = allRows('employees').find(e => e.user_id === u.id) || null;
  const date = url.searchParams.get('date');
  const today = dateOk(date) ? date : new Date().toISOString().slice(0, 10);
  const from = new Date(today + 'T00:00:00Z'); from.setUTCDate(from.getUTCDate() - 45);
  const fromKey = from.toISOString().slice(0, 10), c = cfgOf();
  const records = allRows('records').filter(r => r.user_id === u.id && r.date >= fromKey).sort((a, b) => b.date.localeCompare(a.date)).map(recOut);
  return { user: publicUser(u), employee: emp && { name: emp.name, empNo: emp.emp_no, jobTitle: emp.job_title, department: emp.department },
    eligibility: u.must_change ? { ok: false, reason: 'غيّر كلمة المرور المؤقتة أولاً' } : eligibility(u, emp, today),
    settings: { workStart: c.workStart || '09:00', workEnd: c.workEnd || '17:00', graceMin: Number(c.graceMin || 0), weekend: c.weekend || '5,6', orgName: c.orgName || '' },
    records, serverTime: new Date().toISOString() };
});

route('POST', '/api/m/punch', (req, body) => {
  const u = actorOf(req);
  if (u.must_change) bad(403, 'غيّر كلمة المرور المؤقتة أولاً');
  const { clientId, type, at, date } = body;
  if (!clientId || !['in', 'out'].includes(type)) bad(400, 'طلب غير صحيح');
  const prev = punches.get(String(clientId));
  if (prev) return JSON.parse(prev.result); // إعادة إرسال: نتيجة سابقة دون تكرار
  const when = new Date(at);
  if (isNaN(when) || !dateOk(date)) bad(400, 'وقت التسجيل غير صحيح');
  const skew = Date.now() - when.getTime();
  if (skew < -5 * 60e3) bad(400, 'وقت التسجيل في المستقبل. صحّح ساعة الجهاز');
  if (skew > 7 * 86400e3) bad(400, 'مضى على التسجيل أكثر من 7 أيام');
  const lat = body.lat == null ? null : Number(body.lat), lng = body.lng == null ? null : Number(body.lng), acc = body.acc == null ? null : Math.round(Number(body.acc));
  if (lat === null || lng === null || !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) bad(400, 'الموقع مطلوب للتسجيل');
  const emp = allRows('employees').find(e => e.user_id === u.id) || null, el = eligibility(u, emp, date);
  const done = r => { const res = { ok: true, record: recOut(r), receivedAt: new Date().toISOString() }; applyLine({ k: 'punch', client_id: String(clientId), result: JSON.stringify(res), created: Date.now() }, true); return res; };
  return tx(() => {
    if (!el.ok) bad(422, `لا يمكن التسجيل: ${el.reason}`);
    const rec = recFor(u.id, date);
    if (type === 'in') {
      if (rec) bad(409, 'تم تسجيل الحضور في هذا اليوم مسبقاً');
      const r = { id: crypto.randomBytes(6).toString('hex'), user_id: u.id, date, check_in: when.toISOString(), check_out: null, edited_by: null, edited_at: null, in_lat: lat, in_lng: lng, in_acc: acc, out_lat: null, out_lng: null, out_acc: null };
      putRow('records', r.id, r); return done(r);
    }
    if (!rec) bad(409, 'لا يوجد تسجيل حضور لهذا اليوم');
    if (rec.check_out) bad(409, 'تم تسجيل الانصراف مسبقاً');
    if (when < new Date(rec.check_in)) bad(400, 'وقت الانصراف قبل وقت الحضور');
    const r = { ...rec, check_out: when.toISOString(), out_lat: lat, out_lng: lng, out_acc: acc };
    putRow('records', r.id, r); return done(r);
  });
});

route('POST', '/api/m/password', async (req, body) => {
  const u = actorOf(req), cur = String(body.current || ''), next = String(body.next || '');
  if (!verifyPw(cur, u.password)) bad(403, 'كلمة المرور الحالية غير صحيحة');
  if (next.length < 6) bad(400, 'كلمة المرور الجديدة 6 أحرف على الأقل');
  if (next === cur) bad(400, 'اختر كلمة مرور مختلفة عن الحالية');
  putRow('users', u.id, { ...u, password: hashPw(next), must_change: 0 });
  return { ok: true };
});

// ---------- الخادم ----------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' };
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('HR sync server OK'); }
  const fn = routes[req.method + ' ' + url.pathname];
  if (!fn) return send(res, 404, { error: 'غير موجود' });
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 120e6) { req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    try {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const out = await fn(req, body, ip, url); flush();
      send(res, 200, out);
    } catch (e) {
      flush();
      if (e instanceof HttpError) return send(res, e.code, { error: e.message });
      console.error(e); send(res, 500, { error: 'خطأ في الخادم' });
    }
  });
});
setInterval(() => { for (const [h, v] of sessions) if (v.expires < Date.now()) applyLine({ k: 'sessdel', hash: h }, true); for (const [c, p] of punches) if (p.created < Date.now() - 30 * 86400e3) applyLine({ k: 'punchdel', client_id: c }, true); flush(); }, 3600e3).unref();
server.listen(PORT, () => console.log(`خادم المزامنة يعمل على المنفذ ${PORT}`)); // يعمل أيضاً تحت Passenger/cPanel
module.exports = { server };
