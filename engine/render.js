import { loadShaderSource } from './loader.js';
import { traceDirectionalShadowFaces } from './raytracing.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.overlayCanvas = document.getElementById('viewport-overlay');
        this.gl = canvas.getContext('webgl');
        if (!this.gl) throw new Error('WebGL not supported');
        this.instancingExtension = this.gl.getExtension('ANGLE_instanced_arrays');
        this.instanceBuffer = null;

        this.resize();
        this.gl.clearColor(0.1, 0.1, 0.15, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        window.addEventListener('resize', () => this.resize());

        this.program = null;
        this.boneBuffer = null;
        this.frameId = 0;
        this.renderMode = 'anime';
        this.frameStats = { drawCalls: 0, triangles: 0, objects: 0 };
        this.uniforms = null;
        this.shadowSignature = null;
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
        this.uniforms = {
            uView: gl.getUniformLocation(prog, 'uView'),
            uProj: gl.getUniformLocation(prog, 'uProj'),
            uModel: gl.getUniformLocation(prog, 'uModel'),
            uColor: gl.getUniformLocation(prog, 'uColor'),
            uUseTexture: gl.getUniformLocation(prog, 'uUseTexture'),
            uTexture: gl.getUniformLocation(prog, 'uTexture'),
            uUVTransform: gl.getUniformLocation(prog, 'uUVTransform'),
            uUVRotation: gl.getUniformLocation(prog, 'uUVRotation'),
            uUVCenter: gl.getUniformLocation(prog, 'uUVCenter'),
            uFaceSelected: gl.getUniformLocation(prog, 'uFaceSelected'),
            uRayShadowed: gl.getUniformLocation(prog, 'uRayShadowed'),
            uToonShading: gl.getUniformLocation(prog, 'uToonShading'),
            uLightDirection: gl.getUniformLocation(prog, 'uLightDirection'),
            uLightColor: gl.getUniformLocation(prog, 'uLightColor'),
            uLightIntensity: gl.getUniformLocation(prog, 'uLightIntensity'),
            uLightThreshold: gl.getUniformLocation(prog, 'uLightThreshold'),
            uShadeColor: gl.getUniformLocation(prog, 'uShadeColor'),
            uInstanced: gl.getUniformLocation(prog, 'uInstanced'),
            aInstance: [0, 1, 2, 3].map(index => gl.getAttribLocation(prog, `aInstance${index}`))
        };
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
        if (this.overlayCanvas) {
            this.overlayCanvas.width = window.innerWidth;
            this.overlayCanvas.height = window.innerHeight;
        }
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    setRenderMode(mode) {
        if (!['wireframe', 'solid', 'material', 'anime'].includes(mode)) throw new RangeError(`Unknown render mode: ${mode}`);
        this.renderMode = mode;
    }

    render(scene, camera) {
        const gl = this.gl;
        if (!this.program) return;

        gl.clearColor(0.1, 0.1, 0.15, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);

        gl.useProgram(this.program);
        const frameId = ++this.frameId;
        const stats = {
            drawCalls: 0,
            triangles: 0,
            objects: scene.meshes.length
        };

        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix(this.canvas.width / this.canvas.height);

        gl.uniformMatrix4fv(this.uniforms.uView, false, view);
        gl.uniformMatrix4fv(this.uniforms.uProj, false, proj);
        const light = scene.light;
        if (light) {
            const lightLength = Math.hypot(...light.direction);
            const lightDirection = lightLength > 1e-8 ? light.direction.map(value => value / lightLength) : [0, -1, 0];
            gl.uniform3fv(this.uniforms.uLightDirection, new Float32Array(lightDirection));
            gl.uniform3fv(this.uniforms.uLightColor, new Float32Array(light.color));
            gl.uniform1f(this.uniforms.uLightIntensity, light.intensity);
            gl.uniform1f(this.uniforms.uLightThreshold, light.threshold);
            gl.uniform3fv(this.uniforms.uShadeColor, new Float32Array(light.shadeColor));
        }
        const shadowSignature = this.renderMode === 'anime' ? makeShadowSignature(scene) : null;
        if (this.renderMode === 'anime' && shadowSignature !== this.shadowSignature) {
            const tracedShadows = traceDirectionalShadowFaces(scene, light);
            scene.meshes.forEach(mesh => {
                const next = tracedShadows.get(mesh) || Array(mesh.faceCount).fill(false);
                const previous = mesh.shadowedFaces || [];
                if (next.length !== previous.length || next.some((shadowed, index) => shadowed !== previous[index])) {
                    mesh.shadowedFaces = next;
                    mesh.shadowVersion = (mesh.shadowVersion || 0) + 1;
                }
            });
            this.shadowSignature = shadowSignature;
        } else if (this.renderMode !== 'anime') {
            this.shadowSignature = null;
        }

        if (this.renderMode === 'wireframe') {
            stats.triangles = scene.meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0);
            scene.meshes.forEach(mesh => mesh.draw(gl, this.program, null, frameId, this.renderMode, stats));
            this.frameStats = stats;
            return;
        }

        const transparentFaces = [];
        const opaqueMeshes = [];
        const instanceGroups = new Map();
        scene.meshes.forEach(mesh => {
            if (mesh.opaqueFaceIndices.length) {
                const key = this.instancingExtension ? mesh.getInstanceBatchKey() : null;
                if (key) {
                    if (!instanceGroups.has(key)) instanceGroups.set(key, []);
                    instanceGroups.get(key).push(mesh);
                } else opaqueMeshes.push(mesh);
            }
            if (!mesh.transparentFaceIndices.length) return;
            const model = mesh.getModelMatrix();
            mesh.transparentFaceIndices.forEach(faceIndex => {
                const polygon = mesh.polygons[faceIndex];
                const center = polygon.reduce((sum, vertex) => sum.map((value, axis) => value + vertex[axis] / polygon.length), [0, 0, 0]);
                const worldCenter = transformPoint(model, center);
                const distance = Math.hypot(...worldCenter.map((value, axis) => value - camera.position[axis]));
                transparentFaces.push({ mesh, faceIndex, distance });
            });
        });

        gl.depthMask(true);
        for (const meshes of instanceGroups.values()) {
            if (meshes.length > 1) this.drawInstancedMeshes(meshes, frameId, stats);
            else opaqueMeshes.push(meshes[0]);
        }
        for (const mesh of opaqueMeshes) {
            mesh.draw(gl, this.program, mesh.opaqueFaceIndices, frameId, this.renderMode, stats);
        }
        if (transparentFaces.length) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            transparentFaces.sort((a, b) => b.distance - a.distance);
            gl.depthMask(false);
            for (const face of transparentFaces) {
                face.mesh.draw(gl, this.program, [face.faceIndex], frameId, this.renderMode, stats);
            }
            gl.depthMask(true);
            gl.disable(gl.BLEND);
        }
        this.drawSkeletons(scene, stats);
        this.frameStats = stats;
    }

    drawInstancedMeshes(meshes, frameId, stats) {
        const gl = this.gl;
        const extension = this.instancingExtension;
        const template = meshes[0];
        template.initBuffers(gl, this.program);
        if (gl.createVertexArray) gl.bindVertexArray(template.vao);
        else template.vaoExtension.bindVertexArrayOES(template.vao);

        if (!this.instanceBuffer) this.instanceBuffer = gl.createBuffer();
        const matrices = new Float32Array(meshes.length * 16);
        meshes.forEach((mesh, index) => matrices.set(mesh.getModelMatrix(), index * 16));
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, matrices, gl.DYNAMIC_DRAW);
        this.uniforms.aInstance.forEach((attribute, index) => {
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 64, index * 16);
            extension.vertexAttribDivisorANGLE(attribute, 1);
        });
        gl.uniformMatrix4fv(this.uniforms.uModel, false, identityMatrix());
        gl.uniform1f(this.uniforms.uInstanced, 1);
        gl.uniform1f(this.uniforms.uToonShading, this.renderMode === 'anime' && template.material.shading === 'toon' ? 1 : 0);

        if (template.vertexWeights.size && template.skinningFrame !== frameId) {
            gl.bindBuffer(gl.ARRAY_BUFFER, template.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, template.getDeformedVertices(), gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, template.normalBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, template.getDeformedNormals(), gl.DYNAMIC_DRAW);
            template.skinningFrame = frameId;
        }
        const uniforms = template.getUniformLocations(gl, this.program);
        template.getDrawBatches(template.opaqueFaceIndices).forEach(batch => {
            gl.uniform4fv(uniforms.uColor, batch.color);
            gl.uniform1i(uniforms.uUseTexture, 0);
            gl.uniform1f(uniforms.uFaceSelected, batch.selected ? 1 : 0);
            gl.uniform1f(uniforms.uRayShadowed, batch.shadowed ? 1 : 0);
            gl.uniform4f(uniforms.uUVTransform, batch.transform.scale[0] * (batch.transform.flipX ? -1 : 1), batch.transform.scale[1] * (batch.transform.flipY ? -1 : 1), batch.transform.offset[0], batch.transform.offset[1]);
            gl.uniform1f(uniforms.uUVRotation, batch.transform.rotation);
            gl.uniform2f(uniforms.uUVCenter, batch.uvCenter[0], batch.uvCenter[1]);
            extension.drawElementsInstancedANGLE(gl.TRIANGLES, batch.count, gl.UNSIGNED_SHORT, batch.offset * 2, meshes.length);
            stats.drawCalls++;
            stats.triangles += batch.count / 3 * meshes.length;
        });

        this.uniforms.aInstance.forEach(attribute => {
            extension.vertexAttribDivisorANGLE(attribute, 0);
            gl.disableVertexAttribArray(attribute);
        });
        gl.uniform1f(this.uniforms.uInstanced, 0);
        if (gl.createVertexArray) gl.bindVertexArray(null);
        else template.vaoExtension.bindVertexArrayOES(null);
    }

    drawSkeletons(scene, stats) {
        const gl = this.gl;
        const lineData = [];
        scene.meshes.forEach(mesh => {
            if (!mesh.skeleton.bones.length) return;
            const model = mesh.getModelMatrix();
            const transforms = mesh.skeleton.getWorldTransforms();
            mesh.skeleton.bones.forEach((bone, index) => {
                const transform = transforms.get(bone);
                const localEnd = rotateVector(transform.rotation, [0, bone.length * transform.scale[1], 0]);
                const start = transformPoint(model, transform.position);
                const end = transformPoint(model, transform.position.map((value, axis) => value + localEnd[axis]));
                const color = mesh.selectedBone === index ? [0.25, 0.9, 1] : [1, 0.68, 0.22];
                lineData.push(...start, ...color, ...end, ...color);
            });
        });
        if (!lineData.length) return;

        const program = this.program;
        const position = gl.getAttribLocation(program, 'aPosition');
        const color = gl.getAttribLocation(program, 'aColor');
        const uv = gl.getAttribLocation(program, 'aUV');
        if (!this.boneBuffer) this.boneBuffer = gl.createBuffer();
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.boneBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineData), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
        gl.disableVertexAttribArray(uv);
        gl.vertexAttrib2f(uv, 0, 0);
        gl.uniformMatrix4fv(this.uniforms.uModel, false, identityMatrix());
        gl.uniform1f(this.uniforms.uInstanced, 0);
        gl.uniform1f(this.uniforms.uToonShading, 0);
        gl.uniform1f(this.uniforms.uRayShadowed, 0);
        gl.uniform4fv(this.uniforms.uColor, new Float32Array([1, 1, 1, 1]));
        gl.uniform1i(this.uniforms.uUseTexture, 0);
        gl.uniform1f(this.uniforms.uFaceSelected, 0);
        gl.uniform4f(this.uniforms.uUVTransform, 1, 1, 0, 0);
        gl.uniform1f(this.uniforms.uUVRotation, 0);
        gl.uniform2f(this.uniforms.uUVCenter, 0.5, 0.5);
        gl.drawArrays(gl.LINES, 0, lineData.length / 6);
        stats.drawCalls++;
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
    }
}

function transformPoint(matrix, point) {
    const x = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12];
    const y = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13];
    const z = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14];
    return [x, y, z];
}

function rotateVector(matrix, vector) {
    return matrix.map(row => row.reduce((sum, value, axis) => sum + value * vector[axis], 0));
}

function identityMatrix() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function makeShadowSignature(scene) {
    let hash = 2166136261;
    const add = value => {
        hash = Math.imul(hash ^ Math.round((Number(value) || 0) * 1e5), 16777619);
    };
    add(scene.meshes.length);
    scene.light?.direction.forEach(add);
    scene.meshes.forEach(mesh => {
        add(mesh.renderStateVersion);
        add(mesh.material.shading === 'toon' ? 1 : 0);
        mesh.position.forEach(add);
        mesh.rotation.forEach(add);
        mesh.scale.forEach(add);
        add(mesh.skinRevision);
        if (!mesh.vertexWeights.size) return;
        if (mesh.animationPlayer.playing) add(Math.floor(mesh.animationPlayer.time * 24));
        else mesh.skeleton.bones.forEach(bone => {
            bone.position.forEach(add);
            bone.rotation.forEach(add);
            bone.scale.forEach(add);
        });
    });
    return hash >>> 0;
}
