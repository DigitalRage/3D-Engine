import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneManager } from '../engine/sceneManager.js';

class MemorySceneStore {
    constructor(seed = null) {
        this.supported = true;
        this.value = seed;
        this.writes = 0;
        this.deletes = 0;
    }
    async get() { return structuredClone(this.value); }
    async set(_key, value) { this.writes++; this.value = structuredClone(value); }
    async delete() { this.deletes++; this.value = null; }
}

function legacyStorage(initial = null) {
    const values = new Map(initial ? [['lightweight-3d-scenes', JSON.stringify(initial)]] : []);
    return {
        getItem(key) { return values.get(key) || null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        has(key) { return values.has(key); }
    };
}

function sceneDocument() {
    return {
        version: 1,
        activeSceneId: 'scene-large',
        scenes: [{
            id: 'scene-large',
            name: 'Large Imported Map',
            data: { meshes: [{ positions: [[0, 0, 0]], faces: [[0, 0, 0]] }] },
            references: [],
            subScenes: [],
            updatedAt: 123
        }]
    };
}

test('legacy localStorage scenes migrate to IndexedDB without another localStorage write', async () => {
    const storage = legacyStorage(sceneDocument());
    const store = new MemorySceneStore();
    const manager = new SceneManager({ storage, sceneStore: store });
    await manager.ready;

    assert.equal(manager.activeSceneId, 'scene-large');
    assert.ok(manager.get('scene-large'));
    assert.equal(store.writes, 1);
    assert.equal(storage.has('lightweight-3d-scenes'), false);

    await manager.persist();
    assert.equal(store.writes, 2);
    assert.equal(storage.has('lightweight-3d-scenes'), false);
});

test('new scenes use IndexedDB when available, leaving localStorage free for UI preferences', async () => {
    const storage = legacyStorage();
    const store = new MemorySceneStore();
    const manager = new SceneManager({ storage, sceneStore: store });
    await manager.ready;

    await manager.createScene('Large Scene', { meshes: Array.from({ length: 2000 }, (_, i) => ({ id: i })) });
    assert.equal(store.writes, 1);
    assert.equal(storage.has('lightweight-3d-scenes'), false);
    assert.equal(manager.persistenceMode, 'indexeddb');
});


test('Proxy-wrapped scene data falls back to JSON cloning instead of structuredClone failure', async () => {
    const storage = legacyStorage();
    const store = new MemorySceneStore();
    const proxiedPositions = new Proxy([[0, 0, 0], [1, 0, 0]], {});
    const proxiedFaces = new Proxy([[0, 1, 1]], {});
    const manager = new SceneManager({ storage, sceneStore: store });
    await manager.ready;

    await manager.createScene('Proxy Scene', {
        meshes: [{ positions: proxiedPositions, faces: proxiedFaces }]
    }, { activate: true });

    assert.equal(manager.get(manager.activeSceneId).data.meshes[0].positions[1][0], 1);
    assert.equal(store.writes, 1);
});

test('Proxy data returned by active-scene serialization is clone-safe before IndexedDB persistence', async () => {
    const storage = legacyStorage();
    const store = new MemorySceneStore();
    const proxiedFaces = new Proxy([[0, 1, 2]], {});
    const manager = new SceneManager({
        storage,
        sceneStore: store,
        serializeActive: async () => ({ meshes: [{ positions: [[0, 0, 0]], faces: proxiedFaces }] })
    });
    await manager.ready;

    await manager.createScene('Initial', { meshes: [] }, { activate: true });
    await manager.saveScene();

    assert.deepEqual(manager.activeScene.data.meshes[0].faces, [[0, 1, 2]]);
    assert.equal(manager.persistenceMode, 'indexeddb');
});

test('localStorage fallback still works when IndexedDB is unavailable', async () => {
    const storage = legacyStorage();
    const manager = new SceneManager({ storage, sceneStore: { supported: false } });
    await manager.ready;
    await manager.createScene('Fallback Scene', { meshes: [] });

    assert.equal(manager.persistenceMode, 'localstorage');
    const saved = JSON.parse(storage.getItem('lightweight-3d-scenes'));
    assert.equal(saved.scenes.length, 1);
    assert.equal(saved.scenes[0].name, 'Fallback Scene');
});
