package com.mema.journey;

import android.app.Instrumentation;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.time.Instant;

/** Native RemoteViews render matrix with deterministic fixtures, not launcher/phone proof. */
final class WidgetFamilyChecks {
    private static int assertions;
    private static final java.util.List<String> clipping = new java.util.ArrayList<>();
    private static void require(boolean condition,String label) { assertions++; if (!condition) throw new AssertionError(label); }
    static void run(Instrumentation instrument,Bundle result,boolean live) throws Exception {
        Context original = instrument.getTargetContext(); WidgetStore store = new WidgetStore(original); int id = 987660;
        Station a = new Station("910GANERLEY","Anerley Rail Station",51.412153,-.065886,"");
        Station b = new Station("HUBVIC","Victoria Underground Station",51.496,-.144,"1000248");
        long now = Instant.parse("2026-11-15T09:00:00Z").toEpochMilli();
        try {
            long registered = original.getSystemService(AppWidgetManager.class).getInstalledProviders().stream().filter(p -> p.provider.getPackageName().equals(original.getPackageName())).count();
            require(registered == 5,"five registered native providers");
            Bitmap sheet = Bitmap.createBitmap(1080,1760,Bitmap.Config.ARGB_8888); Canvas canvas = new Canvas(sheet); canvas.drawColor(0xffe7ecf4);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(0xff10253f); paint.setTextSize(21);
            canvas.drawText("JOURNEY / NATIVE WIDGET LAYOUT CHECK",20,30,paint); paint.setTextSize(14);
            canvas.drawText("Fixture times and statuses. Minimum / standard / wide. Not a live launcher screenshot.",20,53,paint);
            int y = 75; WidgetKind[] kinds = {WidgetKind.NEXT,WidgetKind.HOME,WidgetKind.ROUTE,WidgetKind.LINE};
            for (WidgetKind kind : kinds) for (float font : new float[]{1f,1.3f}) {
                Configuration config = new Configuration(original.getResources().getConfiguration()); config.densityDpi = 160; config.fontScale = font;
                Context c = original.createConfigurationContext(config);
                store.configure(id,kind,kind == WidgetKind.HOME ? null : a,kind == WidgetKind.HOME ? a : b,kind == WidgetKind.HOME,kind == WidgetKind.LINE ? "windrush" : "");
                require(store.configured(id,kind),kind+" configuration");
                JSONObject snap;
                if (kind == WidgetKind.NEXT) snap = new JSONObject().put("checkedAt",now).put("ids",new JSONArray().put(a.id)).put("arrivals",new JSONArray().put(new JSONObject().put("naptanId",a.id).put("lineName","Windrush").put("destinationName","Highbury & Islington").put("platformName","Platform 1").put("timestamp","2026-11-15T09:00:00Z").put("expectedArrival","2026-11-15T09:06:00Z")));
                else if (kind == WidgetKind.ROUTE) snap = new JSONObject().put("checkedAt",now).put("departureAt",now+120000).put("arrivalAt",now+2700000).put("summary","Windrush to Canada Water / Jubilee to Westminster");
                else snap = new JSONObject().put("checkedAt",now).put("lineId","windrush").put("status","Part Closure").put("good",false);
                store.prefs.edit().putString(id+":snapshot",snap.toString()).apply();
                canvas.drawText(kind.title+" / text "+font+"x",20,y+14,paint);
                int[][] sizes = kind == WidgetKind.NEXT ? new int[][]{{110,110},{170,170},{300,170}} : kind == WidgetKind.ROUTE ? new int[][]{{250,110},{300,170},{360,220}} : new int[][]{{110,56},{180,90},{300,90}};
                final int top = y+24; int x = 20;
                for (int[] size : sizes) {
                    final int left = x;
                    instrument.runOnMainSync(() -> {
                        View view = WidgetRenderer.create(c,id,kind,size[0],size[1],now).apply(c,new FrameLayout(c));
                        view.measure(View.MeasureSpec.makeMeasureSpec(size[0],View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(size[1],View.MeasureSpec.EXACTLY)); view.layout(0,0,size[0],size[1]);
                        require(view.getContentDescription() != null,kind+" accessible full description");
                        checkBounds(view,view,kind+" "+size[0]+"x"+size[1]+" font "+font);
                        canvas.save(); canvas.translate(left,top); view.draw(canvas); canvas.restore();
                    });
                    canvas.drawText(size[0]+" x "+size[1]+" dp",x,top+size[1]+17,paint); x+=size[0]+22;
                }
                // Failure and expired data must never retain apparently current clocks/statuses.
                if (kind != WidgetKind.HOME) {
                    store.prefs.edit().putString(id+":error","NETWORK_OR_SOURCE_UNAVAILABLE").apply();
                    instrument.runOnMainSync(() -> {
                        View v = WidgetRenderer.create(c,id,kind,300,220,now).apply(c,new FrameLayout(c));
                        require(((TextView)v.findViewById(R.id.compact_meta)).getText().toString().startsWith("Failed /"),kind+" failure label");
                        int primary = kind == WidgetKind.ROUTE ? R.id.route_arrival : R.id.compact_value;
                        require(!((TextView)v.findViewById(primary)).getText().toString().matches("09:06|09:45|Part Closure"),kind+" error clears apparent current answer");
                    });
                    store.prefs.edit().remove(id+":error").apply();
                    instrument.runOnMainSync(() -> {
                        View v = WidgetRenderer.create(c,id,kind,300,220,now+181000).apply(c,new FrameLayout(c));
                        require(((TextView)v.findViewById(R.id.compact_meta)).getText().toString().startsWith("Old /"),kind+" expired source label");
                    });
                }
                y += (kind == WidgetKind.NEXT ? 230 : kind == WidgetKind.ROUTE ? 280 : 150);
            }
            File file = new File(original.getExternalFilesDir(null),"widget-family-fixtures.png");
            try (FileOutputStream stream = new FileOutputStream(file)) { sheet.compress(Bitmap.CompressFormat.PNG,100,stream); } sheet.recycle();
            result.putString("nativeRender",file.getAbsolutePath());
            require(clipping.isEmpty(),"Clipped layouts: "+clipping);
            if (live) {
                TflClient client = new TflClient(); Station london = new Station("940GZZLULNB","London Bridge",51.505881,-.086807,"1000139");
                JSONObject next = client.snapshot(london), route = client.journey(london,b), line = client.lineStatus("windrush");
                require(WidgetData.fresh(next,System.currentTimeMillis()),"real departure retrieval timestamp");
                require(route.getLong("arrivalAt") > System.currentTimeMillis(),"real returned journey arrival");
                require(line.getString("lineId").equals("windrush"),"real exact line identity");
                result.putString("liveMetadata",new JSONObject().put("checkedAt",next.getLong("checkedAt")).put("departureRows",next.getJSONArray("arrivals").length()).put("route",route).put("line",line).toString());
            }
            result.putString("result","PASS: "+assertions+" assertions, 24 native fixture renders; physical launcher not tested");
        } finally { store.remove(id); }
    }
    private static void checkBounds(View root,View view,String label) {
        if (view.getVisibility() != View.VISIBLE) return;
        if (view instanceof TextView text && text.getText().length()>0) {
            Rect r = new Rect(0,0,view.getWidth(),view.getHeight()); ((ViewGroup)root).offsetDescendantRectToMyCoords(view,r);
            assertions += 2;
            if (!(r.top>=0 && r.bottom<=root.getHeight() && view.getHeight()>0)) clipping.add(label+" outside bounds: "+text.getText());
            if (!(text.getLayout()!=null && text.getLayout().getHeight()<=text.getHeight()-text.getCompoundPaddingTop()-text.getCompoundPaddingBottom()+1)) clipping.add(label+" clipped: "+text.getText()+" allocated="+text.getHeight()+" needs="+(text.getLayout()==null ? 0 : text.getLayout().getHeight()));
        }
        if (view instanceof ViewGroup group) for (int i=0;i<group.getChildCount();i++) checkBounds(root,group.getChildAt(i),label);
    }
}
