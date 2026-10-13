// طبقة التخزين: قاعدة بيانات SQLite (sql.js) داخل المتصفح، تُحفظ في IndexedDB
// ويمكن تصديرها/استيرادها كملف .sqlite. اعتمد على: await Store.ready قبل أي استخدام.
const Store = (() => {
  const DEFAULTS = { workStart: '09:00', workEnd: '17:00', graceMin: '0', weekend: '5,6' }; // 5,6 = الجمعة والسبت
  const IDB_NAME = 'attendance', IDB_STORE = 'files', IDB_KEY = 'db';
  const SCRIPT_BASE = document.currentScript.src.replace(/store\.js(\?.*)?$/, '');
  let SQL, db;

  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  // ---------- تشفير كلمات المرور (PBKDF2-SHA256 + ملح عشوائي) ----------
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  async function derive(pw, salt, iter) {
    if (!window.crypto?.subtle) throw new Error('المتصفح يتطلب اتصالاً آمناً (HTTPS) لتشفير كلمة المرور');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
  }
  async function hashPw(pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 100000;
    return `pbkdf2$${iter}$${b64(salt)}$${b64(await derive(pw, salt, iter))}`;
  }
  async function verifyPw(pw, stored) {
    if (!stored.startsWith('pbkdf2$')) return { ok: pw === stored, legacy: true }; // بيانات قديمة نصية: تُرقّى عند الدخول
    const [, it, salt, hash] = stored.split('$');
    return { ok: b64(await derive(pw, unb64(salt), +it)) === hash, legacy: false };
  }

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
      role TEXT NOT NULL CHECK (role IN ('admin','employee')),
      active INTEGER NOT NULL DEFAULT 1,
      can_edit INTEGER NOT NULL DEFAULT 0,
      can_hr INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT,
      edited_by TEXT,
      edited_at TEXT,
      UNIQUE (user_id, date));
    CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      emp_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      national_id TEXT UNIQUE,
      gender TEXT, birth_date TEXT, nationality TEXT, marital TEXT,
      phone TEXT, email TEXT, address TEXT,
      department TEXT, job_title TEXT, emp_type TEXT, hire_date TEXT, salary REAL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','terminated')),
      emergency_name TEXT, emergency_phone TEXT, notes TEXT,
      user_id TEXT,
      department_id TEXT, job_title_id TEXT, manager_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      contract_no TEXT NOT NULL UNIQUE,
      employee_id TEXT NOT NULL,
      type TEXT NOT NULL,
      pay_basis TEXT NOT NULL DEFAULT 'monthly',
      start_date TEXT NOT NULL, end_date TEXT,
      basic_salary REAL NOT NULL, allowances REAL NOT NULL DEFAULT 0,
      job_title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
      notes TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_contracts_emp ON contracts(employee_id);
    CREATE TABLE IF NOT EXISTS salary_grades (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      min_salary REAL NOT NULL, max_salary REAL NOT NULL, increment REAL NOT NULL DEFAULT 0, notes TEXT);
    CREATE TABLE IF NOT EXISTS job_titles (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE,
      grade_id TEXT, description TEXT, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL UNIQUE,
      parent_id TEXT, manager_id TEXT, notes TEXT);`;

  let cfg = { ...DEFAULTS };
  const nextCode = (table, prefix) => {
    const max = all(`SELECT code FROM ${table}`).reduce((m, r) => Math.max(m, Number((r.code.match(/\d+$/) || [0])[0])), 0);
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  };
  // ترقية بيانات قديمة: الأقسام والمسميات المكتوبة نصاً في ملفات الموظفين تتحول إلى سجلات في الأدلة
  function backfillCatalogs() {
    for (const [col, idCol, table, prefix] of [['department', 'department_id', 'departments', 'DEP'], ['job_title', 'job_title_id', 'job_titles', 'JOB']]) {
      all(`SELECT DISTINCT ${col} AS n FROM employees WHERE ${idCol} IS NULL AND ${col} IS NOT NULL AND TRIM(${col}) != ''`).forEach(r => {
        let row = all(`SELECT id FROM ${table} WHERE name = ?`, [r.n])[0];
        if (!row) { row = { id: uid() }; run(`INSERT INTO ${table} (id, code, name) VALUES (?,?,?)`, [row.id, nextCode(table, prefix), r.n]); }
        run(`UPDATE employees SET ${idCol} = ? WHERE ${idCol} IS NULL AND ${col} = ?`, [row.id, r.n]);
      });
    }
  }
  function ensureSchema() {
    db.exec(SCHEMA);
    // ترقية قواعد قديمة: عمود active
    // ترقية قواعد قديمة: أعمدة ناقصة تُضاف تلقائياً
    const addCol = (table, col, ddl) => { if (!all(`PRAGMA table_info(${table})`).some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };
    addCol('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
    addCol('users', 'can_edit', 'INTEGER NOT NULL DEFAULT 0');
    addCol('records', 'edited_by', 'TEXT');
    addCol('records', 'edited_at', 'TEXT');
    addCol('users', 'can_hr', 'INTEGER NOT NULL DEFAULT 0');
    addCol('employees', 'user_id', 'TEXT');
    addCol('employees', 'department_id', 'TEXT');
    addCol('employees', 'job_title_id', 'TEXT');
    addCol('employees', 'manager_id', 'TEXT');
    addCol('contracts', 'pay_basis', "TEXT NOT NULL DEFAULT 'monthly'");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_user ON employees(user_id) WHERE user_id IS NOT NULL');
    backfillCatalogs();
    cfg = { ...DEFAULTS };
    all('SELECT key, value FROM settings').forEach(r => { if (r.key in DEFAULTS) cfg[r.key] = r.value; });
  }

  function all(sql, params = []) {
    const st = db.prepare(sql); const out = [];
    try { st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
  const run = (sql, params = []) => db.run(sql, params);
  // الحفظ بعد كل كتابة (قاعدة صغيرة، فالتصدير سريع)
  let saving = Promise.resolve();
  const persist = () => (saving = saving.then(() => idbPut(db.export())).catch(e => console.error('تعذر حفظ القاعدة', e)));

  async function seed() {
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
    for (const u of users) run('INSERT OR IGNORE INTO users (id, username, password, name, role) VALUES (?,?,?,?,?)', [u.id, u.username, await hashPw(u.password), u.name, u.role]);
    recs.forEach(r => run('INSERT OR IGNORE INTO records (id, user_id, date, check_in, check_out) VALUES (?,?,?,?,?)', [r.id, r.userId, r.date, r.checkIn, r.checkOut || null]));
    localStorage.removeItem('att_users'); localStorage.removeItem('att_records');
  }

  const ready = (async () => {
    SQL = await initSqlJs({ locateFile: f => SCRIPT_BASE + 'vendor/' + f });
    const saved = await idbGet().catch(() => null);
    db = saved ? new SQL.Database(saved) : new SQL.Database();
    ensureSchema();
    if (!saved) await seed();
    await persist(); // يحفظ أيضاً أي ترقية للمخطط
  })();

  const REC = 'SELECT id, user_id AS userId, date, check_in AS checkIn, check_out AS checkOut, edited_by AS editedBy, edited_at AS editedAt FROM records';
  const USER = 'SELECT id, username, name, role, active, can_edit AS canEdit, can_hr AS canHr FROM users';
  const activeAdmins = () => all("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")[0].n;
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  // الصلاحيات: المدير يملك كل شيء، وغيره يملك ما مُنح له فقط
  const isAdmin = u => !!u && u.role === 'admin';
  const canEditAttendance = u => !!u && (u.role === 'admin' || u.canEdit === 1);
  const canHr = u => !!u && (u.role === 'admin' || u.canHr === 1); // مسؤول موارد بشرية
  const NO_HR = 'ليست لديك صلاحية الموارد البشرية';
  const CONTRACT = `SELECT id, contract_no AS contractNo, employee_id AS employeeId, type, pay_basis AS payBasis, start_date AS startDate, end_date AS endDate,
    basic_salary AS basicSalary, allowances, job_title AS jobTitle, status, notes FROM contracts`;
  const FAR = '9999-12-31';
  const CONTRACT_TYPES = ['دائم', 'محدد المدة', 'تجريبي', 'موسمي', 'دوام جزئي'];
  const PAY_BASES = ['monthly', 'daily', 'volunteer']; // شهري / يومي / متطوع
  const SELF_HR = 'لا يمكنك تعديل ملفك الشخصي أو عقدك بنفسك';
  // ملف موظف مرتبط بحساب الممارِس: لا يعدّله إلا المدير (فصل المسؤوليات)
  const ownsEmployee = (actor, empId) => !!empId && all('SELECT 1 FROM employees WHERE id = ? AND user_id = ?', [empId, actor.id]).length > 0;
  const ADMIN_ONLY = 'هذه العملية للمدير فقط';
  const NO_EDIT = 'ليست لديك صلاحية تعديل الحضور';
  const EMP = `SELECT id, emp_no AS empNo, name, national_id AS nationalId, gender, birth_date AS birthDate, nationality, marital,
    phone, email, address, department, job_title AS jobTitle, emp_type AS empType, hire_date AS hireDate, salary, status,
    emergency_name AS emergencyName, emergency_phone AS emergencyPhone, notes, user_id AS userId,
    department_id AS departmentId, job_title_id AS jobTitleId, manager_id AS managerId FROM employees`;
  const trim = v => (v == null ? '' : String(v).trim());
  const checkPw = pw => need(pw && pw.length >= 6, 'كلمة المرور يجب ألا تقل عن 6 أحرف');
  const localISO = (date, hhmm) => { const [y, m, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, h, mi).toISOString(); };

  const api = {
    ready, dateKey, pad,
    get settings() { return { ...cfg }; },
    isWeekend(date) { return cfg.weekend.split(',').filter(Boolean).map(Number).includes(new Date(date + 'T00:00:00').getDay()); },
    saveSettings(next) {
      need(isAdmin(this.currentUser()), ADMIN_ONLY);
      need(/^\d\d:\d\d$/.test(next.workStart) && /^\d\d:\d\d$/.test(next.workEnd), 'أدخل وقت دوام صحيحاً');
      need(toMin(next.workEnd) > toMin(next.workStart), 'وقت نهاية الدوام يجب أن يكون بعد وقت البداية');
      const grace = Number(next.graceMin);
      need(Number.isInteger(grace) && grace >= 0 && grace <= 120, 'مهلة التأخير بين 0 و120 دقيقة');
      const merged = { workStart: next.workStart, workEnd: next.workEnd, graceMin: String(grace), weekend: next.weekend };
      for (const [k, v] of Object.entries(merged)) run('INSERT OR REPLACE INTO settings VALUES (?,?)', [k, v]);
      cfg = merged;
      return persist();
    },

    // ---------- المستخدمون ----------
    users: () => all(`${USER} ORDER BY name`),
    async login(username, password) {
      const u = all(`${USER.replace('active', 'active, password')} WHERE username = ?`, [username.trim()])[0];
      if (!u) return null;
      const v = await verifyPw(password, u.password);
      if (!v.ok) return null;
      need(u.active, 'هذا الحساب معطّل. تواصل مع المدير');
      if (v.legacy) { run('UPDATE users SET password = ? WHERE id = ?', [await hashPw(password), u.id]); await persist(); }
      localStorage.setItem('att_session', JSON.stringify(u.id));
      delete u.password; return u;
    },
    logout() { localStorage.removeItem('att_session'); },
    currentUser() {
      let id = null; try { id = JSON.parse(localStorage.getItem('att_session')); } catch {}
      return id ? all(`${USER} WHERE id = ? AND active = 1`, [id])[0] || null : null;
    },
    async addUser({ name, username, password, role }) {
      need(isAdmin(this.currentUser()), ADMIN_ONLY);
      need(name && username, 'الاسم واسم المستخدم مطلوبان');
      checkPw(password);
      need(!all('SELECT 1 FROM users WHERE username = ?', [username])[0], 'اسم المستخدم موجود مسبقاً');
      run('INSERT INTO users (id, username, password, name, role) VALUES (?,?,?,?,?)', [uid(), username, await hashPw(password), name, role]);
      return persist();
    },
    async setPassword(userId, password) {
      const me = this.currentUser();
      need(isAdmin(me) || (me && me.id === userId), ADMIN_ONLY);
      checkPw(password);
      run('UPDATE users SET password = ? WHERE id = ?', [await hashPw(password), userId]);
      return persist();
    },
    async changeOwnPassword(userId, oldPw, newPw) {
      const row = all('SELECT password FROM users WHERE id = ?', [userId])[0];
      need(row && (await verifyPw(oldPw, row.password)).ok, 'كلمة المرور الحالية غير صحيحة');
      return this.setPassword(userId, newPw);
    },
    setActive(userId, active) {
      need(isAdmin(this.currentUser()), ADMIN_ONLY);
      const u = all(`${USER} WHERE id = ?`, [userId])[0];
      need(u, 'المستخدم غير موجود');
      if (!active) {
        need(userId !== this.currentUser()?.id, 'لا يمكنك تعطيل حسابك الحالي');
        need(!(u.role === 'admin' && activeAdmins() <= 1), 'يجب أن يبقى مدير واحد فعّال على الأقل');
      }
      run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, userId]);
      return persist();
    },

    // ---------- ملفات الموظفين (شؤون الموظفين) ----------
    employees() { need(canHr(this.currentUser()), NO_HR); return all(`${EMP} ORDER BY emp_no`); },
    // بيانات الموظف المرتبط بحساب معيّن (لصاحب الحساب أو للموارد البشرية)
    employeeOfUser(userId) {
      const me = this.currentUser();
      if (!me || (me.id !== userId && !canHr(me))) return null;
      return all(`${EMP} WHERE user_id = ?`, [userId])[0] || null;
    },
    nextEmpNo() {
      const max = all('SELECT emp_no FROM employees').reduce((m, r) => Math.max(m, Number((r.emp_no.match(/\d+$/) || [0])[0])), 0);
      return 'EMP-' + String(max + 1).padStart(4, '0');
    },
    saveEmployee(e) {
      const actor = this.currentUser();
      need(canHr(actor), NO_HR);
      const f = {};
      for (const k of ['empNo', 'name', 'nationalId', 'gender', 'birthDate', 'nationality', 'marital', 'phone', 'email', 'address',
        'empType', 'hireDate', 'status', 'emergencyName', 'emergencyPhone', 'notes']) f[k] = trim(e[k]);
      need(f.name.length >= 3, 'أدخل الاسم الكامل للموظف');
      need(['active', 'leave', 'terminated'].includes(f.status), 'اختر حالة الموظف');
      need(!f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email), 'البريد الإلكتروني غير صحيح');
      need(!f.phone || /^[+\d][\d\s-]{6,19}$/.test(f.phone), 'رقم الهاتف غير صحيح');
      need(!f.emergencyPhone || /^[+\d][\d\s-]{6,19}$/.test(f.emergencyPhone), 'رقم هاتف الطوارئ غير صحيح');
      for (const k of ['birthDate', 'hireDate']) need(!f[k] || /^\d{4}-\d\d-\d\d$/.test(f[k]), 'تاريخ غير صحيح');
      const today = dateKey(new Date());
      need(!f.birthDate || f.birthDate < today, 'تاريخ الميلاد يجب أن يكون في الماضي');
      need(!f.birthDate || !f.hireDate || f.hireDate > f.birthDate, 'تاريخ التعيين يجب أن يكون بعد تاريخ الميلاد');
      const salary = trim(e.salary) === '' ? null : Number(e.salary);
      need(salary === null || (Number.isFinite(salary) && salary >= 0), 'الراتب يجب أن يكون رقماً موجباً');
      if (!f.empNo) f.empNo = this.nextEmpNo();
      const id = e.id || null;
      const userId = trim(e.userId) || null;
      if (userId) {
        need(all('SELECT 1 FROM users WHERE id = ?', [userId]).length, 'حساب الدخول غير موجود');
        const used = all('SELECT id FROM employees WHERE user_id = ?', [userId])[0];
        need(!used || used.id === id, 'هذا الحساب مرتبط بموظف آخر');
      }
      need(isAdmin(actor) || (userId !== actor.id && !ownsEmployee(actor, id)), SELF_HR);
      // القسم والمسمى الوظيفي من الأدلة (يُحفظ اسمهما أيضاً للعرض والتصدير)
      const departmentId = trim(e.departmentId) || null, jobTitleId = trim(e.jobTitleId) || null, managerId = trim(e.managerId) || null;
      f.department = ''; f.jobTitle = '';
      if (departmentId) { const d = all('SELECT name FROM departments WHERE id = ?', [departmentId])[0]; need(d, 'القسم غير موجود'); f.department = d.name; }
      if (jobTitleId) { const t = all('SELECT name FROM job_titles WHERE id = ?', [jobTitleId])[0]; need(t, 'المسمى الوظيفي غير موجود'); f.jobTitle = t.name; }
      if (managerId) { // الرئيس المباشر: لا يكون الموظف نفسه، ولا منتهي الخدمة، ولا يُنشئ حلقة في التسلسل
        need(managerId !== id, 'لا يمكن أن يكون الموظف رئيساً لنفسه');
        const m = all('SELECT status FROM employees WHERE id = ?', [managerId])[0];
        need(m, 'الرئيس المباشر غير موجود');
        need(m.status !== 'terminated', 'لا يمكن إسناد الإشراف لموظف منتهي الخدمة');
        for (let cur = managerId, guard = 0; cur && guard < 1000; guard++) {
          need(cur !== id, 'هذا الإسناد يُنشئ حلقة في التسلسل الإداري (الرئيس سيصبح مرؤوساً لمرؤوسه)');
          cur = all('SELECT manager_id FROM employees WHERE id = ?', [cur])[0]?.manager_id;
        }
      }
      const dupNo = all('SELECT id FROM employees WHERE emp_no = ?', [f.empNo])[0];
      need(!dupNo || dupNo.id === id, 'رقم الموظف مستخدم مسبقاً');
      if (f.nationalId) {
        const dupId = all('SELECT id FROM employees WHERE national_id = ?', [f.nationalId])[0];
        need(!dupId || dupId.id === id, 'رقم الهوية مسجّل لموظف آخر');
      }
      const now = new Date().toISOString();
      const vals = [f.empNo, f.name, f.nationalId || null, f.gender, f.birthDate, f.nationality, f.marital, f.phone, f.email, f.address,
        f.department, f.jobTitle, f.empType, f.hireDate, salary, f.status, f.emergencyName, f.emergencyPhone, f.notes, userId, departmentId, jobTitleId, managerId];
      if (id) run(`UPDATE employees SET emp_no=?, name=?, national_id=?, gender=?, birth_date=?, nationality=?, marital=?, phone=?, email=?, address=?,
        department=?, job_title=?, emp_type=?, hire_date=?, salary=?, status=?, emergency_name=?, emergency_phone=?, notes=?, user_id=?, department_id=?, job_title_id=?, manager_id=?, updated_at=? WHERE id=?`, [...vals, now, id]);
      else run(`INSERT INTO employees (emp_no, name, national_id, gender, birth_date, nationality, marital, phone, email, address, department, job_title,
        emp_type, hire_date, salary, status, emergency_name, emergency_phone, notes, user_id, department_id, job_title_id, manager_id, id, created_at, updated_at) VALUES (${'?,'.repeat(25)}?)`, [...vals, uid(), now, now]);
      return persist();
    },
    deleteEmployee(id) {
      const actor = this.currentUser();
      need(canHr(actor), NO_HR);
      need(isAdmin(actor) || !ownsEmployee(actor, id), SELF_HR);
      run('DELETE FROM contracts WHERE employee_id = ?', [id]);
      run('UPDATE employees SET manager_id = NULL WHERE manager_id = ?', [id]); // مرؤوسوه بلا رئيس حتى يُسند لهم غيره
      run('UPDATE departments SET manager_id = NULL WHERE manager_id = ?', [id]);
      run('DELETE FROM employees WHERE id = ?', [id]);
      return persist();
    },

    // ---------- العقود ----------
    contractTypes: CONTRACT_TYPES, payBases: PAY_BASES,
    contracts() { need(canHr(this.currentUser()), NO_HR); return all(`${CONTRACT} ORDER BY start_date DESC, contract_no DESC`); },
    nextContractNo() {
      const max = all('SELECT contract_no FROM contracts').reduce((m, r) => Math.max(m, Number((r.contract_no.match(/\d+$/) || [0])[0])), 0);
      return 'CNT-' + String(max + 1).padStart(4, '0');
    },
    // الحالة المحسوبة: cancelled | upcoming | expired | expiring (خلال 30 يوماً) | active
    contractStatus(c) {
      const today = dateKey(new Date());
      if (c.status === 'cancelled') return 'cancelled';
      if (c.startDate > today) return 'upcoming';
      if (c.endDate) {
        if (c.endDate < today) return 'expired';
        if ((new Date(c.endDate) - new Date(today)) / 86400000 <= 30) return 'expiring';
      }
      return 'active';
    },
    saveContract(c) {
      const actor = this.currentUser();
      need(canHr(actor), NO_HR);
      const id = c.id || null, empId = trim(c.employeeId);
      need(all('SELECT 1 FROM employees WHERE id = ?', [empId]).length, 'اختر الموظف');
      need(isAdmin(actor) || (!ownsEmployee(actor, empId) && !(id && ownsEmployee(actor, all('SELECT employee_id FROM contracts WHERE id = ?', [id])[0]?.employee_id))), SELF_HR);
      const type = trim(c.type), start = trim(c.startDate), end = trim(c.endDate), status = trim(c.status) || 'active', payBasis = trim(c.payBasis) || 'monthly';
      need(PAY_BASES.includes(payBasis), 'اختر نوع الأجر: شهري أو يومي أو متطوع');
      need(CONTRACT_TYPES.includes(type), 'اختر نوع العقد');
      need(/^\d{4}-\d\d-\d\d$/.test(start), 'أدخل تاريخ بداية العقد');
      need(!end || /^\d{4}-\d\d-\d\d$/.test(end), 'تاريخ انتهاء غير صحيح');
      if (type === 'دائم') need(!end, 'العقد الدائم لا يحتاج تاريخ انتهاء');
      else need(end, 'أدخل تاريخ انتهاء العقد');
      need(!end || end >= start, 'تاريخ الانتهاء يجب ألا يسبق تاريخ البداية');
      let basic = Number(c.basicSalary), allow = trim(c.allowances) === '' ? 0 : Number(c.allowances);
      if (payBasis === 'volunteer') { basic = 0; allow = 0; } // المتطوع بلا أجر
      else {
        need(trim(c.basicSalary) !== '' && Number.isFinite(basic) && basic >= 0, payBasis === 'daily' ? 'أدخل الأجر اليومي (رقماً موجباً)' : 'أدخل الراتب الأساسي (رقماً موجباً)');
        need(payBasis !== 'daily' || basic > 0, 'الأجر اليومي يجب أن يكون أكبر من صفر');
        need(Number.isFinite(allow) && allow >= 0, 'البدلات يجب أن تكون رقماً موجباً');
      }
      need(['active', 'cancelled'].includes(status), 'حالة العقد غير صحيحة');
      const no = trim(c.contractNo) || this.nextContractNo();
      const dupNo = all('SELECT id FROM contracts WHERE contract_no = ?', [no])[0];
      need(!dupNo || dupNo.id === id, 'رقم العقد مستخدم مسبقاً');
      if (status === 'active') { // لا يتداخل عقدان ساريان لنفس الموظف
        const clash = all("SELECT id FROM contracts WHERE employee_id = ? AND status = 'active' AND id != ? AND start_date <= ? AND COALESCE(end_date, ?) >= ?",
          [empId, id || '', end || FAR, FAR, start])[0];
        need(!clash, 'يتداخل هذا العقد مع عقد آخر ساري لنفس الموظف');
      }
      const now = new Date().toISOString(), job = trim(c.jobTitle), notes = trim(c.notes);
      if (id) run('UPDATE contracts SET contract_no=?, employee_id=?, type=?, pay_basis=?, start_date=?, end_date=?, basic_salary=?, allowances=?, job_title=?, status=?, notes=?, updated_at=? WHERE id=?',
        [no, empId, type, payBasis, start, end || null, basic, allow, job, status, notes, now, id]);
      else run('INSERT INTO contracts (id, contract_no, employee_id, type, pay_basis, start_date, end_date, basic_salary, allowances, job_title, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uid(), no, empId, type, payBasis, start, end || null, basic, allow, job, status, notes, now, now]);
      return persist();
    },
    deleteContract(id) {
      const actor = this.currentUser();
      need(canHr(actor), NO_HR);
      const row = all('SELECT employee_id FROM contracts WHERE id = ?', [id])[0];
      need(row, 'العقد غير موجود');
      need(isAdmin(actor) || !ownsEmployee(actor, row.employee_id), SELF_HR);
      run('DELETE FROM contracts WHERE id = ?', [id]);
      return persist();
    },


    // ---------- سلم الرواتب والمسميات والهيكل التنظيمي (موارد بشرية) ----------
    grades() { need(canHr(this.currentUser()), NO_HR); return all('SELECT id, code, name, min_salary AS min, max_salary AS max, increment, notes FROM salary_grades ORDER BY min_salary, code'); },
    nextGradeCode: () => nextCode('salary_grades', 'GR'),
    saveGrade(g) {
      need(canHr(this.currentUser()), NO_HR);
      const id = g.id || null, name = trim(g.name), min = Number(g.min), max = Number(g.max), inc = trim(g.increment) === '' ? 0 : Number(g.increment);
      need(name.length >= 2, 'أدخل اسم الدرجة');
      need(trim(g.min) !== '' && Number.isFinite(min) && min >= 0, 'أدخل الحد الأدنى للراتب');
      need(trim(g.max) !== '' && Number.isFinite(max) && max >= min, 'الحد الأعلى يجب ألا يقل عن الحد الأدنى');
      need(Number.isFinite(inc) && inc >= 0, 'العلاوة السنوية يجب أن تكون رقماً موجباً');
      const code = trim(g.code) || this.nextGradeCode();
      const dup = all('SELECT id FROM salary_grades WHERE code = ?', [code])[0];
      need(!dup || dup.id === id, 'رمز الدرجة مستخدم مسبقاً');
      if (id) run('UPDATE salary_grades SET code=?, name=?, min_salary=?, max_salary=?, increment=?, notes=? WHERE id=?', [code, name, min, max, inc, trim(g.notes), id]);
      else run('INSERT INTO salary_grades (id, code, name, min_salary, max_salary, increment, notes) VALUES (?,?,?,?,?,?,?)', [uid(), code, name, min, max, inc, trim(g.notes)]);
      return persist();
    },
    deleteGrade(id) {
      need(canHr(this.currentUser()), NO_HR);
      const n = all('SELECT COUNT(*) AS n FROM job_titles WHERE grade_id = ?', [id])[0].n;
      need(!n, `لا يمكن حذف الدرجة: مرتبطة بـ ${n} مسمى وظيفي`);
      run('DELETE FROM salary_grades WHERE id = ?', [id]);
      return persist();
    },
    // نطاق راتب الموظف حسب درجة مسماه الوظيفي (أو null)
    gradeRange(employeeId) {
      need(canHr(this.currentUser()), NO_HR);
      return all(`SELECT g.code, g.name, g.min_salary AS min, g.max_salary AS max FROM employees e
        JOIN job_titles t ON t.id = e.job_title_id JOIN salary_grades g ON g.id = t.grade_id WHERE e.id = ?`, [employeeId])[0] || null;
    },

    jobTitles() { need(canHr(this.currentUser()), NO_HR); return all('SELECT id, code, name, grade_id AS gradeId, description, active FROM job_titles ORDER BY code'); },
    nextTitleCode: () => nextCode('job_titles', 'JOB'),
    saveJobTitle(t) {
      need(canHr(this.currentUser()), NO_HR);
      const id = t.id || null, name = trim(t.name), gradeId = trim(t.gradeId) || null;
      need(name.length >= 2, 'أدخل اسم المسمى الوظيفي');
      need(!gradeId || all('SELECT 1 FROM salary_grades WHERE id = ?', [gradeId]).length, 'الدرجة غير موجودة');
      const code = trim(t.code) || this.nextTitleCode();
      const dupNo = all('SELECT id FROM job_titles WHERE code = ?', [code])[0], dupName = all('SELECT id FROM job_titles WHERE name = ?', [name])[0];
      need(!dupNo || dupNo.id === id, 'رمز المسمى مستخدم مسبقاً');
      need(!dupName || dupName.id === id, 'اسم المسمى الوظيفي موجود مسبقاً');
      const active = t.active === 0 || t.active === '0' || t.active === false ? 0 : 1;
      if (id) { run('UPDATE job_titles SET code=?, name=?, grade_id=?, description=?, active=? WHERE id=?', [code, name, gradeId, trim(t.description), active, id]);
        run('UPDATE employees SET job_title = ? WHERE job_title_id = ?', [name, id]); } // يبقى الاسم المعروض متطابقاً بعد إعادة التسمية
      else run('INSERT INTO job_titles (id, code, name, grade_id, description, active) VALUES (?,?,?,?,?,?)', [uid(), code, name, gradeId, trim(t.description), active]);
      return persist();
    },
    deleteJobTitle(id) {
      need(canHr(this.currentUser()), NO_HR);
      const n = all('SELECT COUNT(*) AS n FROM employees WHERE job_title_id = ?', [id])[0].n;
      need(!n, `لا يمكن حذف المسمى: يشغله ${n} موظف. عطّله بدلاً من حذفه`);
      run('DELETE FROM job_titles WHERE id = ?', [id]);
      return persist();
    },

    departments() { need(canHr(this.currentUser()), NO_HR); return all('SELECT id, code, name, parent_id AS parentId, manager_id AS managerId, notes FROM departments ORDER BY code'); },
    nextDepartmentCode: () => nextCode('departments', 'DEP'),
    saveDepartment(d) {
      need(canHr(this.currentUser()), NO_HR);
      const id = d.id || null, name = trim(d.name), parentId = trim(d.parentId) || null, managerId = trim(d.managerId) || null;
      need(name.length >= 2, 'أدخل اسم القسم');
      need(!managerId || all('SELECT 1 FROM employees WHERE id = ?', [managerId]).length, 'مدير القسم غير موجود');
      if (parentId) {
        need(parentId !== id, 'لا يمكن أن يكون القسم تابعاً لنفسه');
        need(all('SELECT 1 FROM departments WHERE id = ?', [parentId]).length, 'القسم الأعلى غير موجود');
        for (let cur = parentId, guard = 0; cur && guard < 1000; guard++) { // منع الحلقات في الهيكل
          need(cur !== id, 'هذا الإسناد يُنشئ حلقة في الهيكل التنظيمي');
          cur = all('SELECT parent_id FROM departments WHERE id = ?', [cur])[0]?.parent_id;
        }
      }
      const code = trim(d.code) || this.nextDepartmentCode();
      const dupNo = all('SELECT id FROM departments WHERE code = ?', [code])[0], dupName = all('SELECT id FROM departments WHERE name = ?', [name])[0];
      need(!dupNo || dupNo.id === id, 'رمز القسم مستخدم مسبقاً');
      need(!dupName || dupName.id === id, 'اسم القسم موجود مسبقاً');
      if (id) { run('UPDATE departments SET code=?, name=?, parent_id=?, manager_id=?, notes=? WHERE id=?', [code, name, parentId, managerId, trim(d.notes), id]);
        run('UPDATE employees SET department = ? WHERE department_id = ?', [name, id]); }
      else run('INSERT INTO departments (id, code, name, parent_id, manager_id, notes) VALUES (?,?,?,?,?,?)', [uid(), code, name, parentId, managerId, trim(d.notes)]);
      return persist();
    },
    deleteDepartment(id) {
      need(canHr(this.currentUser()), NO_HR);
      const kids = all('SELECT COUNT(*) AS n FROM departments WHERE parent_id = ?', [id])[0].n;
      const emps = all('SELECT COUNT(*) AS n FROM employees WHERE department_id = ?', [id])[0].n;
      need(!kids, `لا يمكن حذف القسم: يتبعه ${kids} قسم فرعي`);
      need(!emps, `لا يمكن حذف القسم: يعمل فيه ${emps} موظف`);
      run('DELETE FROM departments WHERE id = ?', [id]);
      return persist();
    },

    // منح/سحب صلاحية: edit = تعديل الحضور، hr = مسؤول موارد بشرية (المدير يملكهما دائماً)
    setPermission(userId, perm, allowed) {
      need(isAdmin(this.currentUser()), ADMIN_ONLY);
      const col = { edit: 'can_edit', hr: 'can_hr' }[perm];
      need(col, 'صلاحية غير معروفة');
      const u = all(`${USER} WHERE id = ?`, [userId])[0];
      need(u, 'المستخدم غير موجود');
      need(u.role !== 'admin', 'المدير يملك هذه الصلاحية دائماً');
      run(`UPDATE users SET ${col} = ? WHERE id = ?`, [allowed ? 1 : 0, userId]);
      return persist();
    },
    canEditAttendance, canHr,

    // ---------- الحضور ----------
    todayRecord: userId => all(`${REC} WHERE user_id = ? AND date = ?`, [userId, dateKey(new Date())])[0] || null,
    checkIn(userId) {
      need(!this.todayRecord(userId), 'تم تسجيل الحضور اليوم مسبقاً');
      const now = new Date();
      run('INSERT INTO records (id, user_id, date, check_in) VALUES (?,?,?,?)', [uid(), userId, dateKey(now), now.toISOString()]);
      return persist();
    },
    checkOut(userId) {
      const r = this.todayRecord(userId);
      need(r, 'لم يتم تسجيل الحضور اليوم');
      need(!r.checkOut, 'تم تسجيل الانصراف مسبقاً');
      run('UPDATE records SET check_out = ? WHERE id = ?', [new Date().toISOString(), r.id]);
      return persist();
    },
    recordsFor: (userId, month) => all(`${REC} WHERE user_id = ? AND date LIKE ? ORDER BY date DESC`, [userId, (month || '') + '%']),
    recordsOn: date => all(`${REC} WHERE date = ? ORDER BY check_in`, [date]),
    // تعديل/إضافة يدوية لمن يملك الصلاحية: checkIn/checkOut بصيغة HH:MM
    // غير المدير لا يعدّل سجلاته الشخصية (فصل المسؤوليات)، وكل تعديل يُسجَّل باسم صاحبه
    saveRecord({ id, userId, date, checkIn, checkOut }) {
      const actor = this.currentUser();
      need(canEditAttendance(actor), NO_EDIT);
      const existing = id ? all('SELECT user_id FROM records WHERE id = ?', [id])[0] : null;
      need(isAdmin(actor) || (userId !== actor.id && existing?.user_id !== actor.id), 'لا يمكنك تعديل سجلاتك الشخصية');
      const stamp = new Date().toISOString();
      need(userId && /^\d{4}-\d\d-\d\d$/.test(date), 'اختر الموظف والتاريخ');
      need(/^\d\d:\d\d$/.test(checkIn), 'أدخل وقت الحضور');
      const cin = localISO(date, checkIn), cout = checkOut ? localISO(date, checkOut) : null;
      need(!cout || cout > cin, 'وقت الانصراف يجب أن يكون بعد وقت الحضور');
      const dup = all('SELECT id FROM records WHERE user_id = ? AND date = ?', [userId, date])[0];
      need(!dup || dup.id === id, 'يوجد سجل لهذا الموظف في هذا التاريخ');
      if (id) run('UPDATE records SET user_id = ?, date = ?, check_in = ?, check_out = ?, edited_by = ?, edited_at = ? WHERE id = ?', [userId, date, cin, cout, actor.id, stamp, id]);
      else run('INSERT INTO records (id, user_id, date, check_in, check_out, edited_by, edited_at) VALUES (?,?,?,?,?,?,?)', [uid(), userId, date, cin, cout, actor.id, stamp]);
      return persist();
    },
    deleteRecord(id) {
      const actor = this.currentUser();
      need(canEditAttendance(actor), NO_EDIT);
      const r = all('SELECT user_id FROM records WHERE id = ?', [id])[0];
      need(r, 'السجل غير موجود');
      need(isAdmin(actor) || r.user_id !== actor.id, 'لا يمكنك تعديل سجلاتك الشخصية');
      run('DELETE FROM records WHERE id = ?', [id]); return persist();
    },

    isLate(rec) {
      const d = new Date(rec.checkIn);
      return d.getHours() * 60 + d.getMinutes() > toMin(cfg.workStart) + Number(cfg.graceMin);
    },
    hours: rec => rec.checkOut ? (new Date(rec.checkOut) - new Date(rec.checkIn)) / 3600000 : 0,
    dailyHours: () => (toMin(cfg.workEnd) - toMin(cfg.workStart)) / 60,

    // ---------- التقرير الشهري (month = YYYY-MM) ----------
    workingDays(month) {
      const [y, m] = month.split('-').map(Number), today = dateKey(new Date());
      let n = 0;
      for (let d = 1, last = new Date(y, m, 0).getDate(); d <= last; d++) {
        const key = `${month}-${pad(d)}`;
        if (key <= today && !this.isWeekend(key)) n++;
      }
      return n;
    },
    attendanceSummary(userId, month) {
      const wd = this.workingDays(month);
      const recs = all(`${REC} WHERE user_id = ? AND date LIKE ?`, [userId, month + '%']);
      const onWorkDays = recs.filter(r => !this.isWeekend(r.date));
      return { workingDays: wd, present: onWorkDays.length, absent: Math.max(0, wd - onWorkDays.length),
        late: recs.filter(r => this.isLate(r)).length, hours: recs.reduce((t, r) => t + this.hours(r), 0) };
    },
    report(month) {
      return all("SELECT id, name FROM users WHERE active = 1 ORDER BY name").map(u => ({ name: u.name, ...this.attendanceSummary(u.id, month) }));
    },

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
      ensureSchema();
      return persist();
    },
  };
  return api;
})();
