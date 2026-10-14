package com.tareqsoft.hr;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;

/**
 * تطبيق «بصمة» للحضور والانصراف: يعرض واجهة التطبيق المضمَّنة في الحزمة (assets/mobile) فيعمل دون اتصال من أول تشغيل،
 * ويرسل التسجيلات إلى خادم النظام عند توفر الإنترنت. الصفحات تُخدَّم من أصل https افتراضي ليعمل الموقع والتخزين المحلي.
 */
public class MainActivity extends Activity {
    static final String ORIGIN_HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + ORIGIN_HOST + "/mobile/index.html";
    private static final int LOC_REQ = 2;
    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(0xFF061416);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: الجلسة وطابور التسجيلات
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!"https".equals(u.getScheme()) || !ORIGIN_HOST.equals(u.getHost())) return null;
                String path = u.getPath() == null ? "" : u.getPath();
                if (path.startsWith("/")) path = path.substring(1);
                if (path.contains("..")) return null;
                try {
                    InputStream in = getAssets().open(path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                if ("https".equals(u.getScheme()) && ORIGIN_HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* لا تطبيق مناسب */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (!origin.contains(ORIGIN_HOST)) { cb.invoke(origin, false, false); return; }
                if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { cb.invoke(origin, true, true); return; }
                geoCallback = cb; geoOrigin = origin;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, LOC_REQ);
            }
        });
        // اطلب إذن الموقع عند أول تشغيل ليكون جاهزاً قبل أول تسجيل
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, LOC_REQ);
        if (b != null) web.restoreState(b); else web.loadUrl(HOME);
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == LOC_REQ && geoCallback != null) {
            boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, ok, ok); geoCallback = null;
        }
    }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

    @Override public void onBackPressed() {
        // الصفحة تتولى الرجوع الداخلي (إغلاق النافذة السفلية/العودة إلى «اليوم»)، وإلا يُغلق التطبيق
        web.evaluateJavascript("(function(){return window.__back ? window.__back() : false})()", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) { if (!"true".equals(v)) MainActivity.super.onBackPressed(); }
        });
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
