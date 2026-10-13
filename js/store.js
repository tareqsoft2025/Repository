// طبقة التخزين: قاعدة بيانات SQLite (sql.js) داخل المتصفح، تُحفظ في IndexedDB
// ويمكن تصديرها/استيرادها كملف .sqlite. اعتمد على: await Store.ready قبل أي استخدام.
const Store = (() => {
  const WORK_START = '09:00'; // بعد هذا الوقت يُعتبر الدخول تأخيراً
  const IDB_NAME = 'attendance', IDB_STORE = 'files', IDB_KEY = 'db';
  const SCRIPT_BASE = document.currentScript.src.replace(/store\.js(\?.*)?$/, '');
  let SQL, db;

  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- IndexedDB ----------
  const idb = () => new Promise((res, rej) => {
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const idbOp = async (mode, fn) => {
    const conn = await idb();
    return new Promise((res, rej) => {
      const rq = fn(conn.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      rq.onsuccess = () => { conn.close(); res(rq.result); };
      rq.onerror = () => { conn.close(); rej(rq.error); };
    });
  };
  const idbGet = () => idbOp('readonly', s => s.get(IDB_KEY));
  const idbPut = bytes => idbOp('readwrite', s => s.put(bytes, IDB_KEY));

  // ---------- SQL ----------
  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','employee')));
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT,
      UNIQUE (user_id, date));
    CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);`;

  function all(sql, params = []) {
    const st = db.prepare(sql); const out = [];
    try { st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
  const run = (sql, params = []) => db.run(sql, params);
  // الحفظ بعد كل كتابة (قاعدة صغيرة، فالتصدير سريع)
  let saving = Promise.resolve();
  const persist = () => (saving = saving.then(() => idbPut(db.export())).catch(e => console.error('تعذر حفظ القاعدة', e)));

  function seed() {
    // ترحيل بيانات النسخة القديمة (localStorage) إن وُجدت، وإلا حسابات تجريبية
    let users = null, recs = [];
    try { users = JSON.parse(localStorage.getItem('att_users')); recs = JSON.parse(localStorage.getItem('att_records')) || []; } catch {}
    if (!Array.isArray(users) || !users.length) {
      users = [
        { id: 'u_admin', username: 'admin', password: 'admin123', name: 'مدير النظام', role: 'admin' },
        { id: 'u_ahmed', username: 'ahmed', password: '123456', name: 'أحمد محمد', role: 'employee' },
      ];
      recs = [];
    }
    users.forEach(u => run('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?)', [u.id, u.username, u.password, u.name, u.role]));
    recs.forEach(r => run('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?)', [r.id, r.userId, r.date, r.checkIn, r.checkOut || null]));
    localStorage.removeItem('att_users'); localStorage.removeItem('att_records');
  }

  const ready = (async () => {
    SQL = await initSqlJs({ locateFile: f => SCRIPT_BASE + 'vendor/' + f });
    const saved = await idbGet().catch(() => null);
    db = saved ? new SQL.Database(saved) : new SQL.Database();
    db.exec(SCHEMA);
    if (!saved) { seed(); await persist(); }
  })();

  const REC = 'SELECT id, user_id AS userId, date, check_in AS checkIn, check_out AS checkOut FROM records';

  return {
    ready, WORK_START, dateKey, pad,
    users: () => all('SELECT id, username, name, role FROM users ORDER BY name'),
    login(username, password) {
      const u = all('SELECT id, username, name, role FROM users WHERE username = ? AND password = ?', [username.trim(), password])[0];
      if (!u) return null;
      localStorage.setItem('att_session', JSON.stringify(u.id));
      return u;
    },
    logout() { localStorage.removeItem('att_session'); },
    currentUser() {
      let id = null; try { id = JSON.parse(localStorage.getItem('att_session')); } catch {}
      return id ? all('SELECT id, username, name, role FROM users WHERE id = ?', [id])[0] || null : null;
    },
    addUser({ name, username, password, role }) {
      if (all('SELECT 1 FROM users WHERE username = ?', [username])[0]) throw new Error('اسم المستخدم موجود مسبقاً');
      run('INSERT INTO users VALUES (?,?,?,?,?)', [uid(), username, password, name, role]);
      return persist();
    },
    todayRecord: userId => all(`${REC} WHERE user_id = ? AND date = ?`, [userId, dateKey(new Date())])[0] || null,
    checkIn(userId) {
      if (this.todayRecord(userId)) throw new Error('تم تسجيل الحضور اليوم مسبقاً');
      const now = new Date();
      run('INSERT INTO records VALUES (?,?,?,?,NULL)', [uid(), userId, dateKey(now), now.toISOString()]);
      return persist();
    },
    checkOut(userId) {
      const r = this.todayRecord(userId);
      if (!r) throw new Error('لم يتم تسجيل الحضور اليوم');
      if (r.checkOut) throw new Error('تم تسجيل الانصراف مسبقاً');
      run('UPDATE records SET check_out = ? WHERE id = ?', [new Date().toISOString(), r.id]);
      return persist();
    },
    recordsFor: (userId, month) => all(`${REC} WHERE user_id = ? AND date LIKE ? ORDER BY date DESC`, [userId, (month || '') + '%']),
    recordsOn: date => all(`${REC} WHERE date = ? ORDER BY check_in`, [date]),
    isLate(rec) {
      const d = new Date(rec.checkIn);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}` > WORK_START;
    },
    hours: rec => rec.checkOut ? (new Date(rec.checkOut) - new Date(rec.checkIn)) / 3600000 : 0,

    // ---------- نسخ احتياطي ----------
    exportDb: () => new Blob([db.export()], { type: 'application/vnd.sqlite3' }),
    async importDb(file) {
      const candidate = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
      try {
        const t = candidate.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','records')");
        if (!t.length || t[0].values.length !== 2) throw new Error('الملف ليس قاعدة بيانات الحضور');
        candidate.exec('SELECT id, username, password, name, role FROM users LIMIT 1');
        candidate.exec('SELECT id, user_id, date, check_in, check_out FROM records LIMIT 1');
      } catch (e) {
        candidate.close();
        throw e.message.startsWith('الملف') ? e : new Error('ملف قاعدة بيانات غير صالح');
      }
      db.close(); db = candidate;
      return persist();
    },
  };
})();
