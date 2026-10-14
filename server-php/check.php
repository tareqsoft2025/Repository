<?php
// أداة فحص: ارفعها بجانب index.php وافتحها في المتصفح، ثم احذفها بعد الانتهاء.
ini_set('display_errors', '1'); error_reporting(E_ALL);
header('Content-Type: text/html; charset=utf-8');
echo '<meta charset="utf-8"><body dir="rtl" style="font:16px sans-serif;padding:20px;line-height:1.9"><h2>فحص خادم المزامنة</h2>';
$ok = function ($label, $good, $info = '') { echo ($good ? '✅ ' : '❌ ') . htmlspecialchars($label) . ($info !== '' ? ' — <b dir="ltr">' . htmlspecialchars((string)$info) . '</b>' : '') . '<br>'; };
$ok('إصدار PHP (يلزم 7.0 فأحدث)', version_compare(PHP_VERSION, '7.0.0', '>='), PHP_VERSION);
$ok('إضافة pdo_sqlite', extension_loaded('pdo_sqlite'));
$ok('إضافة json', extension_loaded('json'));
$ok('دالة hash_pbkdf2', function_exists('hash_pbkdf2'));
$ok('دالة random_bytes', function_exists('random_bytes'));
$ok('إضافة mbstring', extension_loaded('mbstring'));
$ok('ملف index.php موجود', is_file(__DIR__ . '/index.php'));
$ok('ملف config.php موجود', is_file(__DIR__ . '/config.php'));
$ok('ملف .htaccess موجود (أو استخدم index.php/api/...)', is_file(__DIR__ . '/.htaccess'));
if (is_file(__DIR__ . '/config.php')) { include_once __DIR__ . '/config.php'; $ok('تم تغيير HR_SETUP_KEY', defined('HR_SETUP_KEY') && strpos(HR_SETUP_KEY, 'CHANGE-ME') !== 0); }
$home = !empty($_SERVER['DOCUMENT_ROOT']) ? dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')) : '';
$ok('مجلد المستخدم قابل للكتابة (لحفظ البيانات خارج الموقع)', $home && is_writable($home), $home);
$ok('مجلد data المحلي قابل للكتابة (بديل)', is_writable(__DIR__), __DIR__);
echo '<p>الخادم: <b dir="ltr">' . htmlspecialchars($_SERVER['SERVER_SOFTWARE'] ?? '?') . '</b></p>';
if (extension_loaded('pdo_sqlite')) { try { new PDO('sqlite::memory:'); $ok('فتح قاعدة SQLite', true); } catch (Throwable $e) { $ok('فتح قاعدة SQLite', false, $e->getMessage()); } }
if (isset($_GET['run'])) {
  echo '<h3>تشغيل index.php (health)</h3><pre dir="ltr" style="background:#eee;padding:10px">';
  register_shutdown_function(function () { $e = error_get_last(); if ($e) echo "\nFATAL: " . $e['message'] . ' @ ' . basename($e['file']) . ':' . $e['line']; });
  $_GET['route'] = 'health'; $_SERVER['REQUEST_METHOD'] = 'GET';
  require __DIR__ . '/index.php';
} else echo '<p><a href="?run=1">اضغط هنا لتشغيل index.php وإظهار أي خطأ</a></p>';
