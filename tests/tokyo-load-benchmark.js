import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';

const path = '/mnt/data/Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.json';
const text = fs.readFileSync(path, 'utf8');
const t0 = performance.now();
const data = JSON.parse(text);
const parseMs = performance.now() - t0;

function build(lazy) {
  const meshes=[];
  const t=performance.now();
  for (const md of data.meshes) {
    const mat = new Material({color: md.color || md.baseColor || [0.78,0.84,0.92], baseColor: md.baseColor || md.color || [0.78,0.84,0.92], shading: md.shading || 'toon'});
    const m = new Mesh(mat, lazy ? {lazyTopology:true} : {});
    m.setImportTopology(md.positions || [], md.faces || [], {faceColors: md.faceColors || [], faceUvs: md.faceUvs || [], faceUvTransforms: md.faceUvTransforms || [], bakeFaceColors: !!md.bakeFaceColors});
    meshes.push(m);
  }
  return {ms: performance.now()-t, meshes};
}
const fast=build(true);
console.log(JSON.stringify({objects:data.meshes.length, faces:data.meshes.reduce((s,m)=>s+(m.faces?.length||0),0), parseMs, importMs:fast.ms, totalMs:parseMs+fast.ms}));
