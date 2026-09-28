import { mat4 } from './mat4.js';

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
    }

    static createCube(material) {
        const mesh = new Mesh(material);

        const v = [
            // x, y, z
            -0.5, -0.5,  0.5,
             0.5, -0.5,  0.5,
             0.5,  0.5,  0.5,
            -0.5,  0.5,  0.5,
            -0.5, -0.5, -0.5,
             0.5, -0.5, -0.5,
             0.5,  0.5, -0.5,
            -0.5,  0.5, -0.5
        ];

        const c = [
            1,1,1,  1,1,1,  1,1,1,  1,1,1,
            1,1,1,  1,1,1,  1,1,1,  1,1,1
        ];

        const u = [
            0,0, 1,0, 1,1, 0,1,
            0,0, 1,0, 1,1, 0,1
        ];

        const idx = [
            0,1,2, 0,2,3,
            4,5,6, 4,6,7,
            0,4,7, 0,7,3,
            1,5,6, 1,6,2,
            3,2,6, 3,6,7,
            0,1,5, 0,5,4
        ];

        mesh.vertices = new Float32Array(v);
        mesh.colors = new Float32Array(c);
        mesh.uvs = new Float32Array(u);
        mesh.indices = new Uint16Array(idx);

        return mesh;
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
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        const cbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aColor);
        gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

        const ubo = gl.createBuffer();
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
        gl.uniformMatrix4fv(uModel, false, this.getModelMatrix());

        this.material.bind(gl, program);

        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0);

        if (gl.createVertexArray) {
            gl.bindVertexArray(null);
        } else {
            this.vaoExtension.bindVertexArrayOES(null);
        }
    }
}
