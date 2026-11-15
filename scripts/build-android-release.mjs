import { mkdir, readFile, writeFile, chmod, access, copyFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const signing = path.join(os.homedir(), '.android', 'journey-signing');
await mkdir(signing, { recursive: true, mode: 0o700 });
await chmod(signing, 0o700);
const key = path.join(signing, 'journey-release.p12'), secret = path.join(signing, 'password');
const exists = async file => { try { await access(file); return true; } catch { return false; } };
if (await exists(key) && !await exists(secret)) throw new Error('Signing key exists without its password. Restore the original; do not replace the signing identity.');
if (!await exists(secret)) await writeFile(secret, randomBytes(36).toString('base64url'), { mode: 0o600, flag: 'wx' });
await chmod(secret, 0o600);
const password = await readFile(secret, 'utf8');
const env = { ...process.env, JOURNEY_KEYSTORE_PATH: key, JOURNEY_KEYSTORE_PASSWORD: password, JOURNEY_SIGNING_PASSWORD: password };
const run = (command, args, cwd = root) => {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${path.basename(command)} failed; no release accepted`);
};
if (!await exists(key)) {
    const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
    run(keytool, ['-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-storepass:env', 'JOURNEY_SIGNING_PASSWORD', '-keypass:env', 'JOURNEY_SIGNING_PASSWORD', '-alias', 'journey', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Journey Android']);
}
await chmod(key, 0o600);
run(path.join(root, 'android', 'gradlew'), ['--no-daemon', '--console=plain', ':app:testDebugUnitTest', ':app:lintRelease', ':app:assembleRelease'], path.join(root, 'android'));
const output = process.env.JOURNEY_OUTPUT_DIR;
if (!output || !path.isAbsolute(output)) throw new Error('Set JOURNEY_OUTPUT_DIR to the canonical absolute release-artifact folder.');
await mkdir(output, { recursive: true });
const gradle = await readFile(path.join(root, 'android/app/build.gradle'), 'utf8');
const version = gradle.match(/versionName '([0-9.]+)'/)?.[1], versionCode = Number(gradle.match(/versionCode (\d+)/)?.[1]);
if (!version || !versionCode) throw new Error('Missing release version');
const apk = path.join(output, `Journey-Android-${version}.apk`);
const bytes = await readFile(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk')), sha256 = createHash('sha256').update(bytes).digest('hex');
if (await exists(apk) && createHash('sha256').update(await readFile(apk)).digest('hex') !== sha256) throw new Error('Refusing to overwrite a different accepted APK. Use a new evidence folder.');
await copyFile(path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'), apk);
const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim().length > 0;
const manifest = { package: 'com.mema.journey', version, versionCode, apk: path.basename(apk), bytes: bytes.length, sha256, source, dirty, builtAt: new Date().toISOString(), signingKey: '~/.android/journey-signing/journey-release.p12', acceptance: 'See ANDROID-ACCEPTANCE.md; a successful build alone is not physical-phone acceptance.' };
await writeFile(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ apk, sha256, bytes: bytes.length, source, dirty }));
