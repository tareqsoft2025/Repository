package com.tareqsoft.hr;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.GeolocationPermissions;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** غلاف WebView لنظام شؤون الموظفين: يفتح النظام المنشور ويحتفظ بقاعدة البيانات المحلية على الجهاز. */
public class MainActivity extends Activity {
    static final String HOME = "https://tareqsoft2025.github.io/Repository/login.html";
    static final String HOST = "tareqsoft2025.github.io";
    private static final int FILE_REQ = 1;
    private WebView web;
    private static final int LOC_REQ = 2;
    private ValueCallback<Uri[]> filePicker;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage (الجلسة)
        s.setDatabaseEnabled(true);     // IndexedDB (قاعدة البيانات)
        s.setUserAgentString(s.getUserAgentString() + " HRApp/1.0");
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void print() { runOnUiThread(new Runnable() { public void run() { doPrint(); } }); }
        }, "AndroidApp");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* لا تطبيق مناسب */ }
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap f) {
                v.evaluateJavascript("window.print=function(){AndroidApp.print()}", null);
            }
            @Override public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript("window.print=function(){AndroidApp.print()}", null);
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showOffline(v);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // تحديد الموقع للنظام المنشور فقط: يُطلب إذن أندرويد عند أول استخدام
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (!origin.startsWith("https://" + HOST)) { cb.invoke(origin, false, false); return; }
                if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { cb.invoke(origin, true, true); return; }
                geoCallback = cb; geoOrigin = origin;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, LOC_REQ);
            }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = cb;
                try { startActivityForResult(p.createIntent(), FILE_REQ); } catch (Exception e) { filePicker = null; return false; }
                return true;
            }
        });
        if (b != null) web.restoreState(b); else web.loadUrl(HOME);
    }

    private void showOffline(WebView v) {
        String html = "<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:48px 24px;color:#1F3A5F'>"
            + "<h2>لا يوجد اتصال بالإنترنت</h2><p>تحقّق من الاتصال ثم أعد المحاولة.</p>"
            + "<button style='font-size:18px;padding:12px 28px;border:0;border-radius:8px;background:#1F3A5F;color:#fff' onclick=\"location.href='" + HOME + "'\">إعادة المحاولة</button></body></html>";
        v.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void doPrint() {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        String name = "document";
        pm.print(name, web.createPrintDocumentAdapter(name), new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && filePicker != null) {
            filePicker.onReceiveValue(res == RESULT_OK && data != null ? new Uri[] { data.getData() } : null);
            filePicker = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == LOC_REQ && geoCallback != null) {
            boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, ok); geoCallback = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
