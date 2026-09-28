import { createUI } from './ui.js';
import { Gizmos } from './gizmos.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';

export class Editor {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.uiRoot = document.getElementById('ui-root');
        this.ui = createUI(this.uiRoot, {
            scene,
            gl: renderer.gl,
            onSelect: mesh => this.select(mesh),
            onSelectFace: faceIndex => this.selectFace(faceIndex),
            onAddCube: () => this.addCube(),
            onDelete: () => this.deleteSelected(),
            onResetCamera: () => this.resetCamera(),
            onExport: () => this.exportScene()
        });
        this.gizmos = new Gizmos(scene, camera, renderer.canvas);

        this.selected = null;
        this.select(scene.meshes[0] || null);
    }

    update() {
        this.gizmos.update();
    }

    select(mesh) {
        this.selected = mesh;
        if (mesh) mesh.selectedFace = mesh.selectedFace < 0 ? 0 : mesh.selectedFace;
        this.ui.setSelected(mesh);
        this.ui.refreshHierarchy();
    }

    selectFace(faceIndex) {
        if (!this.selected) return;
        this.selected.selectedFace = faceIndex;
        this.ui.setFace(faceIndex);
    }

    addCube() {
        const cube = Mesh.createCube(new Material({ color: [0.78, 0.84, 0.92] }));
        cube.name = `Cube ${this.scene.meshes.length + 1}`;
        cube.position = [0, 0.5, 0];
        this.scene.add(cube);
        this.select(cube);
    }

    deleteSelected() {
        if (!this.selected) return;
        this.scene.remove(this.selected);
        this.select(this.scene.meshes[this.scene.meshes.length - 1] || null);
    }

    resetCamera() {
        this.camera.position = [0, 1.5, 4];
        this.camera.target = [0, 0.5, 0];
        this.gizmos.syncFromCamera();
    }

    exportScene() {
        const data = {
            meshes: this.scene.meshes.map(mesh => ({
                name: mesh.name,
                position: mesh.position,
                rotation: mesh.rotation,
                scale: mesh.scale,
                color: mesh.material.color,
                faceColors: mesh.faceColors,
                faceUvTransforms: mesh.faceUvTransforms
            }))
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'scene.json';
        link.click();
        URL.revokeObjectURL(link.href);
    }
}
