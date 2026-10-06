import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseMTL, parseOBJBuffer } from '../engine/obj.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';

const root = new URL('../assets/', import.meta.url);
const objPath = new URL('Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.obj', root);
const mtlPath = new URL('Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.mtl', root);
const objBytes = fs.readFileSync(objPath);
const mtlText = fs.readFileSync(mtlPath, 'utf8');
const materials = parseMTL(mtlText);

function benchmarkOnce() {
  const parseStart = performance.now();
  const data = parseOBJBuffer(objBytes, { materials });
  const parseMs = performance.now() - parseStart;

  const buildStart = performance.now();
  let renderVertices = 0;
  let triangles = 0;
  for (const object of data.objects) {
    const materialData = data.materials?.[object.materialName] || null;
    const color = object.faceColors?.[0] || materialData?.color || [1, 1, 1, 1];
    const material = new Material({
      name: object.materialName || 'OBJ Material',
      color,
      opacity: color[3] ?? 1,
      useTexture: false,
      shading: 'flat'
    });
    const mesh = new Mesh(material, { lazyTopology: true });
    mesh.bakeFaceColors = true;
    mesh.setStaticTopology(object.positions, object.faces, object.faceColors);
    renderVertices += mesh.vertices.length / 3;
    triangles += mesh.triangleCount;
  }
  const buildMs = performance.now() - buildStart;
  return { parseMs, buildMs, totalMs: parseMs + buildMs, objects: data.objects.length, triangles, renderVertices };
}

const REFERENCE_PRE_OPTIMIZATION_MS = 969.2;
benchmarkOnce(); // JIT warm-up.
const samples = [];
for (let i = 0; i < 7; i++) samples.push(benchmarkOnce());
const sorted = values => [...values].sort((a, b) => a - b);
const median = key => sorted(samples.map(sample => sample[key]))[Math.floor(samples.length / 2)];
const result = {
  objects: samples[0].objects,
  triangles: samples[0].triangles,
  renderVertices: samples[0].renderVertices,
  medianParseMs: median('parseMs'),
  medianBuildMs: median('buildMs'),
  medianTotalMs: median('totalMs'),
  referencePreOptimizationMs: REFERENCE_PRE_OPTIMIZATION_MS,
  speedupVsReference: REFERENCE_PRE_OPTIMIZATION_MS / median('totalMs')
};
console.log(JSON.stringify(result, null, 2));
