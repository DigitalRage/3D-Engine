import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';
import { Scene } from '../engine/scene.js';

test('instances can share geometry batches even when material colors differ', () => {
    const a = new Mesh(new Material({ color: [1, 0, 0, 1], baseColor: [1, 0, 0, 1], shading: 'toon' }));
    const b = new Mesh(new Material({ color: [0, 1, 0, 1], baseColor: [0, 1, 0, 1], shading: 'toon' }));
    a.setTopology([[0,0,0],[1,0,0],[0,1,0]], [[0,1,2]]);
    b.setTopology([[0,0,0],[1,0,0],[0,1,0]], [[0,1,2]]);
    a.rebuildRenderData();
    b.rebuildRenderData();
    assert.equal(a.getInstanceBatchKey(), b.getInstanceBatchKey());
});

test('scene addMany attaches meshes and bumps render revision once for the batch', () => {
    const scene = new Scene();
    const a = new Mesh(new Material());
    const b = new Mesh(new Material());
    const before = scene.renderRevision;
    scene.addMany([a, b]);
    assert.deepEqual(scene.meshes, [a, b]);
    assert.equal(a._scene, scene);
    assert.equal(b._scene, scene);
    assert.equal(scene.renderRevision, before + 2);
});


test('import-shell meshes skip initial legacy polygon Proxy construction', () => {
    const mesh = new Mesh(new Material(), { lazyTopology: true });
    assert.equal(mesh.lazyTopology, true);
    assert.equal(mesh._polygonProxy, null);
    mesh.setImportTopology([[0,0,0],[1,0,0],[0,1,0]], [[0,1,2]]);
    assert.equal(mesh.polygons.length, 1);
});


test('scene update does not scan every mesh when no animations are playing', () => {
    const scene = new Scene();
    const meshes = Array.from({ length: 200 }, () => new Mesh(new Material()));
    scene.addMany(meshes);
    let updates = 0;
    for (const mesh of meshes) mesh.animationPlayer.update = () => { updates++; };
    scene.update(1 / 60);
    assert.equal(updates, 0);
    scene._animatedRevision = -1;
});
