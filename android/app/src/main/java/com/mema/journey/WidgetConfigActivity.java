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
import android.widget.CheckBox;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
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
    private WidgetKind kind;
    private CheckBox phone;
    private Spinner line;
    private EditText homeLabel;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (!DeparturesWidget.owns(this, widgetId)) { finish(); return; }
        kind = DeparturesWidget.kind(this, widgetId);
        LinearLayout root = NativeUi.column(this); ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); int p = NativeUi.dp(this, 20); body.setPadding(p, p, p, p);
        body.addView(NativeUi.text(this, "JOURNEY / YOUR HOME SCREEN", 12, 0xff0057d9));
        body.addView(NativeUi.text(this, kind.title + " / " + kind.size, 28, 0xff10253f));
        body.addView(NativeUi.text(this, kind == WidgetKind.HOME ? "Choose your home station. Tap the widget to check a real route estimate. Phone position is used only after your explicit request, never tracked in the background. Browser Home is unchanged." : "Choose exact stations or a line. TfL predictions do not include every National Rail service. Settings stay separate from browser favourites.", 14, 0xff52657d));
        if (kind == WidgetKind.LINE) {
            line = new Spinner(this); String[] names = new String[WidgetData.LINES.length];
            String saved = new WidgetStore(this).read(widgetId,"config").optString("lineId"); int choice = 0;
            for (int i = 0; i < names.length; i++) { names[i] = WidgetData.LINES[i][1]; if (WidgetData.LINES[i][0].equals(saved)) choice = i; }
            line.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names)); line.setSelection(choice); line.setContentDescription("Line to watch"); body.addView(line);
        }
        if (kind == WidgetKind.HOME) {
            phone = new CheckBox(this); phone.setText("Start from my phone location, only when I find a route");
            phone.setChecked(new WidgetStore(this).read(widgetId,"config").optBoolean("phone", true)); body.addView(phone);
            homeLabel=new EditText(this); homeLabel.setSingleLine(true); homeLabel.setHint("Home label, e.g. SE20 (optional)"); homeLabel.setContentDescription("Home widget label");
            homeLabel.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(24)}); homeLabel.setText(new WidgetStore(this).read(widgetId,"config").optString("homeLabel")); body.addView(homeLabel);
        }
        for (int slot = 0; slot < 2; slot++) {
            if (kind == WidgetKind.LINE || (kind == WidgetKind.NEXT && slot == 1)) continue;
            final int which = slot;
            body.addView(NativeUi.text(this, slot == 0 ? (kind == WidgetKind.HOME ? "Fixed start (only if phone location is unchecked)" : "Departure station / stop") : kind == WidgetKind.HOME ? "Home station (required)" : kind == WidgetKind.ROUTE ? "Destination (required)" : "Shortcut destination (optional)", 15, 0xff10253f));
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
        body.addView(NativeUi.text(this, kind == WidgetKind.HOME ? "Phone mode has no background location or network jobs. A fixed starting station can update in the background. Tap the widget to check an estimate or open the full planner." : "Countdowns tick locally from a dated prediction, not a new live check. Android can delay source refresh and expiry alarms. Refresh before travel; estimates include walks and transfers. Long-press to reconfigure.", 12, 0xff52657d));
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
        boolean usePhone = kind == WidgetKind.HOME && phone.isChecked();
        if (kind != WidgetKind.LINE && ((!usePhone && selected[0] == null) || ((kind == WidgetKind.HOME || kind == WidgetKind.ROUTE) && selected[1] == null) || (inputs[1] != null && !inputs[1].getText().toString().trim().isEmpty() && selected[1] == null))) { status.setText("Choose exact search results. Typed text alone is not a selected station."); return; }
        if (!DeparturesWidget.owns(this, widgetId)) { finish(); return; }
        WidgetRefreshService.cancel(this, widgetId);
        WidgetStore store=new WidgetStore(this); store.configure(widgetId, kind, usePhone ? null : selected[0], selected[1], usePhone, kind == WidgetKind.LINE ? WidgetData.LINES[line.getSelectedItemPosition()][0] : "");
        if(kind==WidgetKind.HOME) store.homeLabel(widgetId,WidgetData.clean(homeLabel.getText().toString()));
        DeparturesWidget.render(this, widgetId);
        WidgetRefreshService.schedule(this, widgetId, false); WidgetRefreshService.schedule(this, widgetId, true);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)); finish();
    }
    @Override public void onDestroy() { revision++; executor.shutdownNow(); super.onDestroy(); }
}
