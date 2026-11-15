package com.mema.journey;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        for (int id : DeparturesWidget.ids(c)) { DeparturesWidget.render(c, id); WidgetRefreshService.schedule(c, id, false); }
    }
}
