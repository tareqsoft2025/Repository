// طبقة التخزين: كل البيانات في localStorage (نسخة تجريبية بدون خادم)
const Store = (() => {
  const LS = window.localStorage;
  const WORK_START = '09:00'; // بعد هذا الوقت يُعتبر الدخول تأخيراً
  const read = (k, d) => { try { return JSON.parse(LS.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => LS.setItem(k, JSON.stringify(v));

  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function seed() {
    if (read('att_users', null)) return;
    write('att_users', [
      { id: 'u_admin', username: 'admin', password: 'admin123', name: 'مدير النظام', role: 'admin' },
      { id: 'u_ahmed', username: 'ahmed', password: '123456', name: 'أحمد محمد', role: 'employee' },
    ]);
    write('att_records', []);
  }
  seed();

  const users = () => read('att_users', []);
  const records = () => read('att_records', []);

  return {
    WORK_START, dateKey, pad,
    users,
    login(username, password) {
      const u = users().find(x => x.username.toLowerCase() === username.trim().toLowerCase() && x.password === password);
      if (!u) return null;
      write('att_session', u.id);
      return u;
    },
    logout() { LS.removeItem('att_session'); },
    currentUser() { const id = read('att_session', null); return users().find(u => u.id === id) || null; },
    addUser({ name, username, password, role }) {
      const list = users();
      if (list.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('اسم المستخدم موجود مسبقاً');
      list.push({ id: uid(), name, username, password, role });
      write('att_users', list);
    },
    todayRecord(userId) {
      const k = dateKey(new Date());
      return records().find(r => r.userId === userId && r.date === k) || null;
    },
    checkIn(userId) {
      if (this.todayRecord(userId)) throw new Error('تم تسجيل الحضور اليوم مسبقاً');
      const now = new Date();
      const all = records();
      all.push({ id: uid(), userId, date: dateKey(now), checkIn: now.toISOString(), checkOut: null });
      write('att_records', all);
    },
    checkOut(userId) {
      const all = records();
      const r = all.find(x => x.userId === userId && x.date === dateKey(new Date()));
      if (!r) throw new Error('لم يتم تسجيل الحضور اليوم');
      if (r.checkOut) throw new Error('تم تسجيل الانصراف مسبقاً');
      r.checkOut = new Date().toISOString();
      write('att_records', all);
    },
    recordsFor(userId, month) { // month = 'YYYY-MM' أو فارغ للكل
      return records().filter(r => r.userId === userId && (!month || r.date.startsWith(month)))
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    recordsOn(date) { return records().filter(r => r.date === date); },
    isLate(rec) {
      const d = new Date(rec.checkIn);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}` > WORK_START;
    },
    hours(rec) {
      if (!rec.checkOut) return 0;
      return (new Date(rec.checkOut) - new Date(rec.checkIn)) / 3600000;
    },
  };
})();
