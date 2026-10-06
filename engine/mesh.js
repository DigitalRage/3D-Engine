import { mat4 } from './mat4.js';
import { Skeleton } from './skeleton.js';
import { AnimationPlayer } from './animation.js';
import { textureHasTransparency } from './loader.js';

export class Mesh {
    constructor(material, { lazyTopology = false } = {}) {
        this.dirtyFlags = { geometry: true, uvs: true, materials: true, skeletonPose: true, selection: true };
        this.geometryRevision = 0;
        this.transformRevision = 0;
        this.skinRevision = 0;
        this.material = material;
        this.name = 'Mesh';
        this._scene = null;
        this._position = [0, 0, 0];
        this._rotation = [0, 0, 0];
        this._scale = [1, 1, 1];
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];

        this.vertices = null;
        this.normals = null;
        this.colors = null;
        this.uvs = null;
        this.indices = null;
        this.indexType = null;
        this.indexBytes = 2;

        this.vao = null;
        this.vaoExtension = null;
        this.positionBuffer = null;
        this.normalBuffer = null;
        this.colorBuffer = null;
        this.uvBuffer = null;
        this.faceColors = [];
        this.faceTextures = [];
        this.faceTextureIds = [];
        this.faceUvTransforms = [];
        this.faceUvs = [];
        this.textureAssetId = null;
        this.faceCount = 0;
        this.triangleCount = 0;
        this.selectedFace = -1;
        this.wireframeIndices = new Uint16Array();
        this.selectedVertex = null;
        this.selectedBone = null;
        this.vertexWeights = new Map();
        this.shadowedFaces = [];
        this.shadowVersion = 0;
        this.shadowedFaceCount = 0;
        this.bakeFaceColors = false;
        this.bakedFaceColorsRevision = -1;
        this.uniformLocations = null;
        this.uniformProgram = null;
        this.skinningFrame = null;
        this.positions = [];
        this.faces = [];
        this.edges = [];
        this.facesOfEdge = new Map();
        this.edgesOfVertex = [];
        this.facesOfVertex = [];
        this.renderVertexSharedIndices = null;
        this.renderVertexOffsetsByShared = [];
        this.faceVertexRanges = [];
        this._fastVertexEditDepth = 0;
        this._fastModifiedVertices = new Set();
        this._pendingGpuRanges = [];
        this._polygonViews = [];
        this._polygonProxy = null;
        this._legacyViewExposed = false;
        this.vertexIndexByPosition = new WeakMap();
        this.faceRanges = [];
        this.opaqueFaceIndices = [];
        this.transparentFaceIndices = [];
        this.allFaceIndices = [];
        this.renderStateVersion = 0;
        this.drawBatchCache = new WeakMap();
        this.geometrySignature = '';
        this.instanceBatchKey = null;
        this.skeleton = new Skeleton();
        this.animationPlayer = new AnimationPlayer(this);
        this.lazyTopology = !!lazyTopology;
        if (!this.lazyTopology) this._setPolygonViews([]);
    }

    get positions() { return this._positions; }
    set positions(value) {
        this._positions = observeArrays(value, () => { if (!this._suppressFastDirty) this.markDirty('geometry'); });
        this.markDirty('geometry');
    }

    get faces() { return this._faces; }
    set faces(value) {
        this._faces = observeArrays(value, () => { if (!this._suppressFastDirty) this.markDirty('geometry'); });
        this.markDirty('geometry');
    }

    get faceUvs() { return this._faceUvs; }
    set faceUvs(value) {
        this._faceUvs = observeArrays(value, () => { if (!this._suppressFastDirty) this.markDirty('uvs'); });
        this.markDirty('uvs');
    }

    get faceColors() { return this._faceColors; }
    set faceColors(value) {
        this._faceColors = observeArrays(value, () => {
            this.markDirty('materials');
            if (this.bakeFaceColors) this.markDirty('geometry');
        });
        this.markDirty('materials');
        if (this.bakeFaceColors) this.markDirty('geometry');
    }

    get faceTextures() { return this._faceTextures; }
    set faceTextures(value) {
        this._faceTextures = observeArray(value, () => this.markDirty('materials'));
        this.markDirty('materials');
    }

    get faceTextureIds() { return this._faceTextureIds; }
    set faceTextureIds(value) {
        this._faceTextureIds = observeArray(value, () => this.markDirty('materials'));
        this.markDirty('materials');
    }

    get faceUvTransforms() { return this._faceUvTransforms; }
    set faceUvTransforms(value) {
        this._faceUvTransforms = observeArrays(value, () => this.markDirty('materials'));
        this.markDirty('materials');
    }

    get selectedFace() { return this._selectedFace; }
    set selectedFace(value) {
        if (this._selectedFace === value) return;
        this._selectedFace = value;
        this.markDirty('selection');
    }

    get selectedVertex() { return this._selectedVertex; }
    set selectedVertex(value) {
        this._selectedVertex = value;
        this.markDirty('selection');
    }

    markDirty(...flags) {
        let renderDirty = false;
        for (const flag of flags) {
            if (!(flag in this.dirtyFlags)) continue;
            this.dirtyFlags[flag] = true;
            if (flag === 'geometry') this.geometryRevision++;
            if (flag === 'skeletonPose') this.skinRevision++;
            if (flag === 'geometry' || flag === 'uvs' || flag === 'materials' || flag === 'selection') renderDirty = true;
        }
        if (renderDirty) this._scene?.markRenderDirty?.();
        if (flags.includes('skeletonPose')) this._scene?.markPoseDirty?.();
    }

    consumeDirtyFlags() {
        const dirty = { ...this.dirtyFlags };
        Object.keys(this.dirtyFlags).forEach(flag => { this.dirtyFlags[flag] = false; });
        return dirty;
    }

    get position() { return this._position; }
    set position(value) { this._position = observeTransformArray(value, () => this.markTransformChanged()); this.markTransformChanged(); }
    get rotation() { return this._rotation; }
    set rotation(value) { this._rotation = observeTransformArray(value, () => this.markTransformChanged()); this.markTransformChanged(); }
    get scale() { return this._scale; }
    set scale(value) { this._scale = observeTransformArray(value, () => this.markTransformChanged()); this.markTransformChanged(); }

    attachScene(scene) {
        this._scene = scene || null;
        return this;
    }

    markTransformChanged() {
        this.transformRevision = (this.transformRevision || 0) + 1;
        this._modelMatrixCacheRevision = -1;
        this._scene?.markRenderDirty?.();
    }

    get polygons() {
        if ((this.staticOptimized || this.lazyTopology) && !this._polygonProxy) return this._getStaticPolygonProxy();
        return this._polygonProxy;
    }

    set polygons(value) {
        if (this.staticOptimized || this.lazyTopology) this._materializeStaticPolygonViews();
        this._setPolygonViews(Array.isArray(value) ? value : []);
        this._legacyViewExposed = true;
        this.markDirty('geometry');
    }

    _getStaticPolygonProxy() {
        if (this._staticPolygonProxy) return this._staticPolygonProxy;
        const target = [];
        const mesh = this;
        this._staticPolygonProxy = new Proxy(target, {
            get(array, property, receiver) {
                if (property === 'length') return mesh.faces.length;
                if (property === Symbol.iterator) {
                    return function* () {
                        for (let index = 0; index < mesh.faces.length; index++) yield mesh.faces[index]?.map(vertexIndex => mesh.positions[vertexIndex]);
                    };
                }
                if (typeof property === 'string' && /^\d+$/.test(property)) {
                    const index = Number(property);
                    const face = mesh.faces[index];
                    return face ? face.map(vertexIndex => mesh.positions[vertexIndex]) : undefined;
                }
                const value = Reflect.get(array, property, receiver);
                if (typeof value === 'function') {
                    const methods = ['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'reduce', 'reduceRight', 'flatMap'];
                    if (methods.includes(property)) return (...args) => Array.prototype[property].apply(receiver, args);
                }
                return value;
            },
            set() {
                mesh._materializeStaticPolygonViews();
                return false;
            },
            deleteProperty() {
                mesh._materializeStaticPolygonViews();
                return false;
            }
        });
        return this._staticPolygonProxy;
    }

    _materializeStaticPolygonViews() {
        if (!this.staticOptimized && !this.lazyTopology) return this._polygonProxy;
        this.staticOptimized = false;
        this.lazyTopology = false;
        this._staticPolygonProxy = null;
        this._setPolygonViews(this.faces.map(face => face.map(vertexIndex => this.positions[vertexIndex])));
        this._rebuildTopologyAdjacency();
        return this._polygonProxy;
    }

    _setPolygonViews(polygons) {
        const wrapFace = face => new Proxy(face, {
            set: (target, property, value, receiver) => {
                this._legacyViewExposed = true;
                this.markDirty('geometry');
                return Reflect.set(target, property, value, receiver);
            },
            deleteProperty: (target, property) => {
                this._legacyViewExposed = true;
                this.markDirty('geometry');
                return Reflect.deleteProperty(target, property);
            }
        });
        this._polygonViews = polygons.map(wrapFace);
        this._polygonProxy = new Proxy(this._polygonViews, {
            set: (target, property, value, receiver) => {
                this._legacyViewExposed = true;
                this.markDirty('geometry');
                return Reflect.set(target, property, Array.isArray(value) ? wrapFace(value) : value, receiver);
            },
            deleteProperty: (target, property) => {
                this._legacyViewExposed = true;
                this.markDirty('geometry');
                return Reflect.deleteProperty(target, property);
            }
        });
    }

    setTopology(positions = [], faces = []) {
        this.positions = positions.map(position => [...position]);
        this.faces = faces.map(face => [...face]);
        this._refreshPolygonViews();
    }

    setStaticTopology(positions = [], faces = [], faceColors = []) {
        // Large static environment meshes do not need the editor's full adjacency graph
        // or thousands of legacy polygon Proxy objects just to render. Keep the source
        // topology for export/selection, but build render buffers directly.
        this._positions = positions;
        this._faces = faces;
        this._faceColors = faceColors;
        this.staticOptimized = true;
        this._staticPolygonProxy = null;
        this.positions.forEach((position, index) => this.vertexIndexByPosition.set(position, index));
        this.faceCount = faces.length;
        this.allFaceIndices = Array.from({ length: this.faceCount }, (_, index) => index);
        this.opaqueFaceIndices = this.allFaceIndices;
        this.transparentFaceIndices = [];
        this.faceTextures = [];
        this.faceTextureIds = [];
        const uvDefault = { scale: [1, 1], offset: [0, 0], rotation: 0, flipX: false, flipY: false };
        this.faceUvTransforms = Array.from({ length: this.faceCount }, () => ({ ...uvDefault, scale: [1, 1], offset: [0, 0] }));
        this.faceUvs = [];
        this.edges = [];
        this.facesOfEdge = new Map();
        this.edgesOfVertex = [];
        this.facesOfVertex = [];
        this.renderVertexSharedIndices = null;
        this.renderVertexOffsetsByShared = [];
        this.faceVertexRanges = [];
        this._fastVertexEditDepth = 0;
        this._fastModifiedVertices = new Set();
        this._pendingGpuRanges = [];
        this._polygonViews = [];
        this._polygonProxy = null;
        this.vertexIndexByPosition = new WeakMap();
        this._buildStaticRenderData();
        this.dirtyFlags.geometry = false;
        this.dirtyFlags.uvs = false;
        this.dirtyFlags.materials = false;
        this.dirtyFlags.selection = false;
        return true;
    }

    setImportTopology(positions = [], faces = [], { faceColors = [], faceUvs = [], faceUvTransforms = [], bakeFaceColors = false } = {}) {
        this._positions = positions;
        this._faces = faces;
        this._faceColors = faceColors;
        this._faceUvs = faceUvs;
        this._faceUvTransforms = faceUvTransforms;
        this._faceTextures = [];
        this._faceTextureIds = [];
        this.staticOptimized = false;
        this.lazyTopology = true;
        this.bakeFaceColors = !!bakeFaceColors;
        this._polygonViews = [];
        this._polygonProxy = null;
        this._staticPolygonProxy = null;
        this._legacyViewExposed = false;
        this.vertexIndexByPosition = new WeakMap();
        for (let i = 0; i < positions.length; i++) this.vertexIndexByPosition.set(positions[i], i);
        this.edges = [];
        this.facesOfEdge = new Map();
        this.edgesOfVertex = [];
        this.facesOfVertex = [];
        this.faceCount = faces.length;
        let triangles = 0;
        for (const face of faces) triangles += Math.max(0, (face?.length || 0) - 2);
        this.triangleCount = triangles;
        this.allFaceIndices = Array.from({ length: this.faceCount }, (_, i) => i);
        this.opaqueFaceIndices = this.allFaceIndices;
        this.transparentFaceIndices = [];
        this.faceRanges = new Array(this.faceCount);
        this._boundsDirty = true;
        this.markDirty('geometry', 'uvs', 'materials');
        this.refreshBounds();
        return this;
    }

    ensureEditorTopology() {
        if (this.lazyTopology || this.staticOptimized) this._materializeStaticPolygonViews();
        if (!this.edges.length || this.edgesOfVertex.length !== this.positions.length) this._rebuildTopologyAdjacency();
        return this;
    }

    _ensureEditMaps() {
        if (this.renderVertexOffsetsByShared?.length && this.faceVertexRanges?.length === this.faceCount) return;
        const offsets = Array.from({ length: this.positions.length }, () => []);
        const faceRanges = new Array(this.faceCount);
        const faceIndexByRenderVertex = new Array(this.vertices ? this.vertices.length / 3 : 0);
        let cursor = 0;
        for (let faceIndex = 0; faceIndex < this.faces.length; faceIndex++) {
            const face = this.faces[faceIndex] || [];
            faceRanges[faceIndex] = { start: cursor, count: face.length };
            for (let corner = 0; corner < face.length; corner++) {
                const shared = face[corner];
                offsets[shared]?.push(cursor + corner);
                faceIndexByRenderVertex[cursor + corner] = faceIndex;
            }
            cursor += face.length;
        }
        this.renderVertexOffsetsByShared = offsets;
        this.renderVertexFaceIndex = faceIndexByRenderVertex;
        this.faceVertexRanges = faceRanges;
        this.renderVertexSharedIndices = new Array(cursor);
        for (let faceIndex = 0, cursor2 = 0; faceIndex < this.faces.length; faceIndex++) {
            const face = this.faces[faceIndex] || [];
            for (let corner = 0; corner < face.length; corner++) this.renderVertexSharedIndices[cursor2++] = face[corner];
        }
    }

    getVertexIndex(vertex) {
        if (Number.isInteger(vertex)) return vertex >= 0 && vertex < this.positions.length ? vertex : -1;
        if (Array.isArray(vertex)) return this.vertexIndexByPosition.get(vertex) ?? this.positions.findIndex(position => position === vertex);
        return -1;
    }

    getVertexSkin(vertex) {
        const index = this.getVertexIndex(vertex);
        return index < 0 ? undefined : this.vertexWeights.get(index);
    }

    _refreshPolygonViews() {
        this.vertexIndexByPosition = new WeakMap();
        this.positions.forEach((position, index) => this.vertexIndexByPosition.set(position, index));
        this._setPolygonViews(this.faces.map(face => face.map(vertexIndex => this.positions[vertexIndex])));
        this._legacyViewExposed = false;
    }

    _syncTopologyFromPolygonViews(weldThreshold = 0.0001) {
        const priorSkinByPosition = new Map();
        this.positions.forEach((position, index) => {
            const skin = this.vertexWeights.get(index);
            if (skin) priorSkinByPosition.set(position, skin);
        });

        const positions = [];
        const faces = [];
        const indicesByIdentity = new Map();
        const indicesByPosition = new Map();
        const skinByIndex = new Map();
        const positionCell = vertex => vertex.map(value => Math.floor(value / weldThreshold));
        const cellKey = cell => cell.join(',');
        const attachSkin = (vertexIndex, skin) => {
            if (!skin) return;
            const attached = skinByIndex.get(vertexIndex);
            if (!attached) skinByIndex.set(vertexIndex, skin);
            else if (attached !== skin) skin.weights.forEach((weight, bone) => attached.weights.set(bone, Math.max(attached.weights.get(bone) || 0, weight)));
        };
        for (const polygon of this._polygonViews) {
            const face = [];
            for (const vertex of polygon) {
                let vertexIndex = indicesByIdentity.get(vertex);
                if (vertexIndex === undefined) {
                    const cell = positionCell(vertex);
                    for (let x = -1; x <= 1 && vertexIndex === undefined; x++) {
                        for (let y = -1; y <= 1 && vertexIndex === undefined; y++) {
                            for (let z = -1; z <= 1 && vertexIndex === undefined; z++) {
                                const candidates = indicesByPosition.get(cellKey([cell[0] + x, cell[1] + y, cell[2] + z])) || [];
                                vertexIndex = candidates.find(candidate => Math.hypot(...positions[candidate].map((value, axis) => value - vertex[axis])) <= weldThreshold);
                            }
                        }
                    }
                    if (vertexIndex === undefined) {
                        vertexIndex = positions.length;
                        positions.push(vertex);
                        const key = cellKey(cell);
                        if (!indicesByPosition.has(key)) indicesByPosition.set(key, []);
                        indicesByPosition.get(key).push(vertexIndex);
                    }
                    indicesByIdentity.set(vertex, vertexIndex);
                }
                attachSkin(vertexIndex, priorSkinByPosition.get(vertex));
                face.push(vertexIndex);
            }
            faces.push(face);
        }
        this.positions = positions;
        this.faces = faces;
        this.vertexWeights = skinByIndex;
        this._refreshPolygonViews();
    }

    _rebuildTopologyAdjacency() {
        this.edges = [];
        this.facesOfEdge = new Map();
        this.edgesOfVertex = Array.from({ length: this.positions.length }, () => []);
        this.facesOfVertex = Array.from({ length: this.positions.length }, () => []);
        const edgesByKey = new Map();
        this.faces.forEach((face, faceIndex) => {
            for (let corner = 0; corner < face.length; corner++) {
                const a = face[corner];
                const b = face[(corner + 1) % face.length];
                if (a === b) continue;
                const key = a < b ? `${a},${b}` : `${b},${a}`;
                let adjacentFaces = this.facesOfEdge.get(key);
                if (!adjacentFaces) {
                    const edge = { a: Math.min(a, b), b: Math.max(a, b), faceA: faceIndex };
                    edgesByKey.set(key, edge);
                    this.edges.push(edge);
                    this.edgesOfVertex[a].push(key);
                    this.edgesOfVertex[b].push(key);
                    adjacentFaces = [];
                    this.facesOfEdge.set(key, adjacentFaces);
                } else {
                    const edge = edgesByKey.get(key);
                    if (edge && edge.faceB === undefined) edge.faceB = faceIndex;
                }
                adjacentFaces.push(faceIndex);
            }
        });
    }

    static createCube(material) {
        const mesh = new Mesh(material);

        mesh.polygons = [
            [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]],
            [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]],
            [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]],
            [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]],
            [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]],
            [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]]
        ];
        const netTiles = [[1, 1], [3, 1], [0, 1], [2, 1], [1, 2], [1, 0]];
        mesh.faceUvs = mesh.polygons.map((polygon, faceIndex) => polygon.map(([u, v], vertexIndex) => {
            const local = [[0, 0], [1, 0], [1, 1], [0, 1]][vertexIndex % 4];
            const [tileX, tileY] = netTiles[faceIndex];
            return [(tileX + local[0]) / 4, (tileY + local[1] + 0.5) / 4];
        }));
        mesh.rebuildRenderData();

        return mesh;
    }

    static createPlane(material) {
        const mesh = new Mesh(material);
        mesh.polygons = [[[-0.5, 0, -0.5], [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5]]];
        mesh.rebuildRenderData();
        return mesh;
    }

    static createUvSphere(material, segments = 16, rings = 8) {
        const mesh = new Mesh(material);
        const point = (ring, segment) => {
            const latitude = Math.PI * ring / rings;
            const longitude = 2 * Math.PI * segment / segments;
            return [0.5 * Math.sin(latitude) * Math.cos(longitude), 0.5 * Math.cos(latitude), 0.5 * Math.sin(latitude) * Math.sin(longitude)];
        };
        for (let segment = 0; segment < segments; segment++) {
            mesh.polygons.push([[0, 0.5, 0], point(1, segment), point(1, segment + 1)]);
            mesh.polygons.push([[0, -0.5, 0], point(rings - 1, segment + 1), point(rings - 1, segment)]);
        }
        for (let ring = 1; ring < rings - 1; ring++) {
            for (let segment = 0; segment < segments; segment++) {
                mesh.polygons.push([point(ring, segment), point(ring, segment + 1), point(ring + 1, segment + 1), point(ring + 1, segment)]);
            }
        }
        mesh.rebuildRenderData();
        return mesh;
    }

    static createCylinder(material, segments = 16) {
        const mesh = new Mesh(material);
        const bottom = [];
        const top = [];
        for (let segment = 0; segment < segments; segment++) {
            const angle = 2 * Math.PI * segment / segments;
            const x = Math.cos(angle) * 0.5;
            const z = Math.sin(angle) * 0.5;
            bottom.push([x, -0.5, z]);
            top.push([x, 0.5, z]);
        }
        mesh.polygons.push([...bottom], [...top].reverse());
        for (let segment = 0; segment < segments; segment++) {
            const next = (segment + 1) % segments;
            mesh.polygons.push([bottom[segment], bottom[next], top[next], top[segment]]);
        }
        mesh.rebuildRenderData();
        return mesh;
    }

    static createFromData(material, data) {
        const mesh = new Mesh(material);
        const vertices = data.vertices || [];
        const faces = data.faces || [];
        mesh.setTopology(vertices, faces);
        mesh.rebuildRenderData();
        return mesh;
    }

    addVertex(faceIndex, position = [0, 0, 0]) {
        if (!this.faces[faceIndex]) {
            faceIndex = this.faces.length;
            this.faces.push([]);
        }
        const vertexIndex = this.positions.length;
        this.positions.push([...position]);
        this.faces[faceIndex].push(vertexIndex);
        this._refreshPolygonViews();
        this.rebuildRenderData();
        return vertexIndex;
    }

    addFace(vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) {
        const face = vertices.map(vertex => {
            const vertexIndex = this.positions.length;
            this.positions.push([...vertex]);
            return vertexIndex;
        });
        this.faces.push(face);
        this._refreshPolygonViews();
        this.rebuildRenderData();
        this.selectedFace = this.faces.length - 1;
    }

    extrudeFace(faceIndex, distance = 0.5) {
        const face = this.faces[faceIndex];
        if (!face || face.length < 3) return;
        const positions = face.map(vertexIndex => this.positions[vertexIndex]);
        const edgeA = positions[1].map((value, axis) => value - positions[0][axis]);
        const edgeB = positions[2].map((value, axis) => value - positions[0][axis]);
        const normal = [
            edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
            edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
            edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]
        ];
        const normalLength = Math.hypot(...normal);
        if (!normalLength) return;
        const offset = normal.map(value => value / normalLength * distance);
        const extrudedFace = positions.map(vertex => {
            const vertexIndex = this.positions.length;
            this.positions.push(vertex.map((value, axis) => value + offset[axis]));
            return vertexIndex;
        });

        for (let index = 0; index < face.length; index++) {
            const next = (index + 1) % face.length;
            this.faces.push([face[index], face[next], extrudedFace[next], extrudedFace[index]]);
        }
        this.faces.push(extrudedFace);
        this._refreshPolygonViews();
        this.rebuildRenderData();
        this.selectedFace = this.faces.length - 1;
    }

    moveFaceUVs(faceIndex, deltaU, deltaV) {
        const faceUvs = this.faceUvs[faceIndex];
        if (!faceUvs) return;
        faceUvs.forEach(uv => {
            uv[0] += deltaU;
            uv[1] += deltaV;
        });
        this.rebuildRenderData();
    }

    getFaceDimensions(faceIndex) {
        const frame = this.getFaceFrame(faceIndex);
        if (!frame) return null;
        const projections = frame.vertices.map(vertex => {
            const relative = vertex.map((value, axis) => value - frame.center[axis]);
            return [dot3(relative, frame.tangent), dot3(relative, frame.bitangent)];
        });
        return {
            width: Math.max(...projections.map(point => point[0])) - Math.min(...projections.map(point => point[0])),
            length: Math.max(...projections.map(point => point[1])) - Math.min(...projections.map(point => point[1]))
        };
    }

    rotateFaceGeometry(faceIndex, angle) {
        const frame = this.getFaceFrame(faceIndex);
        if (!frame) return;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        frame.vertices.forEach(vertex => {
            const relative = vertex.map((value, axis) => value - frame.center[axis]);
            const x = dot3(relative, frame.tangent);
            const y = dot3(relative, frame.bitangent);
            const rotated = frame.center.map((value, axis) => value
                + frame.tangent[axis] * (x * cosine - y * sine)
                + frame.bitangent[axis] * (x * sine + y * cosine));
            vertex.splice(0, 3, ...rotated);
            this.updateBindVertex(vertex);
        });
        this.rebuildRenderData();
    }

    scaleFaceGeometry(faceIndex, widthScale = 1, lengthScale = 1) {
        const frame = this.getFaceFrame(faceIndex);
        if (!frame) return;
        frame.vertices.forEach(vertex => {
            const relative = vertex.map((value, axis) => value - frame.center[axis]);
            const x = dot3(relative, frame.tangent) * widthScale;
            const y = dot3(relative, frame.bitangent) * lengthScale;
            const normalOffset = dot3(relative, frame.normal);
            const scaled = frame.center.map((value, axis) => value
                + frame.tangent[axis] * x
                + frame.bitangent[axis] * y
                + frame.normal[axis] * normalOffset);
            vertex.splice(0, 3, ...scaled);
            this.updateBindVertex(vertex);
        });
        this.rebuildRenderData();
    }

    getFaceFrame(faceIndex) {
        const vertices = this.polygons[faceIndex];
        if (!vertices || vertices.length < 3) return null;
        const center = vertices.reduce((sum, vertex) => sum.map((value, axis) => value + vertex[axis] / vertices.length), [0, 0, 0]);
        let tangent = normalize3(vertices[1].map((value, axis) => value - vertices[0][axis]));
        if (!tangent) return null;
        let normal = null;
        for (let index = 2; index < vertices.length && !normal; index++) {
            const edge = vertices[index].map((value, axis) => value - vertices[0][axis]);
            normal = normalize3(cross3(tangent, edge));
        }
        if (!normal) return null;
        const bitangent = normalize3(cross3(normal, tangent));
        return { vertices, center, tangent, bitangent, normal };
    }

    knifeTool(faceIndex, start, end) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3 || !start || !end) return false;
        const frame = this.getFaceFrame(faceIndex);
        if (!frame) return false;
        const normal = normalize3(frame.normal) || [0, 0, 1];
        const center = frame.center;
        const projectedStart = projectToPlane(start, center, normal);
        const projectedEnd = projectToPlane(end, center, normal);
        const points = [...polygon];
        for (let index = 0; index < polygon.length; index++) {
            const current = polygon[index];
            const next = polygon[(index + 1) % polygon.length];
            const intersection = segmentToSegmentIntersection(projectedStart, projectedEnd, current, next);
            if (intersection) points.splice(index + 1, 0, intersection);
        }
        if (points.length === polygon.length) return false;
        const left = [];
        const right = [];
        for (const point of points) {
            const signed = dot3(point.map((value, axis) => value - center[axis]), normal);
            if (signed >= 0) left.push([...point]);
            else right.push([...point]);
        }
        const leftFace = left.length >= 3 ? left : null;
        const rightFace = right.length >= 3 ? right : null;
        if (!leftFace && !rightFace) return false;
        const replacement = [];
        const replacementUvs = [];
        if (leftFace) {
            replacement.push(leftFace);
            replacementUvs.push(leftFace.map((_, vertexIndex) => this.faceUvs[faceIndex]?.[Math.min(vertexIndex, this.faceUvs[faceIndex].length - 1)] || defaultFaceUV(this.polygons.length, vertexIndex, 1)));
        }
        if (rightFace) {
            replacement.push(rightFace);
            replacementUvs.push(rightFace.map((_, vertexIndex) => this.faceUvs[faceIndex]?.[Math.min(vertexIndex, this.faceUvs[faceIndex].length - 1)] || defaultFaceUV(this.polygons.length, vertexIndex, 1)));
        }
        const oldColor = this.faceColors[faceIndex] || [1, 1, 1, 1];
        this.polygons.splice(faceIndex, 1, ...replacement);
        this.faceUvs.splice(faceIndex, 1, ...replacementUvs);
        this.faceColors.splice(faceIndex, 1, ...replacement.map(() => [...oldColor]));
        this.faceTextures.splice(faceIndex, 1, ...replacement.map(() => this.faceTextures[faceIndex] || null));
        this.faceTextureIds.splice(faceIndex, 1, ...replacement.map(() => this.faceTextureIds[faceIndex] || null));
        this.faceUvTransforms.splice(faceIndex, 1, ...replacement.map(() => ({ ...this.faceUvTransforms[faceIndex] })));
        this.rebuildRenderData();
        return true;
    }

    bevel(faceIndex, amount = 0.1) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3) return false;
        const frame = this.getFaceFrame(faceIndex);
        if (!frame) return false;
        const offsetNormal = normalize3(frame.normal) || [0, 0, 1];
        const offsetPolygon = polygon.map(point => point.map((value, axis) => value + offsetNormal[axis] * amount));
        const sideFaces = polygon.map((vertex, index) => [
            [...vertex],
            [...polygon[(index + 1) % polygon.length]],
            [...offsetPolygon[(index + 1) % polygon.length]],
            [...offsetPolygon[index]]
        ]);
        this.polygons.splice(faceIndex, 1, ...sideFaces, offsetPolygon);
        const faceUv = this.faceUvs[faceIndex] || polygon.map((_, vertexIndex) => defaultFaceUV(faceIndex, vertexIndex, polygon.length));
        const newUvs = sideFaces.map((_, sideIndex) => [
            [...faceUv[Math.min(sideIndex, faceUv.length - 1)]],
            [...faceUv[Math.min((sideIndex + 1) % faceUv.length, faceUv.length - 1)]],
            [...faceUv[Math.min((sideIndex + 1) % faceUv.length, faceUv.length - 1)]],
            [...faceUv[Math.min(sideIndex, faceUv.length - 1)]]
        ]);
        this.faceUvs.splice(faceIndex, 1, ...newUvs, offsetPolygon.map((_, vertexIndex) => [...faceUv[vertexIndex % faceUv.length]]));
        this.faceColors.splice(faceIndex, 1, ...sideFaces.map(() => [...(this.faceColors[faceIndex] || [1, 1, 1, 1])]), [...(this.faceColors[faceIndex] || [1, 1, 1, 1])]);
        this.faceTextures.splice(faceIndex, 1, ...sideFaces.map(() => this.faceTextures[faceIndex] || null), this.faceTextures[faceIndex] || null);
        this.faceTextureIds.splice(faceIndex, 1, ...sideFaces.map(() => this.faceTextureIds[faceIndex] || null), this.faceTextureIds[faceIndex] || null);
        this.faceUvTransforms.splice(faceIndex, 1, ...sideFaces.map(() => ({ ...this.faceUvTransforms[faceIndex] })), { ...this.faceUvTransforms[faceIndex] });
        this.rebuildRenderData();
        return true;
    }

    inset(faceIndex, amount = 0.2) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3) return false;
        const frame = this.getFaceFrame(faceIndex); if (!frame) return false;
        const center = frame.center;
        const insetPolygon = polygon.map(vertex => {
            const offset = vertex.map((value, axis) => value - center[axis]);
            const direction = normalize3(offset) || [1, 0, 0];
            return center.map((value, axis) => value + direction[axis] * amount + (vertex[axis] - center[axis]) * (1 - amount));
        });
        this.polygons.splice(faceIndex, 1, insetPolygon);
        this.faceUvs.splice(faceIndex, 1, insetPolygon.map((_, vertexIndex) => this.faceUvs[faceIndex]?.[vertexIndex] || defaultFaceUV(faceIndex, vertexIndex, insetPolygon.length)));
        this.faceColors.splice(faceIndex, 1, [this.faceColors[faceIndex] || [1, 1, 1, 1]]);
        this.faceTextures.splice(faceIndex, 1, [this.faceTextures[faceIndex] || null]);
        this.faceTextureIds.splice(faceIndex, 1, [this.faceTextureIds[faceIndex] || null]);
        this.faceUvTransforms.splice(faceIndex, 1, [{ ...this.faceUvTransforms[faceIndex] }]);
        this.rebuildRenderData();
        return true;
    }

    loopCut(faceIndex, segments = 2) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3 || segments < 2) return false;
        const result = [];
        for (let index = 0; index < polygon.length; index++) {
            const start = polygon[index];
            const end = polygon[(index + 1) % polygon.length];
            const step = [
                (end[0] - start[0]) / segments,
                (end[1] - start[1]) / segments,
                (end[2] - start[2]) / segments
            ];
            for (let segment = 0; segment < segments; segment++) {
                result.push([
                    start[0] + step[0] * segment,
                    start[1] + step[1] * segment,
                    start[2] + step[2] * segment
                ]);
            }
        }
        const clipped = result.filter((vertex, index, list) => index === 0 || !list.slice(0, index).some(existing => existing.every((value, axis) => Math.abs(value - vertex[axis]) < 1e-6)));
        this.polygons[faceIndex] = clipped;
        this.faceUvs[faceIndex] = (this.faceUvs[faceIndex] || clipped.map((_, vertexIndex) => defaultFaceUV(faceIndex, vertexIndex, clipped.length))).map((uv, index) => [uv[0], uv[1]]);
        this.rebuildRenderData();
        return true;
    }

    bridge(faceIndex, targetFaceIndex) {
        const faceA = this.polygons[faceIndex];
        const faceB = this.polygons[targetFaceIndex];
        if (!faceA || !faceB || faceA.length !== faceB.length) return false;
        const bridgeFaces = [];
        for (let index = 0; index < faceA.length; index++) {
            bridgeFaces.push([
                [...faceA[index]],
                [...faceA[(index + 1) % faceA.length]],
                [...faceB[(index + 1) % faceB.length]],
                [...faceB[index]]
            ]);
        }
        this.polygons.splice(Math.min(faceIndex, targetFaceIndex), 1, ...bridgeFaces);
        this.rebuildRenderData();
        return true;
    }

    fill(faceIndex) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3) return false;
        const triangles = [];
        for (let index = 1; index < polygon.length - 1; index++) {
            triangles.push([polygon[0], polygon[index], polygon[index + 1]]);
        }
        this.polygons.splice(faceIndex, 1, ...triangles);
        this.rebuildRenderData();
        return true;
    }

    gridFill(faceIndex, columns = 2, rows = 2) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 4 || columns < 1 || rows < 1) return false;
        const newFaces = [];
        const startUv = this.faceUvs[faceIndex] || polygon.map((_, index) => defaultFaceUV(faceIndex, index, polygon.length));
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) {
                const corners = [
                    [x / columns, y / rows],
                    [(x + 1) / columns, y / rows],
                    [(x + 1) / columns, (y + 1) / rows],
                    [x / columns, (y + 1) / rows]
                ];
                const local = corners.map(([u, v]) => {
                    const point = polygon[0].map((_, axis) => {
                        const a = polygon[1]?.[axis] ?? polygon[0][axis];
                        const b = polygon[3]?.[axis] ?? polygon[0][axis];
                        return (polygon[0][axis] * (1 - u) + a * u) * (1 - v) + (polygon[0][axis] * (1 - u) + b * u) * v;
                    });
                    return point;
                });
                newFaces.push(local);
            }
        }
        this.polygons.splice(faceIndex, 1, ...newFaces);
        this.faceUvs.splice(faceIndex, 1, ...newFaces.map((_, index) => [
            [startUv[0] ? startUv[0][0] : 0, startUv[0] ? startUv[0][1] : 0],
            [startUv[1] ? startUv[1][0] : 1, startUv[1] ? startUv[1][1] : 0],
            [1, 1],
            [0, 1]
        ]));
        this.rebuildRenderData();
        return true;
    }

    dissolve(faceIndex) {
        if (!this.polygons[faceIndex]) return false;
        this.polygons.splice(faceIndex, 1);
        this.faceUvs.splice(faceIndex, 1);
        this.faceColors.splice(faceIndex, 1);
        this.faceTextures.splice(faceIndex, 1);
        this.faceTextureIds.splice(faceIndex, 1);
        this.faceUvTransforms.splice(faceIndex, 1);
        this.rebuildRenderData();
        return true;
    }

    split(faceIndex, axis = 'x') {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3) return null;
        const axisIndex = { x: 0, y: 1, z: 2 }[axis.toLowerCase()] ?? 0;
        const clone = new Mesh(this.material);
        clone.polygons = [polygon.map(vertex => [...vertex.map((value, index) => index === axisIndex ? value + 0.5 : value)])];
        clone.faceUvs = [polygon.map((_, vertexIndex) => defaultFaceUV(0, vertexIndex, polygon.length))];
        clone.faceColors = [[...this.faceColors[faceIndex] || [1, 1, 1, 1]]];
        clone.faceTextures = [this.faceTextures[faceIndex] || null];
        clone.faceTextureIds = [this.faceTextureIds[faceIndex] || null];
        clone.faceUvTransforms = [{ ...this.faceUvTransforms[faceIndex] }];
        clone.rebuildRenderData();
        return clone;
    }

    separate(faceIndex) {
        return this.split(faceIndex, 'x');
    }

    triangulate(faceIndex) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 4) return false;
        const triangles = [];
        for (let index = 1; index < polygon.length - 1; index++) {
            triangles.push([polygon[0], polygon[index], polygon[index + 1]]);
        }
        this.polygons.splice(faceIndex, 1, ...triangles);
        const uvSource = this.faceUvs[faceIndex] || polygon.map((_, index) => defaultFaceUV(faceIndex, index, polygon.length));
        const newUvs = triangles.map((_, triangleIndex) => [
            [...uvSource[0]],
            [...uvSource[Math.min(1 + triangleIndex, uvSource.length - 1)]],
            [...uvSource[Math.min(2 + triangleIndex, uvSource.length - 1)]]
        ]);
        this.faceUvs.splice(faceIndex, 1, ...newUvs);
        this.faceColors.splice(faceIndex, 1, ...triangles.map(() => [...(this.faceColors[faceIndex] || [1, 1, 1, 1])]));
        this.faceTextures.splice(faceIndex, 1, ...triangles.map(() => this.faceTextures[faceIndex] || null));
        this.faceTextureIds.splice(faceIndex, 1, ...triangles.map(() => this.faceTextureIds[faceIndex] || null));
        this.faceUvTransforms.splice(faceIndex, 1, ...triangles.map(() => ({ ...this.faceUvTransforms[faceIndex] })));
        this.rebuildRenderData();
        return true;
    }

    quadRebuild(faceIndex) {
        const polygon = this.polygons[faceIndex];
        if (!polygon || polygon.length < 3) return false;
        const rebuilt = [];
        for (let index = 0; index < polygon.length; index += 2) {
            const next = (index + 2) % polygon.length;
            rebuilt.push([polygon[index], polygon[(index + 1) % polygon.length], polygon[next], polygon[(next + 1) % polygon.length]]);
        }
        if (!rebuilt.length) return false;
        this.polygons.splice(faceIndex, 1, ...rebuilt);
        this.rebuildRenderData();
        return true;
    }

    recalculateNormals() {
        this.polygons.forEach((polygon, faceIndex) => {
            if (!polygon || polygon.length < 3) return;
            const edgeA = polygon[1].map((value, axis) => value - polygon[0][axis]);
            const edgeB = polygon[2].map((value, axis) => value - polygon[0][axis]);
            const normal = normalize3(cross3(edgeA, edgeB)) || [0, 1, 0];
            for (let vertexIndex = 0; vertexIndex < polygon.length; vertexIndex++) {
                const vertex = polygon[vertexIndex];
                const vertexIndex = this.getVertexIndex(vertex);
                const skin = this.vertexWeights.get(vertexIndex);
                if (skin) {
                    skin.bindPosition = [...vertex];
                    this.vertexWeights.set(vertexIndex, skin);
                }
            }
            if (this.faceUvs[faceIndex]) {
                this.faceUvs[faceIndex] = this.faceUvs[faceIndex].map((uv, vertexIndex) => uv || defaultFaceUV(faceIndex, vertexIndex, polygon.length));
            }
            if (this.faceColors[faceIndex]) this.faceColors[faceIndex] = [...(this.faceColors[faceIndex] || [1, 1, 1, 1])];
        });
        this.rebuildRenderData();
        return true;
    }

    flipNormals() {
        this.polygons.forEach((polygon, faceIndex) => {
            if (!polygon || polygon.length < 3) return;
            this.polygons[faceIndex] = [...polygon].reverse();
            if (this.faceUvs[faceIndex]) this.faceUvs[faceIndex] = [...this.faceUvs[faceIndex]].reverse();
        });
        this.rebuildRenderData();
        return true;
    }

    updateRenderQueues() {
        this.opaqueFaceIndices = [];
        this.transparentFaceIndices = [];
        this.renderStateVersion++;
        this.dirtyFlags.materials = false;
        this.dirtyFlags.selection = false;
        for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
            const color = this.faceColors[faceIndex] || [1, 1, 1, 1];
            const texture = this.faceTextures[faceIndex] || (this.material.useTexture ? this.material.texture : null);
            if ((color[3] ?? 1) < 1 || (texture && textureHasTransparency(texture))) this.transparentFaceIndices.push(faceIndex);
            else this.opaqueFaceIndices.push(faceIndex);
        }
        this.instanceBatchKey = null;
        if (this.transparentFaceIndices.length || (this.material.color?.[3] ?? 1) < 1 || this.vertexWeights.size || this.skeleton.bones.length || this.selectedFace >= 0) return;
        const batches = this.getDrawBatches(this.opaqueFaceIndices);
        if (batches.some(batch => batch.texture)) return;
        this.instanceBatchKey = `${this.geometrySignature}:${this.material.shading}:${this.material.doubleSided ? 1 : 0}:${this.material.useTexture ? 1 : 0}:${JSON.stringify(batches.map(batch => batch.color))}:${JSON.stringify(batches.map(batch => [batch.offset, batch.count, batch.transform.scale, batch.transform.offset, batch.transform.rotation, batch.transform.flipX, batch.transform.flipY, batch.uvCenter]))}`;
    }

    getInstanceBatchKey() {
        if (this.selectedFace >= 0 || (this.material.color?.[3] ?? 1) < 1 || this.vertexWeights.size || this.skeleton.bones.length || this.transparentFaceIndices.length) return null;
        return this.instanceBatchKey ? `${this.instanceBatchKey}:${this.shadowedFaces.join('')}` : null;
    }

    setFaceColor(faceIndex, color) {
        if (!this.faceColors[faceIndex]) return;
        this.faceColors[faceIndex] = [...color];
        this.updateRenderQueues();
    }

    setFaceTexture(faceIndex, texture, textureId = null) {
        if (faceIndex < 0 || faceIndex >= this.faceCount) return;
        this.faceTextures[faceIndex] = texture || null;
        this.faceTextureIds[faceIndex] = textureId;
        this.updateRenderQueues();
    }

    setVertexBoneWeight(faceIndex, vertexIndex, bone, weight = 1) {
        const sharedVertexIndex = this.faces[faceIndex]?.[vertexIndex];
        const vertex = this.positions[sharedVertexIndex];
        if (!vertex || !this.skeleton.bones.includes(bone)) return false;
        let skin = this.vertexWeights.get(sharedVertexIndex);
        if (!skin) {
            skin = { bindPosition: [...vertex], weights: new Map() };
            this.vertexWeights.set(sharedVertexIndex, skin);
        }
        const normalizedWeight = Math.max(0, Math.min(1, weight));
        if (normalizedWeight === 0) skin.weights.delete(bone);
        else skin.weights.set(bone, normalizedWeight);
        const total = [...skin.weights.values()].reduce((sum, value) => sum + value, 0);
        if (total > 1) skin.weights.forEach((value, weightedBone) => skin.weights.set(weightedBone, value / total));
        if (!skin.weights.size) this.vertexWeights.delete(sharedVertexIndex);
        this.markDirty('skeletonPose');
        return true;
    }

    autoWeightBone(bone, radius = Math.max(0.05, bone?.length || 0.5)) {
        if (!bone || !this.skeleton.bones.includes(bone)) return 0;
        const bind = this.skeleton.getWorldTransforms(true).get(bone);
        const start = bind.position;
        const direction = rotate3(bind.rotation, [0, bone.length, 0]);
        const end = start.map((value, axis) => value + direction[axis]);
        const segment = end.map((value, axis) => value - start[axis]);
        const segmentLengthSquared = Math.max(dot3(segment, segment), 1e-8);
        let assigned = 0;
        this.positions.forEach((vertex, vertexIndex) => {
            let skin = this.vertexWeights.get(vertexIndex);
            if (!skin) {
                skin = { bindPosition: [...vertex], weights: new Map() };
                this.vertexWeights.set(vertexIndex, skin);
            }
            const point = skin.bindPosition;
            const offset = point.map((value, axis) => value - start[axis]);
            const along = Math.max(0, Math.min(1, dot3(offset, segment) / segmentLengthSquared));
            const nearest = start.map((value, axis) => value + segment[axis] * along);
            const distance = Math.hypot(...point.map((value, axis) => value - nearest[axis]));
            if (distance > radius) return;
            const influence = Math.pow(1 - distance / radius, 2);
            const otherTotal = [...skin.weights].reduce((sum, [otherBone, value]) => sum + (otherBone === bone ? 0 : value), 0);
            skin.weights.set(bone, Math.max(skin.weights.get(bone) || 0, influence * Math.max(0, 1 - otherTotal)));
            assigned++;
        });
        if (assigned) this.markDirty('skeletonPose');
        return assigned;
    }

    clearVertexBoneWeights(faceIndex, vertexIndex) {
        const sharedVertexIndex = this.faces[faceIndex]?.[vertexIndex];
        if (sharedVertexIndex === undefined) return false;
        const cleared = this.vertexWeights.delete(sharedVertexIndex);
        if (cleared) this.markDirty('skeletonPose');
        return cleared;
    }

    removeBone(index) {
        const bone = this.skeleton.bones[index];
        if (!bone) return false;
        const removed = new Set(this.skeleton.removeBone(bone));
        this.vertexWeights.forEach((skin, vertexIndex) => {
            removed.forEach(removedBone => skin.weights.delete(removedBone));
            if (!skin.weights.size) this.vertexWeights.delete(vertexIndex);
        });
        this.markDirty('skeletonPose');
        this.selectedBone = this.skeleton.bones.length ? Math.min(index, this.skeleton.bones.length - 1) : null;
        return true;
    }

    getDeformedPoint(vertex, transforms = null, bindTransforms = null) {
        const vertexIndex = this.getVertexIndex(vertex);
        const skin = this.vertexWeights.get(vertexIndex);
        if (!skin?.weights.size) return [...(Number.isInteger(vertex) ? this.positions[vertexIndex] : vertex)];
        const current = transforms || this.skeleton.getWorldTransforms();
        const bind = bindTransforms || this.skeleton.getWorldTransforms(true);
        return deformPoint(skin, current, bind);
    }

    getDeformedVertices() {
        const transforms = this.skeleton.getWorldTransforms();
        const bindTransforms = this.skeleton.getWorldTransforms(true);
        const positions = [];
        this.faces.forEach(face => face.forEach(vertexIndex => {
            positions.push(...this.getDeformedPoint(vertexIndex, transforms, bindTransforms));
        }));
        return new Float32Array(positions);
    }

    getDeformedNormals() {
        const transforms = this.skeleton.getWorldTransforms();
        const bindTransforms = this.skeleton.getWorldTransforms(true);
        const normals = [];
        this.faces.forEach((face, faceIndex) => {
            const positions = face.map(vertexIndex => this.getDeformedPoint(vertexIndex, transforms, bindTransforms));
            const edgeA = positions[1]?.map((value, axis) => value - positions[0][axis]) || [0, 0, 0];
            const edgeB = positions[2]?.map((value, axis) => value - positions[0][axis]) || [0, 0, 0];
            const normal = normalize3(cross3(edgeA, edgeB)) || [0, 1, 0];
            positions.forEach(() => normals.push(...normal));
        });
        return new Float32Array(normals);
    }

    getSkinningSignature() {
        // skinRevision is bumped whenever an animation/bone pose changes, so serializing
        // the entire bone pose every frame is unnecessary CPU work.
        if (!this.vertexWeights.size) return '';
        return `${this.geometryRevision}:${this.skinRevision}:${this.skeleton?.poseRevision ?? 0}`;
    }

    updateSkinningBuffers(gl) {
        const signature = this.getSkinningSignature();
        if (signature === this.skinningSignature) {
            this.dirtyFlags.skeletonPose = false;
            return false;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, signature ? this.getDeformedVertices() : this.vertices, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, signature ? this.getDeformedNormals() : this.normals, gl.DYNAMIC_DRAW);
        this.skinningSignature = signature;
        this.dirtyFlags.skeletonPose = false;
        return true;
    }

    getVertexWeightData() {
        return this.faces.map(face => face.map(vertexIndex => {
            const vertex = this.positions[vertexIndex];
            const skin = this.vertexWeights.get(vertexIndex);
            return {
                bindPosition: skin ? [...skin.bindPosition] : [...vertex],
                weights: skin ? [...skin.weights].map(([bone, weight]) => ({ bone: bone.name, weight })) : [],
                unweightedWeight: skin ? Math.max(0, 1 - [...skin.weights.values()].reduce((sum, weight) => sum + weight, 0)) : 1
            };
        }));
    }

    setFaceVertex(faceIndex, vertexIndex, position) {
        const sharedVertexIndex = this.faces[faceIndex]?.[vertexIndex];
        return this.setVertexPosition(sharedVertexIndex, position);
    }

    setVertexPosition(sharedVertexIndex, position) {
        if (!Number.isInteger(sharedVertexIndex) || !this.positions[sharedVertexIndex]) return false;
        const wasFast = this._fastVertexEditDepth > 0;
        if (!wasFast) this.beginVertexEdit();
        const vertex = this.positions[sharedVertexIndex];
        this._suppressFastDirty = true;
        vertex[0] = Number(position[0]) || 0;
        vertex[1] = Number(position[1]) || 0;
        vertex[2] = Number(position[2]) || 0;
        this._suppressFastDirty = false;
        const skin = this.vertexWeights.get(sharedVertexIndex);
        if (skin) skin.bindPosition = [...vertex];
        this._fastModifiedVertices.add(sharedVertexIndex);
        if (!wasFast) this.endVertexEdit();
        return true;
    }

    beginVertexEdit() {
        this._fastVertexEditDepth++;
        return this;
    }

    endVertexEdit() {
        if (this._fastVertexEditDepth > 0) this._fastVertexEditDepth--;
        if (this._fastVertexEditDepth === 0 && this._fastModifiedVertices.size) {
            const indices = [...this._fastModifiedVertices];
            this._fastModifiedVertices.clear();
            this._applyFastVertexEdits(indices);
        }
        return this;
    }

    translateVertices(sharedIndices, delta) {
        const indices = [...new Set(sharedIndices || [])].filter(index => Number.isInteger(index) && this.positions[index]);
        if (!indices.length) return false;
        const wasFast = this._fastVertexEditDepth > 0;
        if (!wasFast) this.beginVertexEdit();
        this._suppressFastDirty = true;
        for (const sharedVertexIndex of indices) {
            const vertex = this.positions[sharedVertexIndex];
            vertex[0] += Number(delta?.[0]) || 0;
            vertex[1] += Number(delta?.[1]) || 0;
            vertex[2] += Number(delta?.[2]) || 0;
            const skin = this.vertexWeights.get(sharedVertexIndex);
            if (skin) skin.bindPosition = [...vertex];
            this._fastModifiedVertices.add(sharedVertexIndex);
        }
        this._suppressFastDirty = false;
        if (!wasFast) this.endVertexEdit();
        return true;
    }

    _applyFastVertexEdits(sharedIndices) {
        if (!this.renderVertexSharedIndices || !this.renderVertexOffsetsByShared.length) this._ensureEditMaps();
        if (!this.renderVertexSharedIndices || !this.renderVertexOffsetsByShared.length) { this.markDirty('geometry'); return; }
        const affectedFaces = new Set();
        for (const sharedIndex of sharedIndices) {
            const offsets = this.renderVertexOffsetsByShared[sharedIndex] || [];
            const position = this.positions[sharedIndex];
            for (const renderIndex of offsets) {
                const base = renderIndex * 3;
                this.vertices[base] = position[0];
                this.vertices[base + 1] = position[1];
                this.vertices[base + 2] = position[2];
                affectedFaces.add(this.renderVertexFaceIndex?.[renderIndex] ?? -1);
                this._queueGpuRange(renderIndex, 1);
            }
            for (const faceIndex of (this.facesOfVertex?.[sharedIndex] || [])) affectedFaces.add(faceIndex);
        }
        for (const faceIndex of affectedFaces) {
            if (!Number.isInteger(faceIndex) || faceIndex < 0) continue;
            const range = this.faceVertexRanges[faceIndex];
            if (!range || range.count < 3) continue;
            const face = this.faces[faceIndex];
            const p0 = this.positions[face[0]], p1 = this.positions[face[1]], p2 = this.positions[face[2]];
            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-8) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 1; nz = 0; }
            const end = range.start + range.count;
            for (let renderIndex = range.start; renderIndex < end; renderIndex++) {
                const base = renderIndex * 3;
                this.normals[base] = nx;
                this.normals[base + 1] = ny;
                this.normals[base + 2] = nz;
            }
            this._queueGpuRange(range.start, range.count);
        }
        this._suppressFastDirty = true;
        this.geometryRevision++;
        this._suppressFastDirty = false;
        this.dirtyFlags.geometry = false;
        this._boundsDirty = true;
        this.renderDataRevision = (this.renderDataRevision || 0) + 1;
        this.geometrySignature = `${this.geometrySignature || 'fast'}:v${this.geometryRevision}`;
        this.renderStateVersion++;
        this.instanceBatchKey = null;
    }

    _queueGpuRange(start, count) {
        if (!Number.isInteger(start) || count <= 0) return;
        this._pendingGpuRanges.push([start, count]);
    }

    flushPendingGeometry(gl) {
        if (!this._pendingGpuRanges.length || !this.positionBuffer) return false;
        const ranges = mergeRanges(this._pendingGpuRanges);
        this._pendingGpuRanges.length = 0;
        for (const [start, end] of ranges) {
            const offset = start * 3;
            const count = end - start;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, offset * 4, this.vertices.subarray(offset, offset + count * 3));
            gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, offset * 4, this.normals.subarray(offset, offset + count * 3));
        }
        return true;
    }

    refreshBounds() {
        if (!this._boundsDirty) return;
        const boundsMin = [Infinity, Infinity, Infinity];
        const boundsMax = [-Infinity, -Infinity, -Infinity];
        for (const vertex of this.positions) {
            if (!vertex) continue;
            for (let axis = 0; axis < 3; axis++) {
                const value = Number(vertex[axis]) || 0;
                if (value < boundsMin[axis]) boundsMin[axis] = value;
                if (value > boundsMax[axis]) boundsMax[axis] = value;
            }
        }
        this.boundsMin = boundsMin[0] === Infinity ? null : boundsMin;
        this.boundsMax = boundsMax[0] === -Infinity ? null : boundsMax;
        if (this.boundsMin && this.boundsMax) {
            this.boundsCenter = [
                (boundsMin[0] + boundsMax[0]) * 0.5,
                (boundsMin[1] + boundsMax[1]) * 0.5,
                (boundsMin[2] + boundsMax[2]) * 0.5
            ];
            let radiusSq = 0;
            for (const vertex of this.positions) {
                const dx = vertex[0] - this.boundsCenter[0], dy = vertex[1] - this.boundsCenter[1], dz = vertex[2] - this.boundsCenter[2];
                radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
            }
            this.boundsRadius = Math.sqrt(radiusSq);
        } else {
            this.boundsCenter = null;
            this.boundsRadius = 0;
        }
        this._boundsDirty = false;
    }

    weldNearbyVertices(faceIndex, vertexIndex, threshold = 0.08) {
        const sourceIndex = this.faces[faceIndex]?.[vertexIndex];
        const source = this.positions[sourceIndex];
        if (!source) return false;
        let nearestIndex = -1;
        let nearestDistance = threshold;
        this.positions.forEach((vertex, otherIndex) => {
            if (otherIndex === sourceIndex) return;
            const distance = Math.hypot(vertex[0] - source[0], vertex[1] - source[1], vertex[2] - source[2]);
            if (distance < nearestDistance) {
                nearestIndex = otherIndex;
                nearestDistance = distance;
            }
        });
        if (nearestIndex < 0) return false;
        const remapped = new Set();
        this.positions.forEach((vertex, index) => {
            if (index !== nearestIndex && Math.hypot(vertex[0] - source[0], vertex[1] - source[1], vertex[2] - source[2]) < threshold) remapped.add(index);
        });
        const targetSkin = this.vertexWeights.get(nearestIndex);
        remapped.forEach(index => {
            const skin = this.vertexWeights.get(index);
            if (skin) {
                if (!targetSkin) this.vertexWeights.set(nearestIndex, skin);
                else skin.weights.forEach((weight, bone) => targetSkin.weights.set(bone, Math.max(targetSkin.weights.get(bone) || 0, weight)));
                this.vertexWeights.delete(index);
            }
        });
        this.faces = this.faces.map(face => face.map(index => remapped.has(index) ? nearestIndex : index));
        this._compactTopology();
        this._refreshPolygonViews();
        this.rebuildRenderData();
        return true;
    }

    mergeNearbyVertices(faceIndex, vertexIndex, threshold = 0.08) {
        const sourceIndex = this.faces[faceIndex]?.[vertexIndex];
        const source = this.positions[sourceIndex];
        if (!source) return false;
        const connected = new Set();
        this.positions.forEach((vertex, index) => {
            if (Math.hypot(vertex[0] - source[0], vertex[1] - source[1], vertex[2] - source[2]) <= threshold) connected.add(vertex);
        });
        if (connected.size < 2) return false;
        const connectedIndices = new Set([...connected].map(vertex => this.getVertexIndex(vertex)));
        const merged = [...source].map((_, axis) => [...connected].reduce((sum, vertex) => sum + vertex[axis] / connected.size, 0));
        const skins = [...connectedIndices].map(index => this.vertexWeights.get(index)).filter(Boolean);
        const mergedIndex = this.positions.length;
        this.positions.push(merged);
        this.faces = this.faces.map(face => face.map(index => connectedIndices.has(index) ? mergedIndex : index));
        const weights = new Map();
        if (skins.length) {
            skins.forEach(skin => skin.weights.forEach((weight, bone) => weights.set(bone, (weights.get(bone) || 0) + weight / skins.length)));
        }
        connectedIndices.forEach(index => this.vertexWeights.delete(index));
        if (skins.length) this.vertexWeights.set(mergedIndex, { bindPosition: [...merged], weights });
        this._compactTopology();
        this._refreshPolygonViews();
        this.rebuildRenderData();
        return true;
    }

    mergeCoplanarFace(faceIndex, tolerance = 0.0001) {
        const polygonViews = this.polygons;
        const faceA = polygonViews[faceIndex];
        const frameA = this.getFaceFrame(faceIndex);
        if (!faceA || !frameA) return false;
        for (let otherIndex = 0; otherIndex < polygonViews.length; otherIndex++) {
            if (otherIndex === faceIndex) continue;
            const faceB = polygonViews[otherIndex];
            const frameB = this.getFaceFrame(otherIndex);
            if (!frameB || dot3(frameA.normal, frameB.normal) < 0.999) continue;
            if (!faceB.every(vertex => Math.abs(dot3(vertex.map((value, axis) => value - frameA.center[axis]), frameA.normal)) <= tolerance)) continue;
            if (!this.canMergeFaceData(faceIndex, otherIndex)) continue;

            const edges = [...makeFaceEdges(faceA, this.faceUvs[faceIndex]), ...makeFaceEdges(faceB, this.faceUvs[otherIndex])];
            const boundaryEdges = [];
            edges.forEach(edge => {
                const reverseIndex = boundaryEdges.findIndex(other => other.startKey === edge.endKey && other.endKey === edge.startKey);
                if (reverseIndex < 0) boundaryEdges.push(edge);
                else boundaryEdges.splice(reverseIndex, 1);
            });
            const boundary = stitchFaceEdges(boundaryEdges);
            if (!boundary || boundary.vertices.length < 3) continue;

            this.faces[faceIndex] = boundary.vertices.map(vertex => this.getVertexIndex(vertex));
            this.faceUvs[faceIndex] = boundary.uvs;
            this.faces.splice(otherIndex, 1);
            [this.faceColors, this.faceTextures, this.faceTextureIds, this.faceUvTransforms, this.faceUvs].forEach(values => values.splice(otherIndex, 1));
            this.selectedFace = otherIndex < faceIndex ? faceIndex - 1 : faceIndex;
            this._compactTopology();
            this._refreshPolygonViews();
            this.rebuildRenderData();
            return true;
        }
        return false;
    }

    canMergeFaceData(firstIndex, secondIndex) {
        const firstColor = this.faceColors[firstIndex] || [1, 1, 1, 1];
        const secondColor = this.faceColors[secondIndex] || [1, 1, 1, 1];
        const firstTransform = this.faceUvTransforms[firstIndex];
        const secondTransform = this.faceUvTransforms[secondIndex];
        return firstColor.length === secondColor.length
            && firstColor.every((value, index) => value === secondColor[index])
            && this.faceTextures[firstIndex] === this.faceTextures[secondIndex]
            && this.faceTextureIds[firstIndex] === this.faceTextureIds[secondIndex]
            && firstTransform.rotation === secondTransform.rotation
            && firstTransform.flipX === secondTransform.flipX
            && firstTransform.flipY === secondTransform.flipY
            && firstTransform.scale.every((value, axis) => value === secondTransform.scale[axis])
            && firstTransform.offset.every((value, axis) => value === secondTransform.offset[axis]);
    }

    updateBindVertex(vertex) {
        const vertexIndex = this.getVertexIndex(vertex);
        const skin = this.vertexWeights.get(vertexIndex);
        if (skin) skin.bindPosition = [...vertex];
    }

    _compactTopology() {
        const usedIndices = new Set(this.faces.flat());
        const remap = new Map();
        const positions = [];
        this.positions.forEach((position, index) => {
            if (!usedIndices.has(index)) return;
            remap.set(index, positions.length);
            positions.push(position);
        });
        const weights = new Map();
        this.vertexWeights.forEach((skin, index) => {
            if (remap.has(index)) weights.set(remap.get(index), skin);
        });
        this.faces = this.faces.map(face => face.map(index => remap.get(index)));
        this.positions = positions;
        this.vertexWeights = weights;
    }

    _buildStaticRenderData() {
        const faces = this.faces || [];
        let renderVertexCount = 0;
        let triangleIndexCount = 0;
        let wireIndexCount = 0;
        for (const face of faces) {
            const n = face?.length || 0;
            renderVertexCount += n;
            triangleIndexCount += Math.max(0, n - 2) * 3;
            wireIndexCount += n * 2;
        }

        const vertices = new Float32Array(renderVertexCount * 3);
        const normals = new Float32Array(renderVertexCount * 3);
        const colors = new Float32Array(renderVertexCount * 3);
        const uvs = new Float32Array(renderVertexCount * 2);
        const IndexArray = renderVertexCount > 65535 ? Uint32Array : Uint16Array;
        const indices = new IndexArray(triangleIndexCount);
        const wireframeIndices = new IndexArray(wireIndexCount);
        this.faceRanges = new Array(faces.length);

        let vertexCursor = 0;
        let triangleCursor = 0;
        let wireCursor = 0;
        const boundsMin = [Infinity, Infinity, Infinity];
        const boundsMax = [-Infinity, -Infinity, -Infinity];

        for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
            const face = faces[faceIndex];
            const n = face?.length || 0;
            const rangeOffset = triangleCursor;
            if (n >= 3) {
                const p0 = this.positions[face[0]];
                const p1 = this.positions[face[1]];
                const p2 = this.positions[face[2]];
                const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
                const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
                let nx = ay * bz - az * by;
                let ny = az * bx - ax * bz;
                let nz = ax * by - ay * bx;
                const normalLength = Math.hypot(nx, ny, nz);
                if (normalLength > 1e-8) {
                    nx /= normalLength; ny /= normalLength; nz /= normalLength;
                } else {
                    nx = 0; ny = 1; nz = 0;
                }
                const color = this.faceColors[faceIndex] || [1, 1, 1, 1];
                const vStart = vertexCursor;
                for (let corner = 0; corner < n; corner++) {
                    const position = this.positions[face[corner]] || [0, 0, 0];
                    vertices[vertexCursor * 3] = position[0];
                    vertices[vertexCursor * 3 + 1] = position[1];
                    vertices[vertexCursor * 3 + 2] = position[2];
                    normals[vertexCursor * 3] = nx;
                    normals[vertexCursor * 3 + 1] = ny;
                    normals[vertexCursor * 3 + 2] = nz;
                    colors[vertexCursor * 3] = color[0] ?? 1;
                    colors[vertexCursor * 3 + 1] = color[1] ?? 1;
                    colors[vertexCursor * 3 + 2] = color[2] ?? 1;
                    uvs[vertexCursor * 2] = 0;
                    uvs[vertexCursor * 2 + 1] = 0;
                    for (let axis = 0; axis < 3; axis++) {
                        const value = Number(position[axis]) || 0;
                        if (value < boundsMin[axis]) boundsMin[axis] = value;
                        if (value > boundsMax[axis]) boundsMax[axis] = value;
                    }
                    vertexCursor++;
                }
                for (let corner = 1; corner < n - 1; corner++) {
                    indices[triangleCursor++] = vStart;
                    indices[triangleCursor++] = vStart + corner;
                    indices[triangleCursor++] = vStart + corner + 1;
                }
                for (let corner = 0; corner < n; corner++) {
                    wireframeIndices[wireCursor++] = vStart + corner;
                    wireframeIndices[wireCursor++] = vStart + ((corner + 1) % n);
                }
            }
            this.faceRanges[faceIndex] = { offset: rangeOffset, count: Math.max(0, n - 2) * 3 };
        }

        this.vertices = vertices;
        this.normals = normals;
        this.colors = colors;
        this.uvs = uvs;
        this.indices = indices;
        this.wireframeIndices = wireframeIndices;
        this.indexType = IndexArray === Uint32Array ? 'UNSIGNED_INT' : 'UNSIGNED_SHORT';
        this.indexBytes = IndexArray === Uint32Array ? 4 : 2;
        this.indexType = IndexArray === Uint32Array ? 'UNSIGNED_INT' : 'UNSIGNED_SHORT';
        this.indexBytes = IndexArray === Uint32Array ? 4 : 2;
        this.triangleCount = triangleIndexCount / 3;
        this.boundsMin = boundsMin[0] === Infinity ? null : boundsMin;
        this.boundsMax = boundsMax[0] === -Infinity ? null : boundsMax;
        if (this.boundsMin && this.boundsMax) {
            this.boundsCenter = [
                (this.boundsMin[0] + this.boundsMax[0]) * 0.5,
                (this.boundsMin[1] + this.boundsMax[1]) * 0.5,
                (this.boundsMin[2] + this.boundsMax[2]) * 0.5
            ];
            let radiusSq = 0;
            for (const position of this.positions) {
                const dx = position[0] - this.boundsCenter[0];
                const dy = position[1] - this.boundsCenter[1];
                const dz = position[2] - this.boundsCenter[2];
                radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
            }
            this.boundsRadius = Math.sqrt(radiusSq);
        } else {
            this.boundsCenter = null;
            this.boundsRadius = 0;
        }
        this.geometrySignature = `static:${renderVertexCount}:${triangleIndexCount}:${this.faceCount}`;
        this.renderVertexSharedIndices = [];
        this.renderVertexOffsetsByShared = Array.from({ length: this.positions.length }, () => []);
        this.renderVertexFaceIndex = [];
        this.faceVertexRanges = new Array(faces.length);
        let staticCursor = 0;
        for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
            const face = faces[faceIndex] || [];
            this.faceVertexRanges[faceIndex] = { start: staticCursor, count: face.length };
            face.forEach(sharedIndex => {
                this.renderVertexSharedIndices.push(sharedIndex);
                this.renderVertexOffsetsByShared[sharedIndex]?.push(staticCursor);
                this.renderVertexFaceIndex.push(faceIndex);
                staticCursor++;
            });
        }
        this.renderStateVersion++;
        this.renderDataRevision = (this.renderDataRevision || 0) + 1;
        this.bakedFaceColorsRevision = this.renderDataRevision;
        this.instanceBatchKey = null;
        this.drawBatchCache = new WeakMap();
        this.shadowedFaces = [];
        this.shadowedFaceCount = 0;
        return true;
    }

    rebuildRenderData({ buildEditorData = !this.lazyTopology } = {}) {
        if (!this._legacyViewExposed && !this.dirtyFlags.geometry && !this.dirtyFlags.uvs) return false;
        if (this._legacyViewExposed) this._syncTopologyFromPolygonViews();

        let cornerCount = 0;
        let triangleIndexCount = 0;
        for (const face of this.faces) {
            const count = face?.length || 0;
            cornerCount += count;
            triangleIndexCount += Math.max(0, count - 2) * 3;
        }
        const vertices = new Float32Array(cornerCount * 3);
        const normals = new Float32Array(cornerCount * 3);
        const colors = new Float32Array(cornerCount * 3);
        const uvs = new Float32Array(cornerCount * 2);
        const IndexArray = cornerCount > 65535 ? Uint32Array : Uint16Array;
        const indices = new IndexArray(triangleIndexCount);
        const wireframeIndices = new IndexArray(cornerCount * 2);
        this.faceRanges = new Array(this.faces.length);
        this.faceVertexRanges = buildEditorData ? new Array(this.faces.length) : [];
        const renderVertexSharedIndices = buildEditorData ? new Array(cornerCount) : null;
        const renderVertexOffsetsByShared = buildEditorData ? Array.from({ length: this.positions.length }, () => []) : [];
        const renderVertexFaceIndex = buildEditorData ? new Array(cornerCount) : null;
        let vertexCursor = 0, indexCursor = 0, wireCursor = 0;
        for (let faceIndex = 0; faceIndex < this.faces.length; faceIndex++) {
            const face = this.faces[faceIndex] || [];
            const vertexStart = vertexCursor / 3;
            const first = face[0];
            const second = face[1];
            const third = face[2];
            const p0 = this.positions[first] || [0, 0, 0];
            const p1 = this.positions[second] || p0;
            const p2 = this.positions[third] || p0;
            const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
            const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
            let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            const nlen = Math.hypot(nx, ny, nz);
            if (nlen > 1e-8) { nx /= nlen; ny /= nlen; nz /= nlen; } else { nx = 0; ny = 1; nz = 0; }
            let faceUvs = this.faceUvs[faceIndex];
            if (!faceUvs) { this.faceUvs[faceIndex] = []; faceUvs = this.faceUvs[faceIndex]; }
            const faceColor = this.faceColors[faceIndex] || [1, 1, 1, 1];
            for (let corner = 0; corner < face.length; corner++) {
                const sharedIndex = face[corner];
                const vertex = this.positions[sharedIndex] || [0, 0, 0];
                vertices[vertexCursor++] = vertex[0] || 0;
                vertices[vertexCursor++] = vertex[1] || 0;
                vertices[vertexCursor++] = vertex[2] || 0;
                normals[vertexCursor - 3] = nx; normals[vertexCursor - 2] = ny; normals[vertexCursor - 1] = nz;
                if (this.bakeFaceColors) {
                    colors[(vertexCursor - 3) / 3 * 3] = faceColor[0] ?? 1;
                    colors[(vertexCursor - 3) / 3 * 3 + 1] = faceColor[1] ?? 1;
                    colors[(vertexCursor - 3) / 3 * 3 + 2] = faceColor[2] ?? 1;
                } else {
                    colors[(vertexCursor - 3) / 3 * 3] = 1; colors[(vertexCursor - 3) / 3 * 3 + 1] = 1; colors[(vertexCursor - 3) / 3 * 3 + 2] = 1;
                }
                const uv = faceUvs[corner] || defaultFaceUV(faceIndex, corner, face.length || 1);
                if (!faceUvs[corner]) faceUvs[corner] = uv;
                const uvBase = ((vertexCursor / 3) - 1) * 2;
                uvs[uvBase] = uv[0] ?? 0; uvs[uvBase + 1] = uv[1] ?? 0;
                const renderIndex = (vertexCursor / 3) - 1;
                if (buildEditorData) {
                    renderVertexSharedIndices[renderIndex] = sharedIndex;
                    renderVertexOffsetsByShared[sharedIndex]?.push(renderIndex);
                    renderVertexFaceIndex[renderIndex] = faceIndex;
                }
            }
            for (let corner = 1; corner < face.length - 1; corner++) {
                indices[indexCursor++] = vertexStart;
                indices[indexCursor++] = vertexStart + corner;
                indices[indexCursor++] = vertexStart + corner + 1;
            }
            for (let corner = 0; corner < face.length; corner++) {
                wireframeIndices[wireCursor++] = vertexStart + corner;
                wireframeIndices[wireCursor++] = vertexStart + ((corner + 1) % face.length);
            }
            this.faceRanges[faceIndex] = { offset: indexCursor - Math.max(0, face.length - 2) * 3, count: Math.max(0, face.length - 2) * 3 };
            if (buildEditorData) this.faceVertexRanges[faceIndex] = { start: vertexStart, count: face.length };
        }
        this.vertices = vertices;
        this.normals = normals;
        this.colors = colors;
        this.uvs = uvs;
        this.indices = indices;
        this.wireframeIndices = wireframeIndices;
        this.renderVertexSharedIndices = renderVertexSharedIndices;
        this.renderVertexOffsetsByShared = renderVertexOffsetsByShared;
        this.renderVertexFaceIndex = renderVertexFaceIndex;
        this.triangleCount = triangleIndexCount / 3;
        if (buildEditorData) this._rebuildTopologyAdjacency();
        if (this._boundsDirty || !this.boundsMin) this.refreshBounds();
        this.geometrySignature = hashGeometry(this.vertices, this.indices);
        this.faceCount = this.faces.length;
        this.allFaceIndices = Array.from({ length: this.faceCount }, (_, faceIndex) => faceIndex);
        while (this.faceColors.length < this.faceCount) this.faceColors.push([1, 1, 1, 1]);
        while (this.faceTextures.length < this.faceCount) this.faceTextures.push(null);
        while (this.faceTextureIds.length < this.faceCount) this.faceTextureIds.push(null);
        while (this.faceUvTransforms.length < this.faceCount) this.faceUvTransforms.push({ scale: [1, 1], offset: [0, 0], rotation: 0, flipX: false, flipY: false });
        this.updateRenderQueues();
        if (this.vao) this.invalidateBuffers();
        this.dirtyFlags.geometry = false;
        this.dirtyFlags.uvs = false;
        this.renderDataRevision = (this.renderDataRevision || 0) + 1;
        this._pendingGpuRanges.length = 0;
        if (!this.lazyTopology) this._refreshPolygonViews();
        this._boundsDirty = false;
        return true;
    }

    invalidateBuffers() {
        this.vao = null;
        this.positionBuffer = null;
        this.normalBuffer = null;
        this.colorBuffer = null;
        this.uvBuffer = null;
        this.indexType = null;
        this.indexBytes = 2;
    }

    initBuffers(gl, program) {
        if (this.vao) return;
        this.vaoExtension = gl.createVertexArray ? null : gl.getExtension('OES_vertex_array_object');
        if (!gl.createVertexArray && !this.vaoExtension) {
            throw new Error('Vertex array objects are not supported');
        }

        this.vao = gl.createVertexArray
            ? gl.createVertexArray()
            : this.vaoExtension.createVertexArrayOES();
        if (gl.createVertexArray) {
            gl.bindVertexArray(this.vao);
        } else {
            this.vaoExtension.bindVertexArrayOES(this.vao);
        }

        const aPos = gl.getAttribLocation(program, 'aPosition');
        const aNormal = gl.getAttribLocation(program, 'aNormal');
        const aColor = gl.getAttribLocation(program, 'aColor');
        const aUV = gl.getAttribLocation(program, 'aUV');

        const vbo = gl.createBuffer();
        this.positionBuffer = vbo;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        this.normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aNormal);
        gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

        const cbo = gl.createBuffer();
        this.colorBuffer = cbo;
        gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aColor);
        gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

        const ubo = gl.createBuffer();
        this.uvBuffer = ubo;
        gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
        gl.bufferData(gl.ARRAY_BUFFER, this.uvs, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aUV);
        gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        const IndexArray = this.indices instanceof Uint32Array ? Uint32Array : Uint16Array;
        if (IndexArray === Uint32Array && !gl.getExtension('OES_element_index_uint')) {
            throw new Error('This mesh needs 32-bit element indices, but this WebGL context does not support OES_element_index_uint.');
        }
        const elementIndices = new IndexArray(this.indices.length + this.wireframeIndices.length);
        elementIndices.set(this.indices);
        elementIndices.set(this.wireframeIndices, this.indices.length);
        this.indexType = IndexArray === Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        this.indexBytes = IndexArray === Uint32Array ? 4 : 2;
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, elementIndices, gl.STATIC_DRAW);

        if (gl.createVertexArray) {
            gl.bindVertexArray(null);
        } else {
            this.vaoExtension.bindVertexArrayOES(null);
        }
    }

    getModelMatrix() {
        // Cache matrix; only recompute when transform changes.
        if (!this._modelMatrixCache) this._modelMatrixCache = new Float32Array(16);
        if (this._modelMatrixCacheRevision === this.transformRevision && this._cachedPos &&
            this._cachedPos[0] === this.position[0] && this._cachedPos[1] === this.position[1] && this._cachedPos[2] === this.position[2] &&
            this._cachedRot && this._cachedRot[0] === this.rotation[0] && this._cachedRot[1] === this.rotation[1] && this._cachedRot[2] === this.rotation[2] &&
            this._cachedScale && this._cachedScale[0] === this.scale[0] && this._cachedScale[1] === this.scale[1] && this._cachedScale[2] === this.scale[2]) {
            return this._modelMatrixCache;
        }
        const out = this._modelMatrixCache;
        const [x, y, z] = this.rotation;
        const [sx, sy, sz] = this.scale;
        const cx = Math.cos(x), sxr = Math.sin(x);
        const cy = Math.cos(y), syr = Math.sin(y);
        const cz = Math.cos(z), szr = Math.sin(z);
        const r00 = cy * cz;
        const r01 = cy * szr;
        const r02 = -syr;
        const r10 = sxr * syr * cz - cx * szr;
        const r11 = sxr * syr * szr + cx * cz;
        const r12 = sxr * cy;
        const r20 = cx * syr * cz + sxr * szr;
        const r21 = cx * syr * szr - sxr * cz;
        const r22 = cx * cy;
        out[0] = r00 * sx; out[1] = r10 * sx; out[2] = r20 * sx; out[3] = 0;
        out[4] = r01 * sy; out[5] = r11 * sy; out[6] = r21 * sy; out[7] = 0;
        out[8] = r02 * sz; out[9] = r12 * sz; out[10] = r22 * sz; out[11] = 0;
        out[12] = this.position[0]; out[13] = this.position[1]; out[14] = this.position[2]; out[15] = 1;
        this._modelMatrixCacheRevision = this.transformRevision || 0;
        this._cachedPos = [...this.position];
        this._cachedRot = [...this.rotation];
        this._cachedScale = [...this.scale];
        return out;
    }

    invalidateTransformCache() {
        this.transformRevision = (this.transformRevision || 0) + 1;
        this._modelMatrixCacheRevision = -1;
    }

    draw(gl, program, faceIndices = null, frameToken = undefined, renderMode = 'anime', stats = null) {
        this.initBuffers(gl, program);
        this.flushPendingGeometry(gl);
        this.refreshBounds();

        if (gl.createVertexArray) {
            gl.bindVertexArray(this.vao);
        } else {
            this.vaoExtension.bindVertexArrayOES(this.vao);
        }

        const uniforms = this.getUniformLocations(gl, program);
        gl.uniformMatrix4fv(uniforms.uModel, false, this.getModelMatrix());
        gl.uniform1f(uniforms.uInstanced, 0);
        gl.uniform1f(uniforms.uToonShading, renderMode === 'anime' && this.material.shading === 'toon' ? 1 : 0);
        if (this.vertexWeights.size || this.skinningSignature) this.updateSkinningBuffers(gl);
        else this.dirtyFlags.skeletonPose = false;
        if (renderMode === 'wireframe') {
            const color = this.material.color;
            gl.uniform4fv(uniforms.uColor, new Float32Array([color[0], color[1], color[2], color[3] ?? 1]));
            gl.uniform1i(uniforms.uUseTexture, 0);
            gl.uniform1f(uniforms.uRayShadowed, 0);
            gl.uniform1f(uniforms.uFaceSelected, 0);
            gl.drawElements(gl.LINES, this.wireframeIndices.length, this.indexType, this.indices.byteLength);
            if (stats) stats.drawCalls++;
            if (gl.createVertexArray) gl.bindVertexArray(null);
            else this.vaoExtension.bindVertexArrayOES(null);
            return;
        }
        const fastBakedColorPath = this.bakeFaceColors && !this.material.useTexture &&
            this.selectedFace < 0 && this.shadowedFaceCount === 0 &&
            (!faceIndices || faceIndices === this.allFaceIndices || (faceIndices === this.opaqueFaceIndices && this.opaqueFaceIndices.length === this.faceCount));
        if (fastBakedColorPath) {
            gl.uniform4f(uniforms.uColor, 1, 1, 1, 1);
            gl.uniform1i(uniforms.uUseTexture, 0);
            gl.uniform1f(uniforms.uFaceSelected, 0);
            gl.uniform1f(uniforms.uRayShadowed, 0);
            gl.uniform4f(uniforms.uUVTransform, 1, 1, 0, 0);
            gl.uniform1f(uniforms.uUVRotation, 0);
            gl.uniform2f(uniforms.uUVCenter, 0.5, 0.5);
            gl.drawElements(gl.TRIANGLES, this.indices.length, this.indexType, 0);
            if (stats) {
                stats.drawCalls++;
                stats.triangles += this.triangleCount;
            }
            if (gl.createVertexArray) gl.bindVertexArray(null);
            else this.vaoExtension.bindVertexArrayOES(null);
            return;
        }
        const batches = this.getDrawBatches(faceIndices || this.allFaceIndices);
        let batchOffset = 0;
        let batchCount = 0;
        let batchColor = null;
        let batchTexture = null;
        let batchTransform = null;
        let batchUvCenter = null;
        let batchSelected = false;
        let batchShadowed = false;
        let batchUvCenterRelevant = false;
        let previousTexture = undefined;
        const flushBatch = () => {
            if (!batchCount) return;
            gl.uniform4fv(uniforms.uColor, batchColor);
            const texture = renderMode === 'solid' ? null : batchTexture;
            gl.uniform1i(uniforms.uUseTexture, texture ? 1 : 0);
            gl.uniform1f(uniforms.uFaceSelected, batchSelected ? 1 : 0);
            gl.uniform1f(uniforms.uRayShadowed, batchShadowed ? 1 : 0);
            gl.uniform4f(uniforms.uUVTransform, batchTransform.scale[0] * (batchTransform.flipX ? -1 : 1), batchTransform.scale[1] * (batchTransform.flipY ? -1 : 1), batchTransform.offset[0], batchTransform.offset[1]);
            gl.uniform1f(uniforms.uUVRotation, batchTransform.rotation);
            gl.uniform2f(uniforms.uUVCenter, batchUvCenter[0], batchUvCenter[1]);
            if (texture !== previousTexture && texture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.uniform1i(uniforms.uTexture, 0);
                previousTexture = texture;
            }
            gl.drawElements(gl.TRIANGLES, batchCount, this.indexType, batchOffset * this.indexBytes);
            if (stats) {
                stats.drawCalls++;
                stats.triangles += batchCount / 3;
            }
        };
        for (const batch of batches) {
            batchOffset = batch.offset;
            batchCount = batch.count;
            batchColor = batch.color;
            batchTexture = batch.texture;
            batchTransform = batch.transform;
            batchUvCenter = batch.uvCenter;
            batchSelected = batch.selected;
            batchShadowed = batch.shadowed;
            batchUvCenterRelevant = batch.uvCenterRelevant;
            flushBatch();
        }

        if (gl.createVertexArray) {
            gl.bindVertexArray(null);
        } else {
            this.vaoExtension.bindVertexArrayOES(null);
        }
    }

    getDrawBatches(faceIndices) {
        const cached = this.drawBatchCache.get(faceIndices);
        if (cached && cached.version === this.renderStateVersion && cached.selectedFace === this.selectedFace && cached.shadowVersion === this.shadowVersion) return cached.batches;
        const batches = [];
        let current = null;
        for (const faceIndex of faceIndices) {
            const color = this.faceColors[faceIndex] || this.material.color;
            const texture = this.faceTextures[faceIndex] || (this.material.useTexture ? this.material.texture : null);
            const transform = this.faceUvTransforms[faceIndex];
            const uvCenterRelevant = transform.rotation !== 0 || transform.scale[0] !== 1 || transform.scale[1] !== 1 || transform.flipX || transform.flipY;
            let uvCenter = DEFAULT_UV_CENTER;
            if (uvCenterRelevant) {
                const faceUvs = this.faceUvs[faceIndex] || [];
                if (faceUvs.length) {
                    let centerU = 0;
                    let centerV = 0;
                    for (let uvIndex = 0; uvIndex < faceUvs.length; uvIndex++) {
                        centerU += faceUvs[uvIndex][0];
                        centerV += faceUvs[uvIndex][1];
                    }
                    uvCenter = [centerU / faceUvs.length, centerV / faceUvs.length];
                }
            }
            const range = this.faceRanges[faceIndex];
            const selected = this.selectedFace === faceIndex;
            const shadowed = !!this.shadowedFaces[faceIndex];
            const batchColor = [color[0], color[1], color[2], color[3] ?? 1];
            if (current && current.offset + current.count === range.offset && sameFaceState(current, texture, batchColor, transform, uvCenter, uvCenterRelevant, selected, shadowed)) {
                current.count += range.count;
            } else {
                current = { offset: range.offset, count: range.count, color: batchColor, texture, transform, uvCenter, uvCenterRelevant, selected, shadowed };
                batches.push(current);
            }
        }
        this.drawBatchCache.set(faceIndices, { version: this.renderStateVersion, selectedFace: this.selectedFace, shadowVersion: this.shadowVersion, batches });
        return batches;
    }

    getUniformLocations(gl, program) {
        if (this.uniformProgram !== program) {
            this.uniformProgram = program;
            this.uniformLocations = {
                uModel: gl.getUniformLocation(program, 'uModel'),
                uColor: gl.getUniformLocation(program, 'uColor'),
                uUseTexture: gl.getUniformLocation(program, 'uUseTexture'),
                uTexture: gl.getUniformLocation(program, 'uTexture'),
                uUVTransform: gl.getUniformLocation(program, 'uUVTransform'),
                uUVRotation: gl.getUniformLocation(program, 'uUVRotation'),
                uUVCenter: gl.getUniformLocation(program, 'uUVCenter'),
                uFaceSelected: gl.getUniformLocation(program, 'uFaceSelected'),
                uRayShadowed: gl.getUniformLocation(program, 'uRayShadowed'),
                uToonShading: gl.getUniformLocation(program, 'uToonShading'),
                uInstanced: gl.getUniformLocation(program, 'uInstanced')
            };
        }
        return this.uniformLocations;
    }

    updateGeometry(gl) {
        if (!this.vao) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.normals, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.uvs, gl.STATIC_DRAW);
    }
}

const DEFAULT_UV_CENTER = [0.5, 0.5];

function observeTransformArray(value, onChange) {
    const target = Array.isArray(value) ? [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0] : [0, 0, 0];
    return new Proxy(target, {
        set(array, property, next, receiver) {
            const result = Reflect.set(array, property, Number(next) || 0, receiver);
            onChange();
            return result;
        }
    });
}

function observeArrays(value, onChange) {
    return Array.isArray(value) ? observeArray(value, onChange) : value;
}

function observeArray(value, onChange) {
    const wrap = entry => {
        if (Array.isArray(entry)) return observeArray(entry, onChange);
        if (!entry || Object.getPrototypeOf(entry) !== Object.prototype) return entry;
        const object = Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, wrap(child)]));
        return new Proxy(object, {
            set(target, property, next, receiver) {
                onChange();
                return Reflect.set(target, property, wrap(next), receiver);
            },
            deleteProperty(target, property) {
                onChange();
                return Reflect.deleteProperty(target, property);
            }
        });
    };
    const target = value.map(wrap);
    return new Proxy(target, {
        set(array, property, next, receiver) {
            onChange();
            return Reflect.set(array, property, wrap(next), receiver);
        },
        deleteProperty(array, property) {
            onChange();
            return Reflect.deleteProperty(array, property);
        }
    });
}

function projectToPlane(point, center, normal) {
    const vector = point.map((value, axis) => value - center[axis]);
    const projection = dot3(vector, normal);
    return point.map((value, axis) => value - normal[axis] * projection);
}

function segmentToSegmentIntersection(a, b, c, d) {
    const ab = a.map((value, axis) => b[axis] - value);
    const cd = c.map((value, axis) => d[axis] - value);
    const denom = dot3(cross3(ab, cd), cross3(ab, cd));
    if (denom < 1e-8) return null;
    const n = cross3(ab, cd);
    const t = dot3(cross3(c.map((value, axis) => value - a[axis]), cd), n) / denom;
    if (!Number.isFinite(t) || t < 0 || t > 1) return null;
    return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

function hashGeometry(vertices, indices) {
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (let index = 0; index < vertices.length; index++) {
        const value = Math.round(vertices[index] * 1e6);
        first = Math.imul(first ^ value, 16777619);
        second = Math.imul(second ^ (value + index), 2246822519);
    }
    for (let index = 0; index < indices.length; index++) {
        const value = indices[index];
        first = Math.imul(first ^ value, 16777619);
        second = Math.imul(second ^ (value + index), 2246822519);
    }
    return `${vertices.length}:${indices.length}:${first >>> 0}:${second >>> 0}`;
}

function sameFaceState(batch, texture, color, transform, uvCenter, uvCenterRelevant, selected, shadowed) {
    return batch.texture === texture
        && batch.selected === selected
        && batch.shadowed === shadowed
        && batch.color[0] === color[0]
        && batch.color[1] === color[1]
        && batch.color[2] === color[2]
        && batch.color[3] === color[3]
        && batch.transform.rotation === transform.rotation
        && batch.transform.flipX === transform.flipX
        && batch.transform.flipY === transform.flipY
        && batch.transform.scale[0] === transform.scale[0]
        && batch.transform.scale[1] === transform.scale[1]
        && batch.transform.offset[0] === transform.offset[0]
        && batch.transform.offset[1] === transform.offset[1]
        && batch.uvCenterRelevant === uvCenterRelevant
        && (!uvCenterRelevant || (batch.uvCenter[0] === uvCenter[0] && batch.uvCenter[1] === uvCenter[1]));
}

function mergeRanges(ranges) {
    if (!ranges.length) return [];
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [start, count] of sorted) {
        const end = start + count;
        const last = merged[merged.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged;
}

function defaultFaceUV(faceIndex, vertexIndex, faceCount) {
    const columns = Math.ceil(Math.sqrt(faceCount));
    const rows = Math.ceil(faceCount / columns);
    const tileX = faceIndex % columns;
    const tileY = Math.floor(faceIndex / columns);
    const local = [[0, 0], [1, 0], [1, 1], [0, 1]][vertexIndex % 4];
    return [(tileX + local[0]) / columns, (tileY + local[1]) / rows];
}

function dot3(a, b) {
    return a.reduce((sum, value, axis) => sum + value * b[axis], 0);
}

function rotate3(matrix, vector) {
    return matrix.map(row => row.reduce((sum, value, axis) => sum + value * vector[axis], 0));
}

function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(vector) {
    const length = Math.hypot(...vector);
    return length > 1e-10 ? vector.map(value => value / length) : null;
}

function deformPoint(skin, poseTransforms, bindTransforms) {
    const totalWeight = [...skin.weights.values()].reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 1e-8) return [...skin.bindPosition];
    const result = [0, 0, 0];
    const normalization = totalWeight > 1 ? 1 / totalWeight : 1;
    skin.weights.forEach((weight, bone) => {
        const pose = poseTransforms.get(bone);
        const bind = bindTransforms.get(bone);
        if (!pose || !bind) return;
        const fromBind = skin.bindPosition.map((value, axis) => value - bind.position[axis]);
        const local = bind.rotation[0].map((_, column) => bind.rotation.reduce((sum, row, index) => sum + row[column] * fromBind[index], 0))
            .map((value, axis) => Math.abs(bind.scale[axis]) > 1e-8 ? value / bind.scale[axis] : value);
        const scaledLocal = local.map((value, axis) => value * pose.scale[axis]);
        const world = pose.position.map((value, axis) => value + pose.rotation[axis].reduce((sum, component, index) => sum + component * scaledLocal[index], 0));
        world.forEach((value, axis) => { result[axis] += value * weight * normalization; });
    });
    if (totalWeight < 1) skin.bindPosition.forEach((value, axis) => { result[axis] += value * (1 - totalWeight); });
    return result;
}

function makeFaceEdges(vertices, uvs) {
    return vertices.map((start, index) => {
        const endIndex = (index + 1) % vertices.length;
        const end = vertices[endIndex];
        return {
            start,
            end,
            uv: [...uvs[index]],
            startKey: start.join(','),
            endKey: end.join(',')
        };
    });
}

function stitchFaceEdges(edges) {
    if (!edges.length) return null;
    const remaining = [...edges];
    const first = remaining.shift();
    const vertices = [first.start];
    const uvs = [first.uv];
    const startKey = first.startKey;
    let currentKey = first.endKey;
    let guard = edges.length;
    while (currentKey !== startKey && guard-- > 0) {
        const edgeIndex = remaining.findIndex(edge => edge.startKey === currentKey);
        if (edgeIndex < 0) return null;
        const edge = remaining.splice(edgeIndex, 1)[0];
        vertices.push(edge.start);
        uvs.push(edge.uv);
        currentKey = edge.endKey;
    }
    return currentKey === startKey && remaining.length === 0 ? { vertices, uvs } : null;
}
