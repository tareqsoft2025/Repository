# خادم المزامنة المركزي

قاعدة بيانات واحدة يشترك فيها **النظام (المتصفح)** وتطبيق **بصمة** على كل الأجهزة. **بلا أي اعتمادية** وعلى أي Node 16 فأحدث؛ البيانات في ملف `hr.log` داخل `DATA_DIR`. يجب أن يعمل على **HTTPS**.

الملفات المطلوبة للتشغيل: `server.js` و`package.json` فقط (متاحة مضغوطة في `app/hr-sync-server.zip`).

## الطريقة 1: استضافة cPanel (Setup Node.js App)
1. حمّل `hr-sync-server.zip` وفكّه في مجلد خارج `public_html` مثل `hr-sync`.
2. cPanel ← **Setup Node.js App** ← Create Application: إصدار Node 16 فأحدث، Application root = `hr-sync`، Application URL = النطاق أو نطاق فرعي (مثل `hr.example.com`)، Startup file = `server.js`.
3. من نفس الصفحة أضف متغيرين: `SETUP_KEY` (كلمة سر طويلة تختارها) و`DATA_DIR` (مسار خارج `public_html`، مثل `/home/اسمك/hr-data`).
4. اضغط Run JS script / Restart، ثم افتح `https://النطاق/api/health` فيجب أن ترى `{"ok":true,...}`.
5. تأكد أن للنطاق شهادة SSL (AutoSSL في cPanel تفعل ذلك عادة).

## الطريقة 2: VPS (Ubuntu/Debian)
```bash
bash install-vps.sh hr.example.com you@example.com
```
يثبّت Node وخدمة systemd وNginx وشهادة Let's Encrypt، ويطبع مفتاح التهيئة. شرط: سجل DNS من نوع A للنطاق يشير إلى الخادم.

## الطريقة 3: Docker
```bash
docker build -t hr-sync .
docker run -d --restart=always -p 8080:8080 -v hr-data:/data -e SETUP_KEY=سر-طويل hr-sync
```
ضعه خلف Nginx/Caddy بشهادة HTTPS.

## الربط (مرة واحدة)
1. ضع عنوان الخادم في `js/config.js` (`window.HR_SERVER = 'https://...'`) وانشره، أو أدخله من الإعدادات.
2. من جهاز المدير الذي فيه البيانات: **الإعدادات ← الخادم المركزي ← رفع بيانات هذا الجهاز** وأدخل `SETUP_KEY`.
3. أي جهاز آخر: يسجّل الدخول بحسابه فتُحمَّل بياناته. تطبيق بصمة: بالحساب نفسه (أدخل عنوان الخادم في شاشة الدخول إن لم يكن مضمَّناً وقت البناء).

## الأمان والبيانات
- كلمات المرور مشفّرة PBKDF2؛ الصلاحيات تُفرض على الخادم (المدير كل شيء، الموارد البشرية الموظفون والعقود، محرر الحضور سجلات الحضور، الموظف سجلاته وعقده فقط).
- حدّ لمحاولات الدخول (8 محاولات / 10 دقائق)، وجلسات 30 يوماً، وتسجيل التطبيق لا يتكرر عند إعادة الإرسال.
- **النسخ الاحتياطي:** انسخ `DATA_DIR/hr.log` دورياً. عند فقدانه يمكن رفع بيانات جهاز المدير من جديد بالخطوة 2.
