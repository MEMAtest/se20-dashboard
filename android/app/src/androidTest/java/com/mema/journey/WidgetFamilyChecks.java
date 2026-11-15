package com.mema.journey;

import android.app.Instrumentation;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Chronometer;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.time.Instant;

/** Actual native layouts with labelled fixtures, plus opt-in bounded provider reads. */
final class WidgetFamilyChecks {
    private static int assertions;
    private static final java.util.List<String> clipping=new java.util.ArrayList<>();
    private static final WidgetKind[] KINDS={WidgetKind.NEXT,WidgetKind.HOME,WidgetKind.ROUTE,WidgetKind.LINE};
    private static void require(boolean value,String label) { assertions++; if(!value) throw new AssertionError(label); }
    private static Context context(Context original,float font) {
        Configuration config=new Configuration(original.getResources().getConfiguration()); config.densityDpi=160; config.fontScale=font;
        return original.createConfigurationContext(config);
    }
    private static JSONObject legs() throws Exception {
        return new JSONObject().put("legs",new JSONArray().put(new JSONObject().put("mode","walking").put("minutes",5)).put(new JSONObject().put("mode","national-rail").put("minutes",21)).put(new JSONObject().put("mode","walking").put("minutes",4)));
    }
    private static void fixture(WidgetStore store,int id,WidgetKind kind,long now) throws Exception {
        Station from=new Station("910GCLOCKHS","Clock House Rail Station",51.4085,-.04,"");
        Station bus=new Station("4900FIXTUREA","Penge High Street",51.41,-.06,"");
        Station to=new Station("940GZZLULNB","London Bridge",51.505881,-.086807,"1000139");
        store.configure(id,kind,kind==WidgetKind.HOME ? null : kind==WidgetKind.NEXT ? bus : from,kind==WidgetKind.HOME ? new Station("910GANERLEY","Anerley",51.412153,-.065886,"") : to,kind==WidgetKind.HOME,kind==WidgetKind.LINE ? "jubilee" : "");
        if(kind==WidgetKind.HOME) store.homeLabel(id,"SE20");
        JSONObject snap;
        if(kind==WidgetKind.NEXT) {
            JSONArray rows=new JSONArray();
            for(int minutes:new int[]{4,12,21}) rows.put(new JSONObject().put("naptanId",bus.id).put("modeName","bus").put("lineName","176").put("lineId","176").put("destinationName","Tottenham Court Road").put("timestamp",Instant.ofEpochMilli(now).toString()).put("expectedArrival",Instant.ofEpochMilli(now+minutes*60000).toString()));
            snap=new JSONObject().put("checkedAt",now).put("ids",new JSONArray().put(bus.id)).put("arrivals",rows);
        } else if(kind==WidgetKind.HOME || kind==WidgetKind.ROUTE) snap=legs().put("checkedAt",now).put("departureAt",now+(kind==WidgetKind.HOME ? 2 : 6)*60000).put("arrivalAt",now+(kind==WidgetKind.HOME ? 32 : 36)*60000).put("locationAt",kind==WidgetKind.HOME ? now : 0).put("summary","Walk / National Rail / walk");
        else snap=new JSONObject().put("checkedAt",now).put("lineId","jubilee").put("status","Minor Delays").put("good",false);
        store.prefs.edit().putString(id+":snapshot",snap.toString()).apply();
    }
    private static View draw(Context c,int id,WidgetKind kind,int w,int h,long now,Canvas canvas,float x,float y,float scale) {
        View view=WidgetRenderer.create(c,id,kind,w,h,now).apply(c,new FrameLayout(c));
        view.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY)); view.layout(0,0,w,h);
        checkBounds(view,view,kind+" "+w+"x"+h+" font "+c.getResources().getConfiguration().fontScale);
        if(canvas!=null) { canvas.save(); canvas.translate(x,y); canvas.scale(scale,scale); view.draw(canvas); canvas.restore(); }
        return view;
    }
    private static void save(Context c,Bitmap bitmap,String name) throws Exception {
        try(FileOutputStream stream=new FileOutputStream(new File(c.getExternalFilesDir(null),name))) { bitmap.compress(Bitmap.CompressFormat.PNG,100,stream); } bitmap.recycle();
    }
    static void run(Instrumentation instrument,Bundle result,boolean live) throws Exception {
        Context original=instrument.getTargetContext(); WidgetStore store=new WidgetStore(original); int id=987660;
        long now=Instant.parse("2026-11-15T08:42:00Z").toEpochMilli();
        try {
            require(original.getSystemService(AppWidgetManager.class).getInstalledProviders().stream().filter(p -> p.provider.getPackageName().equals(original.getPackageName())).count()==5,"five distinct native providers");
            Bitmap sheet=Bitmap.createBitmap(1080,1760,Bitmap.Config.ARGB_8888); Canvas canvas=new Canvas(sheet); canvas.drawColor(0xffe9ecf6);
            Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(0xff11182c); paint.setTextSize(21); canvas.drawText("JOURNEY / IMPLEMENTED NATIVE WIDGETS",20,30,paint); paint.setTextSize(14);
            canvas.drawText("Fixture data. Minimum / standard / wide. Not a launcher screenshot.",20,53,paint);
            int y=75;
            for(WidgetKind kind:KINDS) for(float font:new float[]{1f,1.3f}) {
                Context c=context(original,font); fixture(store,id,kind,now); require(store.configured(id,kind),kind+" configuration");
                canvas.drawText(kind.title+" / text "+font+"x",20,y+14,paint);
                int[][] sizes=kind==WidgetKind.NEXT ? new int[][]{{110,110},{180,180},{300,180}} : kind==WidgetKind.ROUTE ? new int[][]{{250,110},{330,180},{400,220}} : new int[][]{{110,56},{180,90},{300,90}};
                final int top=y+24; int x=20;
                for(int[] size:sizes) {
                    final int left=x;
                    instrument.runOnMainSync(() -> {
                        View view=draw(c,id,kind,size[0],size[1],now,canvas,left,top,1);
                        require(view.getContentDescription()!=null,kind+" full accessible description");
                        if(view.findViewById(R.id.compact_meta).getVisibility()==View.VISIBLE) require(((Chronometer)view.findViewById(R.id.compact_meta)).getText().toString().contains("age"),kind+" continuously ticking source age is visible");
                        if(kind==WidgetKind.NEXT || kind==WidgetKind.ROUTE) {
                            Chronometer clock=view.findViewById(R.id.compact_countdown);
                            require(clock.getVisibility()==View.VISIBLE && clock.isCountDown(),kind+" real system countdown");
                            long remaining=clock.getBase()-SystemClock.elapsedRealtime();
                            require(remaining>0 && remaining<=(kind==WidgetKind.NEXT ? 240000 : 360000),kind+" monotonic target, not static minutes");
                        }
                    });
                    canvas.drawText(size[0]+" x "+size[1]+" dp",x,top+size[1]+17,paint); x+=size[0]+22;
                }
                store.prefs.edit().putString(id+":error","NETWORK_OR_SOURCE_UNAVAILABLE").apply();
                instrument.runOnMainSync(() -> {
                    View view=draw(c,id,kind,300,220,now,null,0,0,1);
                    require(((TextView)view.findViewById(R.id.compact_value)).getVisibility()==View.VISIBLE,kind+" error shows fallback");
                    if(kind!=WidgetKind.HOME) require(((TextView)view.findViewById(R.id.compact_meta)).getText().toString().startsWith("Failed /"),kind+" failed source labelled");
                    if(kind==WidgetKind.NEXT || kind==WidgetKind.ROUTE) require(view.findViewById(R.id.compact_countdown).getVisibility()==View.GONE,kind+" failed countdown hidden");
                    if(kind==WidgetKind.HOME) require(((TextView)view.findViewById(R.id.compact_value)).getText().toString().contains("Check"),"home failure cannot show old ETA");
                });
                store.prefs.edit().remove(id+":error").apply();
                instrument.runOnMainSync(() -> {
                    View view=draw(c,id,kind,300,220,now+180000,null,0,0,1);
                    require(((TextView)view.findViewById(R.id.compact_value)).getVisibility()==View.VISIBLE,kind+" exact expiry boundary fallback");
                    if(kind==WidgetKind.NEXT || kind==WidgetKind.ROUTE) require(view.findViewById(R.id.compact_countdown).getVisibility()==View.GONE,kind+" expired countdown hidden");
                });
                y+=kind==WidgetKind.NEXT ? 240 : kind==WidgetKind.ROUTE ? 280 : 150;
            }
            save(original,sheet,"widget-reference-matrix.png"); result.putString("nativeRender",new File(original.getExternalFilesDir(null),"widget-reference-matrix.png").getAbsolutePath());
            Bitmap overview=Bitmap.createBitmap(740,800,Bitmap.Config.ARGB_8888); Canvas overviewCanvas=new Canvas(overview); overviewCanvas.drawColor(0xffe9ecf6);
            paint.setTextSize(30); overviewCanvas.drawText("Journey",24,38,paint); paint.setTextSize(14); overviewCanvas.drawText("Native Android widgets / reference design implementation",24,62,paint);
            Context c=context(original,1f);
            int[][] positions={{180,180,24,90},{180,90,366,90},{370,180,24,440},{180,90,366,270}};
            for(int i=0;i<KINDS.length;i++) { WidgetKind kind=KINDS[i]; fixture(store,id,kind,now); int[] p=positions[i]; instrument.runOnMainSync(() -> draw(c,id,kind,p[0],p[1],now,overviewCanvas,p[2],p[3],1.8f)); }
            overviewCanvas.drawText("Fixture times/statuses. Actual RemoteViews, not a phone launcher capture.",24,790,paint);
            save(original,overview,"widget-reference-overview.png");
            require(clipping.isEmpty(),"Clipped native layouts: "+clipping);
            fixture(store,id,WidgetKind.ROUTE,now); JSONObject route=store.read(id,"snapshot"); route.remove("legs"); store.prefs.edit().putString(id+":snapshot",route.toString()).apply();
            instrument.runOnMainSync(() -> { View view=draw(c,id,WidgetKind.ROUTE,330,180,now,null,0,0,1); require(view.findViewById(R.id.route_legs).getVisibility()==View.GONE,"no invented walk/train stages"); });
            require(!new WidgetStore(c).read(id,"snapshot").has("latitude"),"no phone coordinates in stored snapshot");
            if(live) live(instrument,original,result,id);
            result.putString("result","PASS: "+assertions+" assertions; 24 native layout fixtures plus failure/expiry/overview checks. Physical phone not tested.");
        } finally { store.remove(id); }
    }
    private static void live(Instrumentation instrument,Context original,Bundle result,int id) throws Exception {
        TflClient client=new TflClient(); Station london=new Station("940GZZLULNB","London Bridge",51.505881,-.086807,"1000139"), victoria=new Station("HUBVIC","Victoria",51.496,-.144,"1000248");
        JSONObject detail=(JSONObject)client.get("StopPoint/490010905E"); Station requested=new Station("490010905E","High Street / Maple Road / Stop E",51.41573,-.05368,""); Station bus=Station.fromJson(TflClient.resolveBoard(detail,requested));
        JSONObject next=client.snapshot(bus), route=client.journey(london,victoria), home=client.journey(victoria,london), line=client.lineStatus("jubilee");
        long now=System.currentTimeMillis(); require(WidgetData.fresh(next,now),"real bus source timestamp"); require(route.optLong("arrivalAt")>now,"real route estimate"); require(home.optLong("arrivalAt")>now,"real fixed-origin home estimate"); require(line.optString("lineId").equals("jubilee"),"exact real line identity");
        JSONArray rows=next.getJSONArray("arrivals"); require(rows.length()>0,"actual bus predictions returned, not no-data pass");
        for(int i=0;i<rows.length();i++) require(rows.getJSONObject(i).optString("naptanId").equals(bus.id),"real prediction stop identity");
        WidgetStore store=new WidgetStore(original); Context c=context(original,1);
        Bitmap liveSheet=Bitmap.createBitmap(740,800,Bitmap.Config.ARGB_8888); Canvas canvas=new Canvas(liveSheet); canvas.drawColor(0xffe9ecf6); Paint p=new Paint(Paint.ANTI_ALIAS_FLAG); p.setColor(0xff11182c); p.setTextSize(22); canvas.drawText("JOURNEY / REAL TFL DATA / "+WidgetData.checked(now),24,36,p); p.setTextSize(14); canvas.drawText("Point-in-time source check. Fixed-origin Home, not phone GPS.",24,61,p);
        int[][] positions={{180,180,24,90},{180,90,366,90},{370,180,24,440},{180,90,366,270}};
        for(int i=0;i<KINDS.length;i++) {
            WidgetKind kind=KINDS[i]; store.configure(id,kind,kind==WidgetKind.NEXT ? bus : kind==WidgetKind.HOME ? victoria : london,kind==WidgetKind.HOME ? london : victoria,false,kind==WidgetKind.LINE ? "jubilee" : "");
            JSONObject snap=kind==WidgetKind.NEXT ? next : kind==WidgetKind.HOME ? home : kind==WidgetKind.ROUTE ? route : line;
            store.prefs.edit().putString(id+":snapshot",snap.toString()).apply(); int[] pos=positions[i];
            instrument.runOnMainSync(() -> {
                long renderNow=System.currentTimeMillis(); View view=draw(c,id,kind,pos[0],pos[1],renderNow,canvas,pos[2],pos[3],1.8f);
                if(kind==WidgetKind.NEXT || kind==WidgetKind.ROUTE) {
                    Chronometer clock=view.findViewById(R.id.compact_countdown); long remaining=clock.getBase()-SystemClock.elapsedRealtime();
                    result.putString(kind+"Counter", "text="+clock.getText()+", remainingMs="+remaining+", renderAt="+renderNow+", sourceAt="+snap.optLong("checkedAt"));
                    require(clock.isCountDown(),kind+" real counter direction");
                    if(clock.getVisibility()==View.VISIBLE && remaining>2000) require(!clock.getText().toString().equals("00:00"),kind+" live countdown must not falsely say zero");
                }
            });
        }
        canvas.drawText("Actual native renders with returned provider data; not a launcher screenshot.",24,790,p);
        save(original,liveSheet,"widget-real-data.png");
        result.putString("liveMetadata",new JSONObject().put("busStop",bus.json()).put("busRows",rows.length()).put("checkedAt",next.getLong("checkedAt")).put("route",route).put("homeFixedOrigin",home).put("line",line).toString());
    }
    private static void checkBounds(View root,View view,String label) {
        if(view.getVisibility()!=View.VISIBLE) return;
        if(view instanceof TextView text && text.getText().length()>0) {
            Rect r=new Rect(0,0,view.getWidth(),view.getHeight()); ((ViewGroup)root).offsetDescendantRectToMyCoords(view,r); assertions+=2;
            if(!(r.top>=0 && r.bottom<=root.getHeight() && view.getHeight()>0)) clipping.add(label+" outside bounds: "+text.getText());
            if(!(text.getLayout()!=null && text.getLayout().getHeight()<=text.getHeight()-text.getCompoundPaddingTop()-text.getCompoundPaddingBottom()+1)) clipping.add(label+" clipped: "+text.getText()+" allocated="+text.getHeight()+" needs="+(text.getLayout()==null ? 0 : text.getLayout().getHeight()));
            if(text.getId()==R.id.compact_countdown && text.getLayout()!=null) { assertions++; if(text.getLayout().getEllipsisCount(0)>0 || text.getPaint().measureText(text.getText().toString())>text.getWidth()+1) clipping.add(label+" timer clipped horizontally"); }
        }
        if(view instanceof ViewGroup group) for(int i=0;i<group.getChildCount();i++) checkBounds(root,group.getChildAt(i),label);
    }
}
