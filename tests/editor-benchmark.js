import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';
import { performance } from 'node:perf_hooks';

const n = 80;
const positions=[];
const faces=[];
for(let z=0; z<=n; z++) for(let x=0; x<=n; x++) positions.push([x,0,z]);
const id=(x,z)=>z*(n+1)+x;
for(let z=0; z<n; z++) for(let x=0; x<n; x++) faces.push([id(x,z),id(x+1,z),id(x+1,z+1),id(x,z+1)]);
const mesh = new Mesh(new Material());
mesh.positions = positions;
mesh.faces = faces;
mesh.faceColors = faces.map(()=>[0.7,0.8,0.9,1]);
mesh.faceUvs = faces.map(()=>[[0,0],[1,0],[1,1],[0,1]]);
mesh.faceUvTransforms = faces.map(()=>({scale:[1,1],offset:[0,0],rotation:0,flipX:false,flipY:false}));
mesh.rebuildRenderData();
const indices = Array.from({length:100}, (_,i)=>i);
let t0=performance.now();
for(let i=0;i<100;i++){
  for(const idx of indices) mesh.positions[idx][0]+=0.001;
  mesh.rebuildRenderData();
}
let naive=performance.now()-t0;
// rebuild base
mesh.rebuildRenderData();
t0=performance.now();
for(let i=0;i<100;i++) mesh.translateVertices(indices,[0.001,0,0]);
let fast=performance.now()-t0;
console.log(JSON.stringify({faces:faces.length,verts:positions.length,naiveMs:naive,fastMs:fast,speedup:naive/fast}));
