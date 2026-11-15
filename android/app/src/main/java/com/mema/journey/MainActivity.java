package com.mema.journey;

import android.Manifest;
import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private WebView web;
    private TextView message;
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingLocation;
    private boolean loadFailed;
    static boolean trusted(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "journey-london.ademola-584.workers.dev".equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = NativeUi.column(this), bar = new LinearLayout(this); bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView title = NativeUi.text(this, "  Journey", 20, 0xff10253f); bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button widget = new Button(this); widget.setText("Add widget"); widget.setTextSize(12); widget.setOnClickListener(v -> pinWidget()); bar.addView(widget);
        Button browser = new Button(this); browser.setText("Browser"); browser.setTextSize(12); browser.setOnClickListener(v -> external(Uri.parse(WidgetData.APP_URL))); bar.addView(browser); root.addView(bar);
        message = NativeUi.text(this, "", 12, 0xff815500); message.setVisibility(android.view.View.GONE); root.addView(message);
        web = new WebView(this); WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false); settings.setGeolocationEnabled(true);
        settings.setSafeBrowsingEnabled(true); settings.setUserAgentString(settings.getUserAgentString() + " JourneyAndroid/0.2");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) { loadFailed = false; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                if (request.isForMainFrame()) external(request.getUrl());
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { loadFailed = true; message.setText("Journey could not load. Check your connection. Tap here to retry."); message.setVisibility(android.view.View.VISIBLE); message.setOnClickListener(v -> web.loadUrl(startUrl())); }
            }
            @Override public void onPageFinished(WebView view, String url) { if (!loadFailed && trusted(Uri.parse(url))) message.setVisibility(android.view.View.GONE); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!trusted(Uri.parse(origin)) || !trusted(Uri.parse(web.getUrl())) || pendingLocation != null) { callback.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) callback.invoke(origin, true, false);
                else { pendingOrigin = origin; pendingLocation = callback; requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 7); }
            }
            @Override public void onGeolocationPermissionsHidePrompt() { denyPendingLocation(); }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root); web.loadUrl(startUrl());
    }
    private String startUrl() {
        int id = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (!DeparturesWidget.owns(this, id)) return WidgetData.APP_URL;
        WidgetStore store = new WidgetStore(this); WidgetKind kind = DeparturesWidget.kind(this, id);
        if (kind == WidgetKind.LINE) return WidgetData.lineLink(store.read(id, "config").optString("lineId"));
        if (kind == WidgetKind.HOME && store.read(id, "config").optBoolean("phone")) return WidgetData.homeLink(store.station(id, "destination"));
        return WidgetData.link(store.station(id, "station"), store.station(id, "destination"));
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); web.loadUrl(startUrl()); }
    private void pinWidget() {
        AppWidgetManager manager = getSystemService(AppWidgetManager.class);
        if (manager.isRequestPinAppWidgetSupported()) {
            Class<?>[] types = {NextUpWidget.class, HomeWidget.class, JourneyWidget.class, LineWatchWidget.class, DeparturesWidget.class};
            WidgetKind[] kinds = WidgetKind.values(); String[] choices = new String[kinds.length];
            for (int i = 0; i < kinds.length; i++) choices[i] = kinds[i].title + " / " + kinds[i].size;
            new android.app.AlertDialog.Builder(this).setTitle("Choose your widget").setItems(choices, (dialog, which) -> manager.requestPinAppWidget(new ComponentName(this, types[which]), null, null)).show();
        }
        else Toast.makeText(this, "Long-press your home screen, choose Widgets, then Journey.", Toast.LENGTH_LONG).show();
    }
    private void external(Uri uri) {
        if (uri == null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); } catch (android.content.ActivityNotFoundException ignored) { Toast.makeText(this, "No browser is available.", Toast.LENGTH_LONG).show(); }
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == 7 && pendingLocation != null) {
            boolean granted = false; for (int grant : grants) if (grant == PackageManager.PERMISSION_GRANTED) granted = true;
            pendingLocation.invoke(pendingOrigin, granted, false); pendingLocation = null; pendingOrigin = null;
        }
    }
    private void denyPendingLocation() { if (pendingLocation != null) pendingLocation.invoke(pendingOrigin, false, false); pendingLocation = null; pendingOrigin = null; }
    @Override public void onDestroy() { denyPendingLocation(); web.destroy(); super.onDestroy(); }
}
