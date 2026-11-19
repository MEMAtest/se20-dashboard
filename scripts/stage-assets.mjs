import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.deploy-assets');
const files = ['index.html', 'styles.css', 'app.js', 'app-updates.js', 'config.js', 'journey-guidance.js',
    'transit-data.js', 'network-map.js', 'tube-network.js', 'tube-map.js', 'tube-search.js', 'familiar-tube.svg', 'TUBE-MAP-LICENCE.txt', 'sw.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', '_headers'];
await mkdir(directory, { recursive: true });
for (const name of await readdir(directory)) {
    if (!files.includes(name)&&name!=='app-release.json') throw new Error('Unexpected staging file: ' + name);
}
const sources=new Map();const fingerprint=createHash('sha256');
for(const name of [...files].sort()) {
    const source=await readFile(path.join(root,name));sources.set(name,source);fingerprint.update(name+'\0');fingerprint.update(source);fingerprint.update('\0');
}
const version=fingerprint.digest('hex').slice(0,16);
const manifest = {};
for (const name of files) {
    const raw=sources.get(name),body=/\.(html|js|css|svg|json|txt)$/.test(name)?Buffer.from(raw.toString('utf8').replaceAll('__JOURNEY_RELEASE__',version)):raw;
    await writeFile(path.join(directory,name),body);
    manifest[name] = createHash('sha256').update(body).digest('hex');
}
const release=JSON.stringify({version,entry:'/index.html'})+'\n';
await writeFile(path.join(directory,'app-release.json'),release);
manifest['app-release.json']=createHash('sha256').update(release).digest('hex');
console.log(JSON.stringify({version,staticAssetCount:Object.keys(manifest).length,files:manifest}));
