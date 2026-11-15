package com.mema.journey;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.widget.LinearLayout;
import android.widget.TextView;

final class NativeUi {
    static int dp(Activity a, int n) { return Math.round(a.getResources().getDisplayMetrics().density * n); }
    static LinearLayout column(Activity a) {
        LinearLayout root = new LinearLayout(a); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(0xfff3f7fc);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()); view.setPadding(bars.left, bars.top, bars.right, bars.bottom); }
            else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        return root;
    }
    static TextView text(Activity a, String label, int size, int colour) {
        TextView v = new TextView(a); v.setText(label); v.setTextSize(size); v.setTextColor(colour); v.setPadding(0, dp(a, 7), 0, dp(a, 7)); return v;
    }
}
