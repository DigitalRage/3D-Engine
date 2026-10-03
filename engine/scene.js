import { DirectionalLight } from './light.js';
import { createDefaultAudioSceneConfig } from './audio.js';

export class Scene {
    constructor() {
        this.dirtyFlags = { geometry: true, light: true };
        this.geometryRevision = 0;
        this.lightRevision = 0;
        this.name = 'Untitled Scene';
        this.assetId = null;
        this.meshes = [];
        this.light = new DirectionalLight();
        this.audio = createDefaultAudioSceneConfig();
    }

    get meshes() { return this._meshes; }
    set meshes(value) {
        this._meshes = observeArray(value, () => this.markDirty('geometry'));
        this.markDirty('geometry');
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
    }

    consumeDirtyFlags() {
        const dirty = { ...this.dirtyFlags };
        Object.keys(this.dirtyFlags).forEach(flag => { this.dirtyFlags[flag] = false; });
        return dirty;
    }

    add(mesh) {
        this.meshes.push(mesh);
    }

    remove(mesh) {
        this.meshes = this.meshes.filter(m => m !== mesh);
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
        this.meshes.forEach(mesh => mesh.animationPlayer?.update(dt));
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
