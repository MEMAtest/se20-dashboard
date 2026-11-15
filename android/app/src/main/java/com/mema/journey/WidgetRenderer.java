package com.mema.journey;

import android.content.Context;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.ArrayList;

final class WidgetRenderer {
    static String stationName(Station station) { return station == null ? "Choose a station" : station.name.replaceAll(" (Underground|Rail|DLR) Station$| Tram Stop$", ""); }
    static String stamp(JSONObject snapshot,String error,long now) {
        long at=snapshot.optLong("checkedAt");
        if(at<=0 || at>now+30_000) return error.isEmpty() ? "Not checked / refresh" : "Failed / retry";
        String date=at>0 && at<=now+30_000 ? WidgetData.shortChecked(at) : "Not checked";
        return (!error.isEmpty() ? "Failed / " : !WidgetData.fresh(snapshot,now) && at>0 ? "Old / " : "Checked ") + date;
    }
    static void text(RemoteViews v,int id,String value) { v.setTextViewText(id,value); }
    static void size(RemoteViews v,int id,float value) { v.setTextViewTextSize(id,TypedValue.COMPLEX_UNIT_SP,value); }
    static int dp(Context c,int n) { return Math.round(c.getResources().getDisplayMetrics().density*n); }
    static void sourceAge(RemoteViews v,JSONObject snapshot,String error,long now,String prefix) {
        long at=snapshot.optLong("checkedAt"); boolean fresh=WidgetData.fresh(snapshot,now) && error.isEmpty();
        v.setChronometerCountDown(R.id.compact_meta,false);
        long base=SystemClock.elapsedRealtime()-Math.max(0,now-at);
        v.setChronometer(R.id.compact_meta,base,prefix+" / age %s",fresh);
        if(fresh) v.setLong(R.id.compact_meta,"setBase",base);
        if(!fresh) text(v,R.id.compact_meta,stamp(snapshot,error,now));
    }
    static void countdown(RemoteViews v,long target,long now,boolean valid,String fallback,float font) {
        v.setViewVisibility(R.id.compact_value,valid ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.compact_countdown,valid ? View.VISIBLE : View.GONE);
        text(v,R.id.compact_value,fallback); size(v,R.id.compact_value,font); size(v,R.id.compact_countdown,font);
        v.setChronometerCountDown(R.id.compact_countdown,true);
        v.setChronometer(R.id.compact_countdown,SystemClock.elapsedRealtime()+Math.max(0,target-now),"%s",valid);
    }
    static RemoteViews create(Context c,int id,WidgetKind kind,int width,int height,long now) {
        if(kind==WidgetKind.BOARD) return DeparturesWidget.boardViews(c,id,now);
        WidgetStore store=new WidgetStore(c); JSONObject config=store.read(id,"config"), snapshot=store.read(id,"snapshot");
        Station origin=store.station(id,"station"), destination=store.station(id,"destination");
        String error=store.prefs.getString(id+":error",""); float scale=c.getResources().getConfiguration().fontScale;
        boolean tiny=kind==WidgetKind.NEXT ? width<145 || height<145 : width<145 || height<75;
        boolean flat=kind==WidgetKind.ROUTE && (height<150 || (scale>1.2f && height<190));
        int layout=kind==WidgetKind.NEXT ? R.layout.widget_next : kind==WidgetKind.HOME ? R.layout.widget_home : kind==WidgetKind.LINE ? R.layout.widget_line : flat ? R.layout.widget_route_compact : R.layout.widget_route;
        RemoteViews v=new RemoteViews(c.getPackageName(),layout);
        boolean configured=store.configured(id,kind), fresh=WidgetData.fresh(snapshot,now) && error.isEmpty();
        v.setOnClickPendingIntent(R.id.compact_root,DeparturesWidget.activity(c,id,configured ? MainActivity.class : WidgetConfigActivity.class));
        sourceAge(v,snapshot,error,now,(snapshot.optBoolean("partial") ? "Partial " : "")+WidgetData.clock(Math.max(0,snapshot.optLong("checkedAt"))));
        v.setContentDescription(R.id.compact_meta,stamp(snapshot,error,now)+". Dated snapshot, not a new source check. Refresh before travel.");
        if(kind==WidgetKind.HOME) {
            boolean phone=config.optBoolean("phone");
            boolean locationFresh=!phone || (snapshot.optLong("locationAt")>0 && now>=snapshot.optLong("locationAt") && now-snapshot.optLong("locationAt")<=180_000);
            boolean valid=fresh && locationFresh && snapshot.optLong("departureAt")>=now && snapshot.optLong("arrivalAt")>snapshot.optLong("departureAt");
            text(v,R.id.compact_title,"Home / "+(config.optString("homeLabel").isEmpty() ? stationName(destination) : config.optString("homeLabel")));
            int homeMinutes=WidgetData.minutes(snapshot.optLong("arrivalAt")-snapshot.optLong("checkedAt"));
            String estimate=homeMinutes>=100 ? (homeMinutes/60)+"h"+(homeMinutes%60>0 ? "+" : "") : homeMinutes+(tiny ? "m" : " min");
            text(v,R.id.compact_value,valid ? estimate : tiny ? "Check" : "Check route");
            text(v,R.id.compact_subtitle,valid ? WidgetData.homeSummary(snapshot) : phone ? "Use phone, on tap" : "From "+stationName(origin));
            String source=phone && snapshot.optLong("locationAt")>0 ? "Fix "+WidgetData.clock(snapshot.optLong("locationAt"))+" / "+WidgetData.clock(snapshot.optLong("checkedAt")) : stamp(snapshot,error,now);
            if(valid) sourceAge(v,snapshot,error,now,phone ? "Fix "+WidgetData.clock(snapshot.optLong("locationAt")) : WidgetData.clock(snapshot.optLong("checkedAt")));
            else { v.setChronometer(R.id.compact_meta,0,"%s",false); text(v,R.id.compact_meta,phone ? "Tap for a fresh fix" : stamp(snapshot,error,now)); }
            v.setOnClickPendingIntent(R.id.compact_root,DeparturesWidget.activity(c,id,configured ? HomeEstimateActivity.class : WidgetConfigActivity.class));
            v.setContentDescription(R.id.compact_root,"Home to "+stationName(destination)+". "+(valid ? WidgetData.minutes(snapshot.optLong("arrivalAt")-snapshot.optLong("checkedAt"))+" minute estimate from the check time, including any wait before departure. "+source : "No current verified estimate.")+". Tap to check; phone location is only obtained after your explicit request. No background tracking.");
            if(tiny) {
                v.setViewVisibility(R.id.home_mark,View.GONE); v.setViewVisibility(R.id.compact_subtitle,View.GONE); v.setViewVisibility(R.id.compact_meta,View.GONE);
                v.setViewPadding(R.id.compact_root,dp(c,7),dp(c,5),dp(c,7),dp(c,5)); v.setViewPadding(R.id.home_content,0,0,0,0);
                text(v,R.id.compact_title,valid ? "Home / "+WidgetData.clock(snapshot.optLong("checkedAt")) : "Home");
                size(v,R.id.compact_title,scale>1.2f ? 9 : 10); size(v,R.id.compact_value,scale>1.2f ? 16 : 20);
            } else {
                size(v,R.id.compact_title,scale>1.2f ? 10 : 12); size(v,R.id.compact_value,scale>1.2f ? 21 : 25);
                if(width<180) v.setViewVisibility(R.id.home_mark,View.GONE);
            }
            return v;
        }
        v.setOnClickPendingIntent(R.id.compact_refresh,DeparturesWidget.refresh(c,id));
        if(kind==WidgetKind.NEXT) {
            v.setOnClickPendingIntent(R.id.compact_title,DeparturesWidget.activity(c,id,MainActivity.class));
            text(v,R.id.compact_title,stationName(origin));
            JSONArray ids=snapshot.optJSONArray("ids"), rows=snapshot.optJSONArray("arrivals"); Set<String> allowed=new HashSet<>();
            if(ids!=null) for(int i=0;i<ids.length();i++) allowed.add(ids.optString(i));
            List<WidgetData.Departure> departures=rows==null ? java.util.Collections.emptyList() : WidgetData.allDepartures(rows,allowed,now);
            WidgetData.Departure next=fresh && !departures.isEmpty() ? departures.get(0) : null;
            boolean bus=next!=null && next.mode().equals("bus");
            text(v,R.id.next_badge,next==null ? "TfL" : next.line());
            v.setImageViewResource(R.id.next_mode,next==null ? R.drawable.ic_pin : bus ? R.drawable.ic_bus : !next.mode().isEmpty() || WidgetData.line(next.lineId())!=null ? R.drawable.ic_train : R.drawable.ic_pin);
            text(v,R.id.compact_subtitle,next!=null ? next.destination() : !configured ? "Choose a stop" : fresh ? "No TfL predictions" : "Tap refresh");
            countdown(v,next==null ? 0 : next.at(),now,next!=null,"Check",tiny ? (scale>1.2f ? 22 : 26) : scale>1.2f ? 30 : 38);
            List<String> following=new ArrayList<>();
            if(next!=null) for(int i=1;i<departures.size() && following.size()<2;i++) {
                WidgetData.Departure d=departures.get(i);
                if(d.line().equals(next.line()) && d.destination().equals(next.destination())) following.add(Integer.toString(WidgetData.minutes(d.at()-now)));
            }
            text(v,R.id.compact_extra,next==null ? "TfL only / not all rail" : following.isEmpty() ? "min:sec to departure" : "Then "+String.join(" / ",following)+" min at check");
            v.setContentDescription(R.id.compact_root,"Next up at "+stationName(origin)+". "+(next==null ? "No current verified prediction." : next.line()+" to "+next.destination()+", expected "+WidgetData.clock(next.at())+" London. Countdown is based on the dated prediction, not a new live check.")+" "+stamp(snapshot,error,now)+". Tap to open Journey; refresh button checks the provider.");
            if(tiny || scale>1.2f) {
                v.setViewPadding(R.id.compact_body,dp(c,7),dp(c,5),dp(c,7),dp(c,4));
                size(v,R.id.compact_title,11); size(v,R.id.compact_subtitle,11); size(v,R.id.compact_meta,8);
                v.setViewVisibility(R.id.next_pin,View.GONE); v.setViewVisibility(R.id.compact_extra,View.GONE);
                if(tiny) v.setViewVisibility(R.id.next_service,View.GONE);
            }
        } else if(kind==WidgetKind.LINE) {
            String lineId=config.optString("lineId"); String[] line=WidgetData.line(lineId);
            boolean verified=fresh && lineId.equals(snapshot.optString("lineId")) && !snapshot.optString("status").isEmpty();
            text(v,R.id.compact_title,line==null ? "Line watch" : line[1]);
            text(v,R.id.compact_value,verified ? snapshot.optString("status") : "Check status");
            v.setInt(R.id.compact_value,"setTextColor",verified && !snapshot.optBoolean("good") ? 0xff9c5a05 : 0xff4c596f);
            v.setInt(R.id.status_dot,"setColorFilter",verified ? snapshot.optBoolean("good") ? 0xff338852 : 0xffdb941f : 0xff929bb1);
            v.setInt(R.id.line_colour,"setBackgroundColor",line==null ? 0xff929bb1 : android.graphics.Color.parseColor(line[2]));
            v.setOnClickPendingIntent(R.id.line_open,DeparturesWidget.activity(c,id,MainActivity.class));
            v.setContentDescription(R.id.compact_root,(line==null ? "Line watch" : line[1])+": "+(verified ? snapshot.optString("status") : "not currently verified")+". "+stamp(snapshot,error,now)+". Tap for exact line details.");
            if(tiny) {
                v.setViewVisibility(R.id.line_open,View.GONE); v.setViewVisibility(R.id.compact_refresh,View.GONE);
                v.setViewPadding(R.id.compact_root,dp(c,6),dp(c,3),dp(c,6),dp(c,3));
                size(v,R.id.compact_title,scale>1.2f ? 10 : 12); size(v,R.id.compact_value,scale>1.2f ? 9 : 10); size(v,R.id.compact_meta,8);
                v.setViewPadding(R.id.compact_meta,0,0,0,0);
            } else if(scale>1.2f) { size(v,R.id.compact_title,14); size(v,R.id.compact_value,11); size(v,R.id.compact_meta,8); }
        } else {
            long departure=snapshot.optLong("departureAt"), arrival=snapshot.optLong("arrivalAt");
            boolean valid=fresh && departure>=now && arrival>departure;
            text(v,R.id.compact_title,stationName(destination));
            text(v,R.id.route_arrival,valid ? "Arrive "+WidgetData.clock(arrival) : "No estimate");
            text(v,R.id.route_origin,"From "+stationName(origin));
            text(v,R.id.compact_label,valid ? "Leave in / min:sec" : "Route estimate");
            countdown(v,departure,now,valid,flat ? "Check route" : "Refresh",flat ? 23 : scale>1.2f ? 27 : 32);
            text(v,R.id.compact_subtitle,valid ? WidgetData.clock(departure)+" departure / "+WidgetData.minutes(arrival-departure)+" min total" : "Refresh for checked times");
            v.setOnClickPendingIntent(R.id.route_open,DeparturesWidget.activity(c,id,MainActivity.class));
            JSONArray legs=valid ? snapshot.optJSONArray("legs") : null;
            if(!flat && legs!=null && legs.length()>0) {
                for(int i=0;i<3;i++) {
                    int group=new int[]{R.id.leg_0,R.id.leg_1,R.id.leg_2}[i], icon=new int[]{R.id.leg_icon_0,R.id.leg_icon_1,R.id.leg_icon_2}[i], label=new int[]{R.id.leg_label_0,R.id.leg_label_1,R.id.leg_label_2}[i], time=new int[]{R.id.leg_time_0,R.id.leg_time_1,R.id.leg_time_2}[i];
                    JSONObject leg=legs.optJSONObject(i);
                    v.setViewVisibility(group,leg==null ? View.GONE : View.VISIBLE);
                    if(leg!=null) {
                        String mode=leg.optString("mode");
                        boolean more=i==2 && legs.length()>3;
                        text(v,label,more ? "More" : WidgetData.modeLabel(mode)); text(v,time,more ? "+"+(legs.length()-2) : leg.isNull("minutes") ? "?" : leg.optInt("minutes")+"m");
                        v.setImageViewResource(icon,more ? R.drawable.ic_chevron : mode.equals("walking") ? R.drawable.ic_walk : mode.equals("bus") ? R.drawable.ic_bus : R.drawable.ic_train);
                        v.setContentDescription(group,more ? (legs.length()-2)+" more legs. Open journey for full route." : WidgetData.modeLabel(mode)+": "+(leg.isNull("minutes") ? "duration unverified" : leg.optInt("minutes")+" minutes"));
                    }
                }
            } else v.setViewVisibility(R.id.route_legs,View.GONE);
            v.setContentDescription(R.id.compact_root,"Journey from "+stationName(origin)+" to "+stationName(destination)+". "+(valid ? "Leave "+WidgetData.clock(departure)+", arrive "+WidgetData.clock(arrival)+". "+snapshot.optString("summary") : "No current verified route.")+" "+stamp(snapshot,error,now)+". Countdown uses that estimate. Open journey for full legs, walking and transfers.");
            if(flat) {
                v.setViewPadding(R.id.compact_body,dp(c,8),dp(c,5),dp(c,8),dp(c,3));
                v.setViewVisibility(R.id.route_pin,View.GONE); size(v,R.id.compact_title,12); size(v,R.id.compact_label,8); size(v,R.id.compact_subtitle,8); size(v,R.id.compact_meta,8);
                text(v,R.id.route_open,"Open ↗"); size(v,R.id.route_origin,9);
                if(height<130) { v.setViewVisibility(R.id.compact_label,View.GONE); v.setViewVisibility(R.id.compact_subtitle,View.GONE); size(v,R.id.route_arrival,8); }
            }
        }
        return v;
    }
}
