import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '../editor/editor.js';
import { Material } from '../engine/material.js';
import { Mesh } from '../engine/mesh.js';
import { SelectionModel } from '../editor/selection.js';

test('multi-face extrusion creates one undoable mesh command', async () => {
    const mesh = Mesh.createCube(new Material());
    const selection = new SelectionModel('face');
    selection.selectedMeshes.add(mesh);
    selection.selectedFaces.add(0);
    selection.selectedFaces.add(4);
    selection.active = { mode: 'face', mesh, faceIndex: 4, value: 4 };
    const editor = Object.create(Editor.prototype);
    const status = [];
    Object.assign(editor, {
        selected: mesh,
        selection,
        selectedFaces: selection.selectedFaces,
        selectedVertices: selection.selectedVertices,
        undoStack: [],
        redoStack: [],
        maxHistoryLength: 100,
        gizmos: { setSelected() {} },
        ui: { setStatus: message => status.push(message), setSelected() {}, setFace() {}, refreshHierarchy() {} },
        refreshSceneAssets() {}
    });

    editor.extrudeFace();
    assert.equal(mesh.faces.length, 16);
    assert.equal(editor.undoStack.length, 1);
    await editor.undo();
    assert.equal(mesh.faces.length, 6);
    await editor.redo();
    assert.equal(mesh.faces.length, 16);
    assert.equal(status.at(-1), 'Extrude: complete');
});

test('face operator no-op reports status without recording history', () => {
    const mesh = Mesh.createCube(new Material());
    mesh.selectedFace = -1;
    const selection = new SelectionModel('face');
    selection.selectedMeshes.add(mesh);
    const status = [];
    const editor = Object.create(Editor.prototype);
    Object.assign(editor, {
        selected: mesh,
        selection,
        selectedFaces: selection.selectedFaces,
        undoStack: [],
        redoStack: [],
        maxHistoryLength: 100,
        ui: { setStatus: message => status.push(message) }
    });

    editor.extrudeFace();
    assert.equal(editor.undoStack.length, 0);
    assert.equal(status.at(-1), 'Select a face first');
});

test('duplicate and delete apply to the selected mesh set', () => {
    const first = Mesh.createCube(new Material());
    const second = Mesh.createCube(new Material());
    const scene = {
        meshes: [first, second],
        add(mesh) { this.meshes.push(mesh); },
        remove(mesh) { this.meshes.splice(this.meshes.indexOf(mesh), 1); }
    };
    const selection = new SelectionModel('mesh');
    selection.selectMeshes([first, second]);
    const editor = Object.create(Editor.prototype);
    Object.assign(editor, {
        scene,
        selected: second,
        selection,
        selectedMeshes: selection.selectedMeshes,
        undoStack: [],
        redoStack: [],
        maxHistoryLength: 100,
        ui: { setStatus() {}, setSelected() {}, refreshHierarchy() {} },
        recordHistory() { this.undoStack.push({ snapshot: true }); },
        refreshSceneAssets() {}
    });

    editor.duplicateSelected();
    assert.equal(scene.meshes.length, 4);
    assert.equal(editor.selectedMeshes.size, 2);
    editor.deleteSelected();
    assert.equal(scene.meshes.length, 2);
    assert.equal(editor.selectedMeshes.size, 1);
    assert.equal(editor.selected, second);
});
