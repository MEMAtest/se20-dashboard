package com.mema.journey;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class WidgetConfigActivity extends Activity {
    private int widgetId = -1, revision;
    private final Station[] selected = new Station[2];
    private final EditText[] inputs = new EditText[2];
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout results;
    private TextView status;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (!DeparturesWidget.owns(this, widgetId)) { finish(); return; }
        LinearLayout root = NativeUi.column(this); ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); int p = NativeUi.dp(this, 20); body.setPadding(p, p, p, p);
        body.addView(NativeUi.text(this, "JOURNEY / YOUR HOME SCREEN", 12, 0xff0057d9));
        body.addView(NativeUi.text(this, "A station at a glance", 28, 0xff10253f));
        body.addView(NativeUi.text(this, "Choose an exact station or bus stop. Widgets use TfL predictions, not every National Rail service. These settings are separate from browser favourites.", 14, 0xff52657d));
        for (int slot = 0; slot < 2; slot++) {
            final int which = slot;
            body.addView(NativeUi.text(this, slot == 0 ? "Departure station / stop" : "Shortcut destination (optional)", 15, 0xff10253f));
            EditText input = new EditText(this); input.setSingleLine(true); input.setHint(slot == 0 ? "e.g. Anerley or London Bridge" : "e.g. Victoria, or your home station"); input.setContentDescription(slot == 0 ? "Departure station search" : "Destination station search"); inputs[slot] = input; body.addView(input);
            input.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
                public void onTextChanged(CharSequence s, int start, int before, int count) { selected[which] = null; revision++; if (results != null) results.removeAllViews(); }
                public void afterTextChanged(Editable e) { }
            });
            Station saved = new WidgetStore(this).station(widgetId, slot == 0 ? "station" : "destination");
            if (saved != null) { input.setText(saved.name); selected[slot] = saved; }
            Button search = new Button(this); search.setText(slot == 0 ? "Search departure stations" : "Search destinations"); search.setOnClickListener(v -> search(which)); body.addView(search);
        }
        status = NativeUi.text(this, "Select a search result before saving. No background location is used.", 14, 0xff52657d); body.addView(status);
        results = new LinearLayout(this); results.setOrientation(LinearLayout.VERTICAL); body.addView(results);
        Button save = new Button(this); save.setText("Save widget"); save.setOnClickListener(v -> save()); body.addView(save);
        body.addView(NativeUi.text(this, "Refresh on demand. Android may delay the roughly 30-minute background updates to save battery. Times are absolute London times, never a continuously live countdown. Tap the destination to open Journey, then confirm your route.", 12, 0xff52657d));
        scroll.addView(body); root.addView(scroll); setContentView(root);
    }
    private void search(int which) {
        String query = inputs[which].getText().toString().trim(); int token = ++revision;
        if (query.isEmpty() || query.length() > 80) { status.setText("Enter a station name (up to 80 characters)."); return; }
        results.removeAllViews(); status.setText("Searching TfL...");
        executor.execute(() -> {
            try {
                List<Station> choices = new TflClient().search(query);
                runOnUiThread(() -> {
                    if (isDestroyed() || token != revision) return;
                    status.setText(choices.isEmpty() ? "No exact station found. Try a more specific name." : "Choose the exact " + (which == 0 ? "departure" : "destination") + " station below:");
                    for (Station station : choices) {
                        Button choice = new Button(this); choice.setText(station.name + "\n" + station.id); choice.setAllCaps(false);
                        choice.setOnClickListener(v -> { inputs[which].setText(station.name); selected[which] = station; results.removeAllViews(); status.setText("Selected " + station.name + ". Your saved Home has not changed."); }); results.addView(choice);
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> { if (!isDestroyed() && token == revision) status.setText("Station search unavailable. Check the connection and retry."); });
            }
        });
    }
    private void save() {
        if (selected[0] == null || (!inputs[1].getText().toString().trim().isEmpty() && selected[1] == null)) { status.setText("Choose exact search results. Typed text alone is not a selected station."); return; }
        if (!DeparturesWidget.owns(this, widgetId)) { finish(); return; }
        WidgetRefreshService.cancel(this, widgetId);
        new WidgetStore(this).configure(widgetId, selected[0], selected[1]); DeparturesWidget.render(this, widgetId);
        WidgetRefreshService.schedule(this, widgetId, false); WidgetRefreshService.schedule(this, widgetId, true);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)); finish();
    }
    @Override public void onDestroy() { revision++; executor.shutdownNow(); super.onDestroy(); }
}
