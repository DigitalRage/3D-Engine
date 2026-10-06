import { DirectionalLight } from './light.js';
import { createDefaultAudioSceneConfig } from './audioConfig.js';

export class Scene {
    constructor() {
        this.dirtyFlags = { geometry: true, light: true };
        this.geometryRevision = 0;
        this.lightRevision = 0;
        this.renderRevision = 0;
        this.poseRevision = 0;
        this.animationListRevision = 0;
        this._bulkMeshMutation = false;
        this._animatedMeshes = [];
        this._animatedRevision = -1;
        this._meshHooksInstalled = new WeakSet();
        this.name = 'Untitled Scene';
        this.assetId = null;
        this.meshes = [];
        this.light = new DirectionalLight();
        this.audio = createDefaultAudioSceneConfig();
    }

    get meshes() { return this._meshes; }
    set meshes(value) {
        const next = Array.isArray(value) ? value : [];
        this._meshes = observeArray(next, () => {
            if (this._bulkMeshMutation) return;
            this.markDirty('geometry');
            this.renderRevision++;
        });
        for (const mesh of next) mesh?.attachScene?.(this);
        this.markDirty('geometry');
        this.renderRevision++;
    }

    get light() { return this._light; }
    set light(value) {
        this._light = observeObject(value, () => this.markDirty('light'));
        this.markDirty('light');
    }

    markDirty(flag) {
        if (!(flag in this.dirtyFlags)) return;
        this.dirtyFlags[flag] = true;
        if (flag === 'geometry') this.geometryRevision++;
        if (flag === 'light') this.lightRevision++;
        this.renderRevision++;
    }

    consumeDirtyFlags() {
        const dirty = { ...this.dirtyFlags };
        Object.keys(this.dirtyFlags).forEach(flag => { this.dirtyFlags[flag] = false; });
        return dirty;
    }

    add(mesh) {
        if (!mesh) return;
        mesh.attachScene?.(this);
        this.meshes.push(mesh);
        this.renderRevision++;
    }

    addMany(meshes) {
        const list = Array.isArray(meshes) ? meshes.filter(Boolean) : [];
        if (!list.length) return [];
        this._bulkMeshMutation = true;
        try {
            for (const mesh of list) mesh.attachScene?.(this);
            this._meshes.push(...list);
        } finally {
            this._bulkMeshMutation = false;
        }
        this.markDirty('geometry');
        this.renderRevision++;
        return list;
    }

    remove(mesh) {
        if (!mesh) return;
        mesh.attachScene?.(null);
        this.meshes = this.meshes.filter(m => m !== mesh);
        this.renderRevision++;
    }

    markRenderDirty() {
        this.renderRevision++;
    }

    markPoseDirty() {
        this.poseRevision++;
    }

    markAnimationListDirty() {
        this.animationListRevision++;
    }

    move(mesh, index) {
        const currentIndex = this.meshes.indexOf(mesh);
        if (currentIndex < 0) return false;
        const targetIndex = Math.max(0, Math.min(this.meshes.length - 1, Math.floor(index)));
        if (currentIndex === targetIndex) return false;
        this.meshes.splice(currentIndex, 1);
        this.meshes.splice(targetIndex, 0, mesh);
        return true;
    }

    update(dt) {
        if (this._animatedRevision !== this.animationListRevision) {
            this._animatedMeshes = this.meshes.filter(mesh => mesh.animationPlayer?.playing && mesh.animationPlayer?.clip);
            this._animatedRevision = this.animationListRevision;
        }
        for (const mesh of this._animatedMeshes) mesh.animationPlayer.update(dt);
    }
}

function observeArray(value, onChange) {
    const target = Array.isArray(value) ? [...value] : [];
    return new Proxy(target, {
        set(array, property, next, receiver) {
            onChange();
            return Reflect.set(array, property, next, receiver);
        },
        deleteProperty(array, property) {
            onChange();
            return Reflect.deleteProperty(array, property);
        }
    });
}

function observeObject(value, onChange) {
    if (!value || typeof value !== 'object') return value;
    const target = Object.fromEntries(Object.entries(value).map(([key, entry]) => [
        key,
        Array.isArray(entry) ? observeNestedArray(entry, onChange) : entry
    ]));
    return new Proxy(target, {
        set(object, property, next, receiver) {
            onChange();
            return Reflect.set(object, property, Array.isArray(next) ? observeNestedArray(next, onChange) : next, receiver);
        },
        deleteProperty(object, property) {
            onChange();
            return Reflect.deleteProperty(object, property);
        }
    });
}

function observeNestedArray(value, onChange) {
    return new Proxy([...value], {
        set(array, property, next, receiver) {
            onChange();
            return Reflect.set(array, property, next, receiver);
        },
        deleteProperty(array, property) {
            onChange();
            return Reflect.deleteProperty(array, property);
        }
    });
}
