// Runtime-only static geometry batches. Editor meshes remain separate objects.
// Batches are rebuilt only when scene geometry changes, and are spatially split
// so frustum culling remains useful on large maps.

import { SpatialGrid } from './spatialGrid.js';

const MAX_BATCH_VERTICES = 60000;

export class StaticBatchManager {
    constructor(gl, program, uniforms) {
        this.gl = gl;
        this.program = program;
        this.uniforms = uniforms;
        this.batches = [];
        this.batchedMeshes = new Set();
        this.dynamicMeshes = [];
        this.revision = -1;
        this.selectionKey = '';
        this.cellSize = 64;
        this.spatialIndex = new SpatialGrid({ cellSize: this.cellSize, maxCellsPerObject: 256 });
        this._spatialCandidates = [];
        this._nextId = 1;
        this._textureIds = new WeakMap();
        this._nextTextureId = 1;
    }

    dispose() {
        const gl = this.gl;
        for (const batch of this.batches) {
            for (const buffer of batch.buffers) gl.deleteBuffer(buffer);
            if (batch.vao) {
                if (gl.deleteVertexArray) gl.deleteVertexArray(batch.vao);
                else this._vaoExtension?.deleteVertexArrayOES(batch.vao);
            }
        }
        this.batches.length = 0;
        this.spatialIndex.clear();
        this.batchedMeshes.clear();
        this.dynamicMeshes.length = 0;
        this.revision = -1;
    }

    canBatch(mesh, selected) {
        if (!mesh || selected?.has(mesh)) return false;
        if (mesh.skeleton?.bones?.length || mesh.vertexWeights?.size) return false;
        if (mesh.animationPlayer?.playing) return false;
        if ((mesh.material?.opacity ?? 1) < 0.999) return false;
        if (mesh.transparentFaceIndices?.length) return false;
        if (mesh.selectedFace >= 0 || mesh.selectedBone != null) return false;
        if (!mesh.vertices?.length || !mesh.indices?.length) return false;
        if (!mesh.bakeFaceColors) return false;
        if (mesh.dirtyFlags?.geometry || mesh.dirtyFlags?.uvs) return false;
        if (!this._hasBatchCompatibleUVTransform(mesh)) return false;
        if (mesh.vertices.length / 3 > MAX_BATCH_VERTICES) return false;
        const texture = this._getSingleTexture(mesh);
        if (texture === MIXED_TEXTURE) return false;
        return true;
    }

    build(scene, selected = new Set()) {
        this.dispose();
        const groups = new Map();
        for (const mesh of scene.meshes) {
            mesh._renderStaticBatchExcluded = !this.canBatch(mesh, selected);
            if (mesh._renderStaticBatchExcluded) {
                this.dynamicMeshes.push(mesh);
                continue;
            }
            const center = mesh.boundsCenter || [0, 0, 0];
            const world = transformPoint(mesh.getModelMatrix(), center);
            const cellX = Math.floor(world[0] / this.cellSize);
            const cellY = Math.floor(world[1] / this.cellSize);
            const cellZ = Math.floor(world[2] / this.cellSize);
            const material = mesh.material || {};
            const texture = this._getSingleTexture(mesh);
            const textureId = texture ? this._getTextureId(texture) : 0;
            const key = `${cellX}|${cellY}|${cellZ}|${material.shading || 'flat'}|${material.doubleSided ? 1 : 0}|${textureId}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    meshes: [],
                    cell: [cellX, cellY, cellZ],
                    shading: material.shading || 'flat',
                    doubleSided: !!material.doubleSided,
                    texture: texture || null
                };
                groups.set(key, group);
            }
            group.meshes.push(mesh);
            this.batchedMeshes.add(mesh);
        }

        for (const group of groups.values()) this._buildGroup(group);
        this.spatialIndex.rebuild(this.batches, batch => ({ x: batch.boundsCenter[0], y: batch.boundsCenter[1], z: batch.boundsCenter[2], r: batch.boundsRadius }));
        this.revision = scene.renderRevision;
        this.selectionKey = selectionKey(selected);
        return this.batches;
    }

    queryCandidates(camera) {
        const far = Math.max(1, Number(camera?.far) || 1000);
        const margin = this.cellSize * 1.75;
        return this.spatialIndex.querySphere(
            camera.position[0], camera.position[1], camera.position[2], far + margin,
            this._spatialCandidates
        );
    }

    _hasBatchCompatibleUVTransform(mesh) {
        const transforms = mesh.faceUvTransforms;
        if (!transforms?.length) return true;
        for (const transform of transforms) {
            if (!transform) continue;
            if ((transform.scale?.[0] ?? 1) !== 1 || (transform.scale?.[1] ?? 1) !== 1) return false;
            if ((transform.offset?.[0] ?? 0) !== 0 || (transform.offset?.[1] ?? 0) !== 0) return false;
            if ((transform.rotation ?? 0) !== 0 || transform.flipX || transform.flipY) return false;
        }
        return true;
    }

    _getSingleTexture(mesh) {
        const materialTexture = mesh.material?.texture || null;
        const faceTextures = mesh.faceTextures;
        if (!materialTexture && (!faceTextures || !faceTextures.some(Boolean))) return null;
        let found = materialTexture || null;
        if (faceTextures?.length) {
            for (let i = 0; i < faceTextures.length; i++) {
                const texture = faceTextures[i] || null;
                if (!texture) continue;
                if (!found) found = texture;
                else if (texture !== found) return MIXED_TEXTURE;
            }
        }
        return found;
    }

    _getTextureId(texture) {
        if (!texture || (typeof texture !== 'object' && typeof texture !== 'function')) return 0;
        let id = this._textureIds.get(texture);
        if (!id) {
            id = this._nextTextureId++;
            this._textureIds.set(texture, id);
        }
        return id;
    }

    _buildGroup(group) {
        let currentMeshes = [];
        let vertexCount = 0;
        let indexCount = 0;

        const flush = () => {
            if (!currentMeshes.length || !vertexCount || !indexCount) return;

            const positions = new Float32Array(vertexCount * 3);
            const normals = new Float32Array(vertexCount * 3);
            const colors = new Float32Array(vertexCount * 3);
            const uvs = new Float32Array(vertexCount * 2);
            const indices = new Uint16Array(indexCount);

            let vertexCursor = 0;
            let indexCursor = 0;
            let boundsMinX = Infinity, boundsMinY = Infinity, boundsMinZ = Infinity;
            let boundsMaxX = -Infinity, boundsMaxY = -Infinity, boundsMaxZ = -Infinity;

            for (const mesh of currentMeshes) {
                const model = mesh.getModelMatrix();
                const normalMatrix = normalMatrixFromModel(model);
                const vertexTotal = mesh.vertices.length / 3;
                const base = vertexCursor;
                const mv0 = model[0], mv1 = model[1], mv2 = model[2];
                const mv4 = model[4], mv5 = model[5], mv6 = model[6];
                const mv8 = model[8], mv9 = model[9], mv10 = model[10];
                const tx = model[12], ty = model[13], tz = model[14];
                const nm0 = normalMatrix[0], nm1 = normalMatrix[1], nm2 = normalMatrix[2];
                const nm3 = normalMatrix[3], nm4 = normalMatrix[4], nm5 = normalMatrix[5];
                const nm6 = normalMatrix[6], nm7 = normalMatrix[7], nm8 = normalMatrix[8];
                const sourceVertices = mesh.vertices;
                const sourceNormals = mesh.normals;
                const sourceColors = mesh.colors;
                const sourceUvs = mesh.uvs;

                for (let i = 0; i < vertexTotal; i++) {
                    const p = i * 3;
                    const x = sourceVertices[p];
                    const y = sourceVertices[p + 1];
                    const z = sourceVertices[p + 2];
                    const wx = mv0 * x + mv4 * y + mv8 * z + tx;
                    const wy = mv1 * x + mv5 * y + mv9 * z + ty;
                    const wz = mv2 * x + mv6 * y + mv10 * z + tz;
                    const outP = (vertexCursor + i) * 3;
                    positions[outP] = wx;
                    positions[outP + 1] = wy;
                    positions[outP + 2] = wz;
                    if (wx < boundsMinX) boundsMinX = wx;
                    if (wy < boundsMinY) boundsMinY = wy;
                    if (wz < boundsMinZ) boundsMinZ = wz;
                    if (wx > boundsMaxX) boundsMaxX = wx;
                    if (wy > boundsMaxY) boundsMaxY = wy;
                    if (wz > boundsMaxZ) boundsMaxZ = wz;

                    const nx0 = sourceNormals[p];
                    const ny0 = sourceNormals[p + 1];
                    const nz0 = sourceNormals[p + 2];
                    let nx = nm0 * nx0 + nm3 * ny0 + nm6 * nz0;
                    let ny = nm1 * nx0 + nm4 * ny0 + nm7 * nz0;
                    let nz = nm2 * nx0 + nm5 * ny0 + nm8 * nz0;
                    const nLen = Math.hypot(nx, ny, nz) || 1;
                    const outN = outP;
                    normals[outN] = nx / nLen;
                    normals[outN + 1] = ny / nLen;
                    normals[outN + 2] = nz / nLen;

                    colors[outP] = sourceColors[p] ?? 1;
                    colors[outP + 1] = sourceColors[p + 1] ?? 1;
                    colors[outP + 2] = sourceColors[p + 2] ?? 1;
                    const uv = (vertexCursor + i) * 2;
                    const srcUv = i * 2;
                    uvs[uv] = sourceUvs[srcUv] ?? 0;
                    uvs[uv + 1] = sourceUvs[srcUv + 1] ?? 0;
                }

                const sourceIndices = mesh.indices;
                for (let i = 0; i < sourceIndices.length; i++) indices[indexCursor++] = sourceIndices[i] + base;
                vertexCursor += vertexTotal;
            }

            this._upload({
                positions,
                normals,
                colors,
                uvs,
                indices,
                boundsMin: [boundsMinX, boundsMinY, boundsMinZ],
                boundsMax: [boundsMaxX, boundsMaxY, boundsMaxZ],
                shading: group.shading,
                doubleSided: group.doubleSided,
                texture: group.texture
            });

            currentMeshes = [];
            vertexCount = 0;
            indexCount = 0;
        };

        for (const mesh of group.meshes) {
            const neededVertices = mesh.vertices.length / 3;
            const neededIndices = mesh.indices.length;
            if (currentMeshes.length && vertexCount + neededVertices > MAX_BATCH_VERTICES) flush();
            currentMeshes.push(mesh);
            vertexCount += neededVertices;
            indexCount += neededIndices;
        }
        flush();
    }

    _upload(data) {
        const gl = this.gl;
        const vertexCount = data.positions.length / 3;
        // Interleave the static vertex stream once at build time. Camera rotation then
        // only changes the view matrix and does not touch vertex attribute state.
        const interleaved = new Float32Array(vertexCount * 11);
        for (let i = 0; i < vertexCount; i++) {
            const p = i * 3, u = i * 2, o = i * 11;
            interleaved[o] = data.positions[p];
            interleaved[o + 1] = data.positions[p + 1];
            interleaved[o + 2] = data.positions[p + 2];
            interleaved[o + 3] = data.normals[p];
            interleaved[o + 4] = data.normals[p + 1];
            interleaved[o + 5] = data.normals[p + 2];
            interleaved[o + 6] = data.colors[p] ?? 1;
            interleaved[o + 7] = data.colors[p + 1] ?? 1;
            interleaved[o + 8] = data.colors[p + 2] ?? 1;
            interleaved[o + 9] = data.uvs[u] ?? 0;
            interleaved[o + 10] = data.uvs[u + 1] ?? 0;
        }
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);

        if (!this._vaoExtension && !gl.createVertexArray) {
            this._vaoExtension = gl.getExtension('OES_vertex_array_object');
        }
        const vao = gl.createVertexArray ? gl.createVertexArray() : this._vaoExtension?.createVertexArrayOES();
        const bindVao = value => gl.bindVertexArray ? gl.bindVertexArray(value) : this._vaoExtension?.bindVertexArrayOES(value);
        bindVao(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        const stride = 11 * 4;
        const attrs = [
            [this.uniforms.aPosition, 3, 0],
            [this.uniforms.aNormal, 3, 12],
            [this.uniforms.aColor, 3, 24],
            [this.uniforms.aUV, 2, 36]
        ];
        for (const [attribute, size, offset] of attrs) {
            if (attribute < 0) continue;
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, stride, offset);
        }
        bindVao(null);

        const batch = {
            id: this._nextId++,
            vertexBuffer,
            indexBuffer,
            vao,
            indexCount: data.indices.length,
            indexType: gl.UNSIGNED_SHORT,
            indexBytes: 2,
            buffers: [vertexBuffer, indexBuffer],
            boundsMin: data.boundsMin,
            boundsMax: data.boundsMax,
            boundsCenter: [
                (data.boundsMin[0] + data.boundsMax[0]) * 0.5,
                (data.boundsMin[1] + data.boundsMax[1]) * 0.5,
                (data.boundsMin[2] + data.boundsMax[2]) * 0.5
            ],
            boundsRadius: 0,
            shading: data.shading,
            doubleSided: data.doubleSided,
            texture: data.texture || null
        };
        // Keep only the two real GPU buffers; the interleaved vertex stream is one buffer.
        batch.buffers = [batch.vertexBuffer, batch.indexBuffer];
        const c = batch.boundsCenter;
        for (let i = 0; i < 8; i++) {
            const x = i & 1 ? data.boundsMax[0] : data.boundsMin[0];
            const y = i & 2 ? data.boundsMax[1] : data.boundsMin[1];
            const z = i & 4 ? data.boundsMax[2] : data.boundsMin[2];
            batch.boundsRadius = Math.max(batch.boundsRadius, Math.hypot(x - c[0], y - c[1], z - c[2]));
        }
        this.batches.push(batch);
    }
}

const MIXED_TEXTURE = Object.freeze({ mixedTexture: true });

export function selectionKey(selection) {
    return [...(selection || [])].map(mesh => mesh?.name || '').sort().join('\u0001');
}

function transformPoint(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
}

function normalMatrixFromModel(m) {
    const x = Math.hypot(m[0], m[1], m[2]) || 1;
    const y = Math.hypot(m[4], m[5], m[6]) || 1;
    const z = Math.hypot(m[8], m[9], m[10]) || 1;
    return [m[0] / (x * x), m[1] / (x * x), m[2] / (x * x), m[4] / (y * y), m[5] / (y * y), m[6] / (y * y), m[8] / (z * z), m[9] / (z * z), m[10] / (z * z)];
}

