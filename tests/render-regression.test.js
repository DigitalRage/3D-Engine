import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';

function makeMesh(faceColor, materialColor = [1, 1, 1, 1]) {
    const mesh = new Mesh(new Material({ color: materialColor, baseColor: materialColor, shading: 'toon' }), { lazyTopology: true });
    mesh.setImportTopology(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        [[0, 1, 2]],
        { faceColors: [faceColor], faceUvs: [[[0, 0], [1, 0], [0, 1]]] }
    );
    mesh.rebuildRenderData({ buildEditorData: false });
    return mesh;
}

test('instance grouping keeps different face-color states separate', () => {
    const a = makeMesh([1, 0, 0, 1]);
    const b = makeMesh([0, 1, 0, 1]);
    assert.notEqual(a.getInstanceBatchKey(), b.getInstanceBatchKey());
});

test('instance grouping still shares identical geometry when only material color differs', () => {
    const a = makeMesh([1, 1, 1, 1], [1, 0, 0, 1]);
    const b = makeMesh([1, 1, 1, 1], [0, 1, 0, 1]);
    assert.equal(a.getInstanceBatchKey(), b.getInstanceBatchKey());
});
