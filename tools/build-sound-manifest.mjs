import { readdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const soundDir = join(root, 'assets', 'sound');
const manifestPath = join(soundDir, 'index.json');

const files = (await readdir(soundDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.ogg')
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

const assets = files.map(file => ({
    id: basename(file, '.ogg').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sound',
    name: basename(file, '.ogg'),
    path: file,
    loopable: true,
    tags: [],
    volume: 1
}));

const seen = new Map();
for (const asset of assets) {
    const count = (seen.get(asset.id) || 0) + 1;
    seen.set(asset.id, count);
    if (count > 1) asset.id = `${asset.id}-${count}`;
}

await writeFile(manifestPath, `${JSON.stringify({ version: 1, assets }, null, 2)}\n`);
console.log(`Wrote ${assets.length} OGG entries to ${manifestPath}`);
