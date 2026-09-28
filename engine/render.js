import { loadShaderSource } from './loader.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl');
        if (!this.gl) throw new Error('WebGL not supported');

        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.program = null;
        this.ready = this.initProgram();
    }

    async initProgram() {
        const gl = this.gl;
        const vertSrc = await loadShaderSource('./engine/shaders/flat.vert');
        const fragSrc = await loadShaderSource('./engine/shaders/flat.frag');

        const vs = this.createShader(gl.VERTEX_SHADER, vertSrc);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fragSrc);

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog));
        }

        this.program = prog;
        gl.useProgram(this.program);
    }

    createShader(type, src) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    render(scene, camera) {
        const gl = this.gl;
        if (!this.program) return;

        gl.clearColor(0.1, 0.1, 0.15, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        gl.useProgram(this.program);

        const uView = gl.getUniformLocation(this.program, 'uView');
        const uProj = gl.getUniformLocation(this.program, 'uProj');

        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix(this.canvas.width / this.canvas.height);

        gl.uniformMatrix4fv(uView, false, view);
        gl.uniformMatrix4fv(uProj, false, proj);

        for (const mesh of scene.meshes) {
            mesh.draw(gl, this.program);
        }
    }
}
