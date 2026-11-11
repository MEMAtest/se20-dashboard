import { mkdir, readdir, copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.deploy-assets');
const files = ['index.html', 'styles.css', 'app.js', 'config.js', 'journey-guidance.js',
    'transit-data.js', 'network-map.js', 'sw.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', '_headers'];
await mkdir(directory, { recursive: true });
for (const name of await readdir(directory)) {
    if (!files.includes(name)) throw new Error('Unexpected staging file: ' + name);
}
const manifest = {};
for (const name of files) {
    await copyFile(path.join(root, name), path.join(directory, name));
    manifest[name] = createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex');
}
console.log(JSON.stringify({ staticAssetCount: files.length, files: manifest }));
