export class PrefabManager {
    constructor(assetManager) {
        if (!assetManager) throw new TypeError('PrefabManager requires an AssetManager');
        this.assetManager = assetManager;
    }

    list() {
        return this.assetManager.getByType('prefab');
    }

    get(id) {
        const asset = this.assetManager.get(id);
        return asset?.type === 'prefab' ? asset : null;
    }

    create(name, nodes, { id = null } = {}) {
        const prefabNodes = normalizeNodes(nodes);
        this.validateNestedPrefabs(prefabNodes, id);
        const dependencies = this.getDependencies(prefabNodes);
        const asset = this.assetManager.register({
            id,
            type: 'prefab',
            name: String(name || 'Prefab').trim() || 'Prefab',
            metadata: { nodeCount: prefabNodes.length, schemaVersion: 1 },
            data: { schemaVersion: 1, nodes: prefabNodes }
        });
        this.assetManager.setDependencies(asset.id, dependencies);
        return asset;
    }

    update(id, nodes) {
        const asset = this.get(id);
        if (!asset) throw new Error(`Unknown prefab: ${id}`);
        const prefabNodes = normalizeNodes(nodes);
        this.validateNestedPrefabs(prefabNodes, id);
        const dependencies = this.getDependencies(prefabNodes);
        asset.data = { schemaVersion: 1, nodes: prefabNodes };
        asset.metadata = { ...asset.metadata, nodeCount: prefabNodes.length, schemaVersion: 1 };
        this.assetManager.setDependencies(id, dependencies);
        return asset;
    }

    createNested(name, prefabIds) {
        if (!Array.isArray(prefabIds) || !prefabIds.length) throw new TypeError('At least one nested prefab is required');
        const nodes = prefabIds.map((prefabId, index) => {
            if (!this.get(prefabId)) throw new Error(`Unknown nested prefab: ${prefabId}`);
            return {
                id: createId('node'),
                type: 'nestedPrefab',
                name: this.get(prefabId).name,
                parentId: null,
                prefabId
            };
        });
        return this.create(name, nodes);
    }

    instantiate(id, { instanceId = createId('instance') } = {}) {
        if (!this.get(id)) throw new Error(`Unknown prefab: ${id}`);
        const members = [];
        const hierarchy = [];
        this.expand(id, '', null, [], members, hierarchy);
        return { instanceId, prefabId: id, members, hierarchy };
    }

    expand(prefabId, prefix, parentId, ancestry, members, hierarchy) {
        if (ancestry.includes(prefabId)) throw new Error(`Prefab nesting cycle: ${[...ancestry, prefabId].join(' -> ')}`);
        const prefab = this.get(prefabId);
        if (!prefab) throw new Error(`Unknown nested prefab: ${prefabId}`);
        const nextAncestry = [...ancestry, prefabId];
        for (const node of prefab.data?.nodes || []) {
            const instanceNodeId = `${prefix}${node.id}`;
            const resolvedParentId = node.parentId ? `${prefix}${node.parentId}` : parentId;
            if (node.type === 'nestedPrefab') {
                hierarchy.push({
                    id: instanceNodeId,
                    name: node.name || this.get(node.prefabId)?.name || 'Nested Prefab',
                    parentId: resolvedParentId,
                    prefabId: node.prefabId,
                    sourcePrefabId: prefabId,
                    sourceNodeId: node.id
                });
                this.expand(node.prefabId, `${instanceNodeId}/`, instanceNodeId, nextAncestry, members, hierarchy);
                continue;
            }
            members.push({
                id: instanceNodeId,
                name: node.name,
                parentId: resolvedParentId,
                sourcePrefabId: prefabId,
                sourceNodeId: node.id,
                data: cloneJson(node.data)
            });
        }
    }

    getNode(prefabId, nodeId) {
        return this.get(prefabId)?.data?.nodes.find(node => node.id === nodeId) || null;
    }

    captureOverrides(prefabId, nodeId, currentData) {
        const baseNode = this.getNode(prefabId, nodeId);
        if (!baseNode) throw new Error(`Unknown prefab node: ${nodeId}`);
        const overrides = {};
        for (const [key, value] of Object.entries(currentData)) {
            if (key === 'prefabInstance' || key === 'assetId' || key === 'materialAssetId' || key === 'skeletonAssetId' || key === 'animationAssetId') continue;
            if (!sameValue(value, baseNode.data[key])) overrides[key] = cloneJson(value);
        }
        return overrides;
    }

    applyOverrides(nodeData, overrides = {}) {
        return { ...cloneJson(nodeData), ...cloneJson(overrides) };
    }

    revertNode(prefabId, nodeId) {
        const node = this.getNode(prefabId, nodeId);
        if (!node || node.type === 'nestedPrefab') throw new Error(`Unknown prefab mesh node: ${nodeId}`);
        return cloneJson(node.data);
    }

    getDependencies(nodes) {
        const dependencies = new Set();
        for (const node of nodes) {
            if (node.prefabId) dependencies.add(node.prefabId);
            for (const id of [node.data?.materialAssetId, node.data?.skeletonAssetId, node.data?.animationAssetId, node.data?.textureAssetId, ...(node.data?.faceTextureIds || [])]) {
                if (id && this.assetManager.get(id)) dependencies.add(id);
            }
        }
        return [...dependencies];
    }

    validateNestedPrefabs(nodes, updatingId = null) {
        for (const node of nodes) {
            if (!node.prefabId) continue;
            if (!this.get(node.prefabId)) throw new Error(`Unknown nested prefab: ${node.prefabId}`);
            if (node.prefabId === updatingId || this.reachesPrefab(node.prefabId, updatingId)) {
                throw new Error('Prefab nesting cannot contain cycles');
            }
        }
    }

    reachesPrefab(fromId, targetId, visited = new Set()) {
        if (!targetId) return false;
        if (fromId === targetId) return true;
        if (visited.has(fromId)) return false;
        visited.add(fromId);
        const prefab = this.get(fromId);
        return !!prefab?.data?.nodes.some(node => node.prefabId && this.reachesPrefab(node.prefabId, targetId, visited));
    }
}

function normalizeNodes(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) throw new TypeError('A prefab requires at least one node');
    const ids = new Set();
    const normalized = nodes.map(source => {
        if (!source || typeof source !== 'object') throw new TypeError('Invalid prefab node');
        const id = source.id || createId('node');
        if (ids.has(id)) throw new Error(`Duplicate prefab node ID: ${id}`);
        ids.add(id);
        if (source.type === 'nestedPrefab') {
            if (!source.prefabId) throw new TypeError('Nested prefab nodes require a prefab ID');
            return { id, type: 'nestedPrefab', name: String(source.name || 'Nested Prefab'), parentId: source.parentId || null, prefabId: source.prefabId };
        }
        if (!source.data || typeof source.data !== 'object') throw new TypeError('Mesh prefab nodes require serialized mesh data');
        return { id, type: 'mesh', name: String(source.name || source.data.name || 'Mesh'), parentId: source.parentId || null, data: cloneJson(source.data) };
    });
    const nodesById = new Map(normalized.map(node => [node.id, node]));
    normalized.forEach(node => {
        if (node.parentId && !ids.has(node.parentId)) throw new Error(`Unknown parent node: ${node.parentId}`);
        if (node.parentId === node.id) throw new Error('A prefab node cannot parent itself');
        const ancestors = new Set([node.id]);
        let parentId = node.parentId;
        while (parentId) {
            if (ancestors.has(parentId)) throw new Error('Prefab node hierarchy cannot contain cycles');
            ancestors.add(parentId);
            parentId = nodesById.get(parentId)?.parentId || null;
        }
    });
    return normalized;
}

function createId(type) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${type}-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function cloneJson(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch {}
    }
    return JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
