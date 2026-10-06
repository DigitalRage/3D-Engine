import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Renderer } from '../engine/render.js';
import { Scene } from '../engine/scene.js';
import { Camera } from '../engine/camera.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';
import { parseMTL, parseOBJBuffer } from '../engine/obj.js';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
};
globalThis.document = {
  getElementById() { return { width: 0, height: 0 }; },
  createElement() { return { getContext() { return null; } }; },
};

autoNoopGL();

function autoNoopGL() {
  class FakeGL {
    constructor() {
      Object.assign(this, {
        VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
        COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100, DEPTH_TEST: 0x0B71, LESS: 0x0201, CCW: 0x0901,
        BLEND: 0x0BE2, CULL_FACE: 0x0B44, BACK: 0x0405, ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
        STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, FLOAT: 0x1406, TRIANGLES: 0x0004, LINES: 0x0001,
        UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405, TEXTURE0: 0x84C0, TEXTURE_2D: 0x0DE1,
      });
    }
    getExtension() { return null; }
    createShader() { return {}; }
    shaderSource() {}
    compileShader() {}
    getShaderParameter() { return true; }
    getShaderInfoLog() { return ''; }
    createProgram() { return {}; }
    attachShader() {}
    linkProgram() {}
    getProgramParameter() { return true; }
    getProgramInfoLog() { return ''; }
    getUniformLocation(_p, name) { return name; }
    getAttribLocation(_p, name) { return name.startsWith('aInstance') ? -1 : 0; }
    useProgram() {}
    clearColor() {}
    enable() {}
    disable() {}
    depthFunc() {}
    frontFace() {}
    depthMask() {}
    clear() {}
    viewport() {}
    createBuffer() { return {}; }
    deleteBuffer() {}
    bindBuffer() {}
    bufferData() {}
    bufferSubData() {}
    createVertexArray() { return {}; }
    deleteVertexArray() {}
    bindVertexArray() {}
    enableVertexAttribArray() {}
    disableVertexAttribArray() {}
    vertexAttribPointer() {}
    vertexAttribDivisor() {}
    drawElements() {}
    drawElementsInstanced() {}
    drawArrays() {}
    activeTexture() {}
    bindTexture() {}
    uniformMatrix4fv() {}
    uniform4f() {}
    uniform4fv() {}
    uniform3f() {}
    uniform3fv() {}
    uniform2f() {}
    uniform1f() {}
    uniform1i() {}
    blendFunc() {}
    cullFace() {}
    createTexture() { return {}; }
    texImage2D() {}
    texParameteri() {}
    texParameterf() {}
    generateMipmap() {}
  }
  globalThis.FakeGL = FakeGL;
}

const root = new URL('../assets/', import.meta.url);
const objBytes = fs.readFileSync(new URL('Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.obj', root));
const mtlText = fs.readFileSync(new URL('Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.mtl', root), 'utf8');
const materials = parseMTL(mtlText);
const data = parseOBJBuffer(objBytes, { materials });
const scene = new Scene();
const meshes = [];
for (const object of data.objects) {
  const md = data.materials?.[object.materialName] || null;
  const color = object.faceColors?.[0] || md?.color || md?.baseColor || [1,1,1,1];
  const mesh = new Mesh(new Material({ name: object.materialName || 'OBJ Material', color, opacity: color[3] ?? 1, useTexture: false, shading: 'toon' }), {lazyTopology:true});
  mesh.bakeFaceColors = true;
  mesh.setStaticTopology(object.positions, object.faces, object.faceColors);
  meshes.push(mesh);
}
scene.addMany(meshes);

const canvas = { width: 960, height: 540, style: {}, getContext() { return new FakeGL(); } };
const renderer = new Renderer(canvas);
await renderer.ready;
renderer.setAutoQuality(false);
renderer.setRenderScale(0.75);
const camera = new Camera();
camera.position = [0, 8, 45];
camera.target = [0, 7, 0];
camera.far = 800;
for (let i = 0; i < 3; i++) renderer.render(scene, camera);
const samples = [];
for (let i = 0; i < 120; i++) {
  const a = i * 0.055;
  camera.position[0] = Math.sin(a) * 45;
  camera.position[2] = Math.cos(a) * 45;
  renderer.render(scene, camera);
  samples.push(renderer.frameStats.cpuMs);
}
samples.sort((a,b)=>a-b);
const pct = p => samples[Math.floor((samples.length - 1) * p)];
console.log(JSON.stringify({
  p50CpuMs: pct(0.5), p95CpuMs: pct(0.95), maxCpuMs: samples.at(-1),
  drawCalls: renderer.frameStats.drawCalls, batches: renderer.staticBatchManager?.batches.length,
  meshes: scene.meshes.length, triangles: scene._triangleCountCache,
}, null, 2));
