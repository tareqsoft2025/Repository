<?php
// خادم المزامنة المركزي (نسخة PHP) لنظام شؤون الموظفين وتطبيق بصمة.
// يعمل على أي استضافة PHP 7.4+ مع SQLite (pdo_sqlite). نفس واجهة نسخة Node تماماً.
mb_internal_encoding('UTF-8');

// ---------- الإعدادات ----------
$cfgFile = __DIR__ . '/config.php';
$SETUP_KEY = '';
if (is_file($cfgFile)) require_once $cfgFile;                      // define('HR_SETUP_KEY', '...'); define('HR_DATA_DIR', '/مسار/خارج/public_html');
if (defined('HR_SETUP_KEY')) $SETUP_KEY = HR_SETUP_KEY;

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: authorization, content-type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Cache-Control: no-store');

function out($code, $obj) { http_response_code($code); header('Content-Type: application/json; charset=utf-8'); echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION); if ($code >= 400) echo str_repeat(' ', 600); /* يظهر نص الخطأ في المتصفحات التي تخفي الأخطاء القصيرة */ exit; }
function bad($code, $msg) { out($code, ['error' => $msg]); }
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

// ---------- المسار ----------
$path = $_GET['route'] ?? '';
if ($path === '') { $p = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH); $i = strpos($p, '/api/'); $path = $i !== false ? substr($p, $i + 5) : ''; }
$path = '/api/' . trim($path, '/');
if ($path === '/api/') { header('Content-Type: text/plain; charset=utf-8'); echo 'HR sync server OK'; exit; }
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($SETUP_KEY === '' || strpos($SETUP_KEY, 'CHANGE-ME') === 0) bad(503, 'غيّر HR_SETUP_KEY في ملف config.php أولاً');

// ---------- قاعدة البيانات (خارج المجلد المنشور قدر الإمكان، وباسم غير قابل للتخمين) ----------
$dataDir = defined('HR_DATA_DIR') ? HR_DATA_DIR : '';
if ($dataDir === '') {
  $home = !empty($_SERVER['DOCUMENT_ROOT']) ? dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')) : '';
  $dataDir = ($home && is_dir($home) && is_writable($home)) ? $home . '/hr-data' : __DIR__ . '/data';
}
if (!is_dir($dataDir)) @mkdir($dataDir, 0700, true);
if (!is_dir($dataDir) || !is_writable($dataDir)) bad(500, 'مجلد البيانات غير قابل للكتابة: ' . $dataDir);
@file_put_contents($dataDir . '/.htaccess', "Require all denied\nDeny from all\n");
$dbFile = $dataDir . '/hr-' . substr(hash('sha256', 'db|' . $SETUP_KEY), 0, 20) . '.sqlite';
try {
  $db = new PDO('sqlite:' . $dbFile, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) { bad(500, 'تعذّر فتح قاعدة SQLite: تأكد من تفعيل pdo_sqlite'); }
$db->exec('PRAGMA busy_timeout = 8000; PRAGMA journal_mode = WAL;');
$db->exec("CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY (tbl, id));
  CREATE INDEX IF NOT EXISTS idx_rows_seq ON rows(seq);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS punches (client_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL);");

const TABLES = ['users', 'records', 'settings', 'employees', 'contracts', 'qualifications', 'courses', 'experiences', 'documents', 'salary_grades', 'leave_requests', 'job_titles', 'departments'];
function q($sql, $p = []) { global $db; $s = $db->prepare($sql); $s->execute($p); return $s; }
function meta($k) { $r = q('SELECT value FROM meta WHERE key = ?', [$k])->fetch(); return $r ? $r['value'] : null; }
function setMeta($k, $v) { q('INSERT OR REPLACE INTO meta VALUES (?,?)', [$k, (string)$v]); }
if (meta('serverId') === null) { setMeta('serverId', bin2hex(random_bytes(16))); setMeta('seq', 0); }
$SERVER_ID = meta('serverId');
function jenc($v) { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION); }
function nextSeq() { $n = (int)meta('seq') + 1; setMeta('seq', $n); return $n; }
function getRow($tbl, $id) { $r = q('SELECT data, deleted FROM rows WHERE tbl = ? AND id = ?', [$tbl, $id])->fetch(); return ($r && !$r['deleted']) ? json_decode($r['data'], true) : null; }
function putRow($tbl, $id, $data) { q('INSERT OR REPLACE INTO rows (tbl, id, data, deleted, seq) VALUES (?,?,?,0,?)', [$tbl, $id, jenc($data), nextSeq()]); }
function delRow($tbl, $id) { q('INSERT OR REPLACE INTO rows (tbl, id, data, deleted, seq) VALUES (?,?,NULL,1,?)', [$tbl, $id, nextSeq()]); }
function allRows($tbl) { $o = []; foreach (q('SELECT data FROM rows WHERE tbl = ? AND deleted = 0', [$tbl]) as $r) $o[] = json_decode($r['data'], true); return $o; }
function userCount() { return (int)q("SELECT COUNT(*) AS n FROM rows WHERE tbl = 'users' AND deleted = 0")->fetch()['n']; }
function tx($fn) { global $db; $db->exec('BEGIN IMMEDIATE'); try { $r = $fn(); $db->exec('COMMIT'); return $r; } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; } }

// ---------- كلمات المرور (متوافقة مع المتصفح: pbkdf2$iter$salt$hash) ----------
function verifyPw($pw, $stored) {
  if (!is_string($stored) || $stored === '') return false;
  if (strpos($stored, 'pbkdf2$') !== 0) return hash_equals($stored, $pw);
  list(, $it, $salt, $hash) = array_pad(explode('$', $stored), 4, '');
  $h = base64_encode(hash_pbkdf2('sha256', $pw, base64_decode($salt), (int)$it, 32, true));
  return hash_equals($hash, $h);
}
function hashPw($pw) { $salt = random_bytes(16); return 'pbkdf2$100000$' . base64_encode($salt) . '$' . base64_encode(hash_pbkdf2('sha256', $pw, $salt, 100000, 32, true)); }

// ---------- الجلسات والحدّ من المحاولات ----------
function newSession($uid) { $t = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); q('INSERT INTO sessions VALUES (?,?,?)', [hash('sha256', $t), $uid, (time() + 30 * 86400) * 1000]); return $t; }
function throttled($k) { $r = q('SELECT n, t FROM fails WHERE k = ?', [$k])->fetch(); return $r && $r['n'] >= 8 && (time() - $r['t']) < 600; }
function noteFail($k) { $r = q('SELECT n, t FROM fails WHERE k = ?', [$k])->fetch(); $n = ($r && (time() - $r['t']) < 600) ? $r['n'] + 1 : 1; q('INSERT OR REPLACE INTO fails VALUES (?,?,?)', [$k, $n, time()]); }
function clientIp() { $f = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''; return $f !== '' ? trim(explode(',', $f)[0]) : ($_SERVER['REMOTE_ADDR'] ?? ''); }
function authHeader() { $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''; if ($h === '' && function_exists('getallheaders')) foreach (getallheaders() as $k => $v) if (strtolower($k) === 'authorization') $h = $v; return $h; }
function actorOf() {
  $t = trim(preg_replace('/^Bearer /i', '', authHeader()));
  if ($t === '') bad(401, 'يلزم تسجيل الدخول');
  $s = q('SELECT user_id, expires FROM sessions WHERE hash = ?', [hash('sha256', $t)])->fetch();
  if (!$s || $s['expires'] < time() * 1000) bad(401, 'انتهت الجلسة. سجّل الدخول من جديد');
  $u = getRow('users', $s['user_id']);
  if (!$u || !$u['active']) bad(401, 'الحساب غير فعّال');
  return $u;
}
function isAdmin($u) { return $u['role'] === 'admin' && !$u['must_change']; }
function isHr($u) { return isAdmin($u) || (($u['can_hr'] ?? 0) == 1 && !$u['must_change']); }
function canEdit($u) { return isAdmin($u) || (($u['can_edit'] ?? 0) == 1 && !$u['must_change']); }
function publicUser($u) { return ['id' => $u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'], 'mustChange' => (bool)$u['must_change'], 'canHr' => (bool)($u['can_hr'] ?? 0), 'canEdit' => (bool)($u['can_edit'] ?? 0)]; }
function ownEmployeeId($u) { foreach (allRows('employees') as $e) if (($e['user_id'] ?? null) === $u['id']) return $e['id']; return null; }
function findUserByName($name) { foreach (allRows('users') as $u) if (mb_strtolower((string)$u['username']) === mb_strtolower((string)$name)) return $u; return null; }

// ---------- صلاحيات المزامنة لكل جدول ----------
function readFilter($u, $tbl, $row, $ownEmp) {
  if (isAdmin($u)) return $row;
  if ($tbl === 'users') { if ($row['id'] === $u['id']) return $row; if (isHr($u) || canEdit($u)) { $row['password'] = ''; return $row; } return null; }
  if ($tbl === 'settings') return preg_match('/^(seq_|demo_)/', $row['key']) ? null : $row;
  if (isHr($u)) return $row;
  if ($tbl === 'records' || $tbl === 'employees') return (canEdit($u) || ($row['user_id'] ?? null) === $u['id']) ? $row : null;
  if ($tbl === 'contracts' || $tbl === 'leave_requests') return ($ownEmp && ($row['employee_id'] ?? null) === $ownEmp) ? $row : null;
  return null;
}
function writeFilter($u, $tbl, $id, $data, $ownEmp) {
  if (isAdmin($u)) return $data;
  if ($tbl === 'users') {
    $old = getRow('users', $id);
    if ($data && ($data['password'] ?? null) === '' && $old) $data['password'] = $old['password'];
    if ($id === $u['id'] && $old) { $np = $data['password'] ?? $old['password']; $old['must_change'] = ($np !== $old['password']) ? 0 : $old['must_change']; $old['password'] = $np; return $old; } // الحساب يغيّر كلمة مروره فقط
    if (isHr($u) && $data && ($data['role'] ?? '') === 'employee' && empty($data['can_hr']) && empty($data['can_edit']) && (!$old || $old['role'] === 'employee')) return $data;
    return null;
  }
  if ($tbl === 'settings') return null;
  if ($tbl === 'records') { $old = getRow('records', $id); return (canEdit($u) || ($data && ($data['user_id'] ?? null) === $u['id'] && (!$old || $old['user_id'] === $u['id']))) ? $data : null; }
  if (isHr($u)) return ($tbl === 'employees' && $data && ($data['user_id'] ?? null) === $u['id']) ? null : $data;
  if ($tbl === 'leave_requests') return ($data && $ownEmp && ($data['employee_id'] ?? null) === $ownEmp && in_array($data['status'] ?? '', ['pending', 'cancelled'], true)) ? $data : null;
  return null;
}

// ---------- الجسم ----------
$raw = file_get_contents('php://input');
$body = $raw !== '' && $raw !== false ? json_decode($raw, true) : [];
if (!is_array($body)) $body = [];
$ip = clientIp();

// ---------- المسارات ----------
if ($path === '/api/health' && $method === 'GET') out(200, ['ok' => true, 'serverId' => $SERVER_ID, 'initialized' => userCount() > 0]);

if ($path === '/api/login' && $method === 'POST') {
  $name = trim((string)($body['username'] ?? '')); $k = $ip . '|' . mb_strtolower($name);
  if (throttled($k)) bad(429, 'محاولات كثيرة. انتظر عشر دقائق');
  $u = findUserByName($name);
  if (!$u || !verifyPw((string)($body['password'] ?? ''), $u['password'])) { noteFail($k); bad(401, 'اسم المستخدم أو كلمة المرور غير صحيحة'); }
  if (!$u['active']) bad(403, 'هذا الحساب معطّل. تواصل مع المدير');
  if (strpos($u['password'], 'pbkdf2$') !== 0) { $u['password'] = hashPw((string)$body['password']); putRow('users', $u['id'], $u); }
  q('DELETE FROM fails WHERE k = ?', [$k]);
  out(200, ['token' => newSession($u['id']), 'user' => publicUser($u), 'serverId' => $SERVER_ID]);
}

if ($path === '/api/bootstrap' && $method === 'POST') {
  if (throttled('boot|' . $ip)) bad(429, 'محاولات كثيرة');
  if (!hash_equals($SETUP_KEY, (string)($body['setupKey'] ?? ''))) { noteFail('boot|' . $ip); bad(403, 'مفتاح التهيئة غير صحيح'); }
  if (userCount() > 0) bad(409, 'الخادم مهيّأ مسبقاً');
  $rows = is_array($body['rows'] ?? null) ? $body['rows'] : [];
  $admin = null;
  foreach ($rows as $r) if (($r['tbl'] ?? '') === 'users' && ($r['id'] ?? '') === ($body['adminId'] ?? null) && ($r['data']['role'] ?? '') === 'admin' && !empty($r['data']['active'])) $admin = $r;
  if (!$admin) bad(400, 'لا يوجد حساب مدير فعّال في البيانات');
  tx(function () use ($rows) { foreach ($rows as $r) if (in_array($r['tbl'] ?? '', TABLES, true) && !empty($r['id']) && isset($r['data'])) putRow($r['tbl'], (string)$r['id'], $r['data']); });
  out(200, ['token' => newSession($admin['id']), 'serverId' => $SERVER_ID, 'cursor' => (int)meta('seq')]);
}

if ($path === '/api/sync/pull' && $method === 'GET') {
  $u = actorOf(); $since = (int)($_GET['since'] ?? 0); $limit = 400; $ownEmp = ownEmployeeId($u);
  $out = []; $cursor = $since; $more = false;
  $st = q('SELECT tbl, id, data, deleted, seq FROM rows WHERE seq > ? ORDER BY seq', [$since]);
  while ($r = $st->fetch()) {
    if (count($out) >= $limit) { $more = true; break; }
    $cursor = (int)$r['seq'];
    if ($r['deleted']) { if (isHr($u) || in_array($r['tbl'], ['users', 'records', 'employees', 'contracts', 'leave_requests', 'settings'], true)) $out[] = ['tbl' => $r['tbl'], 'id' => $r['id'], 'deleted' => true]; continue; }
    $d = readFilter($u, $r['tbl'], json_decode($r['data'], true), $ownEmp);
    if ($d !== null) $out[] = ['tbl' => $r['tbl'], 'id' => $r['id'], 'data' => $d];
  }
  out(200, ['rows' => $out, 'cursor' => $cursor, 'more' => $more, 'serverId' => $SERVER_ID, 'user' => publicUser($u)]);
}

if ($path === '/api/sync/push' && $method === 'POST') {
  $u = actorOf(); $ownEmp = ownEmployeeId($u); $rejected = [];
  $rows = is_array($body['rows'] ?? null) ? $body['rows'] : [];
  tx(function () use ($rows, $u, $ownEmp, &$rejected) {
    foreach ($rows as $r) {
      $tbl = $r['tbl'] ?? ''; $id = (string)($r['id'] ?? '');
      if (!in_array($tbl, TABLES, true) || $id === '') { $rejected[] = $id; continue; }
      if (!empty($r['deleted'])) {
        $old = getRow($tbl, $id);
        if ($old && writeFilter($u, $tbl, $id, $old, $ownEmp) && ($tbl !== 'users' || isAdmin($u)) && $tbl !== 'settings') delRow($tbl, $id);
        elseif ($old) $rejected[] = $id;
        continue;
      }
      $d = writeFilter($u, $tbl, $id, $r['data'] ?? null, $ownEmp);
      if ($d === null) { $rejected[] = $id; continue; }
      putRow($tbl, $id, $d);
    }
  });
  out(200, ['ok' => true, 'rejected' => $rejected, 'cursor' => (int)meta('seq')]);
}

// ---------- واجهة تطبيق الحضور ----------
function eligibility($u, $emp, $date) {
  if (!$emp) return isAdmin($u) ? ['ok' => true, 'exempt' => true] : ['ok' => false, 'reason' => 'حسابك غير مرتبط بملف موظف'];
  if (($emp['status'] ?? '') === 'terminated') return ['ok' => false, 'reason' => 'انتهت خدمتك'];
  $cs = array_values(array_filter(allRows('contracts'), function ($c) use ($emp) { return ($c['employee_id'] ?? null) === $emp['id'] && ($c['status'] ?? '') === 'active'; }));
  foreach ($cs as $c) if ($c['start_date'] <= $date && (($c['end_date'] ?? null) ?: '9999-12-31') >= $date) return ['ok' => true, 'contractNo' => $c['contract_no'], 'contractEnd' => $c['end_date'] ?? null];
  $next = array_values(array_filter($cs, function ($c) use ($date) { return $c['start_date'] > $date; })); usort($next, function ($a, $b) { return strcmp($a['start_date'], $b['start_date']); });
  if ($next) return ['ok' => false, 'reason' => 'يبدأ عقدك في ' . $next[0]['start_date']];
  return ['ok' => false, 'reason' => $cs ? 'انتهى عقدك' : 'لا يوجد عقد ساري لك. تواصل مع الموارد البشرية'];
}
function cfgOf() { $o = []; foreach (allRows('settings') as $s) $o[$s['key']] = $s['value']; return $o; }
function recFor($uid, $date) { foreach (allRows('records') as $r) if ($r['user_id'] === $uid && $r['date'] === $date) return $r; return null; }
function recOut($r) { return $r ? ['id' => $r['id'], 'date' => $r['date'], 'checkIn' => $r['check_in'], 'checkOut' => $r['check_out'] ?? null, 'inLat' => $r['in_lat'] ?? null, 'inLng' => $r['in_lng'] ?? null, 'inAcc' => $r['in_acc'] ?? null, 'outLat' => $r['out_lat'] ?? null, 'outLng' => $r['out_lng'] ?? null, 'outAcc' => $r['out_acc'] ?? null] : null; }
function dateOk($d) { return is_string($d) && preg_match('/^\d{4}-\d\d-\d\d$/', $d) && strtotime($d) !== false; }

if ($path === '/api/m/me' && $method === 'GET') {
  $u = actorOf(); $emp = null; foreach (allRows('employees') as $e) if (($e['user_id'] ?? null) === $u['id']) $emp = $e;
  $date = $_GET['date'] ?? ''; $today = dateOk($date) ? $date : gmdate('Y-m-d');
  $fromKey = gmdate('Y-m-d', strtotime($today . ' -45 days')); $c = cfgOf();
  $recs = array_values(array_filter(allRows('records'), function ($r) use ($u, $fromKey) { return $r['user_id'] === $u['id'] && $r['date'] >= $fromKey; }));
  usort($recs, function ($a, $b) { return strcmp($b['date'], $a['date']); });
  out(200, ['user' => publicUser($u), 'employee' => $emp ? ['name' => $emp['name'], 'empNo' => $emp['emp_no'] ?? null, 'jobTitle' => $emp['job_title'] ?? null, 'department' => $emp['department'] ?? null] : null,
    'eligibility' => $u['must_change'] ? ['ok' => false, 'reason' => 'غيّر كلمة المرور المؤقتة أولاً'] : eligibility($u, $emp, $today),
    'settings' => ['workStart' => $c['workStart'] ?? '09:00', 'workEnd' => $c['workEnd'] ?? '17:00', 'graceMin' => (int)($c['graceMin'] ?? 0), 'weekend' => $c['weekend'] ?? '5,6', 'orgName' => $c['orgName'] ?? ''],
    'records' => array_map('recOut', $recs), 'serverTime' => gmdate('c')]);
}

if ($path === '/api/m/punch' && $method === 'POST') {
  $u = actorOf();
  if ($u['must_change']) bad(403, 'غيّر كلمة المرور المؤقتة أولاً');
  $clientId = (string)($body['clientId'] ?? ''); $type = $body['type'] ?? ''; $date = $body['date'] ?? '';
  if ($clientId === '' || !in_array($type, ['in', 'out'], true)) bad(400, 'طلب غير صحيح');
  $prev = q('SELECT result FROM punches WHERE client_id = ?', [$clientId])->fetch();
  if ($prev) out(200, json_decode($prev['result'], true));
  $ts = strtotime((string)($body['at'] ?? ''));
  if ($ts === false || !dateOk($date)) bad(400, 'وقت التسجيل غير صحيح');
  $skew = time() - $ts;
  if ($skew < -300) bad(400, 'وقت التسجيل في المستقبل. صحّح ساعة الجهاز');
  if ($skew > 7 * 86400) bad(400, 'مضى على التسجيل أكثر من 7 أيام');
  $lat = isset($body['lat']) ? (float)$body['lat'] : null; $lng = isset($body['lng']) ? (float)$body['lng'] : null; $acc = isset($body['acc']) ? (int)round((float)$body['acc']) : null;
  if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) bad(400, 'الموقع مطلوب للتسجيل');
  $emp = null; foreach (allRows('employees') as $e) if (($e['user_id'] ?? null) === $u['id']) $emp = $e;
  $el = eligibility($u, $emp, $date);
  $res = tx(function () use ($u, $el, $type, $date, $ts, $lat, $lng, $acc, $clientId) {
    if (!$el['ok']) bad(422, 'لا يمكن التسجيل: ' . $el['reason']);
    $rec = recFor($u['id'], $date); $whenIso = gmdate('Y-m-d\TH:i:s', $ts) . '.000Z';
    if ($type === 'in') {
      if ($rec) bad(409, 'تم تسجيل الحضور في هذا اليوم مسبقاً');
      $r = ['id' => bin2hex(random_bytes(6)), 'user_id' => $u['id'], 'date' => $date, 'check_in' => $whenIso, 'check_out' => null, 'edited_by' => null, 'edited_at' => null, 'in_lat' => $lat, 'in_lng' => $lng, 'in_acc' => $acc, 'out_lat' => null, 'out_lng' => null, 'out_acc' => null];
    } else {
      if (!$rec) bad(409, 'لا يوجد تسجيل حضور لهذا اليوم');
      if (!empty($rec['check_out'])) bad(409, 'تم تسجيل الانصراف مسبقاً');
      if ($ts < strtotime($rec['check_in'])) bad(400, 'وقت الانصراف قبل وقت الحضور');
      $r = $rec; $r['check_out'] = $whenIso; $r['out_lat'] = $lat; $r['out_lng'] = $lng; $r['out_acc'] = $acc;
    }
    putRow('records', $r['id'], $r);
    $result = ['ok' => true, 'record' => recOut($r), 'receivedAt' => gmdate('c')];
    q('INSERT INTO punches VALUES (?,?,?,?)', [$clientId, $u['id'], jenc($result), time()]);
    return $result;
  });
  out(200, $res);
}

if ($path === '/api/m/password' && $method === 'POST') {
  $u = actorOf(); $cur = (string)($body['current'] ?? ''); $next = (string)($body['next'] ?? '');
  if (!verifyPw($cur, $u['password'])) bad(403, 'كلمة المرور الحالية غير صحيحة');
  if (mb_strlen($next) < 6) bad(400, 'كلمة المرور الجديدة 6 أحرف على الأقل');
  if ($next === $cur) bad(400, 'اختر كلمة مرور مختلفة عن الحالية');
  $u['password'] = hashPw($next); $u['must_change'] = 0; putRow('users', $u['id'], $u);
  out(200, ['ok' => true]);
}

bad(404, 'غير موجود');
