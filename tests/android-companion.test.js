const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');

test('native release has no background location or exported refresh receiver', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    assert.doesNotMatch(manifest, /ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE|SCHEDULE_EXACT_ALARM/);
    for (const name of ['DeparturesWidget','NextUpWidget','HomeWidget','JourneyWidget','LineWatchWidget'])
        assert.match(manifest, new RegExp(`\\.${name}"[^>]*android:exported="false"`));
    assert.match(manifest, /android:permission="android.permission.BIND_JOB_SERVICE"/);
    assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test('WebView has no native JavaScript bridge, file access or mixed-content exception', () => {
    const source = read('android/app/src/main/java/com/mema/journey/MainActivity.java');
    assert.doesNotMatch(source, /addJavascriptInterface|\.proceed\(|MIXED_CONTENT_ALWAYS_ALLOW/);
    assert.match(source, /setAllowFileAccess\(false\)/); assert.match(source, /setAllowContentAccess\(false\)/);
    assert.match(source, /journey-london\.ademola-584\.workers\.dev"\.equals\(uri\.getHost\(\)\)/);
});

test('native builds and keys are excluded from the static website staging allowlist', () => {
    const source = read('scripts/stage-assets.mjs');
    assert.doesNotMatch(source, /\.apk|\.p12|\.jks|android\/app|\.android/);
    assert.match(read('.gitignore'), /android\/\*\*\/build\//);
    assert.match(read('android/gradle/wrapper/gradle-wrapper.properties'), /distributionSha256Sum=[a-f0-9]{64}/);
});

test('Home checks are internal, foreground-only, and expiry performs no provider polling', () => {
    const manifest=read('android/app/src/main/AndroidManifest.xml');
    assert.match(manifest,/\.HomeEstimateActivity" android:exported="false"/);
    assert.match(manifest,/\.WidgetExpiry" android:exported="false"/);
    const home=read('android/app/src/main/java/com/mema/journey/HomeEstimateActivity.java');
    assert.match(home,/setOnClickListener\(v -> startCheck\(\)\)/);
    assert.match(home,/onStop\(\)/); assert.match(home,/removeUpdates\(listener\)/);
    assert.doesNotMatch(home,/ACCESS_BACKGROUND_LOCATION|\.put\("(?:latitude|longitude|lat|lon)"/);
    const expiry=read('android/app/src/main/java/com/mema/journey/WidgetExpiry.java');
    assert.match(expiry,/AlarmManager\.ELAPSED_REALTIME/);
    assert.doesNotMatch(expiry,/setExact|WAKEUP|new TflClient|\.journey\(|\.snapshot\(/);
});

test('reference widget counters use native monotonic clocks, with ticking source age and no fake leg tiles', () => {
    const renderer=read('android/app/src/main/java/com/mema/journey/WidgetRenderer.java');
    assert.match(renderer,/SystemClock\.elapsedRealtime\(\)/); assert.match(renderer,/setChronometerCountDown/);
    assert.match(renderer,/\/ age %s/); assert.match(renderer,/legs=valid \? snapshot\.optJSONArray\("legs"\)/);
    for(const name of ['widget_next','widget_route']) assert.match(read(`android/app/src/main/res/layout/${name}.xml`),/<Chronometer/);
});
