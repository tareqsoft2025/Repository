// عنوان خادم MySQL المركزي: مجلد server-mysql بجانب مجلد js في نسخة الموقع.
 // إذا رفعت الخادم إلى مسار مختلف، استخدم عنوان HTTPS الكامل للخادم هنا.
window.HR_SERVER = new URL('../server-mysql', document.currentScript.src).href.replace(/\/+$/, '');
