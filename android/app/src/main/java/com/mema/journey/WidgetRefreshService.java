package com.mema.journey;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;

public final class WidgetRefreshService extends JobService {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<Integer, Future<?>> work = new ConcurrentHashMap<>();
    static int jobId(int widget, boolean immediate) { return 1000 + widget * 2 + (immediate ? 1 : 0); }
    static void schedule(Context c, int id, boolean immediate) {
        WidgetKind kind = DeparturesWidget.kind(c,id);
        if (!kind.refreshes || !new WidgetStore(c).configured(id,kind) || !DeparturesWidget.owns(c, id)) return;
        PersistableBundle extras = new PersistableBundle(); extras.putInt("widget", id);
        JobInfo.Builder builder = new JobInfo.Builder(jobId(id, immediate), new ComponentName(c, WidgetRefreshService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setExtras(extras);
        if (immediate) builder.setOverrideDeadline(0); else builder.setPeriodic(30 * 60_000L).setPersisted(true);
        int result = c.getSystemService(JobScheduler.class).schedule(builder.build());
        if (result != JobScheduler.RESULT_SUCCESS) {
            new WidgetStore(c).prefs.edit().putString(id + ":error", "SCHEDULE_DEFERRED").apply(); DeparturesWidget.render(c, id);
        }
    }
    static void cancel(Context c, int id) { JobScheduler scheduler = c.getSystemService(JobScheduler.class); scheduler.cancel(jobId(id, false)); scheduler.cancel(jobId(id, true)); }
    @Override public boolean onStartJob(JobParameters params) {
        int id = params.getExtras().getInt("widget", -1);
        if (!DeparturesWidget.owns(this, id)) return false;
        WidgetStore store = new WidgetStore(this); WidgetKind kind = DeparturesWidget.kind(this,id); Station station = store.station(id, "station");
        if (!kind.refreshes || !store.configured(id,kind)) return false;
        long now = System.currentTimeMillis(), attempt = store.prefs.getLong(id + ":attempt", 0);
        if (now >= attempt && now - attempt < 30_000) { DeparturesWidget.render(this, id); return false; }
        String config = store.read(id, "config").toString();
        store.prefs.edit().putLong(id + ":attempt", now).apply();
        FutureTask<Void> task = new FutureTask<>(() -> {
            try {
                TflClient client = new TflClient();
                String snapshot = (kind == WidgetKind.LINE ? client.lineStatus(store.read(id,"config").optString("lineId")) : kind == WidgetKind.ROUTE ? client.journey(station,store.station(id,"destination")) : client.snapshot(station)).toString();
                if (!Thread.currentThread().isInterrupted() && DeparturesWidget.owns(this, id) && store.read(id, "config").toString().equals(config))
                    store.prefs.edit().putString(id + ":snapshot", snapshot).remove(id + ":error").apply();
            } catch (Exception e) {
                if (!Thread.currentThread().isInterrupted() && DeparturesWidget.owns(this, id) && store.read(id, "config").toString().equals(config))
                    store.prefs.edit().putString(id + ":error", e instanceof TflClient.SourceException ? ((TflClient.SourceException)e).code : "NETWORK_OR_SOURCE_UNAVAILABLE").apply();
            } finally {
                if (!Thread.currentThread().isInterrupted() && DeparturesWidget.owns(this, id)) DeparturesWidget.render(this, id);
                work.remove(params.getJobId());
                if (!Thread.currentThread().isInterrupted()) jobFinished(params, false);
            }
            return null;
        });
        work.put(params.getJobId(), task); executor.execute(task);
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { Future<?> task = work.remove(params.getJobId()); if (task != null) task.cancel(true); return false; }
    @Override public void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
}
