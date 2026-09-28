import { mat4 } from './mat4.js';
import { Skeleton } from './skeleton.js';
import { AnimationPlayer } from './animation.js';

export class Mesh {
    constructor(material) {
        this.material = material;
        this.name = 'Mesh';
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];

        this.vertices = null;
        this.colors = null;
        this.uvs = null;
        this.indices = null;

        this.vao = null;
        this.vaoExtension = null;
        this.positionBuffer = null;
        this.colorBuffer = null;
        this.uvBuffer = null;
        this.faceColors = [];
        this.faceTextures = [];
        this.faceUvTransforms = [];
        this.faceCount = 0;
        this.selectedFace = -1;
        this.polygons = [];
        this.faceRanges = [];
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

    setFaceVertex(faceIndex, vertexIndex, position) {
        if (!this.polygons[faceIndex]?.[vertexIndex]) return;
        const previous = this.polygons[faceIndex][vertexIndex];
        this.polygons.forEach(polygon => polygon.forEach((vertex, otherFace) => {
            if (vertex === previous || Math.hypot(vertex[0] - previous[0], vertex[1] - previous[1], vertex[2] - previous[2]) < 0.0001) {
                polygon[otherFace] = [...position];
            }
        }));
        this.weldNearbyVertices(faceIndex, vertexIndex);
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

    rebuildRenderData() {
        const vertices = [];
        const colors = [];
        const uvs = [];
        const indices = [];
        this.faceRanges = [];
        const faceUVs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        this.polygons.forEach((polygon, faceIndex) => {
            const vertexStart = vertices.length / 3;
            polygon.forEach((vertex, vertexIndex) => {
                vertices.push(...vertex);
                colors.push(1, 1, 1);
                uvs.push(...faceUVs[vertexIndex % faceUVs.length]);
            });
            for (let vertexIndex = 1; vertexIndex < polygon.length - 1; vertexIndex++) {
                indices.push(vertexStart, vertexStart + vertexIndex, vertexStart + vertexIndex + 1);
            }
            this.faceRanges.push({ offset: indices.length - Math.max(0, polygon.length - 2) * 3, count: Math.max(0, polygon.length - 2) * 3 });
        });
        this.vertices = new Float32Array(vertices);
        this.colors = new Float32Array(colors);
        this.uvs = new Float32Array(uvs);
        this.indices = new Uint16Array(indices);
        this.faceCount = this.polygons.length;
        while (this.faceColors.length < this.faceCount) this.faceColors.push([1, 1, 1]);
        while (this.faceTextures.length < this.faceCount) this.faceTextures.push(null);
        while (this.faceUvTransforms.length < this.faceCount) this.faceUvTransforms.push({ scale: [1, 1], offset: [0, 0], rotation: 0 });
        if (this.vao) this.invalidateBuffers();
    }

    invalidateBuffers() {
        this.vao = null;
        this.positionBuffer = null;
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
        const aColor = gl.getAttribLocation(program, 'aColor');
        const aUV = gl.getAttribLocation(program, 'aUV');

        const vbo = gl.createBuffer();
        this.positionBuffer = vbo;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

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

    draw(gl, program) {
        this.initBuffers(gl, program);

        if (gl.createVertexArray) {
            gl.bindVertexArray(this.vao);
        } else {
            this.vaoExtension.bindVertexArrayOES(this.vao);
        }

        const uModel = gl.getUniformLocation(program, 'uModel');
        const uColor = gl.getUniformLocation(program, 'uColor');
        const uUseTexture = gl.getUniformLocation(program, 'uUseTexture');
        const uTexture = gl.getUniformLocation(program, 'uTexture');
        const uUVTransform = gl.getUniformLocation(program, 'uUVTransform');
        const uUVRotation = gl.getUniformLocation(program, 'uUVRotation');
        const uFaceSelected = gl.getUniformLocation(program, 'uFaceSelected');
        gl.uniformMatrix4fv(uModel, false, this.getModelMatrix());
        for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
            const color = this.faceColors[faceIndex] || this.material.color;
            const texture = this.faceTextures[faceIndex];
            const transform = this.faceUvTransforms[faceIndex];
            gl.uniform3fv(uColor, new Float32Array(color));
            gl.uniform1i(uUseTexture, texture ? 1 : 0);
            gl.uniform1f(uFaceSelected, this.selectedFace === faceIndex ? 1 : 0);
            gl.uniform4f(uUVTransform, transform.scale[0], transform.scale[1], transform.offset[0], transform.offset[1]);
            gl.uniform1f(uUVRotation, transform.rotation);
            if (texture) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.uniform1i(uTexture, 0);
            }
            const range = this.faceRanges[faceIndex];
            gl.drawElements(gl.TRIANGLES, range.count, gl.UNSIGNED_SHORT, range.offset * 2);
        }

        if (gl.createVertexArray) {
            gl.bindVertexArray(null);
        } else {
            this.vaoExtension.bindVertexArrayOES(null);
        }
    }

    updateGeometry(gl) {
        if (!this.vao) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.uvs, gl.STATIC_DRAW);
    }
}
