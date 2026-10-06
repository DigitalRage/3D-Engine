import assert from 'node:assert/strict';
import test from 'node:test';
import { exportOBJ, parseMTL, parseOBJ } from '../engine/obj.js';
import { Material } from '../engine/material.js';
import { Mesh } from '../engine/mesh.js';

test('OBJ parser preserves multiple named objects and MTL colors', () => {
    const mtl = parseMTL(`newmtl Red\nKd 1 0 0\nNs 750\nPm 0.25\n`);
    const obj = parseOBJ(`mtllib city.mtl\no Building A\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl Red\nf 1/1 2/2 3/3 4/4\no Tree\nv 2 0 0\nv 3 0 0\nv 2 1 0\nf 5 6 7\n`, { materials: mtl });

    assert.equal(obj.mtllibs[0], 'city.mtl');
    assert.equal(obj.objects.length, 2);
    assert.equal(obj.objects[0].name, 'Building A');
    assert.equal(obj.objects[0].faces.length, 1);
    assert.deepEqual(obj.objects[0].faceUvs[0][2], [1, 1]);
    assert.deepEqual(obj.objects[0].faceColors[0], [1, 0, 0]);
    assert.equal(obj.objects[1].name, 'Tree');
});

test('OBJ parser supports negative vertex indices', () => {
    const obj = parseOBJ(`o Quad\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1\n`);
    assert.deepEqual(obj.objects[0].faces[0], [0, 1, 2, 3]);
});

test('OBJ exporter keeps meshes as separate objects and bakes transforms', () => {
    const first = Mesh.createCube(new Material({ color: [1, 0, 0] }));
    first.name = 'Building A';
    first.position = [10, 2, -3];
    first.scale = [2, 2, 2];
    first.rotation = [0, Math.PI / 2, 0];
    first.transformRevision += 1;
    first.faceColors[0] = [1, 0, 0, 1];
    first.faceUvs[0] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    first.rebuildRenderData();

    const second = Mesh.createCube(new Material({ color: [0, 1, 0] }));
    second.name = 'Tree';

    const result = exportOBJ([first, second]);
    assert.match(result.obj, /mtllib scene\.mtl/);
    assert.match(result.obj, /o Building_A/);
    assert.match(result.obj, /o Tree/);
    assert.match(result.obj, /usemtl mat_/);
    assert.match(result.obj, /f 1\/1 2\/2 3\/3 4\/4/);
    assert.ok(result.mtl.includes('newmtl '));
    assert.ok(result.objectCount === 2);
});
