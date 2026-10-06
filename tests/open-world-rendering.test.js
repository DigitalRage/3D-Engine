import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../engine/camera.js';
import { Scene } from '../engine/scene.js';
import { mat4 } from '../engine/mat4.js';
import { SpatialGrid } from '../engine/spatialGrid.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';

function ndcZ(matrix, z) {
    const clipZ = matrix[10] * z + matrix[14];
    const clipW = matrix[11] * z + matrix[15];
    return clipZ / clipW;
}

test('reverse-Z perspective maps near to far-side depth and far to zero-side depth', () => {
    const p = mat4.perspective(Math.PI / 3, 16 / 9, 0.1, 1000, new Float32Array(16), true);
    const near = ndcZ(p, -0.1);
    const far = ndcZ(p, -1000);
    assert.ok(Math.abs(near - 1) < 1e-6);
    assert.ok(Math.abs(far + 1) < 1e-6);
});

test('camera exposes a stable cached reverse-Z projection', () => {
    const camera = new Camera();
    camera.reverseZ = true;
    const a = camera.getProjectionMatrix(16 / 9);
    const b = camera.getProjectionMatrix(16 / 9);
    assert.strictEqual(a, b);
    assert.equal(camera._projectionSnapshot[5], 1);
});

test('spatial grid is conservative for objects whose bounds touch the query sphere', () => {
    const grid = new SpatialGrid({ cellSize: 10 });
    const inside = { name: 'inside' };
    const edge = { name: 'edge' };
    grid.insert(inside, { x: 0, y: 0, z: 0, r: 1 });
    grid.insert(edge, { x: 11, y: 0, z: 0, r: 2 });
    const result = grid.querySphere(0, 0, 0, 10);
    assert.ok(result.includes(inside));
    assert.ok(result.includes(edge));
});

test('static imported geometry with consistently inward winding is protected from back-face culling', async () => {
    const { Mesh } = await import('../engine/mesh.js');
    const { Material } = await import('../engine/material.js');
    const material = new Material({ color: [1, 1, 1, 1], shading: 'flat', doubleSided: false });
    const mesh = new Mesh(material, { lazyTopology: true });
    const p = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
    ];
    const outward = [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
        [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]
    ];
    const inward = outward.map(face => [face[0], face[2], face[1]]);
    mesh.setStaticTopology(p, inward, []);
    assert.equal(mesh.material.doubleSided, true);
});

test('geometry edits invalidate cached world bounds before culling', () => {
    const mesh = new Mesh(new Material({ color: [1, 1, 1, 1] }), { lazyTopology: true });
    mesh.setImportTopology(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[0, 1, 2]],
        { faceColors: [[1, 1, 1, 1]] }
    );
    const first = mesh.getWorldBounds();
    const firstRadius = first.radius;
    assert.ok(firstRadius > 0);
    mesh.positions = [...mesh.positions, [100, 0, 0]];
    mesh.faces = [...mesh.faces, [0, 1, 3]];
    mesh.rebuildRenderData({ buildEditorData: false });
    const second = mesh.getWorldBounds();
    assert.ok(second.radius > firstRadius);
});


test('non-batchable meshes stay on the dynamic render path instead of disappearing', async () => {
    globalThis.window = globalThis.window || { innerWidth: 960, innerHeight: 540, addEventListener() {} };
    globalThis.document = globalThis.document || {
        getElementById() { return null; },
        createElement() { return { getContext() { return null; } }; }
    };
    class GL {
        constructor() {
            Object.assign(this, {
                VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
                COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 17, LESS: 18, GREATER: 19,
                CCW: 20, BLEND: 21, CULL_FACE: 22, BACK: 23, ARRAY_BUFFER: 24, ELEMENT_ARRAY_BUFFER: 25,
                STATIC_DRAW: 26, DYNAMIC_DRAW: 27, FLOAT: 28, TRIANGLES: 29, LINES: 30,
                UNSIGNED_SHORT: 31, UNSIGNED_INT: 32, TEXTURE0: 33, TEXTURE_2D: 34
            });
            this.drawn = 0;
        }
        getExtension() { return null; }
        createShader() { return {}; } shaderSource() {} compileShader() {}
        getShaderParameter() { return true; } getShaderInfoLog() { return ''; }
        createProgram() { return {}; } attachShader() {} linkProgram() {}
        getProgramParameter() { return true; } getProgramInfoLog() { return ''; }
        getUniformLocation(_p, name) { return name; }
        getAttribLocation(_p, name) { return name.startsWith('aInstance') ? 0 : 1; }
        useProgram() {} clearColor() {} enable() {} disable() {} depthFunc() {} frontFace() {}
        depthMask() {} clear() {} clearDepth() {} viewport() {}
        createBuffer() { return {}; } deleteBuffer() {} bindBuffer() {} bufferData() {} bufferSubData() {}
        createVertexArray() { return {}; } deleteVertexArray() {} bindVertexArray() {}
        enableVertexAttribArray() {} disableVertexAttribArray() {} vertexAttribPointer() {}
        vertexAttribDivisor() {} vertexAttrib4f() {}
        drawElements() { this.drawn++; } drawElementsInstanced() { this.drawn++; } drawArrays() {}
        activeTexture() {} bindTexture() {} uniformMatrix4fv() {} uniform4f() {} uniform4fv() {}
        uniform3f() {} uniform3fv() {} uniform2f() {} uniform1f() {} uniform1i() {} blendFunc() {}
        cullFace() {}
    }
    const { Renderer } = await import('../engine/render.js');
    const scene = new Scene();
    const mesh = new Mesh(new Material({ shading: 'toon', color: [1, 1, 1, 1] }), { lazyTopology: true });
    mesh.positions = [[-1, 0, 0], [1, 0, 0], [0, 1, 0]];
    mesh.faces = [[0, 1, 2]];
    mesh.faceColors = [[1, 1, 1, 1]];
    mesh.faceUvs = [[[0, 0], [1, 0], [0, 1]]];
    mesh.rebuildRenderData({ buildEditorData: false });
    scene.add(mesh);
    const canvas = { width: 960, height: 540, style: {}, getContext() { return new GL(); } };
    const renderer = new Renderer(canvas);
    await renderer.ready;
    const camera = new Camera();
    camera.position = [0, 0, 5];
    camera.target = [0, 0, 0];
    camera.far = 100;
    renderer.render(scene, camera);
    assert.ok(renderer.frameStats.drawCalls > 0);
    assert.equal(renderer.frameStats.culled, 0);
});


test('camera-edge culling keeps a command alive for one grace frame', async () => {
    const { Renderer } = await import('../engine/render.js');
    const rendererLike = { cullingEnabled: true, cullingMargin: 0, cullingGraceFrames: 1 };
    const command = {};
    const inside = new Float32Array(24);
    inside[0] = 1; inside[1] = 0; inside[2] = 0; inside[3] = 10;
    assert.equal(Renderer.prototype.isCommandVisible.call(rendererLike, command, { x: 0, y: 0, z: 0, r: 1 }, inside, 10), true);
    const outside = new Float32Array(24);
    outside[0] = 1; outside[1] = 0; outside[2] = 0; outside[3] = 1;
    assert.equal(Renderer.prototype.isCommandVisible.call(rendererLike, command, { x: -5, y: 0, z: 0, r: 0.1 }, outside, 11), true);
    assert.equal(Renderer.prototype.isCommandVisible.call(rendererLike, command, { x: -5, y: 0, z: 0, r: 0.1 }, outside, 12), false);
});

test('import shells also protect consistently inward winding while dynamic', async () => {
    const { Mesh } = await import('../engine/mesh.js');
    const { Material } = await import('../engine/material.js');
    const material = new Material({ color: [1, 1, 1, 1], shading: 'flat', doubleSided: false });
    const mesh = new Mesh(material, { lazyTopology: true });
    const p = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
    ];
    const outward = [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
        [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]
    ];
    mesh.setImportTopology(p, outward.map(face => [face[0], face[2], face[1]]));
    assert.equal(mesh.material.doubleSided, true);
});
