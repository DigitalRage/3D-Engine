import { mat4 } from './mat4.js';
import { Skeleton } from './skeleton.js';
import { AnimationPlayer } from './animation.js';
import { textureHasTransparency } from './loader.js';

export class Mesh {
    constructor(material) {
        this.material = material;
        this.name = 'Mesh';
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];

        this.vertices = null;
        this.normals = null;
        this.colors = null;
        this.uvs = null;
        this.indices = null;

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
        this.selectedFace = -1;
        this.selectedVertex = null;
        this.selectedBone = null;
        this.vertexWeights = new Map();
        this.skinRevision = 0;
        this.shadowedFaces = [];
        this.shadowVersion = 0;
        this.uniformLocations = null;
        this.uniformProgram = null;
        this.skinningFrame = null;
        this.polygons = [];
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
        mesh.polygons = faces.map(face => face.map(index => [...vertices[index]]));
        mesh.rebuildRenderData();
        return mesh;
    }

    addVertex(faceIndex, position = [0, 0, 0]) {
        if (!this.polygons[faceIndex]) this.polygons.push([]);
        this.polygons[faceIndex].push([...position]);
        this.rebuildRenderData();
    }

    addFace(vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) {
        this.polygons.push(vertices.map(vertex => [...vertex]));
        this.rebuildRenderData();
        this.selectedFace = this.polygons.length - 1;
    }

    extrudeFace(faceIndex, distance = 0.5) {
        const face = this.polygons[faceIndex];
        if (!face || face.length < 3) return;
        const edgeA = face[1].map((value, axis) => value - face[0][axis]);
        const edgeB = face[2].map((value, axis) => value - face[0][axis]);
        const normal = [
            edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
            edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
            edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]
        ];
        const normalLength = Math.hypot(...normal);
        if (!normalLength) return;
        const offset = normal.map(value => value / normalLength * distance);
        const extrudedFace = face.map(vertex => vertex.map((value, axis) => value + offset[axis]));

        for (let index = 0; index < face.length; index++) {
            const next = (index + 1) % face.length;
            this.polygons.push([face[index], face[next], extrudedFace[next], extrudedFace[index]]);
        }
        this.polygons.push(extrudedFace);
        this.rebuildRenderData();
        this.selectedFace = this.polygons.length - 1;
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

    updateRenderQueues() {
        this.opaqueFaceIndices = [];
        this.transparentFaceIndices = [];
        this.renderStateVersion++;
        for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
            const color = this.faceColors[faceIndex] || [1, 1, 1, 1];
            const texture = this.faceTextures[faceIndex] || (this.material.useTexture ? this.material.texture : null);
            if ((color[3] ?? 1) < 1 || (texture && textureHasTransparency(texture))) this.transparentFaceIndices.push(faceIndex);
            else this.opaqueFaceIndices.push(faceIndex);
        }
        this.instanceBatchKey = null;
        if (this.transparentFaceIndices.length || this.vertexWeights.size || this.skeleton.bones.length || this.selectedFace >= 0) return;
        const batches = this.getDrawBatches(this.opaqueFaceIndices);
        if (batches.some(batch => batch.texture)) return;
        this.instanceBatchKey = `${this.geometrySignature}:${this.material.shading}:${JSON.stringify(batches.map(batch => [batch.offset, batch.count, batch.color, batch.transform.scale, batch.transform.offset, batch.transform.rotation, batch.transform.flipX, batch.transform.flipY, batch.uvCenter]))}`;
    }

    getInstanceBatchKey() {
        if (this.selectedFace >= 0 || this.vertexWeights.size || this.skeleton.bones.length || this.transparentFaceIndices.length) return null;
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
        const vertex = this.polygons[faceIndex]?.[vertexIndex];
        if (!vertex || !this.skeleton.bones.includes(bone)) return false;
        let skin = this.vertexWeights.get(vertex);
        if (!skin) {
            skin = { bindPosition: [...vertex], weights: new Map() };
            this.vertexWeights.set(vertex, skin);
        }
        const normalizedWeight = Math.max(0, Math.min(1, weight));
        if (normalizedWeight === 0) skin.weights.delete(bone);
        else skin.weights.set(bone, normalizedWeight);
        const total = [...skin.weights.values()].reduce((sum, value) => sum + value, 0);
        if (total > 1) skin.weights.forEach((value, weightedBone) => skin.weights.set(weightedBone, value / total));
        if (!skin.weights.size) this.vertexWeights.delete(vertex);
        this.skinRevision++;
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
        const vertices = new Set(this.polygons.flat());
        let assigned = 0;
        vertices.forEach(vertex => {
            let skin = this.vertexWeights.get(vertex);
            if (!skin) {
                skin = { bindPosition: [...vertex], weights: new Map() };
                this.vertexWeights.set(vertex, skin);
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
        if (assigned) this.skinRevision++;
        return assigned;
    }

    clearVertexBoneWeights(faceIndex, vertexIndex) {
        const vertex = this.polygons[faceIndex]?.[vertexIndex];
        if (!vertex) return false;
        const cleared = this.vertexWeights.delete(vertex);
        if (cleared) this.skinRevision++;
        return cleared;
    }

    removeBone(index) {
        const bone = this.skeleton.bones[index];
        if (!bone) return false;
        const removed = new Set(this.skeleton.removeBone(bone));
        this.vertexWeights.forEach((skin, vertex) => {
            removed.forEach(removedBone => skin.weights.delete(removedBone));
            if (!skin.weights.size) this.vertexWeights.delete(vertex);
        });
        this.skinRevision++;
        this.selectedBone = this.skeleton.bones.length ? Math.min(index, this.skeleton.bones.length - 1) : null;
        return true;
    }

    getDeformedPoint(vertex, transforms = null, bindTransforms = null) {
        const skin = this.vertexWeights.get(vertex);
        if (!skin?.weights.size) return [...vertex];
        const current = transforms || this.skeleton.getWorldTransforms();
        const bind = bindTransforms || this.skeleton.getWorldTransforms(true);
        return deformPoint(skin, current, bind);
    }

    getDeformedVertices() {
        const transforms = this.skeleton.getWorldTransforms();
        const bindTransforms = this.skeleton.getWorldTransforms(true);
        const positions = [];
        this.polygons.forEach(polygon => polygon.forEach(vertex => {
            positions.push(...this.getDeformedPoint(vertex, transforms, bindTransforms));
        }));
        return new Float32Array(positions);
    }

    getDeformedNormals() {
        const transforms = this.skeleton.getWorldTransforms();
        const bindTransforms = this.skeleton.getWorldTransforms(true);
        const normals = [];
        this.polygons.forEach(polygon => {
            const positions = polygon.map(vertex => this.getDeformedPoint(vertex, transforms, bindTransforms));
            const edgeA = positions[1]?.map((value, axis) => value - positions[0][axis]) || [0, 0, 0];
            const edgeB = positions[2]?.map((value, axis) => value - positions[0][axis]) || [0, 0, 0];
            const normal = normalize3(cross3(edgeA, edgeB)) || [0, 1, 0];
            positions.forEach(() => normals.push(...normal));
        });
        return new Float32Array(normals);
    }

    getVertexWeightData() {
        return this.polygons.map(polygon => polygon.map(vertex => {
            const skin = this.vertexWeights.get(vertex);
            return {
                bindPosition: skin ? [...skin.bindPosition] : [...vertex],
                weights: skin ? [...skin.weights].map(([bone, weight]) => ({ bone: bone.name, weight })) : [],
                unweightedWeight: skin ? Math.max(0, 1 - [...skin.weights.values()].reduce((sum, weight) => sum + weight, 0)) : 1
            };
        }));
    }

    setFaceVertex(faceIndex, vertexIndex, position) {
        if (!this.polygons[faceIndex]?.[vertexIndex]) return;
        const previous = this.polygons[faceIndex][vertexIndex];
        const skin = this.vertexWeights.get(previous);
        this.polygons.forEach(polygon => polygon.forEach((vertex, otherVertex) => {
            if (vertex === previous || Math.hypot(vertex[0] - previous[0], vertex[1] - previous[1], vertex[2] - previous[2]) < 0.0001) {
                const replacement = [...position];
                polygon[otherVertex] = replacement;
                const previousSkin = this.vertexWeights.get(vertex) || skin;
                if (previousSkin) this.vertexWeights.set(replacement, { bindPosition: [...position], weights: new Map(previousSkin.weights) });
                this.vertexWeights.delete(vertex);
            }
        }));
        this.rebuildRenderData();
    }

    weldNearbyVertices(faceIndex, vertexIndex, threshold = 0.08) {
        const source = this.polygons[faceIndex]?.[vertexIndex];
        if (!source) return;
        let nearest = null;
        let nearestDistance = threshold;
        this.polygons.forEach((polygon, otherFace) => polygon.forEach((vertex, otherVertex) => {
            if (otherFace === faceIndex && otherVertex === vertexIndex) return;
            const distance = Math.hypot(vertex[0] - source[0], vertex[1] - source[1], vertex[2] - source[2]);
            if (distance < nearestDistance) {
                nearest = vertex;
                nearestDistance = distance;
            }
        }));
        if (nearest) {
            this.polygons.forEach(polygon => polygon.forEach(vertex => {
                if (Math.hypot(vertex[0] - source[0], vertex[1] - source[1], vertex[2] - source[2]) < threshold) {
                    vertex.splice(0, 3, ...nearest);
                }
            }));
        }
    }

    mergeNearbyVertices(faceIndex, vertexIndex, threshold = 0.08) {
        const source = this.polygons[faceIndex]?.[vertexIndex];
        if (!source) return false;
        const connected = new Set();
        this.polygons.forEach(polygon => polygon.forEach(vertex => {
            if (Math.hypot(vertex[0] - source[0], vertex[1] - source[1], vertex[2] - source[2]) <= threshold) connected.add(vertex);
        }));
        if (connected.size < 2) return false;
        const merged = [...source].map((_, axis) => [...connected].reduce((sum, vertex) => sum + vertex[axis] / connected.size, 0));
        const skins = [...connected].map(vertex => this.vertexWeights.get(vertex)).filter(Boolean);
        if (skins.length) {
            const weights = new Map();
            skins.forEach(skin => skin.weights.forEach((weight, bone) => weights.set(bone, (weights.get(bone) || 0) + weight / skins.length)));
            this.vertexWeights.set(merged, { bindPosition: [...merged], weights });
        }
        connected.forEach(vertex => this.vertexWeights.delete(vertex));
        this.polygons = this.polygons.map(polygon => polygon.map(vertex => connected.has(vertex) ? merged : vertex));
        this.rebuildRenderData();
        return true;
    }

    mergeCoplanarFace(faceIndex, tolerance = 0.0001) {
        const faceA = this.polygons[faceIndex];
        const frameA = this.getFaceFrame(faceIndex);
        if (!faceA || !frameA) return false;
        for (let otherIndex = 0; otherIndex < this.polygons.length; otherIndex++) {
            if (otherIndex === faceIndex) continue;
            const faceB = this.polygons[otherIndex];
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

            this.polygons[faceIndex] = boundary.vertices;
            this.faceUvs[faceIndex] = boundary.uvs;
            this.polygons.splice(otherIndex, 1);
            [this.faceColors, this.faceTextures, this.faceTextureIds, this.faceUvTransforms, this.faceUvs].forEach(values => values.splice(otherIndex, 1));
            this.selectedFace = otherIndex < faceIndex ? faceIndex - 1 : faceIndex;
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
        const skin = this.vertexWeights.get(vertex);
        if (skin) skin.bindPosition = [...vertex];
    }

    rebuildRenderData() {
        const verticesByPosition = new Map();
        this.polygons = this.polygons.map(polygon => polygon.map(vertex => {
            const key = vertex.join(',');
            const attachedVertex = verticesByPosition.get(key);
            if (attachedVertex) {
                const sourceSkin = this.vertexWeights.get(vertex);
                if (sourceSkin && !this.vertexWeights.has(attachedVertex)) this.vertexWeights.set(attachedVertex, sourceSkin);
                else if (sourceSkin && sourceSkin !== this.vertexWeights.get(attachedVertex)) {
                    const attachedSkin = this.vertexWeights.get(attachedVertex);
                    sourceSkin.weights.forEach((weight, bone) => attachedSkin.weights.set(bone, Math.max(attachedSkin.weights.get(bone) || 0, weight)));
                }
                return attachedVertex;
            }
            verticesByPosition.set(key, vertex);
            return vertex;
        }));

        const vertices = [];
        const normals = [];
        const colors = [];
        const uvs = [];
        const indices = [];
        this.faceRanges = [];
        this.polygons.forEach((polygon, faceIndex) => {
            const vertexStart = vertices.length / 3;
            const edgeA = polygon[1]?.map((value, axis) => value - polygon[0][axis]) || [0, 0, 0];
            const edgeB = polygon[2]?.map((value, axis) => value - polygon[0][axis]) || [0, 0, 0];
            const normal = normalize3(cross3(edgeA, edgeB)) || [0, 1, 0];
            if (!this.faceUvs[faceIndex]) this.faceUvs[faceIndex] = [];
            polygon.forEach((vertex, vertexIndex) => {
                vertices.push(...vertex);
                colors.push(1, 1, 1);
                normals.push(...normal);
                if (!this.faceUvs[faceIndex][vertexIndex]) {
                    this.faceUvs[faceIndex][vertexIndex] = defaultFaceUV(faceIndex, vertexIndex, this.polygons.length);
                }
                uvs.push(...this.faceUvs[faceIndex][vertexIndex]);
            });
            for (let vertexIndex = 1; vertexIndex < polygon.length - 1; vertexIndex++) {
                indices.push(vertexStart, vertexStart + vertexIndex, vertexStart + vertexIndex + 1);
            }
            this.faceRanges.push({ offset: indices.length - Math.max(0, polygon.length - 2) * 3, count: Math.max(0, polygon.length - 2) * 3 });
        });
        this.vertices = new Float32Array(vertices);
        this.normals = new Float32Array(normals);
        this.colors = new Float32Array(colors);
        this.uvs = new Float32Array(uvs);
        this.indices = new Uint16Array(indices);
        this.geometrySignature = hashGeometry(this.vertices, this.indices);
        this.faceCount = this.polygons.length;
        this.allFaceIndices = Array.from({ length: this.faceCount }, (_, faceIndex) => faceIndex);
        while (this.faceColors.length < this.faceCount) this.faceColors.push([1, 1, 1, 1]);
        while (this.faceTextures.length < this.faceCount) this.faceTextures.push(null);
        while (this.faceTextureIds.length < this.faceCount) this.faceTextureIds.push(null);
        while (this.faceUvTransforms.length < this.faceCount) this.faceUvTransforms.push({ scale: [1, 1], offset: [0, 0], rotation: 0, flipX: false, flipY: false });
        this.updateRenderQueues();
        if (this.vao) this.invalidateBuffers();
    }

    invalidateBuffers() {
        this.vao = null;
        this.positionBuffer = null;
        this.normalBuffer = null;
        this.colorBuffer = null;
        this.uvBuffer = null;
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
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);

        if (gl.createVertexArray) {
            gl.bindVertexArray(null);
        } else {
            this.vaoExtension.bindVertexArrayOES(null);
        }
    }

    getModelMatrix() {
        const out = new Float32Array(16);
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
        return out;
    }

    draw(gl, program, faceIndices = null, frameToken = undefined) {
        this.initBuffers(gl, program);

        if (gl.createVertexArray) {
            gl.bindVertexArray(this.vao);
        } else {
            this.vaoExtension.bindVertexArrayOES(this.vao);
        }

        const uniforms = this.getUniformLocations(gl, program);
        gl.uniformMatrix4fv(uniforms.uModel, false, this.getModelMatrix());
        gl.uniform1f(uniforms.uInstanced, 0);
        gl.uniform1f(uniforms.uToonShading, this.material.shading === 'toon' ? 1 : 0);
        if (this.vertexWeights.size) {
            if (frameToken === undefined || this.skinningFrame !== frameToken) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, this.getDeformedVertices(), gl.DYNAMIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, this.getDeformedNormals(), gl.DYNAMIC_DRAW);
                this.skinningFrame = frameToken;
            }
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
            gl.uniform1i(uniforms.uUseTexture, batchTexture ? 1 : 0);
            gl.uniform1f(uniforms.uFaceSelected, batchSelected ? 1 : 0);
            gl.uniform1f(uniforms.uRayShadowed, batchShadowed ? 1 : 0);
            gl.uniform4f(uniforms.uUVTransform, batchTransform.scale[0] * (batchTransform.flipX ? -1 : 1), batchTransform.scale[1] * (batchTransform.flipY ? -1 : 1), batchTransform.offset[0], batchTransform.offset[1]);
            gl.uniform1f(uniforms.uUVRotation, batchTransform.rotation);
            gl.uniform2f(uniforms.uUVCenter, batchUvCenter[0], batchUvCenter[1]);
            if (batchTexture !== previousTexture && batchTexture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, batchTexture);
                gl.uniform1i(uniforms.uTexture, 0);
                previousTexture = batchTexture;
            }
            gl.drawElements(gl.TRIANGLES, batchCount, gl.UNSIGNED_SHORT, batchOffset * 2);
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
