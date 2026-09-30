const SCENE_STORAGE_VERSION = 1;

export class SceneManager {
    constructor({
        storageKey = 'lightweight-3d-scenes',
        storage = getLocalStorage(),
        serializeActive = async () => null,
        activateScene = async () => {},
        loadSubScene = async () => {},
        unloadSubScene = async () => {}
    } = {}) {
        this.storageKey = storageKey;
        this.storage = storage;
        this.serializeActive = serializeActive;
        this.activateScene = activateScene;
        this.loadSubSceneCallback = loadSubScene;
        this.unloadSubSceneCallback = unloadSubScene;
        this.scenes = new Map();
        this.activeSceneId = null;
        this.restore();
    }

    restore() {
        if (!this.storage) return false;
        try {
            const document = JSON.parse(this.storage.getItem(this.storageKey) || 'null');
            if (document?.version !== SCENE_STORAGE_VERSION || !Array.isArray(document.scenes)) return false;
            for (const source of document.scenes) {
                if (!source || typeof source.id !== 'string' || !source.id || !source.data || typeof source.data !== 'object') continue;
                if (this.scenes.has(source.id)) continue;
                this.scenes.set(source.id, {
                    id: source.id,
                    name: String(source.name || 'Scene'),
                    data: cloneJson(source.data),
                    references: uniqueStrings(source.references),
                    subScenes: normalizeSubScenes(source.subScenes),
                    updatedAt: Number(source.updatedAt) || 0
                });
            }
            this.activeSceneId = this.scenes.has(document.activeSceneId) ? document.activeSceneId : this.scenes.keys().next().value || null;
            return this.scenes.size > 0;
        } catch {
            this.scenes.clear();
            this.activeSceneId = null;
            return false;
        }
    }

    list() {
        return [...this.scenes.values()].map(scene => ({
            id: scene.id,
            name: scene.name,
            references: [...scene.references],
            subScenes: scene.subScenes.map(subScene => ({ ...subScene })),
            updatedAt: scene.updatedAt
        }));
    }

    get(id) {
        return this.scenes.get(id) || null;
    }

    get activeScene() {
        return this.get(this.activeSceneId);
    }

    async createScene(name, data, { id = null, activate = false } = {}) {
        if (!data || typeof data !== 'object') throw new TypeError('Scene data is required');
        const sceneId = id || createId('scene');
        if (this.scenes.has(sceneId)) throw new Error(`Scene already exists: ${sceneId}`);
        const previousSceneId = this.activeSceneId;
        const scene = {
            id: sceneId,
            name: String(name || 'Scene').trim() || 'Scene',
            data: cloneJson(data),
            references: [],
            subScenes: [],
            updatedAt: Date.now()
        };
        this.scenes.set(sceneId, scene);
        if (activate && previousSceneId) {
            await this.saveScene(previousSceneId);
            await this.unloadLoadedSubScenes(this.activeScene);
            this.activeSceneId = sceneId;
            await this.activateScene(cloneJson(scene.data), scene);
            for (const subScene of scene.subScenes) {
                if (!subScene.streaming) await this.loadSubScene(scene.id, subScene.sceneId);
            }
        } else if (!this.activeSceneId) {
            this.activeSceneId = sceneId;
            if (activate) await this.activateScene(cloneJson(scene.data), scene);
        }
        this.persist();
        return scene;
    }

    async saveScene(id = this.activeSceneId) {
        const scene = this.get(id);
        if (!scene) throw new Error(`Unknown scene: ${id}`);
        if (id === this.activeSceneId) {
            const data = await this.serializeActive();
            if (!data || typeof data !== 'object') throw new Error('The active scene could not be serialized');
            scene.data = cloneJson(data);
        }
        scene.updatedAt = Date.now();
        this.persist();
        return scene;
    }

    async initializeActiveScene() {
        const scene = this.activeScene;
        if (!scene) return null;
        await this.activateScene(cloneJson(scene.data), scene);
        for (const subScene of scene.subScenes) {
            if (!subScene.streaming) await this.loadSubScene(scene.id, subScene.sceneId);
        }
        this.persist();
        return scene;
    }

    async loadScene(id) {
        const target = this.get(id);
        if (!target) throw new Error(`Unknown scene: ${id}`);
        if (id === this.activeSceneId) return target;
        if (this.activeSceneId) await this.saveScene(this.activeSceneId);
        await this.unloadLoadedSubScenes(this.activeScene);
        await this.activateScene(cloneJson(target.data), target);
        this.activeSceneId = id;
        for (const subScene of target.subScenes) {
            if (!subScene.streaming && !subScene.loaded) await this.loadSubScene(target.id, subScene.sceneId);
        }
        this.persist();
        return target;
    }

    async duplicateScene(id = this.activeSceneId, name = null) {
        const source = this.get(id);
        if (!source) throw new Error(`Unknown scene: ${id}`);
        if (id === this.activeSceneId) await this.saveScene(id);
        const clonedData = cloneJson(source.data);
        const sceneId = duplicateSceneAssetIds(clonedData);
        const duplicate = await this.createScene(name || `${source.name} Copy`, clonedData, { id: sceneId });
        duplicate.references = source.references.map(reference => reference === id ? sceneId : reference);
        duplicate.subScenes = source.subScenes.map(subScene => ({ ...subScene, loaded: false }));
        this.persist();
        return duplicate;
    }

    async deleteScene(id) {
        const target = this.get(id);
        if (!target) return false;
        if (this.scenes.size === 1) throw new Error('The last scene cannot be deleted');
        if (id === this.activeSceneId) {
            await this.saveScene(id);
            const nextScene = [...this.scenes.keys()].find(sceneId => sceneId !== id);
            await this.loadScene(nextScene);
        }
        for (const scene of this.scenes.values()) {
            const loadedChild = scene.subScenes.find(subScene => subScene.sceneId === id && subScene.loaded);
            if (scene.id === this.activeSceneId && loadedChild) await this.unloadSubScene(scene.id, id);
            scene.references = scene.references.filter(reference => reference !== id);
            scene.subScenes = scene.subScenes.filter(subScene => subScene.sceneId !== id);
        }
        this.scenes.delete(id);
        this.persist();
        return true;
    }

    renameScene(id, name) {
        const scene = this.get(id);
        const nextName = String(name || '').trim();
        if (!scene || !nextName) return false;
        scene.name = nextName;
        scene.updatedAt = Date.now();
        this.persist();
        return true;
    }

    addReference(sceneId, referencedSceneId) {
        const scene = this.get(sceneId);
        if (!scene || !this.scenes.has(referencedSceneId)) throw new Error('Both referenced scenes must exist');
        if (sceneId === referencedSceneId) throw new Error('A scene cannot reference itself');
        if (!scene.references.includes(referencedSceneId)) scene.references.push(referencedSceneId);
        this.persist();
        return true;
    }

    removeReference(sceneId, referencedSceneId) {
        const scene = this.get(sceneId);
        if (!scene) return false;
        const referenceCount = scene.references.length;
        scene.references = scene.references.filter(id => id !== referencedSceneId);
        if (scene.references.length !== referenceCount) this.persist();
        return scene.references.length !== referenceCount;
    }

    addSubScene(parentId, childId, { streaming = true } = {}) {
        const parent = this.get(parentId);
        if (!parent || !this.scenes.has(childId)) throw new Error('Both sub-scenes must exist');
        if (parentId === childId || this.hasSubScenePath(childId, parentId)) throw new Error('Sub-scene relationships cannot contain cycles');
        if (parent.subScenes.some(subScene => subScene.sceneId === childId)) return false;
        parent.subScenes.push({ sceneId: childId, streaming: !!streaming, loaded: false });
        this.persist();
        if (!streaming && parentId === this.activeSceneId) return this.loadSubScene(parentId, childId);
        return true;
    }

    async loadSubScene(parentId, childId) {
        const parent = this.get(parentId);
        const link = parent?.subScenes.find(subScene => subScene.sceneId === childId);
        const child = this.get(childId);
        if (!link || !child) throw new Error('The sub-scene relationship does not exist');
        if (parentId !== this.activeSceneId) throw new Error('Only the active scene can stream sub-scenes');
        if (link.loaded) return false;
        await this.loadSubSceneCallback(child.id, cloneJson(child.data));
        link.loaded = true;
        this.persist();
        return true;
    }

    async unloadSubScene(parentId, childId) {
        const parent = this.get(parentId);
        const link = parent?.subScenes.find(subScene => subScene.sceneId === childId);
        if (!link?.loaded) return false;
        await this.unloadSubSceneCallback(childId);
        link.loaded = false;
        this.persist();
        return true;
    }

    async unloadLoadedSubScenes(scene) {
        if (!scene) return;
        for (const subScene of scene.subScenes) {
            if (!subScene.loaded) continue;
            await this.unloadSubSceneCallback(subScene.sceneId);
            subScene.loaded = false;
        }
    }

    hasSubScenePath(fromId, targetId, visited = new Set()) {
        if (fromId === targetId) return true;
        if (visited.has(fromId)) return false;
        visited.add(fromId);
        const scene = this.get(fromId);
        return !!scene?.subScenes.some(subScene => this.hasSubScenePath(subScene.sceneId, targetId, visited));
    }

    persist() {
        if (!this.storage) return false;
        const document = {
            version: SCENE_STORAGE_VERSION,
            activeSceneId: this.activeSceneId,
            scenes: [...this.scenes.values()].map(scene => ({
                id: scene.id,
                name: scene.name,
                data: scene.data,
                references: scene.references,
                subScenes: scene.subScenes,
                updatedAt: scene.updatedAt
            }))
        };
        try {
            this.storage.setItem(this.storageKey, JSON.stringify(document));
            return true;
        } catch (error) {
            throw new Error(`Could not save scenes to local storage: ${error.message || error}`);
        }
    }
}

function duplicateSceneAssetIds(data) {
    const manifest = data.assetManifest;
    const ids = new Map();
    if (Array.isArray(manifest?.assets)) {
        manifest.assets.forEach(asset => {
            if (asset.type !== 'texture') ids.set(asset.id, createId(asset.type));
        });
        manifest.assets.forEach(asset => {
            asset.id = ids.get(asset.id) || asset.id;
            asset.dependencies = (asset.dependencies || []).map(id => ids.get(id) || id);
            for (const node of asset.data?.nodes || []) {
                if (node.prefabId) node.prefabId = ids.get(node.prefabId) || node.prefabId;
                if (!node.data) continue;
                for (const field of ['assetId', 'materialAssetId', 'skeletonAssetId', 'animationAssetId', 'textureAssetId']) {
                    if (node.data[field]) node.data[field] = ids.get(node.data[field]) || node.data[field];
                }
                node.data.faceTextureIds = (node.data.faceTextureIds || []).map(id => ids.get(id) || id);
            }
        });
    }
    if (data.sceneAssetId) data.sceneAssetId = ids.get(data.sceneAssetId) || createId('scene');
    for (const mesh of data.meshes || []) {
        for (const field of ['assetId', 'materialAssetId', 'skeletonAssetId', 'animationAssetId']) {
            if (mesh[field]) mesh[field] = ids.get(mesh[field]) || createId(field.replace('AssetId', '').replace(/^[a-z]/, letter => letter.toLowerCase()));
        }
        if (mesh.prefabInstance) {
            mesh.prefabInstance.prefabId = ids.get(mesh.prefabInstance.prefabId) || mesh.prefabInstance.prefabId;
            mesh.prefabInstance.sourcePrefabId = ids.get(mesh.prefabInstance.sourcePrefabId) || mesh.prefabInstance.sourcePrefabId;
        }
    }
    return data.sceneAssetId || createId('scene');
}

function normalizeSubScenes(subScenes) {
    if (!Array.isArray(subScenes)) return [];
    return subScenes.filter(entry => typeof entry?.sceneId === 'string').map(entry => ({
        sceneId: entry.sceneId,
        streaming: entry.streaming !== false,
        loaded: false
    }));
}

function uniqueStrings(values) {
    return [...new Set(Array.isArray(values) ? values.filter(value => typeof value === 'string') : [])];
}

function createId(type) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${type}-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function getLocalStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}
