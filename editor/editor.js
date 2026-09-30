import { createUI } from './ui.js';
import { Gizmos } from './gizmos.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';
import { AnimationClip } from '../engine/animation.js';
import { DirectionalLight } from '../engine/light.js';
import { TextureLibrary } from './textureLibrary.js';

export class Editor {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.textureLibrary = new TextureLibrary(renderer.gl);
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistoryLength = 100;

        this.uiRoot = document.getElementById('ui-root');
        this.ui = createUI(this.uiRoot, {
            scene,
            gl: renderer.gl,
            textureLibrary: this.textureLibrary,
            onSelect: mesh => this.select(mesh),
            onSelectFace: faceIndex => this.selectFace(faceIndex),
            onSetPickMode: mode => this.gizmos.setPickMode(mode),
            onAddCube: () => this.addCube(),
            onAddPlane: () => this.addPrimitive('Plane'),
            onAddSphere: () => this.addPrimitive('Sphere'),
            onAddCylinder: () => this.addPrimitive('Cylinder'),
            onAddBatch: (type, count, spacing, onProgress) => this.addPrimitiveBatch(type, count, spacing, onProgress),
            onDuplicate: () => this.duplicateSelected(),
            onAddFace: () => this.addFace(),
            onExtrudeFace: () => this.extrudeFace(),
            onMergeFace: () => this.mergeSelectedFace(),
            onMergeVertices: () => this.mergeSelectedVertices(),
            onAddVertex: () => this.addVertex(),
            onAddBone: parentIndex => this.addBone(parentIndex),
            onRemoveBone: index => this.removeBone(index),
            onCreateAnimation: () => this.createAnimation(),
            onKeyPose: (index, time) => this.keyBonePose(index, time),
            onDeleteBoneKeys: (index, time) => this.deleteBoneKeyframes(index, time),
            onSeekAnimation: time => this.seekAnimation(time),
            onToggleAnimation: time => this.playAnimation(time),
            onRenameAnimation: name => this.renameAnimation(name),
            onSetAnimationDuration: duration => this.setAnimationDuration(duration),
            onImportMesh: file => this.importMesh(file),
            onImportTexture: file => this.importTexture(file),
            onDelete: mesh => this.deleteSelected(mesh),
            onReorderMesh: (mesh, index) => this.reorderMesh(mesh, index),
            onResetCamera: () => this.resetCamera(),
            onExport: () => this.exportScene(),
            onUndo: () => this.undo(),
            onRedo: () => this.redo(),
            onHistory: () => this.recordHistory()
        });
        this.gizmos = new Gizmos(scene, camera, renderer.canvas, {
            onPickFace: (mesh, faceIndex) => {
                mesh.selectedVertex = null;
                this.select(mesh);
                this.selectFace(faceIndex);
            },
            onPickVertex: (mesh, faceIndex, vertexIndex) => {
                this.select(mesh);
                this.selectFace(faceIndex);
                mesh.selectedVertex = { faceIndex, vertexIndex };
                this.ui.setSelected(mesh);
            },
            onHistoryStart: () => this.snapshotScene(),
            onHistoryEnd: snapshot => this.recordHistorySnapshot(snapshot)
        });

        this.selected = null;
        this.select(scene.meshes[0] || null);
    }

    update() {
        this.gizmos.update();
        this.ui.updateUvWorkspace();
        this.ui.updateAnimationWorkspace(this.selected?.animationPlayer.time || 0, this.selected?.animationPlayer.playing || false);
        const allPolygons = this.scene.meshes.reduce((sum, mesh) => sum + mesh.faceCount, 0);
        this.ui.setPolygonCount(this.selected?.faceCount || 0, allPolygons);
    }

    async importTexture(file) {
        await this.textureLibrary.addFile(file);
        this.ui.refreshTextures();
    }

    select(mesh) {
        this.selected = mesh;
        if (mesh) mesh.selectedFace = mesh.selectedFace < 0 ? 0 : mesh.selectedFace;
        this.ui.setSelected(mesh);
        this.ui.refreshHierarchy();
    }

    selectFace(faceIndex) {
        if (!this.selected) return;
        this.selected.selectedVertex = null;
        this.selected.selectedFace = faceIndex;
        this.ui.setFace(faceIndex);
    }

    addFace() {
        if (!this.selected) return;
        this.recordHistory();
        this.selected.addFace([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
        this.selectFace(this.selected.faceCount - 1);
    }

    extrudeFace() {
        if (!this.selected) return;
        this.recordHistory();
        this.selected.extrudeFace(Math.max(0, this.selected.selectedFace));
        this.selectFace(this.selected.selectedFace);
    }

    mergeSelectedFace() {
        if (!this.selected) return;
        this.recordHistory();
        if (this.selected.mergeCoplanarFace(Math.max(0, this.selected.selectedFace))) {
            this.selected.selectedVertex = null;
            this.selectFace(this.selected.selectedFace);
        }
    }

    mergeSelectedVertices() {
        const selectedVertex = this.selected?.selectedVertex;
        if (!selectedVertex) return;
        this.recordHistory();
        if (this.selected.mergeNearbyVertices(selectedVertex.faceIndex, selectedVertex.vertexIndex)) {
            this.selected.selectedVertex = null;
            this.ui.setSelected(this.selected);
        }
    }

    addVertex() {
        if (!this.selected) return;
        const faceIndex = Math.max(0, this.selected.selectedFace);
        this.recordHistory();
        this.selected.addVertex(faceIndex, [0, 0, 0]);
        this.ui.setSelected(this.selected);
    }

    addBone(parentIndex = null) {
        if (!this.selected) return;
        this.recordHistory();
        const parent = Number.isInteger(parentIndex) ? this.selected.skeleton.bones[parentIndex] : null;
        const bone = this.selected.skeleton.addBone(undefined, parent);
        this.selected.selectedBone = this.selected.skeleton.bones.indexOf(bone);
        this.ui.refreshBones();
    }

    removeBone(index) {
        if (!this.selected) return;
        this.recordHistory();
        if (!this.selected.removeBone(index)) return;
        if (this.selected.animationClip) {
            this.selected.animationClip.tracks = this.selected.animationClip.tracks.filter(track => !track.boneName || this.selected.skeleton.find(track.boneName));
        }
        this.ui.refreshBones();
    }

    keyBonePose(index, time) {
        const bone = this.selected?.skeleton.bones[index];
        if (!bone || !this.selected.animationClip) return;
        this.recordHistory();
        this.selected.animationClip.addBoneKeyframe(bone.name, 'position', time, bone.position);
        this.selected.animationClip.addBoneKeyframe(bone.name, 'rotation', time, bone.rotation);
        this.selected.animationClip.addBoneKeyframe(bone.name, 'scale', time, bone.scale);
        this.ui.refreshBones();
    }

    createAnimation() {
        if (!this.selected) return;
        this.recordHistory();
        this.selected.animationClip = new AnimationClip(`${this.selected.name} Animation`, 2);
        this.selected.animationPlayer.stop();
        this.selected.animationPlayer.clip = this.selected.animationClip;
        this.selected.animationPlayer.seek(0);
        this.ui.refreshBones();
    }

    deleteBoneKeyframes(index, time) {
        const bone = this.selected?.skeleton.bones[index];
        if (!bone || !this.selected.animationClip) return;
        const snapshot = this.selected.animationClip.tracks.some(track => track.boneName === bone.name && track.times.some(keyTime => Math.abs(keyTime - time) < 1e-3));
        if (!snapshot) return;
        this.recordHistory();
        this.selected.animationClip.removeBoneKeyframes(bone.name, time);
        this.ui.refreshBones();
    }

    seekAnimation(time) {
        const player = this.selected?.animationPlayer;
        if (!player || !this.selected.animationClip) return;
        player.stop();
        player.clip = this.selected.animationClip;
        player.seek(time);
    }

    playAnimation(time = 0) {
        const player = this.selected?.animationPlayer;
        if (!player || !this.selected.animationClip) return false;
        player.clip = this.selected.animationClip;
        if (player.playing) player.stop();
        else player.play(this.selected.animationClip, time);
        this.ui.refreshBones();
        return player.playing;
    }

    renameAnimation(name) {
        const clip = this.selected?.animationClip;
        if (!clip || !name.trim() || clip.name === name.trim()) return;
        this.recordHistory();
        clip.name = name.trim();
    }

    setAnimationDuration(duration) {
        const clip = this.selected?.animationClip;
        if (!clip) return;
        const nextDuration = Math.max(0.1, Number(duration) || 0.1);
        if (clip.duration === nextDuration) return;
        this.recordHistory();
        clip.setDuration(nextDuration);
        this.selected.animationPlayer.seek(Math.min(this.selected.animationPlayer.time, clip.duration));
        this.ui.refreshBones();
    }

    async importMesh(file) {
        const data = JSON.parse(await file.text());
        this.recordHistory();
        if (Array.isArray(data.meshes)) {
            await this.importSceneData(data);
            return;
        }
        let vertices = data.vertices || [];
        if (vertices.length && typeof vertices[0] === 'number') {
            vertices = Array.from({ length: vertices.length / 3 }, (_, index) => vertices.slice(index * 3, index * 3 + 3));
        }
        let faces = data.faces || data.indices || [];
        if (faces.length && typeof faces[0] === 'number') {
            faces = faces.length % 3 === 0
                ? Array.from({ length: faces.length / 3 }, (_, index) => faces.slice(index * 3, index * 3 + 3))
                : [faces];
        }
        const mesh = Mesh.createFromData(new Material({ color: [0.78, 0.84, 0.92] }), { vertices, faces });
        mesh.name = file.name.replace(/\.[^.]+$/, '') || 'Imported Mesh';
        mesh.position = [0, 0.5, 0];
        this.scene.add(mesh);
        this.select(mesh);
    }

    async importSceneData(data) {
        if (data.light) {
            const importedLight = new DirectionalLight(data.light);
            if (this.scene.light) Object.assign(this.scene.light, importedLight);
            else this.scene.light = importedLight;
            this.ui.refreshLight();
        }
        const textureIds = new Map();
        for (const assetData of data.textureAssets || []) {
            const asset = await this.textureLibrary.importExportedAsset(assetData);
            textureIds.set(assetData.id, asset.id);
        }
        const resolveTexture = id => this.textureLibrary.get(textureIds.get(id) || id);
        const importedMeshes = [];
        for (const meshData of data.meshes) {
            const mesh = new Mesh(new Material({ color: [...(meshData.color || [0.78, 0.84, 0.92])], shading: meshData.shading || 'toon' }));
            if (meshData.polygons) {
                mesh.polygons = meshData.polygons.map(polygon => polygon.map(vertex => [...vertex]));
            } else {
                let vertices = meshData.vertices || [];
                if (vertices.length && typeof vertices[0] === 'number') {
                    vertices = Array.from({ length: vertices.length / 3 }, (_, index) => vertices.slice(index * 3, index * 3 + 3));
                }
                let faces = meshData.faces || meshData.indices || [];
                if (faces.length && typeof faces[0] === 'number') {
                    faces = faces.length % 3 === 0
                        ? Array.from({ length: faces.length / 3 }, (_, index) => faces.slice(index * 3, index * 3 + 3))
                        : [faces];
                }
                mesh.polygons = faces.map(face => face.map(index => [...vertices[index]]));
            }
            mesh.name = meshData.name || 'Imported Mesh';
            mesh.position = [...(meshData.position || [0, 0, 0])];
            mesh.rotation = [...(meshData.rotation || [0, 0, 0])];
            mesh.scale = [...(meshData.scale || [1, 1, 1])];
            mesh.faceColors = (meshData.faceColors || []).map(color => [...color]);
            mesh.faceUvs = (meshData.faceUvs || []).map(faceUvs => faceUvs.map(uv => [...uv]));
            mesh.faceUvTransforms = (meshData.faceUvTransforms || []).map(transform => ({
                scale: [...(transform.scale || [1, 1])],
                offset: [...(transform.offset || [0, 0])],
                rotation: transform.rotation || 0,
                flipX: !!transform.flipX,
                flipY: !!transform.flipY
            }));
            mesh.rebuildRenderData();

            const boneMap = new Map();
            (meshData.bones || []).forEach(boneData => {
                const bone = mesh.skeleton.addBone(boneData.name || `Bone ${mesh.skeleton.bones.length + 1}`);
                bone.position = [...(boneData.position || [0, 0, 0])];
                bone.rotation = [...(boneData.rotation || [0, 0, 0])];
                bone.scale = [...(boneData.scale || [1, 1, 1])];
                bone.length = boneData.length || 0.5;
                bone.bindPosition = [...(boneData.bindPosition || bone.position)];
                bone.bindRotation = [...(boneData.bindRotation || bone.rotation)];
                bone.bindScale = [...(boneData.bindScale || bone.scale)];
                boneMap.set(bone.name, bone);
            });
            (meshData.bones || []).forEach(boneData => {
                const bone = boneMap.get(boneData.name);
                const parent = boneMap.get(boneData.parent);
                if (bone && parent) {
                    bone.parent = parent;
                    parent.children.push(bone);
                }
            });
            mesh.selectedBone = mesh.skeleton.bones.length ? 0 : null;

            meshData.vertexWeights?.forEach((polygonWeights, faceIndex) => polygonWeights.forEach((entry, vertexIndex) => {
                const vertex = mesh.polygons[faceIndex]?.[vertexIndex];
                if (!vertex || !entry.weights?.length) return;
                const weights = new Map();
                entry.weights.forEach(weight => {
                    const bone = boneMap.get(weight.bone);
                    if (bone) weights.set(bone, weight.weight);
                });
                if (weights.size) mesh.vertexWeights.set(vertex, {
                    bindPosition: [...(entry.bindPosition || vertex)],
                    weights
                });
            }));

            mesh.textureAssetId = textureIds.get(meshData.textureAssetId) || meshData.textureAssetId || null;
            const meshTexture = resolveTexture(meshData.textureAssetId);
            mesh.material.texture = meshTexture?.texture || null;
            mesh.material.useTexture = !!mesh.material.texture;
            mesh.faceTextureIds = (meshData.faceTextureIds || []).map(id => textureIds.get(id) || id || null);
            mesh.faceTextures = mesh.faceTextureIds.map(id => resolveTexture(id)?.texture || null);

            if (meshData.animation) {
                const clip = new AnimationClip(meshData.animation.name || 'Imported Animation', meshData.animation.duration || 1);
                (meshData.animation.tracks || []).forEach(track => {
                    if (track.boneName) track.times.forEach((time, index) => clip.addBoneKeyframe(track.boneName, track.property, time, track.values[index]));
                    else clip.addTrack(track.property, [...track.times], track.values.map(value => [...value]));
                });
                mesh.animationClip = clip;
            }
            this.scene.add(mesh);
            importedMeshes.push(mesh);
        }
        this.ui.refreshTextures();
        if (importedMeshes.length) this.select(importedMeshes[importedMeshes.length - 1]);
    }

    addCube() {
        this.addPrimitive('Cube');
    }

    addPrimitive(type) {
        const mesh = this.createPrimitive(type);
        if (!mesh) return;
        this.recordHistory();
        mesh.name = `${type} ${this.scene.meshes.length + 1}`;
        mesh.position = [0, 0.5, 0];
        this.scene.add(mesh);
        this.select(mesh);
    }

    createPrimitive(type) {
        const material = new Material({ color: [0.78, 0.84, 0.92] });
        const creators = {
            Cube: () => Mesh.createCube(material),
            Plane: () => Mesh.createPlane(material),
            Sphere: () => Mesh.createUvSphere(material),
            Cylinder: () => Mesh.createCylinder(material)
        };
        return creators[type]?.() || null;
    }

    async addPrimitiveBatch(type, count, spacing = 2, onProgress = () => {}) {
        if (typeof spacing === 'function') {
            onProgress = spacing;
            spacing = 2;
        }
        const amount = Math.max(1, Math.min(100000, Math.floor(count) || 1));
        this.recordHistory();
        spacing = Math.max(1.05, Math.min(10, Number(spacing) || 2));
        const columns = Math.ceil(Math.sqrt(amount));
        const rows = Math.ceil(amount / columns);
        const chunkSize = 250;
        let lastMesh = null;
        for (let index = 0; index < amount; index++) {
            const mesh = this.createPrimitive(type);
            if (!mesh) throw new Error(`Unknown primitive type: ${type}`);
            mesh.name = `${type} ${this.scene.meshes.length + 1}`;
            mesh.position = [
                (index % columns - (columns - 1) / 2) * spacing,
                0.5,
                (Math.floor(index / columns) - (rows - 1) / 2) * spacing
            ];
            this.scene.add(mesh);
            lastMesh = mesh;
            if ((index + 1) % chunkSize === 0 || index + 1 === amount) {
                onProgress(index + 1);
                if (index + 1 < amount) await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        this.select(lastMesh);
    }

    duplicateSelected() {
        const source = this.selected;
        if (!source) return;
        this.recordHistory();
        const duplicate = new Mesh(new Material({
            color: [...source.material.color],
            useTexture: source.material.useTexture,
            texture: source.material.texture,
            shading: source.material.shading
        }));
        duplicate.name = `${source.name} Copy`;
        duplicate.position = source.position.map((value, axis) => value + (axis === 0 ? 1 : 0));
        duplicate.rotation = [...source.rotation];
        duplicate.scale = [...source.scale];
        duplicate.polygons = source.polygons.map(polygon => polygon.map(vertex => [...vertex]));
        duplicate.faceColors = source.faceColors.map(color => [...color]);
        duplicate.faceTextures = [...source.faceTextures];
        duplicate.faceTextureIds = [...source.faceTextureIds];
        duplicate.faceUvTransforms = source.faceUvTransforms.map(transform => ({
            scale: [...transform.scale],
            offset: [...transform.offset],
            rotation: transform.rotation,
            flipX: transform.flipX,
            flipY: transform.flipY
        }));
        duplicate.faceUvs = source.faceUvs.map(faceUvs => faceUvs.map(uv => [...uv]));
        duplicate.textureAssetId = source.textureAssetId;
        duplicate.rebuildRenderData();
        const bones = new Map();
        source.skeleton.bones.forEach(bone => {
            const parent = bones.get(bone.parent) || null;
            const cloned = duplicate.skeleton.addBone(bone.name, parent);
            cloned.position = [...bone.position];
            cloned.rotation = [...bone.rotation];
            cloned.scale = [...bone.scale];
            cloned.bindPosition = [...bone.bindPosition];
            cloned.bindRotation = [...bone.bindRotation];
            cloned.bindScale = [...bone.bindScale];
            bones.set(bone, cloned);
        });
        source.polygons.forEach((polygon, faceIndex) => polygon.forEach((vertex, vertexIndex) => {
            const skin = source.vertexWeights.get(vertex);
            if (!skin) return;
            const duplicateVertex = duplicate.polygons[faceIndex]?.[vertexIndex];
            if (!duplicateVertex) return;
            duplicate.vertexWeights.set(duplicateVertex, {
                bindPosition: [...skin.bindPosition],
                weights: new Map([...skin.weights].map(([bone, weight]) => [bones.get(bone), weight]).filter(([bone]) => bone))
            });
        }));
        duplicate.animationClip = source.animationClip ? new AnimationClip(source.animationClip.name, source.animationClip.duration) : null;
        source.animationClip?.tracks.forEach(track => {
            if (track.boneName) track.times.forEach((time, index) => duplicate.animationClip.addBoneKeyframe(track.boneName, track.property, time, track.values[index]));
            else duplicate.animationClip.addTrack(track.property, [...track.times], track.values.map(value => [...value]));
        });
        this.scene.add(duplicate);
        this.select(duplicate);
    }

    deleteSelected(mesh = this.selected) {
        if (!mesh) return;
        const index = this.scene.meshes.indexOf(mesh);
        if (index < 0) return;
        this.recordHistory();
        this.scene.remove(mesh);
        if (mesh === this.selected) this.select(this.scene.meshes[Math.min(index, this.scene.meshes.length - 1)] || null);
        else this.ui.refreshHierarchy();
    }

    reorderMesh(mesh, index) {
        const currentIndex = this.scene.meshes.indexOf(mesh);
        if (currentIndex < 0 || currentIndex === index) return;
        this.recordHistory();
        this.scene.move(mesh, index);
        this.ui.refreshHierarchy();
    }

    resetCamera() {
        this.camera.position = [0, 1.5, 4];
        this.camera.target = [0, 0.5, 0];
        this.gizmos.syncFromCamera();
    }

    snapshotScene() {
        const snapshot = {
            light: this.scene.light ? {
                name: this.scene.light.name,
                direction: this.scene.light.direction,
                color: this.scene.light.color,
                intensity: this.scene.light.intensity,
                threshold: this.scene.light.threshold,
                shadeColor: this.scene.light.shadeColor
            } : null,
            selectedIndex: this.scene.meshes.indexOf(this.selected),
            meshes: this.scene.meshes.map(mesh => ({
                name: mesh.name,
                position: mesh.position,
                rotation: mesh.rotation,
                scale: mesh.scale,
                color: mesh.material.color,
                shading: mesh.material.shading,
                polygons: mesh.polygons,
                faceColors: mesh.faceColors,
                textureAssetId: mesh.textureAssetId,
                faceTextureIds: mesh.faceTextureIds,
                faceUvs: mesh.faceUvs,
                faceUvTransforms: mesh.faceUvTransforms,
                selectedFace: mesh.selectedFace,
                selectedVertex: mesh.selectedVertex,
                selectedBone: mesh.selectedBone,
                vertexWeights: mesh.getVertexWeightData(),
                animation: mesh.animationClip ? {
                    name: mesh.animationClip.name,
                    duration: mesh.animationClip.duration,
                    tracks: mesh.animationClip.tracks.map(track => ({
                        boneName: track.boneName || null,
                        property: track.property,
                        times: track.times,
                        values: track.values
                    }))
                } : null,
                bones: mesh.skeleton.bones.map(bone => ({
                    name: bone.name,
                    parent: bone.parent?.name || null,
                    position: bone.position,
                    rotation: bone.rotation,
                    scale: bone.scale,
                    length: bone.length,
                    bindPosition: bone.bindPosition,
                    bindRotation: bone.bindRotation,
                    bindScale: bone.bindScale
                }))
            }))
        };
        return JSON.parse(JSON.stringify(snapshot));
    }

    recordHistorySnapshot(snapshot) {
        if (!snapshot || JSON.stringify(snapshot) === JSON.stringify(this.snapshotScene())) return;
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxHistoryLength) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    recordHistory() {
        this.undoStack.push(this.snapshotScene());
        if (this.undoStack.length > this.maxHistoryLength) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    async restoreHistorySnapshot(snapshot) {
        this.scene.meshes.length = 0;
        await this.importSceneData(snapshot);
        if (snapshot.light) {
            if (!this.scene.light) this.scene.light = new DirectionalLight(snapshot.light);
            else Object.assign(this.scene.light, new DirectionalLight(snapshot.light));
        } else this.scene.light = null;
        snapshot.meshes.forEach((meshData, index) => {
            const mesh = this.scene.meshes[index];
            if (!mesh) return;
            mesh.selectedFace = meshData.selectedFace ?? 0;
            mesh.selectedVertex = meshData.selectedVertex || null;
            mesh.selectedBone = meshData.selectedBone ?? null;
        });
        this.select(this.scene.meshes[snapshot.selectedIndex] || null);
    }

    async undo() {
        const snapshot = this.undoStack.pop();
        if (!snapshot) return;
        this.redoStack.push(this.snapshotScene());
        await this.restoreHistorySnapshot(snapshot);
    }

    async redo() {
        const snapshot = this.redoStack.pop();
        if (!snapshot) return;
        this.undoStack.push(this.snapshotScene());
        await this.restoreHistorySnapshot(snapshot);
    }

    async exportScene() {
        const data = {
            format: 'lightweight-3d-scene',
            version: 1,
            coordinateSystem: { handedness: 'right', upAxis: 'Y', units: 'editor' },
            light: this.scene.light ? {
                name: this.scene.light.name,
                direction: this.scene.light.direction,
                color: this.scene.light.color,
                intensity: this.scene.light.intensity,
                threshold: this.scene.light.threshold,
                shadeColor: this.scene.light.shadeColor
            } : null,
            textureAssets: await this.textureLibrary.getExportData(),
            meshes: this.scene.meshes.map(mesh => ({
                name: mesh.name,
                position: mesh.position,
                rotation: mesh.rotation,
                scale: mesh.scale,
                color: mesh.material.color,
                shading: mesh.material.shading,
                polygons: mesh.polygons,
                faceColors: mesh.faceColors,
                textureAssetId: mesh.textureAssetId,
                faceTextureIds: mesh.faceTextureIds,
                faceUvs: mesh.faceUvs,
                faceUvTransforms: mesh.faceUvTransforms,
                vertexWeights: mesh.getVertexWeightData(),
                animation: mesh.animationClip ? {
                    name: mesh.animationClip.name,
                    duration: mesh.animationClip.duration,
                    tracks: mesh.animationClip.tracks.map(track => ({
                        boneName: track.boneName || null,
                        property: track.property,
                        times: track.times,
                        values: track.values
                    }))
                } : null,
                bones: mesh.skeleton.bones.map(bone => ({
                    name: bone.name,
                    parent: bone.parent?.name || null,
                    position: bone.position,
                    rotation: bone.rotation,
                    scale: bone.scale,
                    length: bone.length,
                    bindPosition: bone.bindPosition,
                    bindRotation: bone.bindRotation,
                    bindScale: bone.bindScale
                }))
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
