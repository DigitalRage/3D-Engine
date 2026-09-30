const ASSET_TYPES = new Set([
    'mesh',
    'material',
    'texture',
    'animation',
    'skeleton',
    'scene',
    'prefab',
    'audio'
]);

export class AssetManager {
    constructor() {
        this.assets = new Map();
        this.resourceIds = new WeakMap();
        this.sequence = 0;
    }

    createId(type = 'asset') {
        let id;
        do {
            const uuid = globalThis.crypto?.randomUUID?.();
            this.sequence++;
            id = `${type}-${uuid || `${Date.now().toString(36)}-${this.sequence.toString(36)}`}`;
        } while (this.assets.has(id));
        return id;
    }

    register(options = {}) {
        const { type, name = 'Untitled', resource = null, id = null, metadata = {}, dependencies = [], thumbnail = null, data = null } = options;
        if (!ASSET_TYPES.has(type)) throw new TypeError(`Unsupported asset type: ${type}`);
        const resourceId = this.getIdForResource(resource);
        if (resourceId) {
            const existing = this.assets.get(resourceId);
            if (existing.type !== type) throw new TypeError(`Resource is already registered as ${existing.type}`);
            this.updateAsset(existing, { name, metadata, thumbnail, data });
            return existing;
        }

        let assetId = typeof id === 'string' && id ? id : this.createId(type);
        let existing = this.assets.get(assetId);
        if (existing && existing.type === type && id === assetId) {
            if (Object.hasOwn(options, 'resource')) {
                if (existing.resource && typeof existing.resource === 'object') this.resourceIds.delete(existing.resource);
                existing.resource = resource;
                if (resource && typeof resource === 'object') this.resourceIds.set(resource, assetId);
            }
            this.updateAsset(existing, { name, metadata, thumbnail, data });
            if (dependencies.length) this.setDependencies(assetId, dependencies);
            return existing;
        }
        if (existing && existing.type === type && !existing.resource) {
            existing.resource = resource;
            this.updateAsset(existing, { name, metadata, thumbnail, data });
            if (resource && typeof resource === 'object') this.resourceIds.set(resource, assetId);
            if (dependencies.length) this.setDependencies(assetId, dependencies);
            return existing;
        }
        if (existing) assetId = this.createId(type);

        const asset = {
            id: assetId,
            name: String(name || 'Untitled'),
            type,
            metadata: cloneJson(metadata || {}),
            dependencies: new Set(),
            thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
            resource,
            data: cloneJson(data)
        };
        this.assets.set(assetId, asset);
        if (resource && typeof resource === 'object') this.resourceIds.set(resource, assetId);
        if (dependencies.length) this.setDependencies(assetId, dependencies);
        return asset;
    }

    updateAsset(asset, { name, metadata, thumbnail, data }) {
        if (name !== undefined) asset.name = String(name || 'Untitled');
        if (metadata !== undefined) asset.metadata = cloneJson(metadata || {});
        if (thumbnail !== undefined) asset.thumbnail = typeof thumbnail === 'string' ? thumbnail : null;
        if (data !== undefined) asset.data = cloneJson(data);
    }

    get(id) {
        return this.assets.get(id) || null;
    }

    getByType(type) {
        return [...this.assets.values()].filter(asset => asset.type === type);
    }

    getIdForResource(resource) {
        if (!resource || typeof resource !== 'object') return null;
        return this.resourceIds.get(resource) || null;
    }

    rename(id, name) {
        const asset = this.get(id);
        if (!asset || !String(name).trim()) return false;
        asset.name = String(name).trim();
        return true;
    }

    updateMetadata(id, metadata) {
        const asset = this.get(id);
        if (!asset) return false;
        asset.metadata = { ...asset.metadata, ...cloneJson(metadata || {}) };
        return true;
    }

    setThumbnail(id, thumbnail) {
        const asset = this.get(id);
        if (!asset) return false;
        asset.thumbnail = typeof thumbnail === 'string' ? thumbnail : null;
        return true;
    }

    setDependencies(id, dependencies) {
        const asset = this.get(id);
        if (!asset) throw new Error(`Unknown asset: ${id}`);
        const next = new Set(dependencies);
        if (next.has(id)) throw new Error('An asset cannot depend on itself');
        for (const dependencyId of next) {
            if (!this.assets.has(dependencyId)) throw new Error(`Unknown dependency: ${dependencyId}`);
        }
        asset.dependencies = next;
        return asset;
    }

    addDependency(id, dependencyId) {
        const asset = this.get(id);
        if (!asset) throw new Error(`Unknown asset: ${id}`);
        if (!this.assets.has(dependencyId)) throw new Error(`Unknown dependency: ${dependencyId}`);
        if (id === dependencyId) throw new Error('An asset cannot depend on itself');
        asset.dependencies.add(dependencyId);
        return true;
    }

    getDependents(id) {
        return [...this.assets.values()].filter(asset => asset.dependencies.has(id));
    }

    remove(id, { cascade = false } = {}) {
        if (!this.assets.has(id)) return false;
        const visited = new Set();
        const removeAsset = assetId => {
            if (visited.has(assetId)) return;
            visited.add(assetId);
            const dependents = this.getDependents(assetId);
            if (dependents.length && !cascade) throw new Error(`Asset ${assetId} is still in use`);
            dependents.forEach(dependent => removeAsset(dependent.id));
            const asset = this.assets.get(assetId);
            if (asset?.resource && this.getIdForResource(asset.resource) === assetId) this.resourceIds.delete(asset.resource);
            this.assets.delete(assetId);
        };
        removeAsset(id);
        return true;
    }

    toJSON() {
        return {
            version: 1,
            assets: [...this.assets.values()].map(asset => ({
                id: asset.id,
                name: asset.name,
                type: asset.type,
                metadata: cloneJson(asset.metadata),
                dependencies: [...asset.dependencies],
                thumbnail: asset.thumbnail?.startsWith('blob:') ? null : asset.thumbnail,
                data: cloneJson(asset.data)
            }))
        };
    }

    importManifest(manifest, { reuseExisting = false } = {}) {
        if (!manifest || !Array.isArray(manifest.assets)) throw new TypeError('Invalid asset manifest');
        if (manifest.version !== 1) throw new TypeError(`Unsupported asset manifest version: ${manifest.version}`);

        const sourceIds = new Set();
        for (const source of manifest.assets) {
            if (!source || typeof source.id !== 'string' || !source.id) throw new TypeError('Asset manifest entries require an ID');
            if (sourceIds.has(source.id)) throw new TypeError(`Duplicate asset ID in manifest: ${source.id}`);
            if (!ASSET_TYPES.has(source.type)) throw new TypeError(`Unsupported asset type: ${source.type}`);
            if (source.dependencies !== undefined && !Array.isArray(source.dependencies)) throw new TypeError(`Invalid dependencies for asset: ${source.id}`);
            cloneJson(source.metadata || {});
            cloneJson(source.data);
            sourceIds.add(source.id);
        }
        for (const source of manifest.assets) {
            for (const dependencyId of source.dependencies || []) {
                if (!sourceIds.has(dependencyId) && !this.assets.has(dependencyId)) {
                    throw new Error(`Unknown dependency: ${dependencyId}`);
                }
            }
        }

        const idMap = new Map();
        const pending = [];
        for (const source of manifest.assets) {
            const existing = this.assets.get(source.id);
            if (reuseExisting && existing && existing.type !== source.type) {
                throw new TypeError(`Asset type mismatch for ID: ${source.id}`);
            }
            const id = existing && !(reuseExisting && existing.type === source.type) ? this.createId(source.type) : source.id;
            const asset = this.register({
                id,
                type: source.type,
                name: source.name,
                metadata: source.metadata,
                thumbnail: source.thumbnail,
                data: source.data
            });
            idMap.set(source.id, asset.id);
            pending.push({ assetId: asset.id, dependencies: source.dependencies || [] });
        }

        for (const entry of pending) {
            const dependencies = entry.dependencies.map(id => idMap.get(id) || id);
            this.setDependencies(entry.assetId, dependencies);
        }
        return idMap;
    }
}

function cloneJson(value) {
    if (value === null || value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}
