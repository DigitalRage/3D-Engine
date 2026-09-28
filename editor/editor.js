import { createUI } from './ui.js';
import { Gizmos } from './gizmos.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';
import { AnimationClip } from '../engine/animation.js';

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
            onAddFace: () => this.addFace(),
            onAddVertex: () => this.addVertex(),
            onAddBone: () => this.addBone(),
            onPlayAnimation: () => this.playAnimation(),
            onImportMesh: file => this.importMesh(file),
            onDelete: () => this.deleteSelected(),
            onResetCamera: () => this.resetCamera(),
            onExport: () => this.exportScene()
        });
        this.gizmos = new Gizmos(scene, camera, renderer.canvas, {
            onPickFace: (mesh, faceIndex) => {
                this.select(mesh);
                this.selectFace(faceIndex);
            },
            onPickVertex: (mesh, faceIndex) => {
                this.select(mesh);
                this.selectFace(faceIndex);
            }
        });

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

    addFace() {
        if (!this.selected) return;
        this.selected.addFace([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
        this.selectFace(this.selected.faceCount - 1);
    }

    addVertex() {
        if (!this.selected) return;
        const faceIndex = Math.max(0, this.selected.selectedFace);
        this.selected.addVertex(faceIndex, [0, 0, 0]);
        this.ui.setSelected(this.selected);
    }

    addBone() {
        if (!this.selected) return;
        const parent = this.selected.skeleton.bones[this.selected.skeleton.bones.length - 1] || null;
        this.selected.skeleton.addBone(undefined, parent);
        this.ui.setSelected(this.selected);
    }

    playAnimation() {
        if (!this.selected) return;
        if (!this.selected.animationClip) {
            const clip = new AnimationClip('Transform Preview', 2);
            clip.addTrack('rotation', [0, 1, 2], [[0, 0, 0], [0, Math.PI, 0], [0, Math.PI * 2, 0]]);
            this.selected.animationClip = clip;
        }
        if (this.selected.animationPlayer.playing) this.selected.animationPlayer.stop();
        else this.selected.animationPlayer.play(this.selected.animationClip);
    }

    async importMesh(file) {
        const data = JSON.parse(await file.text());
        let vertices = data.vertices || [];
        if (vertices.length && typeof vertices[0] === 'number') {
            vertices = Array.from({ length: vertices.length / 3 }, (_, index) => vertices.slice(index * 3, index * 3 + 3));
        }
        let faces = data.faces || data.indices || [];
        if (faces.length && typeof faces[0] === 'number') faces = [faces];
        if (faces.length && faces[0].length === 3 && data.indices) faces = faces;
        const mesh = Mesh.createFromData(new Material({ color: [0.78, 0.84, 0.92] }), { vertices, faces });
        mesh.name = file.name.replace(/\.[^.]+$/, '') || 'Imported Mesh';
        mesh.position = [0, 0.5, 0];
        this.scene.add(mesh);
        this.select(mesh);
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
                polygons: mesh.polygons,
                faceColors: mesh.faceColors,
                faceUvTransforms: mesh.faceUvTransforms,
                bones: mesh.skeleton.bones.map(bone => ({ name: bone.name, parent: bone.parent?.name || null, position: bone.position, rotation: bone.rotation, scale: bone.scale }))
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
