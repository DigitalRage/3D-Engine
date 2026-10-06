import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseMTL, parseOBJ } from '../engine/obj.js';

const root = new URL('../assets/', import.meta.url);
const objPath = new URL('Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.obj', root);
const mtlPath = new URL('Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.mtl', root);
const t0 = performance.now();
const objText = fs.readFileSync(objPath, 'utf8');
const mtlText = fs.readFileSync(mtlPath, 'utf8');
const materials = parseMTL(mtlText);
const data = parseOBJ(objText, { materials });
const parseMs = performance.now() - t0;
console.log(JSON.stringify({
  objects: data.objects.length,
  faces: data.objects.reduce((s, m) => s + m.faces.length, 0),
  parseMs
}));
