import { createUI } from './ui.js';
import { Gizmos } from './gizmos.js';
import { Mesh } from '../engine/mesh.js';
import { Material } from '../engine/material.js';
import { AnimationClip } from '../engine/animation.js';
import { DirectionalLight } from '../engine/light.js';
import { SceneManager } from '../engine/sceneManager.js';
import { AssetManager } from '../engine/assetManager.js';
import { PrefabManager } from '../engine/prefabManager.js';
import { TextureLibrary } from './textureLibrary.js';
import { SelectionModel } from './selection.js';
import { executeMeshCommand, executeSceneCommand } from './ops/meshCommands.js';
import { runMeshOperator } from './ops/meshOperators.js';

export class Editor {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.assetManager = new AssetManager();
        this.prefabManager = new PrefabManager(this.assetManager);
        this.textureLibrary = new TextureLibrary(renderer.gl, this.assetManager);
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistoryLength = 100;
        this.streamedSubScenes = new Map();
        this.sceneManager = new SceneManager({
            serializeActive: () => this.serializeSceneData(),
            activateScene: (data, record) => this.activateSceneData(data, record),
            loadSubScene: (sceneId, data) => this.loadSubSceneData(sceneId, data),
            unloadSubScene: sceneId => this.unloadSubSceneData(sceneId)
        });
        this.selection = new SelectionModel('face');
        this.selectedMeshes = this.selection.selectedMeshes;
        this.selectedFaces = this.selection.selectedFaces;
        this.selectedEdges = this.selection.selectedEdges;
        this.selectedVertices = this.selection.selectedVertices;

        this.uiRoot = document.getElementById('ui-root');
        this.ui = createUI(this.uiRoot, {
            scene,
            gl: renderer.gl,
            textureLibrary: this.textureLibrary,
            getSelectedItems: () => this.selectedMeshes,
            getSelectionCounts: () => ({
                meshes: this.selectedMeshes.size,
                faces: this.selectedFaces.size,
                edges: this.selectedEdges.size,
                vertices: this.selectedVertices.size
            }),
            prefabActions: {
                list: () => this.prefabManager.list(),
                create: name => this.createPrefab(name),
                instantiate: id => this.instantiatePrefab(id),
                update: id => this.updatePrefab(id),
                revert: () => this.revertPrefabInstances(),
                createNested: (name, ids) => this.createNestedPrefab(name, ids)
            },
            sceneActions: {
                list: () => this.sceneManager.list(),
                activeId: () => this.sceneManager.activeSceneId,
                create: () => this.createScene(),
                save: () => this.saveScene(),
                loadFile: file => this.loadSceneFile(file),
                duplicate: () => this.duplicateScene(),
                delete: () => this.deleteScene(),
                switch: id => this.switchScene(id),
                addReference: id => this.addSceneReference(id),
                removeReference: id => this.removeSceneReference(id),
                addSubScene: (id, streaming) => this.addSubScene(id, streaming),
                toggleSubScene: id => this.toggleSubScene(id),
                subSceneState: id => this.getSubSceneState(id)
            },
            onSelect: (mesh, additive) => this.select(mesh, { additive }),
            onSelectFace: faceIndex => this.selectFace(faceIndex),
            onSetPickMode: mode => this.setSelectionMode(mode),
            onSetTransformTool: tool => {
                this.gizmos.setTransformTool(tool);
                this.ui.setEditorState({ tool });
            },
            onSetTransformSpace: space => {
                this.gizmos.setTransformSpace(space);
                this.ui.setEditorState({ space });
            },
            onSetAxisLock: axis => this.gizmos.setAxisConstraint(axis),
            onSetSnap: settings => {
                this.gizmos.setSnap(settings);
                this.ui.setEditorState({ snap: settings });
            },
            onSetCameraView: view => this.setCameraView(view),
            onSetRenderMode: mode => this.renderer.setRenderMode(mode),
            onBonePoseChange: () => this.selected?.markDirty('skeletonPose'),
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
            onKnifeTool: () => this.knifeTool(),
            onBevel: () => this.bevelSelected(),
            onInset: () => this.insetSelected(),
            onLoopCut: () => this.loopCutSelected(),
            onBridge: () => this.bridgeSelected(),
            onFill: () => this.fillSelected(),
            onGridFill: () => this.gridFillSelected(),
            onDissolve: () => this.dissolveSelected(),
            onSplit: () => this.splitSelected(),
            onSeparate: () => this.separateSelected(),
            onTriangulate: () => this.triangulateSelected(),
            onQuadRebuild: () => this.quadRebuildSelected(),
            onRecalculateNormals: () => this.recalculateNormalsSelected(),
            onFlipNormals: () => this.flipNormalsSelected(),
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
            onPickMesh: (mesh, modifiers) => this.select(mesh, { additive: modifiers.additive }),
            onPickFace: (mesh, faceIndex, modifiers) => this.selectElement(mesh, 'face', faceIndex, { faceIndex }, modifiers),
            onPickEdge: (mesh, faceIndex, edgeKey, a, b, modifiers) => this.selectElement(mesh, 'edge', edgeKey, { faceIndex, a, b }, modifiers),
            onPickVertex: (mesh, faceIndex, vertexIndex, modifiers) => {
                const sharedVertexIndex = mesh.faces[faceIndex]?.[vertexIndex];
                this.selectElement(mesh, 'vertex', sharedVertexIndex, { faceIndex, vertexIndex }, modifiers);
            },
            onPickEmpty: modifiers => { if (!modifiers.additive) this.select(null); },
            onHistoryStart: () => this.snapshotScene(),
            onHistoryEnd: snapshot => this.recordHistorySnapshot(snapshot),
            onCameraViewChange: view => this.ui.setCameraView(view),
            onTransform: mesh => {
                // Lightweight: only mark transform dirty and refresh UI selection.
                // Full asset refresh is deferred until save/export or explicit request.
                mesh.transformRevision = (mesh.transformRevision || 0) + 1;
                mesh.markDirty?.('transform');
                this.ui.setSelected(mesh);
                // Avoid full hierarchy rebuild on every mouse move end; only if needed.
                if (this.selectedMeshes.size <= 8) this.ui.refreshHierarchy();
            }
        });

        this.selected = null;
        this.select(scene.meshes[0] || null);
    }

    update() {
        this.gizmos.update();
        this.ui.updateUvWorkspace();
        this.ui.updateAnimationWorkspace(this.selected?.animationPlayer.time || 0, this.selected?.animationPlayer.playing || false);
        this.ui.refreshStatus();
        const allPolygons = this.scene.meshes.reduce((sum, mesh) => sum + mesh.faceCount, 0);
        this.ui.setPolygonCount(this.selected?.faceCount || 0, allPolygons);
        this.ui.setViewportStats(this.renderer.frameStats);
    }

    async initializeScenes() {
        if (!this.sceneManager.activeScene) {
            this.refreshSceneAssets();
            const data = await this.serializeSceneData();
            const record = await this.sceneManager.createScene(this.scene.name, data, { id: this.scene.assetId });
            record.data.sceneAssetId = record.id;
            this.scene.assetId = record.id;
            this.sceneManager.persist();
        } else {
            await this.sceneManager.initializeActiveScene();
        }
        this.ui.refreshScenes();
    }

    async createScene() {
        const sceneNumber = this.sceneManager.scenes.size + 1;
        const record = await this.sceneManager.createScene(`Scene ${sceneNumber}`, {
            format: 'lightweight-3d-scene',
            version: 1,
            coordinateSystem: { handedness: 'right', upAxis: 'Y', units: 'editor' },
            sceneAssetId: null,
            assetManifest: { version: 1, assets: [] },
            light: null,
            textureAssets: [],
            meshes: []
        });
        record.data.sceneAssetId = record.id;
        this.sceneManager.persist();
        await this.sceneManager.loadScene(record.id);
        this.ui.refreshScenes();
        return record;
    }

    async saveScene() {
        const record = await this.sceneManager.saveScene();
        this.ui.refreshScenes();
        return record;
    }

    async switchScene(id) {
        const record = await this.sceneManager.loadScene(id);
        this.ui.refreshScenes();
        return record;
    }

    async duplicateScene() {
        const record = await this.sceneManager.duplicateScene();
        this.ui.refreshScenes();
        return record;
    }

    async deleteScene() {
        const removed = await this.sceneManager.deleteScene(this.sceneManager.activeSceneId);
        this.ui.refreshScenes();
        return removed;
    }

    async loadSceneFile(file) {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.meshes)) throw new TypeError('The selected file is not a scene export');
        if (data.assetManifest) {
            const assetIds = this.assetManager.importManifest(data.assetManifest);
            this.remapImportedSceneAssetIds(data, assetIds);
        }
        const record = await this.sceneManager.createScene(data.sceneName || file.name.replace(/\.[^.]+$/, '') || 'Imported Scene', data);
        record.references = (data.sceneReferences || []).filter(id => this.sceneManager.get(id));
        record.subScenes = (data.subScenes || []).filter(entry => this.sceneManager.get(entry.sceneId)).map(entry => ({
            sceneId: entry.sceneId,
            streaming: entry.streaming !== false,
            loaded: false
        }));
        try {
            this.sceneManager.persist();
        } catch (error) {
            console.warn('Scene imported in memory, but browser storage could not save it:', error);
        }
        await this.sceneManager.loadScene(record.id);
        this.ui.refreshScenes();
        return record;
    }

    remapImportedSceneAssetIds(data, assetIds) {
        const remap = id => assetIds.get(id) || id;
        data.sceneAssetId = remap(data.sceneAssetId);
        data.assetManifest = {
            ...data.assetManifest,
            assets: data.assetManifest.assets.map(asset => ({
                ...asset,
                id: remap(asset.id),
                dependencies: (asset.dependencies || []).map(remap),
                data: asset.data?.textureAssetId ? { ...asset.data, textureAssetId: remap(asset.data.textureAssetId) } : asset.data
            }))
        };
        (data.textureAssets || []).forEach(asset => { asset.id = remap(asset.id); });
        (data.meshes || []).forEach(mesh => {
            ['assetId', 'materialAssetId', 'skeletonAssetId', 'animationAssetId', 'textureAssetId'].forEach(field => {
                if (mesh[field]) mesh[field] = remap(mesh[field]);
            });
            mesh.faceTextureIds = (mesh.faceTextureIds || []).map(remap);
        });
    }

    async addSceneReference(id) {
        const result = this.sceneManager.addReference(this.sceneManager.activeSceneId, id);
        this.ui.refreshScenes();
        return result;
    }

    removeSceneReference(id) {
        const result = this.sceneManager.removeReference(this.sceneManager.activeSceneId, id);
        this.ui.refreshScenes();
        return result;
    }

    async addSubScene(id, streaming) {
        const result = await this.sceneManager.addSubScene(this.sceneManager.activeSceneId, id, { streaming });
        this.ui.refreshScenes();
        return result;
    }

    async toggleSubScene(id) {
        const link = this.getSubSceneState(id);
        if (!link) return false;
        const result = link.loaded
            ? await this.sceneManager.unloadSubScene(this.sceneManager.activeSceneId, id)
            : await this.sceneManager.loadSubScene(this.sceneManager.activeSceneId, id);
        this.ui.refreshScenes();
        return result;
    }

    getSubSceneState(id) {
        return this.sceneManager.activeScene?.subScenes.find(entry => entry.sceneId === id) || null;
    }

    async activateSceneData(data, record) {
        this.scene.meshes.length = 0;
        this.streamedSubScenes.clear();
        this.scene.name = record.name;
        this.scene.assetId = record.id;
        this.scene.light = null;
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        await this.importSceneData(data, { reuseExistingAssets: true, setSceneId: true });
        this.scene.name = record.name;
        this.scene.assetId = data.sceneAssetId || record.id;
        if (!this.scene.light) this.scene.light = new DirectionalLight();
        this.ui.refreshLight();
        this.select(this.scene.meshes[0] || null);
        this.ui.refreshScenes();
        this.ui.refreshPrefabs();
    }

    async loadSubSceneData(sceneId, data) {
        if (this.streamedSubScenes.has(sceneId)) return false;
        const imported = await this.importSceneData(data, {
            reuseExistingAssets: true,
            includeLighting: false,
            setSceneId: false,
            refreshAssets: false,
            selectImported: false
        });
        this.streamedSubScenes.set(sceneId, new Set(imported));
        this.refreshSceneAssets();
        this.ui.refreshHierarchy();
        return true;
    }

    async unloadSubSceneData(sceneId) {
        const meshes = this.streamedSubScenes.get(sceneId);
        if (!meshes) return false;
        this.scene.meshes = this.scene.meshes.filter(mesh => !meshes.has(mesh));
        this.streamedSubScenes.delete(sceneId);
        if (meshes.has(this.selected)) this.select(this.getAuthoredMeshes().at(-1) || null);
        this.refreshSceneAssets();
        this.ui.refreshHierarchy();
        return true;
    }

    getAuthoredMeshes() {
        const streamed = new Set([...this.streamedSubScenes.values()].flatMap(meshes => [...meshes]));
        return this.scene.meshes.filter(mesh => !streamed.has(mesh));
    }

    refreshSceneAssets() {
        const sceneMeshes = this.getAuthoredMeshes();
        const sceneAsset = this.assetManager.register({
            id: this.scene.assetId,
            name: this.scene.name || 'Scene',
            type: 'scene',
            resource: this.scene,
            metadata: { meshCount: sceneMeshes.length }
        });
        this.scene.assetId = sceneAsset.id;

        const meshAssetIds = [];
        const authoredMeshSet = new Set(sceneMeshes);
        this.scene.meshes.forEach((mesh, index) => {
            const materialAsset = this.assetManager.register({
                id: mesh.material.assetId,
                name: `${mesh.name || 'Mesh'} Material`,
                type: 'material',
                resource: mesh.material,
                metadata: {
                    shading: mesh.material.shading || 'toon',
                    metallic: mesh.material.metallic,
                    roughness: mesh.material.roughness,
                    opacity: mesh.material.opacity
                },
                data: {
                    name: mesh.material.name || `${mesh.name || 'Mesh'} Material`,
                    assetId: mesh.material.assetId || null,
                    baseColor: [...(mesh.material.baseColor || mesh.material.color || [1, 1, 1])],
                    metallic: mesh.material.metallic ?? 0,
                    roughness: mesh.material.roughness ?? 0.5,
                    emission: [...(mesh.material.emission || [0, 0, 0])],
                    opacity: mesh.material.opacity ?? 1,
                    shading: mesh.material.shading || 'toon',
                    useTexture: !!mesh.material.useTexture,
                    textureAssetId: mesh.textureAssetId || null,
                    textureSlots: {
                        albedo: mesh.material.textureSlots?.albedo ? { id: mesh.material.textureSlots.albedo.id || null } : null,
                        normal: mesh.material.textureSlots?.normal ? { id: mesh.material.textureSlots.normal.id || null } : null,
                        roughness: mesh.material.textureSlots?.roughness ? { id: mesh.material.textureSlots.roughness.id || null } : null,
                        metallic: mesh.material.textureSlots?.metallic ? { id: mesh.material.textureSlots.metallic.id || null } : null,
                        emission: mesh.material.textureSlots?.emission ? { id: mesh.material.textureSlots.emission.id || null } : null
                    }
                }
            });
            mesh.material.assetId = materialAsset.id;

            const skeletonData = mesh.skeleton.bones.map(bone => ({
                name: bone.name,
                parent: bone.parent?.name || null,
                position: [...bone.position],
                rotation: [...bone.rotation],
                scale: [...bone.scale],
                length: bone.length,
                bindPosition: [...bone.bindPosition],
                bindRotation: [...bone.bindRotation],
                bindScale: [...bone.bindScale]
            }));
            const skeletonAsset = this.assetManager.register({
                id: mesh.skeleton.assetId,
                name: `${mesh.name || 'Mesh'} Skeleton`,
                type: 'skeleton',
                resource: mesh.skeleton,
                metadata: { boneCount: skeletonData.length },
                data: { bones: skeletonData }
            });
            mesh.skeleton.assetId = skeletonAsset.id;

            let animationAsset = null;
            if (mesh.animationClip) {
                const tracks = mesh.animationClip.tracks.map(track => ({
                    boneName: track.boneName || null,
                    property: track.property,
                    times: [...track.times],
                    values: track.values.map(value => Array.isArray(value) ? [...value] : value)
                }));
                animationAsset = this.assetManager.register({
                    id: mesh.animationClip.assetId,
                    name: mesh.animationClip.name || `${mesh.name || 'Mesh'} Animation`,
                    type: 'animation',
                    resource: mesh.animationClip,
                    metadata: { duration: mesh.animationClip.duration, trackCount: tracks.length },
                    data: { duration: mesh.animationClip.duration, tracks }
                });
                mesh.animationClip.assetId = animationAsset.id;
            }

            const meshAsset = this.assetManager.register({
                id: mesh.assetId,
                name: mesh.name || `Mesh ${index + 1}`,
                type: 'mesh',
                resource: mesh,
                metadata: { polygonCount: mesh.faceCount },
                data: { sceneIndex: index }
            });
            mesh.assetId = meshAsset.id;
            const textureDependencies = [mesh.textureAssetId, ...(mesh.faceTextureIds || [])]
                .filter(id => id && this.assetManager.get(id));
            this.assetManager.setDependencies(materialAsset.id, [mesh.textureAssetId].filter(id => id && this.assetManager.get(id)));
            this.assetManager.setDependencies(meshAsset.id, [...new Set([
                materialAsset.id,
                skeletonAsset.id,
                animationAsset?.id,
                mesh.prefabInstance?.prefabId,
                mesh.prefabInstance?.sourcePrefabId,
                ...textureDependencies
            ].filter(Boolean))]);
            if (authoredMeshSet.has(mesh)) meshAssetIds.push(meshAsset.id);
        });

        this.assetManager.register({
            id: this.scene.assetId,
            name: this.scene.name || 'Scene',
            type: 'scene',
            resource: this.scene,
            metadata: { meshCount: meshAssetIds.length },
            data: { meshAssetIds }
        });
        this.assetManager.setDependencies(sceneAsset.id, meshAssetIds);
    }

    async importTexture(file) {
        await this.textureLibrary.addFile(file);
        this.ui.refreshTextures();
    }

    select(mesh, { additive = false } = {}) {
        const previous = this.selected;
        this.selected = this.selection.selectMesh(mesh, { additive });
        if (previous && previous !== this.selected) previous.selectedVertex = null;
        if (this.selected) this.selected.selectedFace = this.selected.selectedFace < 0 ? 0 : this.selected.selectedFace;
        this.gizmos?.setSelected(this.selected);
        this.ui.setSelected(this.selected);
        this.ui.refreshHierarchy();
    }

    selectMeshes(meshes) {
        const previous = this.selected;
        this.selected = this.selection.selectMeshes(meshes);
        if (previous && previous !== this.selected) previous.selectedVertex = null;
        this.gizmos?.setSelected(this.selected);
        this.ui.setSelected(this.selected);
        this.ui.refreshHierarchy();
    }

    setSelectionMode(mode) {
        if (mode !== 'orbit') this.selection.setMode(mode);
        this.gizmos?.setPickMode(mode);
        this.ui?.setEditorState({ mode });
    }

    selectElement(mesh, mode, value, details = {}, { additive = false } = {}) {
        const previous = this.selected;
        this.selection.selectElement(mesh, mode, value, details, { additive });
        this.selected = mesh;
        if (previous && previous !== mesh) previous.selectedVertex = null;
        const active = this.selection.active;
        mesh.selectedVertex = active?.mesh === mesh && active.mode === 'vertex'
            ? { faceIndex: active.faceIndex, vertexIndex: active.vertexIndex }
            : null;
        if (active?.mesh === mesh && Number.isInteger(active.faceIndex)) {
            mesh.selectedFace = active.faceIndex;
        } else if (mode === 'face') {
            mesh.selectedFace = -1;
        }
        this.gizmos?.setSelected(mesh);
        this.ui.setSelected(mesh);
        this.ui.setFace(mesh.selectedFace);
        this.ui.refreshHierarchy();
    }

    async createPrefab(name) {
        const selectedMeshes = [...this.selectedMeshes].filter(mesh => this.scene.meshes.includes(mesh));
        if (!selectedMeshes.length) throw new Error('Select one or more meshes to create a prefab');
        this.refreshSceneAssets();
        const sceneData = await this.serializeSceneData();
        const meshDataByAssetId = new Map(sceneData.meshes.map(meshData => [meshData.assetId, meshData]));
        const sourcePrefabIds = new Set(selectedMeshes.map(mesh => mesh.prefabInstance?.sourcePrefabId).filter(Boolean));
        const keepSourceNodeIds = sourcePrefabIds.size === 1;
        const nodeIds = new Map(selectedMeshes.map(mesh => [
            mesh,
            keepSourceNodeIds ? mesh.prefabInstance?.sourceNodeId || createId('prefab-node') : createId('prefab-node')
        ]));
        const nodes = selectedMeshes.map(mesh => {
            const data = { ...meshDataByAssetId.get(mesh.assetId) };
            delete data.prefabInstance;
            const sourceInstance = mesh.prefabInstance;
            const parentMesh = sourceInstance && selectedMeshes.find(candidate =>
                candidate.prefabInstance?.instanceId === sourceInstance.instanceId && candidate.prefabInstance.nodeId === sourceInstance.parentNodeId
            );
            return {
                id: nodeIds.get(mesh),
                name: mesh.name,
                parentId: parentMesh ? nodeIds.get(parentMesh) : null,
                data
            };
        });
        const prefab = this.prefabManager.create(name || `${selectedMeshes[0].name || 'Mesh'} Prefab`, nodes);
        this.ui.refreshPrefabs();
        return prefab;
    }

    async instantiatePrefab(prefabId) {
        const instance = this.prefabManager.instantiate(prefabId);
        this.recordHistory();
        const meshData = instance.members.map(node => ({
            ...node.data,
            prefabInstance: {
                instanceId: instance.instanceId,
                prefabId: instance.prefabId,
                sourcePrefabId: node.sourcePrefabId,
                sourceNodeId: node.sourceNodeId,
                nodeId: node.id,
                parentNodeId: node.parentId,
                overrides: {}
            }
        }));
        const imported = await this.importSceneData({ meshes: meshData }, { selectImported: false });
        this.selectMeshes(imported);
        this.refreshSceneAssets();
        this.ui.refreshPrefabs();
        return imported;
    }

    async updatePrefab(prefabId) {
        const selected = [...this.selectedMeshes].filter(mesh => mesh.prefabInstance?.sourcePrefabId === prefabId);
        if (!selected.length) throw new Error('Select an instance node from the prefab being updated');
        const instanceId = selected[0].prefabInstance.instanceId;
        const instanceNodes = selected.filter(mesh => mesh.prefabInstance.instanceId === instanceId);
        const sceneData = await this.serializeSceneData();
        const dataByAssetId = new Map(sceneData.meshes.map(meshData => [meshData.assetId, meshData]));
        const prefab = this.prefabManager.get(prefabId);
        const nodes = prefab.data.nodes.map(node => {
            const mesh = instanceNodes.find(candidate => candidate.prefabInstance.sourceNodeId === node.id && candidate.prefabInstance.sourcePrefabId === prefabId);
            if (!mesh) return node;
            const data = { ...dataByAssetId.get(mesh.assetId) };
            delete data.prefabInstance;
            mesh.prefabInstance.overrides = {};
            return { ...node, data };
        });
        this.prefabManager.update(prefabId, nodes);
        const updatedPrefabAsset = this.assetManager.toJSON().assets.find(asset => asset.id === prefabId);
        const reconcileMeshData = meshData => {
            const instance = meshData.prefabInstance;
            if (!instance || instance.sourcePrefabId !== prefabId) return;
            const baseData = this.prefabManager.revertNode(prefabId, instance.sourceNodeId);
            const overrides = instance.instanceId === instanceId ? {} : instance.overrides || {};
            const updatedData = this.prefabManager.applyOverrides(baseData, overrides);
            const assetIds = Object.fromEntries(['assetId', 'materialAssetId', 'skeletonAssetId', 'animationAssetId'].map(key => [key, meshData[key]]));
            Object.assign(meshData, updatedData, assetIds, { prefabInstance: { ...instance, overrides } });
        };
        for (const record of this.sceneManager.scenes.values()) {
            (record.data.meshes || []).forEach(reconcileMeshData);
            if (record.data.assetManifest?.assets && updatedPrefabAsset) {
                const index = record.data.assetManifest.assets.findIndex(asset => asset.id === prefabId);
                if (index >= 0) record.data.assetManifest.assets[index] = JSON.parse(JSON.stringify(updatedPrefabAsset));
            }
            record.updatedAt = Date.now();
        }
        const replacements = [];
        for (const mesh of this.scene.meshes) {
            const instance = mesh.prefabInstance;
            if (!instance || instance.sourcePrefabId !== prefabId || instance.instanceId === instanceId) continue;
            const currentData = dataByAssetId.get(mesh.assetId);
            if (!currentData) continue;
            const baseData = this.prefabManager.revertNode(prefabId, instance.sourceNodeId);
            const overrides = currentData.prefabInstance?.overrides || instance.overrides || {};
            const updatedData = this.prefabManager.applyOverrides(baseData, overrides);
            for (const field of ['assetId', 'materialAssetId', 'skeletonAssetId', 'animationAssetId']) updatedData[field] = currentData[field];
            updatedData.prefabInstance = { ...instance, overrides };
            replacements.push([mesh, updatedData]);
        }
        for (const [mesh, data] of replacements) await this.replaceMeshFromPrefabData(mesh, data);
        this.sceneManager.persist();
        this.refreshSceneAssets();
        this.ui.refreshPrefabs();
        return prefab;
    }

    createNestedPrefab(name, prefabIds) {
        const prefab = this.prefabManager.createNested(name, prefabIds);
        this.ui.refreshPrefabs();
        return prefab;
    }

    async revertPrefabInstances() {
        const selected = [...this.selectedMeshes].filter(mesh => mesh.prefabInstance);
        if (!selected.length) throw new Error('Select one or more prefab instance meshes to revert');
        this.recordHistory();
        const replacements = [];
        for (const mesh of selected) {
            const instance = mesh.prefabInstance;
            const baseData = this.prefabManager.revertNode(instance.sourcePrefabId, instance.sourceNodeId);
            const replacement = await this.replaceMeshFromPrefabData(mesh, {
                ...baseData,
                prefabInstance: { ...instance, overrides: {} }
            });
            replacements.push(replacement);
        }
        this.selectMeshes(replacements);
        this.refreshSceneAssets();
        this.ui.refreshPrefabs();
        return replacements;
    }

    async replaceMeshFromPrefabData(mesh, data) {
        const index = this.scene.meshes.indexOf(mesh);
        const [replacement] = await this.importSceneData({ meshes: [data] }, { refreshAssets: false, selectImported: false });
        if (!replacement || index < 0) throw new Error('Could not restore prefab mesh data');
        this.scene.meshes[index] = replacement;
        for (const members of this.streamedSubScenes.values()) {
            if (members.delete(mesh)) members.add(replacement);
        }
        return replacement;
    }

    selectFace(faceIndex, { additive = false, mesh = this.selected } = {}) {
        if (!mesh) return;
        this.selectElement(mesh, 'face', faceIndex, { faceIndex }, { additive });
    }

    getSelectedFaceIndices(mesh = this.selected) {
        if (!mesh) return [];
        const selected = [...this.selectedFaces].filter(index => index >= 0 && index < mesh.faceCount);
        if (selected.length) return selected;
        return mesh.selectedFace >= 0 && mesh.selectedFace < mesh.faceCount ? [mesh.selectedFace] : [];
    }

    finishMeshEditSelection(mesh) {
        this.selection.clearElements();
        mesh.selectedVertex = null;
        if (mesh.faceCount) {
            const faceIndex = Math.max(0, Math.min(mesh.selectedFace, mesh.faceCount - 1));
            mesh.selectedFace = faceIndex;
            this.selectedFaces.add(faceIndex);
            this.selection.active = { mode: 'face', mesh, value: faceIndex, faceIndex };
        } else {
            mesh.selectedFace = -1;
            this.selection.active = { mode: 'mesh', mesh };
        }
        this.selected = mesh;
        this.gizmos?.setSelected(mesh);
        this.ui.setSelected(mesh);
        this.ui.setFace(mesh.selectedFace);
    }

    runSelectedFaceOperator(name, label, ...args) {
        const mesh = this.selected;
        const faceIndices = this.getSelectedFaceIndices(mesh).sort((a, b) => b - a);
        if (!mesh || !faceIndices.length) {
            this.ui.setStatus('Select a face first');
            return false;
        }
        const targetFaces = faceIndices.map(faceIndex => mesh.faces[faceIndex]?.join(',')).filter(Boolean);
        const changed = executeMeshCommand(this, mesh, label, () => {
            targetFaces.forEach(faceSignature => {
                const faceIndex = mesh.faces.findIndex(face => face.join(',') === faceSignature);
                if (faceIndex >= 0) runMeshOperator(mesh, name, faceIndex, ...args);
            });
        });
        if (changed) this.finishMeshEditSelection(mesh);
        return changed;
    }

    addFace() {
        if (!this.selected) {
            this.ui.setStatus('Select a mesh first');
            return;
        }
        const mesh = this.selected;
        if (executeMeshCommand(this, mesh, 'Add Face', () => runMeshOperator(mesh, 'addFace', [[0, 0, 0], [1, 0, 0], [0, 1, 0]]))) {
            this.finishMeshEditSelection(mesh);
        }
    }

    extrudeFace() {
        this.runSelectedFaceOperator('extrude', 'Extrude');
    }

    mergeSelectedFace() {
        this.runSelectedFaceOperator('mergeCoplanar', 'Merge Coplanar');
    }

    mergeSelectedVertices() {
        const mesh = this.selected;
        if (!mesh) return;
        const selectedIndices = [...this.selectedVertices];
        if (!selectedIndices.length && mesh.selectedVertex) {
            const { faceIndex, vertexIndex } = mesh.selectedVertex;
            selectedIndices.push(mesh.faces[faceIndex]?.[vertexIndex]);
        }
        const positions = selectedIndices.map(index => mesh.positions[index]).filter(Boolean).map(position => [...position]);
        if (!positions.length) {
            this.ui.setStatus('Select a vertex first');
            return;
        }
        if (executeMeshCommand(this, mesh, 'Merge Vertices', () => positions.forEach(position => {
            const vertexIndex = mesh.positions.findIndex(candidate => Math.hypot(...candidate.map((value, axis) => value - position[axis])) < 1e-6);
            if (vertexIndex < 0) return;
            const faceIndex = mesh.faces.findIndex(face => face.includes(vertexIndex));
            if (faceIndex < 0) return;
            const cornerIndex = mesh.faces[faceIndex].indexOf(vertexIndex);
            runMeshOperator(mesh, 'mergeVertices', faceIndex, cornerIndex);
        }))) this.finishMeshEditSelection(mesh);
    }

    addVertex() {
        this.runSelectedFaceOperator('addVertex', 'Add Vertex', [0, 0, 0]);
    }

    knifeTool() {
        this.runSelectedFaceOperator('knife', 'Knife', [0, 0, 0], [1, 0, 0]);
    }

    bevelSelected() {
        this.runSelectedFaceOperator('bevel', 'Bevel', 0.1);
    }

    insetSelected() {
        this.runSelectedFaceOperator('inset', 'Inset', 0.2);
    }

    loopCutSelected() {
        this.runSelectedFaceOperator('loopCut', 'Loop Cut', 2);
    }

    bridgeSelected() {
        const mesh = this.selected;
        const faces = this.getSelectedFaceIndices(mesh);
        const source = faces[0];
        const target = faces[1] ?? (source === undefined ? undefined : source + 1);
        if (!mesh || target === undefined || target >= mesh.faceCount) {
            this.ui.setStatus('Select two faces to bridge');
            return;
        }
        if (executeMeshCommand(this, mesh, 'Bridge', () => runMeshOperator(mesh, 'bridge', source, target))) this.finishMeshEditSelection(mesh);
    }

    fillSelected() {
        this.runSelectedFaceOperator('fill', 'Fill');
    }

    gridFillSelected() {
        this.runSelectedFaceOperator('gridFill', 'Grid Fill', 2, 2);
    }

    dissolveSelected() {
        this.runSelectedFaceOperator('dissolve', 'Dissolve');
    }

    splitSelected() {
        const faceIndices = this.getSelectedFaceIndices();
        if (!this.selected || !faceIndices.length) {
            this.ui.setStatus('Select a face first');
            return;
        }
        const sourceMesh = this.selected;
        const created = [];
        executeSceneCommand(this, 'Split',
            () => {
                faceIndices.forEach(faceIndex => {
                    const splitMesh = runMeshOperator(sourceMesh, 'split', faceIndex, 'x');
                    if (splitMesh) created.push(splitMesh);
                });
                created.forEach(mesh => this.scene.add(mesh));
                return created.length;
            },
            () => created.forEach(mesh => this.scene.remove(mesh)),
            () => created.forEach(mesh => this.scene.add(mesh)),
            count => count > 0
        );
        this.ui.refreshHierarchy();
    }

    separateSelected() {
        const faceIndices = this.getSelectedFaceIndices();
        if (!this.selected || !faceIndices.length) {
            this.ui.setStatus('Select a face first');
            return;
        }
        const sourceMesh = this.selected;
        const created = [];
        executeSceneCommand(this, 'Separate',
            () => {
                faceIndices.forEach(faceIndex => {
                    const separated = runMeshOperator(sourceMesh, 'separate', faceIndex);
                    if (separated) created.push(separated);
                });
                created.forEach(mesh => this.scene.add(mesh));
                return created.length;
            },
            () => created.forEach(mesh => this.scene.remove(mesh)),
            () => created.forEach(mesh => this.scene.add(mesh)),
            count => count > 0
        );
        this.ui.refreshHierarchy();
    }

    triangulateSelected() {
        this.runSelectedFaceOperator('triangulate', 'Triangulate');
    }

    quadRebuildSelected() {
        this.runSelectedFaceOperator('quadRebuild', 'Quad Rebuild');
    }

    recalculateNormalsSelected() {
        if (!this.selected) {
            this.ui.setStatus('Select a mesh first');
            return;
        }
        const mesh = this.selected;
        executeMeshCommand(this, mesh, 'Recalculate Normals', () => runMeshOperator(mesh, 'recalculateNormals'));
    }

    flipNormalsSelected() {
        if (!this.selected) {
            this.ui.setStatus('Select a mesh first');
            return;
        }
        const mesh = this.selected;
        if (executeMeshCommand(this, mesh, 'Flip Normals', () => runMeshOperator(mesh, 'flipNormals'))) this.finishMeshEditSelection(mesh);
    }

    addBone(parentIndex = null) {
        if (!this.selected) return;
        this.recordHistory();
        const parent = Number.isInteger(parentIndex) ? this.selected.skeleton.bones[parentIndex] : null;
        const bone = this.selected.skeleton.addBone(undefined, parent);
        this.selected.markDirty('skeletonPose');
        this.selected.selectedBone = this.selected.skeleton.bones.indexOf(bone);
        this.ui.refreshBones();
    }

    removeBone(index) {
        if (!this.selected) return;
        this.recordHistory();
        if (!this.selected.removeBone(index)) return;
        this.selected.markDirty('skeletonPose');
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
        this.refreshSceneAssets();
        this.select(mesh);
    }

    async importSceneData(data, { reuseExistingAssets = false, includeLighting = true, setSceneId = false, refreshAssets = true, selectImported = true } = {}) {
        const assetIds = data.assetManifest ? this.assetManager.importManifest(data.assetManifest, { reuseExisting: reuseExistingAssets }) : new Map();
        const reserveCollidingId = (id, type) => {
            if (id && !assetIds.has(id) && this.assetManager.get(id)) assetIds.set(id, this.assetManager.createId(type));
        };
        if (!data.assetManifest && !reuseExistingAssets) {
            if (setSceneId) reserveCollidingId(data.sceneAssetId, 'scene');
            (data.textureAssets || []).forEach(asset => reserveCollidingId(asset.id, 'texture'));
            (data.meshes || []).forEach(meshData => {
                reserveCollidingId(meshData.assetId, 'mesh');
                reserveCollidingId(meshData.materialAssetId, 'material');
                reserveCollidingId(meshData.skeletonAssetId, 'skeleton');
                reserveCollidingId(meshData.animationAssetId, 'animation');
            });
        }
        if (setSceneId && data.sceneAssetId) this.scene.assetId = assetIds.get(data.sceneAssetId) || data.sceneAssetId;
        if (includeLighting && data.light) {
            const importedLight = new DirectionalLight(data.light);
            if (this.scene.light) Object.assign(this.scene.light, importedLight);
            else this.scene.light = importedLight;
            this.ui.refreshLight();
        }
        const textureIds = new Map();
        for (const assetData of data.textureAssets || []) {
            const textureId = assetIds.get(assetData.id) || assetData.id;
            const existingTexture = reuseExistingAssets ? this.textureLibrary.get(textureId) : null;
            const asset = existingTexture || await this.textureLibrary.importExportedAsset(assetData, { id: textureId });
            textureIds.set(assetData.id, asset.id);
        }
        const resolveTexture = id => this.textureLibrary.get(textureIds.get(id) || assetIds.get(id) || id);
        const importedMeshes = [];
        for (const meshData of data.meshes || []) {
            const materialData = Material.fromJSON({
                baseColor: meshData.baseColor || meshData.color || [0.78, 0.84, 0.92],
                color: meshData.color || meshData.baseColor || [0.78, 0.84, 0.92],
                metallic: meshData.metallic ?? 0,
                roughness: meshData.roughness ?? 0.5,
                emission: meshData.emission || [0, 0, 0],
                opacity: meshData.opacity ?? 1,
                shading: meshData.shading || 'toon',
                useTexture: meshData.useTexture || !!meshData.textureAssetId,
                texture: null,
                albedo: null,
                textureSlots: meshData.textureSlots || null,
                assetId: meshData.materialAssetId || null,
                name: meshData.materialName || 'Imported Material'
            });
            const mesh = new Mesh(materialData);
            if (meshData.positions && meshData.faces) {
                mesh.setTopology(meshData.positions, meshData.faces);
            } else if (meshData.polygons) {
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
                mesh.setTopology(vertices, faces);
            }
            mesh.name = meshData.name || 'Imported Mesh';
            mesh.prefabInstance = meshData.prefabInstance ? JSON.parse(JSON.stringify(meshData.prefabInstance)) : null;
            mesh.assetId = assetIds.get(meshData.assetId) || meshData.assetId || null;
            mesh.material.assetId = assetIds.get(meshData.materialAssetId) || meshData.materialAssetId || null;
            if (meshData.materialAssetId && !mesh.material.assetId) mesh.material.assetId = meshData.materialAssetId;
            mesh.skeleton.assetId = assetIds.get(meshData.skeletonAssetId) || meshData.skeletonAssetId || null;
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
                const sharedVertexIndex = mesh.faces[faceIndex]?.[vertexIndex];
                const vertex = mesh.positions[sharedVertexIndex];
                if (!vertex || !entry.weights?.length) return;
                const weights = new Map();
                entry.weights.forEach(weight => {
                    const bone = boneMap.get(weight.bone);
                    if (bone) weights.set(bone, weight.weight);
                });
                if (weights.size) mesh.vertexWeights.set(sharedVertexIndex, {
                    bindPosition: [...(entry.bindPosition || vertex)],
                    weights
                });
            }));

            const resolveMaterialTexture = slot => {
                if (!slot) return null;
                const resolved = resolveTexture(slot); 
                if (resolved?.texture) return resolved.texture;
                return slot?.texture || slot || null;
            };
            const materialTextureSlots = meshData.textureSlots || {};
            mesh.material.textureSlots = {
                albedo: resolveMaterialTexture(materialTextureSlots.albedo ?? meshData.textureAssetId ?? null),
                normal: resolveMaterialTexture(materialTextureSlots.normal ?? null),
                roughness: resolveMaterialTexture(materialTextureSlots.roughness ?? null),
                metallic: resolveMaterialTexture(materialTextureSlots.metallic ?? null),
                emission: resolveMaterialTexture(materialTextureSlots.emission ?? null)
            };
            mesh.textureAssetId = textureIds.get(meshData.textureAssetId) || assetIds.get(meshData.textureAssetId) || meshData.textureAssetId || null;
            const meshTexture = resolveTexture(meshData.textureAssetId) || resolveMaterialTexture(materialTextureSlots.albedo ?? meshData.textureAssetId ?? null);
            mesh.material.texture = meshTexture || null;
            mesh.material.useTexture = !!mesh.material.texture;
            mesh.faceTextureIds = (meshData.faceTextureIds || []).map(id => textureIds.get(id) || assetIds.get(id) || id || null);
            mesh.faceTextures = mesh.faceTextureIds.map(id => resolveTexture(id)?.texture || null);

            if (meshData.animation) {
                const clip = new AnimationClip(meshData.animation.name || 'Imported Animation', meshData.animation.duration || 1);
                clip.assetId = assetIds.get(meshData.animationAssetId) || meshData.animationAssetId || null;
                (meshData.animation.tracks || []).forEach(track => {
                    if (track.boneName) track.times.forEach((time, index) => clip.addBoneKeyframe(track.boneName, track.property, time, track.values[index]));
                    else clip.addTrack(track.property, [...track.times], track.values.map(value => [...value]));
                });
                mesh.animationClip = clip;
            }
            this.scene.add(mesh);
            importedMeshes.push(mesh);
        }
        if (refreshAssets) this.refreshSceneAssets();
        this.ui.refreshTextures();
        this.ui.refreshPrefabs();
        if (selectImported && importedMeshes.length) this.select(importedMeshes[importedMeshes.length - 1]);
        return importedMeshes;
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
        this.refreshSceneAssets();
        this.select(mesh);
    }

    createPrimitive(type) {
        const material = Material.fromJSON({ baseColor: [0.78, 0.84, 0.92], color: [0.78, 0.84, 0.92], roughness: 0.5, metallic: 0, emission: [0, 0, 0], opacity: 1 });
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
        // Larger chunks; keep unique materials but identical geometry so instancing still groups them.
        // Sharing a single Material object was unsafe (dirty flags / face state).
        const chunkSize = amount > 2000 ? 400 : 200;
        let lastMesh = null;
        // Temporarily disable expensive shadow rebuilds during mass add
        const prevShadow = this.renderer?.shadowSignature;
        for (let index = 0; index < amount; index++) {
            const mesh = this.createPrimitive(type);
            if (!mesh) throw new Error(`Unknown primitive type: ${type}`);
            mesh.name = `${type} ${this.scene.meshes.length + 1}`;
            mesh.position = [
                (index % columns - (columns - 1) / 2) * spacing,
                0.5,
                (Math.floor(index / columns) - (rows - 1) / 2) * spacing
            ];
            // Ensure render queues exist immediately
            if (!mesh.opaqueFaceIndices?.length && mesh.faceCount) {
                mesh.updateRenderQueues?.();
            }
            this.scene.add(mesh);
            lastMesh = mesh;
            if ((index + 1) % chunkSize === 0 || index + 1 === amount) {
                onProgress(index + 1);
                if (index + 1 < amount) await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        this.refreshSceneAssets();
        this.select(lastMesh);
        this.ui.setStatus(`Added ${amount} ${type}(s) – switch to Wireframe if needed, then back to Anime`);
    }

    duplicateSelected() {
        const sources = [...this.selectedMeshes].filter(mesh => this.scene.meshes.includes(mesh));
        if (!sources.length && this.selected) sources.push(this.selected);
        if (!sources.length) {
            this.ui.setStatus('Select one or more meshes first');
            return;
        }
        this.recordHistory();
        const duplicates = sources.map(source => this.cloneMesh(source));
        duplicates.forEach(duplicate => this.scene.add(duplicate));
        this.refreshSceneAssets();
        this.selectMeshes(duplicates);
    }

    cloneMesh(source) {
        const duplicate = new Mesh(Material.fromJSON({
            baseColor: [...source.material.baseColor],
            color: [...source.material.color],
            opacity: source.material.opacity,
            metallic: source.material.metallic,
            roughness: source.material.roughness,
            emission: [...source.material.emission],
            useTexture: source.material.useTexture,
            texture: source.material.texture,
            shading: source.material.shading,
            textureSlots: source.material.textureSlots,
            assetId: source.material.assetId,
            name: source.material.name
        }));
        duplicate.name = `${source.name} Copy`;
        duplicate.position = source.position.map((value, axis) => value + (axis === 0 ? 1 : 0));
        duplicate.rotation = [...source.rotation];
        duplicate.scale = [...source.scale];
        duplicate.setTopology(source.positions, source.faces);
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
            const sharedVertexIndex = source.faces[faceIndex]?.[vertexIndex];
            const skin = source.vertexWeights.get(sharedVertexIndex);
            if (!skin) return;
            const duplicateVertexIndex = duplicate.faces[faceIndex]?.[vertexIndex];
            if (duplicateVertexIndex === undefined) return;
            duplicate.vertexWeights.set(duplicateVertexIndex, {
                bindPosition: [...skin.bindPosition],
                weights: new Map([...skin.weights].map(([bone, weight]) => [bones.get(bone), weight]).filter(([bone]) => bone))
            });
        }));
        duplicate.animationClip = source.animationClip ? new AnimationClip(source.animationClip.name, source.animationClip.duration) : null;
        source.animationClip?.tracks.forEach(track => {
            if (track.boneName) track.times.forEach((time, index) => duplicate.animationClip.addBoneKeyframe(track.boneName, track.property, time, track.values[index]));
            else duplicate.animationClip.addTrack(track.property, [...track.times], track.values.map(value => [...value]));
        });
        return duplicate;
    }

    deleteSelected(mesh = null) {
        const targets = (mesh ? [mesh] : [...this.selectedMeshes]).filter(item => this.scene.meshes.includes(item));
        if (!targets.length && this.selected && this.scene.meshes.includes(this.selected)) targets.push(this.selected);
        if (!targets.length) {
            this.ui.setStatus('Select one or more meshes first');
            return;
        }
        const firstIndex = Math.min(...targets.map(target => this.scene.meshes.indexOf(target)));
        this.recordHistory();
        targets.forEach(target => this.scene.remove(target));
        this.refreshSceneAssets();
        const remainingSelection = [...this.selectedMeshes].filter(target => this.scene.meshes.includes(target));
        if (remainingSelection.length) this.selectMeshes(remainingSelection);
        else this.select(this.scene.meshes[Math.min(firstIndex, this.scene.meshes.length - 1)] || null);
    }

    reorderMesh(mesh, index) {
        const currentIndex = this.scene.meshes.indexOf(mesh);
        if (currentIndex < 0 || currentIndex === index) return;
        this.recordHistory();
        this.scene.move(mesh, index);
        this.ui.refreshHierarchy();
    }

    resetCamera() {
        this.camera.setViewMode('perspective');
        this.camera.position = [0, 1.5, 4];
        this.camera.target = [0, 0.5, 0];
        this.gizmos.syncFromCamera();
        this.ui.setCameraView('perspective');
    }

    setCameraView(view) {
        this.camera.setViewMode(view);
        this.gizmos.syncFromCamera();
        this.ui.setCameraView(view);
    }

    snapshotScene() {
        const authoredMeshes = this.getAuthoredMeshes();
        const snapshot = {
            light: this.scene.light ? {
                name: this.scene.light.name,
                direction: this.scene.light.direction,
                color: this.scene.light.color,
                intensity: this.scene.light.intensity,
                threshold: this.scene.light.threshold,
                shadeColor: this.scene.light.shadeColor
            } : null,
            selectedIndex: authoredMeshes.indexOf(this.selected),
            meshes: authoredMeshes.map(mesh => ({
                assetId: mesh.assetId,
                materialAssetId: mesh.material.assetId,
                skeletonAssetId: mesh.skeleton.assetId,
                animationAssetId: mesh.animationClip?.assetId || null,
                prefabInstance: mesh.prefabInstance ? JSON.parse(JSON.stringify(mesh.prefabInstance)) : null,
                name: mesh.name,
                position: mesh.position,
                rotation: mesh.rotation,
                scale: mesh.scale,
                materialName: mesh.material.name,
                baseColor: [...mesh.material.baseColor],
                color: mesh.material.color,
                metallic: mesh.material.metallic,
                roughness: mesh.material.roughness,
                emission: [...mesh.material.emission],
                opacity: mesh.material.opacity,
                shading: mesh.material.shading,
                textureSlots: {
                    albedo: mesh.material.textureSlots?.albedo?.id || mesh.textureAssetId || null,
                    normal: mesh.material.textureSlots?.normal?.id || null,
                    roughness: mesh.material.textureSlots?.roughness?.id || null,
                    metallic: mesh.material.textureSlots?.metallic?.id || null,
                    emission: mesh.material.textureSlots?.emission?.id || null
                },
                polygons: mesh.polygons,
                positions: mesh.positions.map(position => [...position]),
                faces: mesh.faces.map(face => [...face]),
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
        const streamedMeshes = [...this.streamedSubScenes.values()].flatMap(meshes => [...meshes]);
        this.scene.meshes.length = 0;
        await this.importSceneData(snapshot, { reuseExistingAssets: true });
        this.scene.meshes.push(...streamedMeshes);
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
        this.refreshSceneAssets();
        this.select(this.getAuthoredMeshes()[snapshot.selectedIndex] || null);
    }

    async undo() {
        const historyEntry = this.undoStack.pop();
        if (!historyEntry) return;
        if (historyEntry.type === 'mesh-edit' || historyEntry.type === 'scene-edit') {
            historyEntry.undo();
            this.redoStack.push(historyEntry);
            if (historyEntry.mesh) this.refreshAfterMeshCommand(historyEntry.mesh);
            else this.ui.refreshHierarchy();
            return;
        }
        this.redoStack.push(this.snapshotScene());
        await this.restoreHistorySnapshot(historyEntry);
    }

    async redo() {
        const historyEntry = this.redoStack.pop();
        if (!historyEntry) return;
        if (historyEntry.type === 'mesh-edit' || historyEntry.type === 'scene-edit') {
            historyEntry.redo();
            this.undoStack.push(historyEntry);
            if (historyEntry.mesh) this.refreshAfterMeshCommand(historyEntry.mesh);
            else this.ui.refreshHierarchy();
            return;
        }
        this.undoStack.push(this.snapshotScene());
        await this.restoreHistorySnapshot(historyEntry);
    }

    refreshAfterMeshCommand(mesh) {
        if (this.selected === mesh) {
            this.selection.clearElements();
            if (mesh.faceCount && mesh.selectedFace >= 0) {
                this.selectedFaces.add(mesh.selectedFace);
                this.selection.active = { mode: 'face', mesh, value: mesh.selectedFace, faceIndex: mesh.selectedFace };
            } else {
                this.selection.active = { mode: 'mesh', mesh };
            }
            this.ui.setSelected(mesh);
            this.ui.setFace(mesh.selectedFace);
        } else if (this.selected) {
            this.ui.setSelected(this.selected);
        }
        this.ui.refreshHierarchy();
    }

    async serializeSceneData() {
        this.refreshSceneAssets();
        const authoredMeshes = this.getAuthoredMeshes();
        const activeRecord = this.sceneManager?.activeScene;
        const allAssets = this.assetManager.toJSON();
        const assetsById = new Map(allAssets.assets.map(asset => [asset.id, asset]));
        const reachableAssets = new Set([this.scene.assetId]);
        const pendingAssetIds = [this.scene.assetId];
        while (pendingAssetIds.length) {
            const asset = assetsById.get(pendingAssetIds.pop());
            for (const dependencyId of asset?.dependencies || []) {
                if (reachableAssets.has(dependencyId)) continue;
                reachableAssets.add(dependencyId);
                pendingAssetIds.push(dependencyId);
            }
        }
        const assetManifest = {
            ...allAssets,
            assets: allAssets.assets.filter(asset => reachableAssets.has(asset.id))
        };
        const data = {
            format: 'lightweight-3d-scene',
            version: 1,
            coordinateSystem: { handedness: 'right', upAxis: 'Y', units: 'editor' },
            sceneName: this.scene.name,
            sceneAssetId: this.scene.assetId,
            sceneReferences: activeRecord ? [...activeRecord.references] : [],
            subScenes: activeRecord ? activeRecord.subScenes.map(({ sceneId, streaming }) => ({ sceneId, streaming })) : [],
            assetManifest,
            light: this.scene.light ? {
                name: this.scene.light.name,
                direction: this.scene.light.direction,
                color: this.scene.light.color,
                intensity: this.scene.light.intensity,
                threshold: this.scene.light.threshold,
                shadeColor: this.scene.light.shadeColor
            } : null,
            textureAssets: (await this.textureLibrary.getExportData()).filter(asset => reachableAssets.has(asset.id)),
            meshes: authoredMeshes.map(mesh => ({
                assetId: mesh.assetId,
                materialAssetId: mesh.material.assetId,
                skeletonAssetId: mesh.skeleton.assetId,
                animationAssetId: mesh.animationClip?.assetId || null,
                prefabInstance: mesh.prefabInstance ? JSON.parse(JSON.stringify(mesh.prefabInstance)) : null,
                name: mesh.name,
                position: mesh.position,
                rotation: mesh.rotation,
                scale: mesh.scale,
                color: mesh.material.color,
                shading: mesh.material.shading,
                polygons: mesh.polygons,
                positions: mesh.positions.map(position => [...position]),
                faces: mesh.faces.map(face => [...face]),
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
        data.meshes.forEach((meshData, index) => {
            const mesh = authoredMeshes[index];
            if (!mesh.prefabInstance) return;
            try {
                mesh.prefabInstance.overrides = this.prefabManager.captureOverrides(
                    mesh.prefabInstance.sourcePrefabId,
                    mesh.prefabInstance.sourceNodeId,
                    meshData
                );
            } catch {
                mesh.prefabInstance.overrides = {};
            }
            meshData.prefabInstance = JSON.parse(JSON.stringify(mesh.prefabInstance));
        });
        return data;
    }

    async exportScene() {
        const data = await this.serializeSceneData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'scene.json';
        link.click();
        URL.revokeObjectURL(link.href);
    }
}
