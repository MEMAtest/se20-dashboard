const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');

test('native release has no background location or exported refresh receiver', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    assert.doesNotMatch(manifest, /ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE|SCHEDULE_EXACT_ALARM/);
    assert.match(manifest, /\.DeparturesWidget" android:exported="false"/);
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
