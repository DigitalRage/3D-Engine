import assert from 'node:assert/strict';
import test from 'node:test';
import { Material } from '../engine/material.js';
import { Mesh } from '../engine/mesh.js';
import { executeMeshCommand, executeSceneCommand } from '../editor/ops/meshCommands.js';
import { listMeshOperators } from '../editor/ops/meshOperators.js';
import { canonicalEdgeKey, SelectionModel } from '../editor/selection.js';

test('selection model toggles meshes and active faces with modifiers', () => {
    const selection = new SelectionModel('face');
    const firstMesh = {};
    const secondMesh = {};

    selection.selectMesh(firstMesh);
    selection.selectMesh(secondMesh, { additive: true });
    assert.deepEqual([...selection.selectedMeshes], [firstMesh, secondMesh]);
    selection.selectMesh(secondMesh, { additive: true });
    assert.deepEqual([...selection.selectedMeshes], [firstMesh]);

    selection.selectElement(firstMesh, 'face', 1, { faceIndex: 1 });
    selection.selectElement(firstMesh, 'face', 2, { faceIndex: 2 }, { additive: true });
    selection.selectElement(firstMesh, 'face', 1, { faceIndex: 1 }, { additive: true });
    assert.deepEqual([...selection.selectedFaces], [2]);
    assert.equal(selection.active.faceIndex, 2);
});

test('edge selection uses canonical vertex-pair keys', () => {
    const selection = new SelectionModel('edge');
    const mesh = { faces: [[0, 2, 3]] };

    assert.equal(canonicalEdgeKey(4, 1), '1,4');
    selection.selectElement(mesh, 'edge', '2,3', { a: 2, b: 3, faceIndex: 0 });
    assert.ok(selection.selectedEdges.has('2,3'));
    assert.equal(selection.active.mode, 'edge');
});

test('mesh edit command restores and replays one extrusion', () => {
    const mesh = Mesh.createCube(new Material());
    const status = [];
    const editor = { undoStack: [], redoStack: [], maxHistoryLength: 100, ui: { setStatus: message => status.push(message) } };

    assert.equal(executeMeshCommand(editor, mesh, 'Extrude', () => mesh.extrudeFace(4)), true);
    assert.equal(editor.undoStack.length, 1);
    assert.equal(mesh.faces.length, 11);
    editor.undoStack[0].undo();
    assert.equal(mesh.faces.length, 6);
    assert.equal(mesh.positions.length, 8);
    editor.undoStack[0].redo();
    assert.equal(mesh.faces.length, 11);

    assert.equal(executeMeshCommand(editor, mesh, 'No-op', () => mesh.extrudeFace(-1)), false);
    assert.equal(editor.undoStack.length, 1);
    assert.equal(status.at(-1), 'No-op: no change');
});

test('scene mesh creation command undoes and redoes membership without snapshots', () => {
    const editor = { undoStack: [], redoStack: [], maxHistoryLength: 100, ui: { setStatus() {} } };
    const meshes = [];
    const created = {};

    assert.equal(executeSceneCommand(editor, 'Split', () => {
        meshes.push(created);
        return 1;
    }, () => meshes.splice(meshes.indexOf(created), 1), () => meshes.push(created), count => count > 0), true);
    assert.equal(editor.undoStack[0].type, 'scene-edit');
    assert.equal(meshes.length, 1);
    editor.undoStack[0].undo();
    assert.equal(meshes.length, 0);
    editor.undoStack[0].redo();
    assert.equal(meshes[0], created);
});

test('operator registry exposes the requested mesh operation set', () => {
    const names = new Set(listMeshOperators());
    for (const name of ['extrude', 'inset', 'bevel', 'loopCut', 'bridge', 'fill', 'dissolve', 'split', 'separate', 'triangulate', 'recalculateNormals', 'flipNormals', 'mergeVertices', 'mergeCoplanar', 'knife']) {
        assert.ok(names.has(name), `missing mesh operator: ${name}`);
    }
});
