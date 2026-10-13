// طبقة التخزين: قاعدة بيانات SQLite (sql.js) داخل المتصفح، تُحفظ في IndexedDB
// ويمكن تصديرها/استيرادها كملف .sqlite. اعتمد على: await Store.ready قبل أي استخدام.
const Store = (() => {
  const CURRENCIES = { ILS: 'شيكل (₪)', USD: 'دولار أمريكي ($)', JOD: 'دينار أردني', EUR: 'يورو (€)', SAR: 'ريال سعودي' };
  const DEFAULT_TERMS = [
    'يلتزم الطرف الثاني بأداء المهام الموكلة إليه وفق وصف العمل المبيّن في هذا العقد، وبتعليمات المشرف المباشر.',
    'يلتزم الطرف الثاني بالمحافظة على سرية المعلومات وعلى ممتلكات الطرف الأول وأدواته.',
    'يلتزم الطرف الثاني بأوقات الدوام الرسمية ولوائح العمل المعتمدة لدى الطرف الأول.',
    'يجوز لأي من الطرفين إنهاء هذا العقد بإشعار خطي مسبق وفق الأنظمة والقوانين المعمول بها.',
    'تُطبَّق الأنظمة والقوانين السارية على كل ما لم يرد فيه نص في هذا العقد.',
  ].join('\n');
  const DEFAULTS = { workStart: '09:00', workEnd: '17:00', graceMin: '0', weekend: '5,6', // 5,6 = الجمعة والسبت
    orgName: 'الجهة المتعاقدة', currency: 'ILS', contractTerms: DEFAULT_TERMS };
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
      can_hr INTEGER NOT NULL DEFAULT 0,
      must_change INTEGER NOT NULL DEFAULT 0);
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
      name_en TEXT, birth_place TEXT,
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
      issue_date TEXT, grade_id TEXT, grade_step INTEGER, currency TEXT NOT NULL DEFAULT 'ILS',
      project_code TEXT, project_name TEXT, project_name_en TEXT, supervisor_id TEXT,
      work_desc TEXT, work_desc_en TEXT, inclusions TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_contracts_emp ON contracts(employee_id);
    CREATE TABLE IF NOT EXISTS qualifications (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, degree TEXT, major TEXT, university TEXT, grad_year INTEGER, gpa REAL);
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, name TEXT NOT NULL, hours REAL, from_date TEXT, to_date TEXT, organizer TEXT);
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employer TEXT NOT NULL, job_title TEXT, from_date TEXT, to_date TEXT);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT,
      name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_qual_emp ON qualifications(employee_id);
    CREATE INDEX IF NOT EXISTS idx_course_emp ON courses(employee_id);
    CREATE INDEX IF NOT EXISTS idx_exp_emp ON experiences(employee_id);
    CREATE INDEX IF NOT EXISTS idx_doc_emp ON documents(employee_id);
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
    addCol('users', 'must_change', 'INTEGER NOT NULL DEFAULT 0');
    addCol('employees', 'user_id', 'TEXT');
    addCol('employees', 'department_id', 'TEXT');
    addCol('employees', 'job_title_id', 'TEXT');
    addCol('employees', 'manager_id', 'TEXT');
    addCol('employees', 'name_en', 'TEXT');
    addCol('employees', 'birth_place', 'TEXT');
    addCol('contracts', 'pay_basis', "TEXT NOT NULL DEFAULT 'monthly'");
    for (const [c, ddl] of [['issue_date', 'TEXT'], ['grade_id', 'TEXT'], ['grade_step', 'INTEGER'], ['currency', "TEXT NOT NULL DEFAULT 'ILS'"], ['project_code', 'TEXT'],
      ['project_name', 'TEXT'], ['project_name_en', 'TEXT'], ['supervisor_id', 'TEXT'], ['work_desc', 'TEXT'], ['work_desc_en', 'TEXT'], ['inclusions', 'TEXT']]) addCol('contracts', c, ddl);
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
  const USER = 'SELECT id, username, name, role, active, can_edit AS canEdit, can_hr AS canHr, must_change AS mustChange FROM users';
  const activeAdmins = () => all("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")[0].n;
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  // الصلاحيات: المدير يملك كل شيء، وغيره يملك ما مُنح له فقط
  // حساب ينتظر تغيير كلمة مروره المؤقتة لا يملك أي صلاحية حتى يغيّرها
  const isAdmin = u => !!u && !u.mustChange && u.role === 'admin';
  const canEditAttendance = u => !!u && !u.mustChange && (u.role === 'admin' || u.canEdit === 1);
  const canHr = u => !!u && !u.mustChange && (u.role === 'admin' || u.canHr === 1); // مسؤول موارد بشرية
  const MUST_CHANGE = 'يجب تغيير كلمة المرور المؤقتة أولاً';
  // ترقيم تلقائي تصاعدي لا يعيد استخدام رقم محذوف (العدّاد محفوظ في الإعدادات)
  const seqNext = (key, table, col) => {
    const cur = Number(all('SELECT value FROM settings WHERE key = ?', [key])[0]?.value || 0);
    const max = all(`SELECT ${col} AS c FROM ${table}`).reduce((m, r) => Math.max(m, Number((String(r.c).match(/\d+$/) || [0])[0])), 0);
    return Math.max(cur, max) + 1;
  };
  const seqCommit = (key, n) => run('INSERT OR REPLACE INTO settings VALUES (?,?)', [key, String(n)]);
  const NO_HR = 'ليست لديك صلاحية الموارد البشرية';
  const CONTRACT = `SELECT id, contract_no AS contractNo, employee_id AS employeeId, type, pay_basis AS payBasis, start_date AS startDate, end_date AS endDate,
    basic_salary AS basicSalary, allowances, job_title AS jobTitle, status, notes, issue_date AS issueDate, grade_id AS gradeId, grade_step AS gradeStep, currency,
    project_code AS projectCode, project_name AS projectName, project_name_en AS projectNameEn, supervisor_id AS supervisorId, work_desc AS workDesc,
    work_desc_en AS workDescEn, inclusions FROM contracts`;
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
    department_id AS departmentId, job_title_id AS jobTitleId, manager_id AS managerId, name_en AS nameEn, birth_place AS birthPlace FROM employees`;
  const trim = v => (v == null ? '' : String(v).trim());
  const MAX_FILE = 2 * 1024 * 1024; // 2 ميغابايت لكل مرفق
  const FILE_TYPES = { 'application/pdf': [[0x25, 0x50, 0x44, 0x46]], 'image/jpeg': [[0xFF, 0xD8, 0xFF]], 'image/png': [[0x89, 0x50, 0x4E, 0x47]], 'image/webp': [[0x52, 0x49, 0x46, 0x46]] };
  // يتحقق من حجم المرفق ونوعه الحقيقي (من بداية الملف لا من اسمه) ويعيده منظفاً
  const checkFile = (f, label) => {
    need(f && f.data instanceof Uint8Array && f.data.length > 0, `${label}: الملف فارغ`);
    need(f.data.length <= MAX_FILE, `${label}: حجم الملف أكبر من 2 ميغابايت`);
    const sigs = FILE_TYPES[f.mime];
    need(sigs && sigs.some(sig => sig.every((b, i) => f.data[i] === b)), `${label}: النوع غير مقبول (PDF أو صورة JPG/PNG/WEBP فقط)`);
    return { name: trim(f.name).slice(0, 120) || 'مرفق', mime: f.mime, data: f.data };
  };
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
      const orgName = next.orgName === undefined ? cfg.orgName : trim(next.orgName), currency = next.currency === undefined ? cfg.currency : trim(next.currency);
      const terms = next.contractTerms === undefined ? cfg.contractTerms : String(next.contractTerms).trim();
      need(orgName.length >= 2 && orgName.length <= 120, 'أدخل اسم الجهة المتعاقدة (2 إلى 120 حرفاً)');
      need(CURRENCIES[currency], 'اختر عملة صحيحة');
      need(terms.length <= 4000, 'نص بنود العقد طويل جداً (الحد 4000 حرف)');
      const merged = { workStart: next.workStart, workEnd: next.workEnd, graceMin: String(grace), weekend: next.weekend, orgName, currency, contractTerms: terms };
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
      run('INSERT INTO users (id, username, password, name, role, must_change) VALUES (?,?,?,?,?,1)', [uid(), username, await hashPw(password), name, role]); // كلمة المرور من المدير: تُغيَّر عند أول دخول
      return persist();
    },
    async setPassword(userId, password) {
      const me = this.currentUser();
      need(isAdmin(me) || (me && me.id === userId), ADMIN_ONLY);
      checkPw(password);
      const mustChange = me.id !== userId ? 1 : 0; // إعادة التعيين بواسطة المدير تتطلب تغييرها عند الدخول التالي
      run('UPDATE users SET password = ?, must_change = ? WHERE id = ?', [await hashPw(password), mustChange, userId]);
      return persist();
    },
    // تغيير كلمة المرور المؤقتة عند أول دخول
    async completeFirstLogin(newPw) {
      const me = this.currentUser();
      need(me && me.mustChange, 'لا يلزم تغيير كلمة المرور');
      checkPw(newPw);
      const row = all('SELECT password FROM users WHERE id = ?', [me.id])[0];
      need(!(await verifyPw(newPw, row.password)).ok, 'اختر كلمة مرور مختلفة عن المؤقتة');
      run('UPDATE users SET password = ?, must_change = 0 WHERE id = ?', [await hashPw(newPw), me.id]);
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
    nextEmpNo: () => 'EMP-' + String(seqNext('seq_employees', 'employees', 'emp_no')).padStart(4, '0'),
    // يعيد { accountCreated: اسم المستخدم } عند إنشاء حساب الدخول تلقائياً
    async saveEmployee(e) {
      const actor = this.currentUser();
      need(canHr(actor), NO_HR);
      const f = {};
      for (const k of ['empNo', 'name', 'nameEn', 'nationalId', 'gender', 'birthDate', 'birthPlace', 'nationality', 'marital', 'phone', 'email', 'address',
        'empType', 'hireDate', 'status', 'emergencyName', 'emergencyPhone', 'notes']) f[k] = trim(e[k]);
      need(f.name.length >= 3, 'أدخل الاسم الكامل للموظف');
      need(!f.nameEn || /^[A-Za-z][A-Za-z .'-]{2,}$/.test(f.nameEn), 'الاسم بالإنجليزية يجب أن يكون بأحرف إنجليزية فقط');
      need(!f.gender || ['ذكر', 'أنثى'].includes(f.gender), 'اختر الجنس');
      need(!f.nationalId || /^[0-9A-Za-z-]{6,20}$/.test(f.nationalId), 'رقم الهوية يجب أن يكون من 6 إلى 20 خانة');
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
      const id = e.id || null;
      let userId = trim(e.userId) || null;
      // رقم الموظف تلقائي: يُولَّد عند الإضافة ولا يتغير بالتعديل
      if (id) { f.empNo = all('SELECT emp_no FROM employees WHERE id = ?', [id])[0]?.emp_no; need(f.empNo, 'الموظف غير موجود'); }
      else f.empNo = this.nextEmpNo();
      if (userId) {
        need(all('SELECT 1 FROM users WHERE id = ?', [userId]).length, 'حساب الدخول غير موجود');
        const used = all('SELECT id FROM employees WHERE user_id = ?', [userId])[0];
        need(!used || used.id === id, 'هذا الحساب مرتبط بموظف آخر');
      }
      need(isAdmin(actor) || (userId !== actor.id && !ownsEmployee(actor, id)), SELF_HR);
      // القسم والمسمى الوظيفي من الأدلة (يُحفظ اسمهما أيضاً للعرض والتصدير)
      const departmentId = trim(e.departmentId) || null, jobTitleId = trim(e.jobTitleId) || null, managerId = trim(e.managerId) || null;
      f.department = ''; f.jobTitle = '';
      // الحقول الإلزامية: عند الإضافة كلها مطلوبة، وعند التعديل لا تُفرَّغ قيمة كانت موجودة (الملفات القديمة الناقصة لا تُجبَر على الاكتمال)
      const prev = id ? all(`${EMP} WHERE id = ?`, [id])[0] : null;
      const req = (value, prevValue, msg) => need(value || (prev && !prevValue), msg);
      req(f.nameEn, prev?.nameEn, 'أدخل الاسم بالإنجليزية');
      req(f.birthDate, prev?.birthDate, 'أدخل تاريخ الميلاد');
      req(f.nationalId, prev?.nationalId, 'أدخل رقم الهوية');
      req(f.gender, prev?.gender, 'اختر الجنس');
      req(departmentId, prev?.departmentId, 'اختر القسم');
      req(jobTitleId, prev?.jobTitleId, 'اختر المسمى الوظيفي');
      req(f.hireDate, prev?.hireDate, 'أدخل تاريخ التعيين');
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
      if (f.nationalId) {
        const dupId = all('SELECT id FROM employees WHERE national_id = ?', [f.nationalId])[0];
        need(!dupId || dupId.id === id, 'رقم الهوية مسجّل لموظف آخر');
      }
      const extras = this._cleanExtras(e); // مؤهلات ودورات وخبرات ومرفقات (تُتحقق قبل أي كتابة)
      // حساب دخول تلقائي: اسم المستخدم وكلمة المرور المؤقتة = رقم الهوية، ويُطلب تغييرها عند أول دخول
      let newUser = null;
      if (e.createAccount && !userId) {
        need(f.nationalId.length >= 6, 'رقم الهوية (6 خانات على الأقل) مطلوب لإنشاء حساب الدخول');
        need(!all('SELECT 1 FROM users WHERE username = ?', [f.nationalId])[0], 'يوجد حساب بنفس رقم الهوية مسبقاً');
        newUser = { id: uid(), hash: await hashPw(f.nationalId) };
        userId = newUser.id;
      }
      const now = new Date().toISOString();
      if (newUser) run("INSERT INTO users (id, username, password, name, role, must_change) VALUES (?,?,?,?,'employee',1)", [newUser.id, f.nationalId, newUser.hash, f.name]);
      const empId = id || uid();
      const vals = [f.empNo, f.name, f.nationalId || null, f.gender, f.birthDate, f.nationality, f.marital, f.phone, f.email, f.address,
        f.department, f.jobTitle, f.empType, f.hireDate, salary, f.status, f.emergencyName, f.emergencyPhone, f.notes, userId, departmentId, jobTitleId, managerId, f.nameEn, f.birthPlace];
      if (id) run(`UPDATE employees SET emp_no=?, name=?, national_id=?, gender=?, birth_date=?, nationality=?, marital=?, phone=?, email=?, address=?,
        department=?, job_title=?, emp_type=?, hire_date=?, salary=?, status=?, emergency_name=?, emergency_phone=?, notes=?, user_id=?, department_id=?, job_title_id=?, manager_id=?, name_en=?, birth_place=?, updated_at=? WHERE id=?`, [...vals, now, id]);
      else run(`INSERT INTO employees (emp_no, name, national_id, gender, birth_date, nationality, marital, phone, email, address, department, job_title,
        emp_type, hire_date, salary, status, emergency_name, emergency_phone, notes, user_id, department_id, job_title_id, manager_id, name_en, birth_place, id, created_at, updated_at) VALUES (${'?,'.repeat(27)}?)`, [...vals, empId, now, now]);
      if (!id) seqCommit('seq_employees', Number(f.empNo.match(/\d+$/)[0]));
      this._writeExtras(empId, extras, now);
      await persist();
      return { accountCreated: newUser ? f.nationalId : null };
    },
    deleteEmployee(id) {
      const actor = this.currentUser();
      need(canHr(actor), NO_HR);
      need(isAdmin(actor) || !ownsEmployee(actor, id), SELF_HR);
      for (const t of ['contracts', 'qualifications', 'courses', 'experiences', 'documents']) run(`DELETE FROM ${t} WHERE employee_id = ?`, [id]);
      run('UPDATE employees SET manager_id = NULL WHERE manager_id = ?', [id]); // مرؤوسوه بلا رئيس حتى يُسند لهم غيره
      run('UPDATE departments SET manager_id = NULL WHERE manager_id = ?', [id]);
      run('DELETE FROM employees WHERE id = ?', [id]);
      return persist();
    },


    // ---------- المؤهلات والدورات والخبرات والمرفقات ----------
    // يتحقق من القوائم المرسلة ويعيدها منظفة (غير المرسلة = لا تغيير). الصفوف الفارغة تماماً تُتجاهل.
    _cleanExtras(e) {
      const blank = (o, keys) => keys.every(k => trim(o[k]) === '') && !o.file;
      const date = (v, msg) => need(/^\d{4}-\d\d-\d\d$/.test(v), msg);
      const out = {};
      if (Array.isArray(e.qualifications)) {
        const year = new Date().getFullYear();
        out.qualifications = e.qualifications.filter(q => !blank(q, ['degree', 'major', 'university', 'gradYear', 'gpa'])).map((q, i) => {
          const n = `المؤهل ${i + 1}`, r = { id: q.id || null, degree: trim(q.degree), major: trim(q.major), university: trim(q.university), gradYear: Number(q.gradYear), gpa: Number(q.gpa) };
          need(r.degree, `${n}: اختر المؤهل العلمي`); need(r.major, `${n}: أدخل التخصص`); need(r.university, `${n}: أدخل الجامعة`);
          need(Number.isInteger(r.gradYear) && r.gradYear >= 1950 && r.gradYear <= year + 1, `${n}: سنة التخرج غير صحيحة`);
          need(trim(q.gpa) !== '' && Number.isFinite(r.gpa) && r.gpa > 0 && r.gpa <= 100, `${n}: المعدل يجب أن يكون رقماً بين 0 و100`);
          r.file = q.file ? checkFile(q.file, `${n} (مرفق)`) : null; r.removeDoc = !!q.removeDoc;
          return r;
        });
      }
      if (Array.isArray(e.courses)) {
        out.courses = e.courses.filter(c => !blank(c, ['name', 'hours', 'from', 'to', 'organizer'])).map((c, i) => {
          const n = `الدورة ${i + 1}`, r = { id: c.id || null, name: trim(c.name), hours: Number(c.hours), from: trim(c.from), to: trim(c.to), organizer: trim(c.organizer) };
          need(r.name, `${n}: أدخل اسم الدورة`);
          need(trim(c.hours) !== '' && Number.isFinite(r.hours) && r.hours > 0, `${n}: عدد الساعات يجب أن يكون أكبر من صفر`);
          date(r.from, `${n}: أدخل تاريخ البداية`); date(r.to, `${n}: أدخل تاريخ النهاية`);
          need(r.to >= r.from, `${n}: تاريخ النهاية يجب ألا يسبق البداية`);
          need(r.organizer, `${n}: أدخل الجهة المنظمة`);
          return r;
        });
      }
      if (Array.isArray(e.experiences)) {
        out.experiences = e.experiences.filter(x => !blank(x, ['employer', 'jobTitle', 'from', 'to'])).map((x, i) => {
          const n = `الخبرة ${i + 1}`, r = { id: x.id || null, employer: trim(x.employer), jobTitle: trim(x.jobTitle), from: trim(x.from), to: trim(x.to) };
          need(r.employer, `${n}: أدخل اسم الجهة`); need(r.jobTitle, `${n}: أدخل المسمى الوظيفي`);
          date(r.from, `${n}: أدخل تاريخ البداية`);
          need(!r.to || (/^\d{4}-\d\d-\d\d$/.test(r.to) && r.to >= r.from), `${n}: تاريخ النهاية يجب ألا يسبق البداية`); // فارغ = حتى الآن
          return r;
        });
      }
      if (e.idDoc) out.idDoc = { file: e.idDoc.file ? checkFile(e.idDoc.file, 'صورة الهوية') : null, remove: !!e.idDoc.remove };
      return out;
    },
    _writeExtras(empId, x, now) {
      const putDoc = (kind, refId, f) => run('INSERT INTO documents (id, employee_id, kind, ref_id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [uid(), empId, kind, refId, f.name, f.mime, f.data.length, f.data, now]);
      const dropDoc = (kind, refId) => run('DELETE FROM documents WHERE employee_id = ? AND kind = ? AND ref_id IS ?', [empId, kind, refId]);
      // يزامن جدولاً فرعياً مع القائمة المرسلة: يحدّث الموجود ويضيف الجديد ويحذف ما حُذف من النموذج
      const reconcile = (table, rows, write, after) => {
        const have = new Set(all(`SELECT id FROM ${table} WHERE employee_id = ?`, [empId]).map(r => r.id)), keep = new Set();
        for (const r of rows) {
          const upd = !!(r.id && have.has(r.id)), rid = upd ? r.id : uid();
          keep.add(rid); write(rid, upd, r); if (after) after(rid, r);
        }
        have.forEach(rid => { if (!keep.has(rid)) { run(`DELETE FROM ${table} WHERE id = ?`, [rid]); if (table === 'qualifications') dropDoc('qualification', rid); } });
      };
      if (x.qualifications) reconcile('qualifications', x.qualifications,
        (rid, upd, q) => upd ? run('UPDATE qualifications SET degree=?, major=?, university=?, grad_year=?, gpa=? WHERE id=?', [q.degree, q.major, q.university, q.gradYear, q.gpa, rid])
          : run('INSERT INTO qualifications (id, employee_id, degree, major, university, grad_year, gpa) VALUES (?,?,?,?,?,?,?)', [rid, empId, q.degree, q.major, q.university, q.gradYear, q.gpa]),
        (rid, q) => { if (q.file) { dropDoc('qualification', rid); putDoc('qualification', rid, q.file); } else if (q.removeDoc) dropDoc('qualification', rid); });
      if (x.courses) reconcile('courses', x.courses,
        (rid, upd, c) => upd ? run('UPDATE courses SET name=?, hours=?, from_date=?, to_date=?, organizer=? WHERE id=?', [c.name, c.hours, c.from, c.to, c.organizer, rid])
          : run('INSERT INTO courses (id, employee_id, name, hours, from_date, to_date, organizer) VALUES (?,?,?,?,?,?,?)', [rid, empId, c.name, c.hours, c.from, c.to, c.organizer]));
      if (x.experiences) reconcile('experiences', x.experiences,
        (rid, upd, r) => upd ? run('UPDATE experiences SET employer=?, job_title=?, from_date=?, to_date=? WHERE id=?', [r.employer, r.jobTitle, r.from, r.to || null, rid])
          : run('INSERT INTO experiences (id, employee_id, employer, job_title, from_date, to_date) VALUES (?,?,?,?,?,?)', [rid, empId, r.employer, r.jobTitle, r.from, r.to || null]));
      if (x.idDoc) { if (x.idDoc.file) { dropDoc('id', null); putDoc('id', null, x.idDoc.file); } else if (x.idDoc.remove) dropDoc('id', null); }
    },
    // ملف الموظف التفصيلي: مؤهلات ودورات وخبرات وبيانات المرفقات (بدون محتواها)
    employeeDetails(id) {
      need(canHr(this.currentUser()), NO_HR);
      return {
        qualifications: all('SELECT id, degree, major, university, grad_year AS gradYear, gpa FROM qualifications WHERE employee_id = ? ORDER BY grad_year DESC', [id]),
        courses: all('SELECT id, name, hours, from_date AS "from", to_date AS "to", organizer FROM courses WHERE employee_id = ? ORDER BY from_date DESC', [id]),
        experiences: all('SELECT id, employer, job_title AS jobTitle, from_date AS "from", to_date AS "to" FROM experiences WHERE employee_id = ? ORDER BY from_date DESC', [id]),
        docs: all('SELECT id, kind, ref_id AS refId, name, mime, size FROM documents WHERE employee_id = ?', [id]),
      };
    },
    getDocument(id) { // رابط تحميل المرفق
      need(canHr(this.currentUser()), NO_HR);
      const r = all('SELECT name, mime, data FROM documents WHERE id = ?', [id])[0];
      need(r, 'المرفق غير موجود');
      return { name: r.name, blob: new Blob([r.data], { type: r.mime }) };
    },

    // ---------- العقود ----------
    contractTypes: CONTRACT_TYPES, payBases: PAY_BASES, currencies: CURRENCIES,
    // بيانات مستند العقد للطباعة: للموارد البشرية أو لصاحب العقد نفسه
    contractDocument(id) {
      const me = this.currentUser();
      need(me && !me.mustChange, MUST_CHANGE);
      const c = all(`${CONTRACT} WHERE id = ?`, [id])[0];
      need(c, 'العقد غير موجود');
      const e = all(`${EMP} WHERE id = ?`, [c.employeeId])[0];
      need(canHr(me) || (e && e.userId === me.id), NO_HR);
      const grade = c.gradeId ? all('SELECT code, name, min_salary AS min, max_salary AS max, increment FROM salary_grades WHERE id = ?', [c.gradeId])[0] || null : null;
      const sup = c.supervisorId ? all('SELECT name, name_en AS nameEn FROM employees WHERE id = ?', [c.supervisorId])[0] || null : null;
      const dept = e?.departmentId ? all('SELECT name FROM departments WHERE id = ?', [e.departmentId])[0]?.name || '' : '';
      return { contract: c, employee: e, grade, supervisor: sup, department: dept, org: cfg.orgName, terms: cfg.contractTerms,
        workStart: cfg.workStart, workEnd: cfg.workEnd, currencyLabel: CURRENCIES[c.currency] || c.currency, status: this.contractStatus(c) };
    },
    contracts() { need(canHr(this.currentUser()), NO_HR); return all(`${CONTRACT} ORDER BY start_date DESC, contract_no DESC`); },
    nextContractNo: () => 'CNT-' + String(seqNext('seq_contracts', 'contracts', 'contract_no')).padStart(4, '0'),
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
    async saveContract(c) {
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
      // رقم العقد تلقائي: يُولَّد عند الإضافة ولا يتغير بالتعديل
      let no;
      if (id) { no = all('SELECT contract_no FROM contracts WHERE id = ?', [id])[0]?.contract_no; need(no, 'العقد غير موجود'); }
      else no = this.nextContractNo();
      if (status === 'active') { // لا يتداخل عقدان ساريان لنفس الموظف
        const clash = all("SELECT id FROM contracts WHERE employee_id = ? AND status = 'active' AND id != ? AND start_date <= ? AND COALESCE(end_date, ?) >= ?",
          [empId, id || '', end || FAR, FAR, start])[0];
        need(!clash, 'يتداخل هذا العقد مع عقد آخر ساري لنفس الموظف');
      }
      // تاريخ التحرير والعملة
      const issue = trim(c.issueDate) || dateKey(new Date());
      need(/^\d{4}-\d\d-\d\d$/.test(issue), 'تاريخ تحرير العقد غير صحيح');
      const currency = trim(c.currency) || cfg.currency;
      need(CURRENCIES[currency], 'اختر عملة صحيحة');
      // سلم الرواتب (للعقود الشهرية): الدرجة والخطوة
      let gradeId = null, gradeStep = null;
      if (payBasis === 'monthly' && trim(c.gradeId)) {
        gradeId = trim(c.gradeId);
        const g = all('SELECT min_salary AS min, max_salary AS max, increment FROM salary_grades WHERE id = ?', [gradeId])[0];
        need(g, 'الدرجة غير موجودة');
        if (trim(c.gradeStep) !== '') {
          gradeStep = Number(c.gradeStep);
          need(Number.isInteger(gradeStep) && gradeStep >= 1, 'رقم الخطوة يجب أن يكون عدداً صحيحاً موجباً');
          need(!g.increment || gradeStep <= Math.floor((g.max - g.min) / g.increment) + 1, 'الخطوة تتجاوز عدد خطوات الدرجة');
        }
      }
      // بيانات المشروع (لعقود العمال اليوميين والمتطوعين)
      let pr = { code: '', name: '', nameEn: '', supervisor: null, desc: '', descEn: '' };
      if (payBasis !== 'monthly') {
        pr = { code: trim(c.projectCode), name: trim(c.projectName), nameEn: trim(c.projectNameEn), supervisor: trim(c.supervisorId) || null, desc: trim(c.workDesc), descEn: trim(c.workDescEn) };
        need(pr.name, 'أدخل اسم المشروع');
        need(pr.supervisor, 'اختر المشرف');
        const sup = all('SELECT status FROM employees WHERE id = ?', [pr.supervisor])[0];
        need(sup, 'المشرف غير موجود');
        need(pr.supervisor !== empId, 'لا يمكن أن يكون المشرف هو صاحب العقد نفسه');
        need(sup.status !== 'terminated', 'لا يمكن إسناد الإشراف لموظف منتهي الخدمة');
        need(pr.desc, 'أدخل وصف العمل');
      }
      const inclusions = trim(c.inclusions);
      need(inclusions.length <= 2000, 'نص «شمول العقد» طويل جداً');
      const now = new Date().toISOString(), job = trim(c.jobTitle), notes = trim(c.notes);
      const cid = id || uid();
      const extra = [issue, gradeId, gradeStep, currency, pr.code, pr.name, pr.nameEn, pr.supervisor, pr.desc, pr.descEn, inclusions];
      if (id) run(`UPDATE contracts SET contract_no=?, employee_id=?, type=?, pay_basis=?, start_date=?, end_date=?, basic_salary=?, allowances=?, job_title=?, status=?, notes=?,
        issue_date=?, grade_id=?, grade_step=?, currency=?, project_code=?, project_name=?, project_name_en=?, supervisor_id=?, work_desc=?, work_desc_en=?, inclusions=?, updated_at=? WHERE id=?`,
        [no, empId, type, payBasis, start, end || null, basic, allow, job, status, notes, ...extra, now, id]);
      else run(`INSERT INTO contracts (id, contract_no, employee_id, type, pay_basis, start_date, end_date, basic_salary, allowances, job_title, status, notes,
        issue_date, grade_id, grade_step, currency, project_code, project_name, project_name_en, supervisor_id, work_desc, work_desc_en, inclusions, created_at, updated_at) VALUES (${'?,'.repeat(24)}?)`,
        [cid, no, empId, type, payBasis, start, end || null, basic, allow, job, status, notes, ...extra, now, now]);
      if (!id) seqCommit('seq_contracts', Number(no.match(/\d+$/)[0]));
      await persist();
      return { id: cid };
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

    // ---------- أهلية تسجيل الحضور: لا حضور بدون عقد ساري ----------
    // الحساب غير المرتبط بملف موظف مستثنى إن كان مديراً (حساب إدارة النظام)
    // يعيد { ok, contract? , exempt? } أو { ok:false, code, date? } مع سبب الرفض
    attendanceEligibility(userId, date = dateKey(new Date())) {
      const u = all('SELECT role FROM users WHERE id = ?', [userId])[0];
      const emp = all('SELECT id FROM employees WHERE user_id = ?', [userId])[0];
      if (!emp) return u?.role === 'admin' ? { ok: true, exempt: true } : { ok: false, code: 'no_employee' };
      const cs = all(`${CONTRACT} WHERE employee_id = ? ORDER BY start_date DESC`, [emp.id]);
      if (!cs.length) return { ok: false, code: 'no_contract' };
      const valid = cs.find(c => c.status === 'active' && c.startDate <= date && (!c.endDate || c.endDate >= date));
      if (valid) return { ok: true, contract: valid };
      const live = cs.filter(c => c.status === 'active');
      const upcoming = live.filter(c => c.startDate > date).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      if (upcoming) return { ok: false, code: 'upcoming', date: upcoming.startDate };
      if (live.length) return { ok: false, code: 'expired', date: live.map(c => c.endDate).sort().pop() };
      return { ok: false, code: 'cancelled' };
    },
    // نص السبب: self=true بصيغة المخاطَب (الموظف نفسه)، وإلا بصيغة الغائب (للموارد البشرية)
    eligibilityReason(el, self) {
      const who = self ? 'عقدك' : 'عقد الموظف';
      return ({
        no_employee: self ? 'حسابك غير مرتبط بملف موظف' : 'الحساب غير مرتبط بملف موظف',
        no_contract: self ? 'لا يوجد عقد مرتبط بحسابك' : 'لا يوجد عقد للموظف',
        upcoming: `يبدأ ${who} في ${el.date}`,
        expired: `انتهى ${who} في ${el.date}`,
        cancelled: `${who} ملغى`,
      })[el.code] || '';
    },
    // عقود الموظف المرتبط بالحساب الحالي (للعرض لصاحبه، بلا حاجة لصلاحية الموارد البشرية)
    myContracts() {
      const me = this.currentUser();
      if (!me || me.mustChange) return [];
      const emp = all('SELECT id FROM employees WHERE user_id = ?', [me.id])[0];
      return emp ? all(`${CONTRACT} WHERE employee_id = ? ORDER BY start_date DESC`, [emp.id]) : [];
    },

    // ---------- الحضور ----------
    todayRecord: userId => all(`${REC} WHERE user_id = ? AND date = ?`, [userId, dateKey(new Date())])[0] || null,
    checkIn(userId) {
      need(!this.currentUser()?.mustChange, MUST_CHANGE);
      need(!this.todayRecord(userId), 'تم تسجيل الحضور اليوم مسبقاً');
      const el = this.attendanceEligibility(userId);
      need(el.ok, `لا يمكن تسجيل الحضور: ${this.eligibilityReason(el, this.currentUser()?.id === userId)}. تواصل مع الموارد البشرية`);
      const now = new Date();
      run('INSERT INTO records (id, user_id, date, check_in) VALUES (?,?,?,?)', [uid(), userId, dateKey(now), now.toISOString()]);
      return persist();
    },
    checkOut(userId) {
      need(!this.currentUser()?.mustChange, MUST_CHANGE);
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
      const el = this.attendanceEligibility(userId, date);
      need(el.ok, `لا يمكن حفظ سجل حضور بتاريخ ${date}: ${this.eligibilityReason(el, false)}`);
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

    // ---------- بيانات تجريبية (للمدير): تُحمَّل وتُحذف دون المساس ببيانات حقيقية ----------
    // كل صف تنشئه الدالة معرّفه يبدأ بـ demo_ ، فيُحذف بدقة. الأدلة الموجودة بالاسم نفسه تُستخدم ولا تُحذف.
    demoStatus() {
      const loaded = !!all("SELECT 1 FROM settings WHERE key = 'demo_loaded'")[0];
      const n = (t, col = 'id') => all(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} LIKE 'demo_%'`)[0].n;
      return { loaded, counts: loaded ? { employees: n('employees'), contracts: n('contracts'), accounts: n('users'), records: n('records') } : null,
        accounts: loaded ? all("SELECT username, name, role, can_hr AS canHr FROM users WHERE id LIKE 'demo_u_%' ORDER BY name") : [] };
    },
    async loadDemoData() {
      need(isAdmin(this.currentUser()), ADMIN_ONLY);
      need(!this.demoStatus().loaded, 'البيانات التجريبية محمّلة بالفعل. احذفها أولاً لإعادة التحميل');
      const today = dateKey(new Date()), rel = n => { const d = new Date(); d.setDate(d.getDate() + n); return dateKey(d); };
      const iso = new Date().toISOString(), D = 'demo_';
      const pwHash = await hashPw('demo1234');
      db.exec('BEGIN'); // معاملة واحدة: عند أي خطأ لا يبقى شيء
      try {
      // ----- أدلة: إعادة استخدام ما له الاسم نفسه -----
      const ensure = (table, name, insert) => { const r = all(`SELECT id FROM ${table} WHERE name = ?`, [name])[0]; if (r) return r.id; const id = D + uid(); insert(id); return id; };
      const grade = {};
      [['المستوى الأول', 2500, 3500, 100], ['المستوى الثاني', 3500, 5000, 150], ['المستوى الثالث', 5000, 7500, 250], ['المستوى الرابع', 7500, 10500, 300], ['المستوى الخامس', 10500, 15000, 450]].forEach(([name, min, max, inc], i) => {
        grade[i + 1] = ensure('salary_grades', name, id => run('INSERT INTO salary_grades (id, code, name, min_salary, max_salary, increment, notes) VALUES (?,?,?,?,?,?,?)', [id, nextCode('salary_grades', 'GR'), name, min, max, inc, 'درجة تجريبية']));
      });
      const gradeRow = i => all('SELECT min_salary AS min, increment AS inc FROM salary_grades WHERE id = ?', [grade[i]])[0];
      const dept = {};
      [['gm', 'الإدارة العامة', null], ['hr', 'الموارد البشرية', 'gm'], ['fin', 'الشؤون المالية', 'gm'], ['it', 'تقنية المعلومات', 'gm'], ['prj', 'المشاريع', 'gm'], ['ops', 'العمليات والخدمات', 'gm']].forEach(([k, name, parent]) => {
        dept[k] = ensure('departments', name, id => run('INSERT INTO departments (id, code, name, parent_id, manager_id, notes) VALUES (?,?,?,?,NULL,?)', [id, nextCode('departments', 'DEP'), name, parent ? dept[parent] : null, 'قسم تجريبي']));
      });
      const title = {};
      [['مدير عام', 5], ['مدير إدارة', 4], ['مسؤول موارد بشرية', 3], ['محاسب', 3], ['محاسب مساعد', 2], ['مطور برمجيات', 3], ['مهندس شبكات', 3], ['منسق مشاريع', 3], ['مشرف ميداني', 2], ['عامل مياومة', 1], ['متطوع ميداني', 1]].forEach(([name, g]) => {
        title[name] = ensure('job_titles', name, id => run('INSERT INTO job_titles (id, code, name, grade_id, description, active) VALUES (?,?,?,?,?,1)', [id, nextCode('job_titles', 'JOB'), name, grade[g], 'مسمى تجريبي']));
      });
      // ----- الموظفون: [مفتاح، الاسم، English، الجنس، الميلاد، مكان الميلاد، القسم، المسمى، المدير، التعيين، الحالة، النوع، حساب] -----
      const E = [
        ['salim', 'د. سليم حسن الأغا', 'Dr. Salim Hassan Alagha', 'ذكر', '1974-05-12', 'غزة', 'gm', 'مدير عام', null, rel(-4000), 'active', 'دوام كامل', 'salim'],
        ['huda', 'هدى خالد النجار', 'Huda Khaled Alnajjar', 'أنثى', '1982-09-03', 'غزة', 'hr', 'مدير إدارة', 'salim', rel(-3200), 'active', 'دوام كامل', null],
        ['rami', 'رامي يوسف عودة', 'Rami Yousef Odeh', 'ذكر', '1980-02-21', 'خان يونس', 'fin', 'مدير إدارة', 'salim', rel(-2900), 'active', 'دوام كامل', null],
        ['ahmed', 'أحمد محمد سالم', 'Ahmed Mohammed Salem', 'ذكر', '1992-11-30', 'غزة', 'fin', 'محاسب', 'rami', rel(-520), 'active', 'دوام كامل', 'ahmed'],
        ['laila', 'ليلى عبد الله شحادة', 'Laila Abdullah Shehadeh', 'أنثى', '1998-04-17', 'رفح', 'fin', 'محاسب مساعد', 'rami', rel(-210), 'active', 'دوام كامل', 'laila'],
        ['karim', 'كريم ناصر الخطيب', 'Karim Nasser Alkhatib', 'ذكر', '1985-07-08', 'غزة', 'it', 'مدير إدارة', 'salim', rel(-1800), 'active', 'دوام كامل', null],
        ['sara', 'سارة محمود أبو شمالة', 'Sara Mahmoud Abu Shamala', 'أنثى', '1996-01-25', 'دير البلح', 'it', 'مطور برمجيات', 'karim', rel(-900), 'leave', 'دوام كامل', 'sara'],
        ['omar', 'عمر فؤاد الريس', 'Omar Fouad Alrayes', 'ذكر', '1994-12-02', 'غزة', 'it', 'مهندس شبكات', 'karim', rel(-65), 'active', 'دوام كامل', null],
        ['dina', 'دينا إبراهيم مطر', 'Dina Ibrahim Matar', 'أنثى', '1983-03-14', 'جباليا', 'prj', 'مدير إدارة', 'salim', rel(-2400), 'active', 'دوام كامل', null],
        ['yousef', 'يوسف أنور حمدان', 'Yousef Anwar Hamdan', 'ذكر', '1991-06-19', 'غزة', 'prj', 'منسق مشاريع', 'dina', rel(-130), 'active', 'عقد', 'yousef'],
        ['mona', 'منى سامي القدوة', 'Mona Sami Alqudwa', 'أنثى', '1995-08-27', 'خان يونس', 'prj', 'مشرف ميداني', 'dina', rel(-35), 'active', 'عقد', 'mona'],
        ['tareq', 'طارق جمال الشوا', 'Tareq Jamal Alshawa', 'ذكر', '1988-10-05', 'غزة', 'ops', 'مشرف ميداني', 'salim', rel(-1500), 'active', 'دوام كامل', null],
        ['nadine', 'نادين أحمد عاشور', 'Nadine Ahmed Ashour', 'أنثى', '1993-05-09', 'غزة', 'hr', 'مسؤول موارد بشرية', 'huda', rel(-1100), 'active', 'دوام كامل', 'hr.demo'],
        ['mohammed', 'محمد سعيد البنا', 'Mohammed Saeed Albanna', 'ذكر', '1990-01-15', 'رفح', 'ops', 'عامل مياومة', 'tareq', rel(-20), 'active', 'عقد', null],
        ['ismail', 'إسماعيل رائد أبو عمرو', 'Ismail Raed Abu Amro', 'ذكر', '1997-09-22', 'بيت لاهيا', 'ops', 'عامل مياومة', 'tareq', rel(-5), 'active', 'عقد', null],
        ['aya', 'آية سعيد قنديل', 'Aya Saeed Qandeel', 'أنثى', '2000-03-30', 'غزة', 'prj', 'متطوع ميداني', 'mona', rel(-15), 'active', 'متدرب', 'aya'],
        ['jamil', 'جميل حسام الدين', 'Jamil Hossam Aldeen', 'ذكر', '1987-02-11', 'غزة', 'fin', 'محاسب', 'rami', rel(-700), 'terminated', 'دوام كامل', null],
      ];
      const QUAL = { salim: [['دكتوراه', 'إدارة أعمال', 'جامعة القاهرة', 2008, 88]], huda: [['ماجستير', 'إدارة موارد بشرية', 'الجامعة الإسلامية', 2014, 85]], rami: [['بكالوريوس', 'محاسبة', 'جامعة الأزهر', 2005, 82.5]],
        ahmed: [['بكالوريوس', 'محاسبة', 'جامعة الأقصى', 2014, 79]], laila: [['دبلوم', 'محاسبة', 'كلية فلسطين التقنية', 2019, 84]], karim: [['ماجستير', 'هندسة حاسوب', 'الجامعة الإسلامية', 2012, 87]],
        sara: [['بكالوريوس', 'علوم حاسوب', 'جامعة الأزهر', 2018, 91]], omar: [['بكالوريوس', 'هندسة اتصالات', 'جامعة الأقصى', 2017, 80]], dina: [['ماجستير', 'إدارة مشاريع', 'جامعة بيرزيت', 2012, 89]],
        yousef: [['بكالوريوس', 'هندسة مدنية', 'جامعة الأزهر', 2014, 83]], mona: [['بكالوريوس', 'خدمة اجتماعية', 'جامعة الأقصى', 2017, 78]], tareq: [['دبلوم', 'إدارة أعمال', 'كلية فلسطين التقنية', 2008, 75]],
        nadine: [['بكالوريوس', 'إدارة أعمال', 'الجامعة الإسلامية', 2015, 81]], mohammed: [['ثانوية عامة', 'علمي', 'مدرسة الشهيد', 2008, 70]], ismail: [['ثانوية عامة', 'أدبي', 'مدرسة الكرامة', 2015, 66]],
        aya: [['بكالوريوس', 'هندسة زراعية', 'جامعة الأقصى', 2022, 86]], jamil: [['بكالوريوس', 'محاسبة', 'جامعة الأزهر', 2010, 77]] };
      const COURSE = { ahmed: [['محاسبة متقدمة', 30, '2021-03-07', '2021-03-11', 'معهد الإدارة'], ['Excel للمحاسبين', 16, '2022-01-09', '2022-01-12', 'Microsoft Learning']], sara: [['تطوير تطبيقات الويب', 40, '2022-06-05', '2022-06-16', 'أكاديمية البرمجة']],
        yousef: [['إدارة المشاريع PMP', 35, '2021-11-01', '2021-11-10', 'PMI Chapter']], nadine: [['قانون العمل', 24, '2020-02-02', '2020-02-05', 'نقابة المحامين']], karim: [['أمن الشبكات', 32, '2019-04-14', '2019-04-20', 'Cisco Academy']] };
      const EXP = { ahmed: [['شركة الأفق للتجارة', 'محاسب', '2015-01-01', '2020-12-31']], karim: [['شركة جوال للاتصالات', 'مهندس شبكات', '2012-03-01', '2017-06-30']], dina: [['مؤسسة التنمية المجتمعية', 'منسق برامج', '2013-01-01', '2018-12-31']],
        rami: [['مكتب الخبرة للتدقيق', 'مدقق حسابات', '2006-01-01', '2013-12-31']], sara: [['شركة سوفت لاين', 'مطور مبتدئ', '2019-01-01', '2021-12-31']], salim: [['جامعة الأزهر', 'محاضر', '2008-09-01', '2014-08-31']] };
      // ----- أرقام تلقائية متسلسلة لا تتعارض مع الموجود -----
      let empSeq = seqNext('seq_employees', 'employees', 'emp_no') - 1, ctSeq = seqNext('seq_contracts', 'contracts', 'contract_no') - 1;
      const emp = {}; let nid = 4000000;
      for (const [k, name, nameEn, gender, birth, place, d, t] of E) {
        const nat = String(++nid).padStart(9, '0');
        need(!all('SELECT 1 FROM employees WHERE national_id = ?', [nat])[0], `رقم هوية تجريبي ${nat} مستخدم مسبقاً`);
        emp[k] = { id: D + 'e_' + k, no: `EMP-${String(++empSeq).padStart(4, '0')}`, nat };
      }
      // ----- حسابات الدخول -----
      const accountOf = {}, hasUser = id => !!all('SELECT 1 FROM users WHERE id = ?', [id])[0];
      for (const row of E) {
        const [k, name, , , , , , , , , , , acct] = row; if (!acct) continue;
        if (acct === 'ahmed') { // حساب ahmed التجريبي الأصلي إن وُجد ولم يرتبط بملف
          if (hasUser('u_ahmed') && !all("SELECT 1 FROM employees WHERE user_id = 'u_ahmed'")[0]) accountOf[k] = 'u_ahmed';
          continue;
        }
        need(!all('SELECT 1 FROM users WHERE username = ?', [acct])[0], `اسم المستخدم التجريبي «${acct}» مستخدم مسبقاً`);
        accountOf[k] = D + 'u_' + acct;
        run('INSERT INTO users (id, username, password, name, role, can_edit, can_hr, must_change) VALUES (?,?,?,?,?,?,?,0)', [accountOf[k], acct, pwHash, name, 'employee', acct === 'hr.demo' ? 1 : 0, acct === 'hr.demo' ? 1 : 0]);
      }
      // ----- ملفات الموظفين -----
      const empCols = 'id, emp_no, name, national_id, gender, birth_date, nationality, marital, phone, email, address, department, job_title, emp_type, hire_date, salary, status, emergency_name, emergency_phone, notes, user_id, department_id, job_title_id, manager_id, name_en, birth_place, created_at, updated_at';
      const deptName = Object.fromEntries(all('SELECT id, name FROM departments').map(r => [r.id, r.name]));
      E.forEach(([k, name, nameEn, gender, birth, place, d, t, mgr, hire, status, type], i) => {
        run(`INSERT INTO employees (${empCols}) VALUES (${'?,'.repeat(27)}?)`, [emp[k].id, emp[k].no, name, emp[k].nat, gender, birth, 'فلسطيني', i % 3 === 0 ? 'أعزب' : 'متزوج',
          '059' + String(7000000 + i * 1111).padStart(7, '0'), `${k}@demo.example`, 'غزة — حي الرمال', deptName[dept[d]], t, type, hire, null, status, 'قريب الموظف', '059' + String(8000000 + i * 777).padStart(7, '0'),
          'بيانات تجريبية', accountOf[k] || null, dept[d], title[t], mgr ? emp[mgr].id : null, nameEn, place, iso, iso]);
      });
      [['gm', 'salim'], ['hr', 'huda'], ['fin', 'rami'], ['it', 'karim'], ['prj', 'dina'], ['ops', 'tareq']].forEach(([d, k]) => { if (dept[d].startsWith(D)) run('UPDATE departments SET manager_id = ? WHERE id = ?', [emp[k].id, dept[d]]); });
      let n = 0;
      for (const [k, list] of Object.entries(QUAL)) list.forEach(([degree, major, uni, year, gpa]) => run('INSERT INTO qualifications (id, employee_id, degree, major, university, grad_year, gpa) VALUES (?,?,?,?,?,?,?)', [D + 'q' + ++n, emp[k].id, degree, major, uni, year, gpa]));
      for (const [k, list] of Object.entries(COURSE)) list.forEach(([name, hours, from, to, org]) => run('INSERT INTO courses (id, employee_id, name, hours, from_date, to_date, organizer) VALUES (?,?,?,?,?,?,?)', [D + 'c' + ++n, emp[k].id, name, hours, from, to, org]));
      for (const [k, list] of Object.entries(EXP)) list.forEach(([employer, jt, from, to]) => run('INSERT INTO experiences (id, employee_id, employer, job_title, from_date, to_date) VALUES (?,?,?,?,?,?)', [D + 'x' + ++n, emp[k].id, employer, jt, from, to]));
      // مرفقات نموذجية صغيرة (PDF صالح) لتجربة التحميل
      const pdf = text => { const stream = `BT /F1 14 Tf 20 100 Td (${text}) Tj ET`, objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
        let out = '%PDF-1.4\n'; const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
        const xref = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        return new TextEncoder().encode(out); };
      for (const [k, nameEn, kind, ref] of [['salim', 'Dr. Salim Hassan Alagha', 'id', null], ['ahmed', 'Ahmed Mohammed Salem', 'id', null]]) {
        const f = pdf(`Demo ID document - ${nameEn}`); run('INSERT INTO documents (id, employee_id, kind, ref_id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [D + 'doc' + ++n, emp[k].id, kind, ref, 'id-demo.pdf', 'application/pdf', f.length, f, iso]);
      }
      const qid = all("SELECT id FROM qualifications WHERE employee_id = ?", [emp.ahmed.id])[0].id, qf = pdf('Demo degree certificate - Ahmed Mohammed Salem');
      run('INSERT INTO documents (id, employee_id, kind, ref_id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?,?,?)', [D + 'doc' + ++n, emp.ahmed.id, 'qualification', qid, 'degree-demo.pdf', 'application/pdf', qf.length, qf, iso]);
      // ----- العقود -----
      const ctCols = 'id, contract_no, employee_id, type, pay_basis, start_date, end_date, basic_salary, allowances, job_title, status, notes, issue_date, grade_id, grade_step, currency, project_code, project_name, project_name_en, supervisor_id, work_desc, work_desc_en, inclusions, created_at, updated_at';
      let ctCount = 0;
      const addContract = (k, o) => {
        ctCount++;
        const c = { type: 'دائم', payBasis: 'monthly', end: null, allow: 0, status: 'active', step: null, grade: null, ...o };
        let basic = c.basic;
        if (c.grade) { const g = gradeRow(c.grade); basic = g.min + (c.step - 1) * g.inc; }
        run(`INSERT INTO contracts (${ctCols}) VALUES (${'?,'.repeat(24)}?)`, [D + 'ct_' + ++ctSeq, `CNT-${String(ctSeq).padStart(4, '0')}`, emp[k].id, c.type, c.payBasis, c.start, c.end, c.payBasis === 'volunteer' ? 0 : basic, c.payBasis === 'volunteer' ? 0 : c.allow,
          E.find(e => e[0] === k)[7], c.status, 'عقد تجريبي', c.start, c.grade ? grade[c.grade] : null, c.grade ? c.step : null, 'ILS', c.code || '', c.project || '', c.projectEn || '',
          c.sup ? emp[c.sup].id : null, c.desc || '', c.descEn || '', c.incl || '', iso, iso]);
      };
      const hire = k => E.find(e => e[0] === k)[9];
      addContract('salim', { grade: 5, step: 6, allow: 1500, start: hire('salim'), incl: 'يشمل العقد التأمين الصحي وبدل الاتصالات.' });
      addContract('huda', { grade: 4, step: 4, allow: 800, start: hire('huda') });
      addContract('rami', { grade: 4, step: 5, allow: 800, type: 'محدد المدة', start: rel(-300), end: rel(65) });
      addContract('ahmed', { grade: 3, step: 3, allow: 400, start: hire('ahmed'), incl: 'يشمل العقد بدل مواصلات شهري.' });
      addContract('laila', { grade: 2, step: 3, allow: 250, type: 'محدد المدة', start: rel(-200), end: rel(20) });
      addContract('karim', { grade: 4, step: 2, allow: 700, start: hire('karim') });
      addContract('sara', { grade: 3, step: 2, allow: 300, start: hire('sara') });
      addContract('omar', { grade: 3, step: 1, allow: 200, type: 'تجريبي', start: rel(-65), end: rel(25) });
      addContract('dina', { grade: 4, step: 5, allow: 800, start: hire('dina') });
      addContract('yousef', { grade: 3, step: 1, allow: 300, type: 'محدد المدة', start: rel(-130), end: rel(235) });
      addContract('mona', { grade: 2, step: 3, allow: 200, type: 'موسمي', start: rel(-35), end: rel(150) });
      addContract('tareq', { grade: 2, step: 1, allow: 200, start: hire('tareq') });
      addContract('nadine', { grade: 3, step: 4, allow: 300, start: hire('nadine') });
      addContract('jamil', { grade: 3, step: 1, allow: 200, type: 'محدد المدة', start: rel(-700), end: rel(-100) });
      addContract('mohammed', { payBasis: 'daily', type: 'محدد المدة', basic: 120, allow: 10, start: rel(-20), end: rel(40), code: 'WASH-2026', project: 'مشروع المياه والصرف الصحي', projectEn: 'WASH Project', sup: 'tareq', desc: 'عامل مياومة', descEn: 'Daily wage worker' });
      addContract('mohammed', { payBasis: 'daily', type: 'محدد المدة', basic: 125, allow: 10, start: rel(41), end: rel(100), code: 'WASH-2026', project: 'مشروع المياه والصرف الصحي', projectEn: 'WASH Project', sup: 'tareq', desc: 'عامل مياومة', descEn: 'Daily wage worker' });
      addContract('ismail', { payBasis: 'daily', type: 'موسمي', basic: 110, allow: 0, start: rel(-5), end: rel(25), code: 'ROAD-2026', project: 'مشروع تأهيل الطرق', projectEn: 'Roads Rehabilitation', sup: 'tareq', desc: 'عامل نظافة وصيانة', descEn: 'Maintenance worker' });
      addContract('aya', { payBasis: 'volunteer', type: 'محدد المدة', start: rel(-15), end: rel(60), code: 'CAMP-2026', project: 'حملة التشجير', projectEn: 'Tree Planting Campaign', sup: 'mona', desc: 'متطوعة ميدانية', descEn: 'Field volunteer', incl: 'يشمل العقد شهادة تطوع وتغطية وجبات.' });
      seqCommit('seq_employees', empSeq); seqCommit('seq_contracts', ctSeq);
      // ----- سجل حضور آخر 3 أسابيع لأصحاب الحسابات (بعقود سارية) -----
      let seed = 20260101; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      let recs = 0;
      for (const k of ['salim', 'nadine', 'ahmed', 'laila', 'yousef', 'aya', 'mona']) {
        const uid2 = accountOf[k]; if (!uid2) continue;
        for (let back = 21; back >= 1; back--) {
          const date = rel(-back);
          if (this.isWeekend(date) || date < hire(k) || rnd() < 0.08) continue;
          const inMin = 470 + Math.floor(rnd() * 80), outMin = 960 + Math.floor(rnd() * 105); // 07:50–09:10 / 16:00–17:45
          const hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
          run('INSERT INTO records (id, user_id, date, check_in, check_out) VALUES (?,?,?,?,?)', [D + 'r' + ++n, uid2, date, localISO(date, hm(inMin)), localISO(date, hm(outMin))]);
          recs++;
        }
      }
      run("INSERT OR REPLACE INTO settings VALUES ('demo_loaded', ?)", [iso]);
      db.exec('COMMIT');
      await persist();
      return { employees: E.length, contracts: ctCount, accounts: Object.keys(accountOf).length, records: recs };
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    },
    async removeDemoData() {
      need(isAdmin(this.currentUser()), ADMIN_ONLY);
      need(this.demoStatus().loaded, 'لا توجد بيانات تجريبية محمّلة');
      for (const t of ['documents', 'qualifications', 'courses', 'experiences', 'contracts']) run(`DELETE FROM ${t} WHERE id LIKE 'demo_%' OR employee_id LIKE 'demo_%'`);
      run("DELETE FROM records WHERE id LIKE 'demo_%'");
      run("UPDATE departments SET manager_id = NULL WHERE manager_id LIKE 'demo_%'");
      run("UPDATE employees SET manager_id = NULL WHERE manager_id LIKE 'demo_%'");
      run("DELETE FROM employees WHERE id LIKE 'demo_%'");
      run("DELETE FROM users WHERE id LIKE 'demo_u_%'");
      run("DELETE FROM departments WHERE id LIKE 'demo_%'");
      run("DELETE FROM job_titles WHERE id LIKE 'demo_%'");
      run("DELETE FROM salary_grades WHERE id LIKE 'demo_%'");
      run("DELETE FROM settings WHERE key = 'demo_loaded'");
      await persist();
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
