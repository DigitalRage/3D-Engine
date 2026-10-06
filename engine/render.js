import { loadShaderSource } from './loader.js';
import { traceDirectionalShadowFaces } from './raytracing.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.overlayCanvas = document.getElementById('viewport-overlay');
        this.gl = canvas.getContext('webgl', {
            antialias: false,
            depth: true,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false
        });
        if (!this.gl) throw new Error('WebGL not supported');
        this.instancingExtension = this.gl.getExtension('ANGLE_instanced_arrays');
        this.instanceBuffer = null;
        this.instanceScratch = new Float32Array(0);
        this.instanceBufferCapacity = 0;

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
        this._renderPlanCache = null;
        this._skeletonCache = { revision: -1, meshes: [] };
        this._lastCullState = null;
        this._identity = identityMatrix();
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
            aInstance: [0, 1, 2, 3].map(index => gl.getAttribLocation(prog, `aInstance${index}`)),
            aInstanceColor: gl.getAttribLocation(prog, 'aInstanceColor')
        };
        gl.useProgram(this.program);
        if (this.uniforms.aInstanceColor >= 0) {
            gl.disableVertexAttribArray(this.uniforms.aInstanceColor);
            gl.vertexAttrib4f(this.uniforms.aInstanceColor, 1, 1, 1, 1);
        }
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

        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix(this.canvas.width / this.canvas.height);
        const cameraKey = makeCameraKey(camera, this.canvas.width, this.canvas.height);
        const planKey = `${scene.renderRevision}|${cameraKey}|${this.renderMode}`;
        let plan = this._renderPlanCache?.key === planKey ? this._renderPlanCache.plan : null;
        const light = scene.light;

        gl.clearColor(0.1, 0.1, 0.15, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.frontFace(gl.CCW);
        gl.useProgram(this.program);
        const frameId = ++this.frameId;
        this._lastCullState = null;
        const stats = { drawCalls: 0, triangles: 0, objects: 0 };
        gl.uniformMatrix4fv(this.uniforms.uView, false, view);
        gl.uniformMatrix4fv(this.uniforms.uProj, false, proj);
        if (light) {
            const lightLength = Math.hypot(...light.direction);
            const lx = lightLength > 1e-8 ? light.direction[0] / lightLength : 0;
            const ly = lightLength > 1e-8 ? light.direction[1] / lightLength : -1;
            const lz = lightLength > 1e-8 ? light.direction[2] / lightLength : 0;
            gl.uniform3f(this.uniforms.uLightDirection, lx, ly, lz);
            gl.uniform3fv(this.uniforms.uLightColor, light.color);
            gl.uniform1f(this.uniforms.uLightIntensity, light.intensity);
            gl.uniform1f(this.uniforms.uLightThreshold, light.threshold);
            gl.uniform3fv(this.uniforms.uShadeColor, light.shadeColor);
        }

        const meshCount = scene.meshes.length;
        const sceneTriangleCount = scene._triangleCountCacheRevision === scene.renderRevision
            ? scene._triangleCountCache
            : scene.meshes.reduce((sum, mesh) => sum + (mesh.triangleCount || 0), 0);
        scene._triangleCountCache = sceneTriangleCount;
        scene._triangleCountCacheRevision = scene.renderRevision;
        const shadowEligible = meshCount <= 800 && sceneTriangleCount <= 20000;
        const shadowSignature = (this.renderMode === 'anime' && shadowEligible)
            ? `${scene.renderRevision}|${scene.lightRevision}|${meshCount}|${sceneTriangleCount}` : null;
        if (this.renderMode === 'anime' && shadowEligible && shadowSignature !== this.shadowSignature) {
            const tracedShadows = traceDirectionalShadowFaces(scene, light);
            for (const mesh of scene.meshes) {
                const next = tracedShadows.get(mesh) || [];
                if (next.length !== (mesh.shadowedFaces?.length || 0) || next.some((v, i) => v !== mesh.shadowedFaces[i])) {
                    mesh.shadowedFaces = next;
                    mesh.shadowedFaceCount = next.reduce((count, value) => count + (value ? 1 : 0), 0);
                    mesh.shadowVersion = (mesh.shadowVersion || 0) + 1;
                }
            }
            this.shadowSignature = shadowSignature;
        } else if (!shadowEligible && this.shadowSignature !== '__none__') {
            for (const mesh of scene.meshes) {
                if (mesh.shadowedFaces?.length || mesh.shadowedFaceCount) {
                    mesh.shadowedFaces = [];
                    mesh.shadowedFaceCount = 0;
                    mesh.shadowVersion = (mesh.shadowVersion || 0) + 1;
                }
            }
            this.shadowSignature = '__none__';
        } else if (this.renderMode !== 'anime') {
            this.shadowSignature = null;
        }

        if (!plan || this.renderMode === 'wireframe') {
            const transparentFaces = [];
            const opaqueMeshes = [];
            const instanceGroups = new Map();
            const frustum = extractFrustumPlanes(view, proj);
            let culled = 0;
            const useFrustumCull = meshCount > 50;
            for (const mesh of scene.meshes) {
                if (mesh._boundsDirty) mesh.refreshBounds?.();
                if (useFrustumCull && mesh.boundsCenter && !meshInFrustumFast(mesh, frustum, camera)) { culled++; continue; }
                if (mesh.dirtyFlags.geometry || mesh.dirtyFlags.uvs) mesh.rebuildRenderData({ buildEditorData: !mesh.lazyTopology });
                else if (mesh.dirtyFlags.materials || mesh.dirtyFlags.selection) mesh.updateRenderQueues();
                if (mesh.opaqueFaceIndices?.length || !mesh.transparentFaceIndices?.length) {
                    const key = this.instancingExtension ? mesh.getInstanceBatchKey() : null;
                    if (key) {
                        if (!instanceGroups.has(key)) instanceGroups.set(key, []);
                        instanceGroups.get(key).push(mesh);
                    } else opaqueMeshes.push(mesh);
                }
                if (mesh.transparentFaceIndices?.length) {
                    const model = mesh.getModelMatrix();
                    for (const faceIndex of mesh.transparentFaceIndices) {
                        const range = mesh.faceRanges?.[faceIndex];
                        const polygon = mesh.polygons?.[faceIndex];
                        if (!polygon?.length) continue;
                        let cx = 0, cy = 0, cz = 0;
                        for (const vertex of polygon) { cx += vertex[0]; cy += vertex[1]; cz += vertex[2]; }
                        const inv = 1 / polygon.length;
                        cx *= inv; cy *= inv; cz *= inv;
                        const world = transformPoint(model, [cx, cy, cz]);
                        const dx = world[0] - camera.position[0], dy = world[1] - camera.position[1], dz = world[2] - camera.position[2];
                        transparentFaces.push({ mesh, faceIndex, distance: dx*dx + dy*dy + dz*dz });
                    }
                }
            }
            const MAX_INSTANCES = 512;
            const opaqueCommands = [];
            for (const meshes of instanceGroups.values()) {
                if (meshes.length > 1) {
                    // Keep instances within each material/geometry batch front-to-back.
                    // This preserves early-Z efficiency instead of letting a giant instance
                    // group render in scene-storage order.
                    meshes.sort((a, b) => distanceSqToMesh(a, camera) - distanceSqToMesh(b, camera));
                    for (let i = 0; i < meshes.length; i += MAX_INSTANCES) {
                        const chunk = meshes.slice(i, i + MAX_INSTANCES);
                        opaqueCommands.push({ kind: 'instances', meshes: chunk, distance: distanceSqToMesh(chunk[0], camera) });
                    }
                } else opaqueMeshes.push(meshes[0]);
            }
            for (const mesh of opaqueMeshes) opaqueCommands.push({ kind: 'mesh', mesh, distance: distanceSqToMesh(mesh, camera) });
            if (opaqueCommands.length <= 2000) opaqueCommands.sort((a, b) => a.distance - b.distance);
            transparentFaces.sort((a, b) => b.distance - a.distance);
            plan = { opaqueCommands, transparentFaces, culled };
            this._renderPlanCache = { key: planKey, plan };
        }

        stats.culled = plan.culled || 0;
        stats.objects = meshCount - stats.culled;
        if (this.renderMode === 'wireframe') {
            gl.disable(gl.CULL_FACE);
            for (const mesh of scene.meshes) mesh.draw(gl, this.program, null, frameId, this.renderMode, stats);
            this.frameStats = stats;
            return;
        }
        gl.depthMask(true);
        for (const command of plan.opaqueCommands) {
            const material = command.kind === 'mesh' ? command.mesh.material : command.meshes[0].material;
            this.setBackfaceCullingCached(material);
            if (command.kind === 'instances') this.drawInstancedMeshes(command.meshes, frameId, stats);
            else command.mesh.draw(gl, this.program, command.mesh.opaqueFaceIndices, frameId, this.renderMode, stats);
        }
        if (plan.transparentFaces.length) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.depthMask(false);
            for (const face of plan.transparentFaces) {
                this.setBackfaceCullingCached(face.mesh.material);
                face.mesh.draw(gl, this.program, [face.faceIndex], frameId, this.renderMode, stats);
            }
            gl.depthMask(true);
            gl.disable(gl.BLEND);
        }
        this.drawSkeletons(scene, stats);
        this.frameStats = stats;
    }

    setBackfaceCullingCached(material) {
        const enabled = !material?.doubleSided;
        if (this._lastCullState === enabled) return;
        this._lastCullState = enabled;
        const gl = this.gl;
        if (enabled) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        else gl.disable(gl.CULL_FACE);
    }

    drawInstancedMeshes(meshes, frameId, stats) {
        const gl = this.gl;
        const extension = this.instancingExtension;
        const template = meshes[0];
        template.initBuffers(gl, this.program);
        if (gl.createVertexArray) gl.bindVertexArray(template.vao);
        else template.vaoExtension.bindVertexArrayOES(template.vao);

        if (!this.instanceBuffer) this.instanceBuffer = gl.createBuffer();
        const instanceStride = 20;
        const requiredFloats = meshes.length * instanceStride;
        if (this.instanceScratch.length < requiredFloats) {
            let next = Math.max(instanceStride * 64, this.instanceScratch.length || instanceStride * 64);
            while (next < requiredFloats) next *= 2;
            this.instanceScratch = new Float32Array(next);
        }
        const instanceData = this.instanceScratch;
        meshes.forEach((mesh, index) => {
            const base = index * instanceStride;
            const model = mesh.getModelMatrix();
            instanceData.set(model, base);
            const color = mesh.material?.color || [1, 1, 1, 1];
            instanceData[base + 16] = color[0] ?? 1;
            instanceData[base + 17] = color[1] ?? 1;
            instanceData[base + 18] = color[2] ?? 1;
            instanceData[base + 19] = color[3] ?? 1;
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        if (this.instanceBufferCapacity < instanceData.length) {
            gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
            this.instanceBufferCapacity = instanceData.length;
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, requiredFloats));
        this.uniforms.aInstance.forEach((attribute, index) => {
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, instanceStride * 4, index * 16);
            extension.vertexAttribDivisorANGLE(attribute, 1);
        });
        gl.enableVertexAttribArray(this.uniforms.aInstanceColor);
        gl.vertexAttribPointer(this.uniforms.aInstanceColor, 4, gl.FLOAT, false, instanceStride * 4, 64);
        extension.vertexAttribDivisorANGLE(this.uniforms.aInstanceColor, 1);
        gl.uniformMatrix4fv(this.uniforms.uModel, false, this._identity);
        gl.uniform1f(this.uniforms.uInstanced, 1);
        gl.uniform1f(this.uniforms.uToonShading, this.renderMode === 'anime' && template.material.shading === 'toon' ? 1 : 0);

        if (template.vertexWeights.size || template.skinningSignature) template.updateSkinningBuffers(gl);
        const uniforms = template.getUniformLocations(gl, this.program);
        template.getDrawBatches(template.opaqueFaceIndices).forEach(batch => {
            gl.uniform4fv(uniforms.uColor, batch.color);
            gl.uniform1i(uniforms.uUseTexture, 0);
            gl.uniform1f(uniforms.uFaceSelected, batch.selected ? 1 : 0);
            gl.uniform1f(uniforms.uRayShadowed, batch.shadowed ? 1 : 0);
            gl.uniform4f(uniforms.uUVTransform, batch.transform.scale[0] * (batch.transform.flipX ? -1 : 1), batch.transform.scale[1] * (batch.transform.flipY ? -1 : 1), batch.transform.offset[0], batch.transform.offset[1]);
            gl.uniform1f(uniforms.uUVRotation, batch.transform.rotation);
            gl.uniform2f(uniforms.uUVCenter, batch.uvCenter[0], batch.uvCenter[1]);
            extension.drawElementsInstancedANGLE(gl.TRIANGLES, batch.count, template.indexType, batch.offset * template.indexBytes, meshes.length);
            stats.drawCalls++;
            stats.triangles += batch.count / 3 * meshes.length;
        });

        this.uniforms.aInstance.forEach(attribute => {
            extension.vertexAttribDivisorANGLE(attribute, 0);
            gl.disableVertexAttribArray(attribute);
        });
        extension.vertexAttribDivisorANGLE(this.uniforms.aInstanceColor, 0);
        gl.disableVertexAttribArray(this.uniforms.aInstanceColor);
        gl.vertexAttrib4f(this.uniforms.aInstanceColor, 1, 1, 1, 1);
        gl.uniform1f(this.uniforms.uInstanced, 0);
        if (gl.createVertexArray) gl.bindVertexArray(null);
        else template.vaoExtension.bindVertexArrayOES(null);
    }

    drawSkeletons(scene, stats) {
        const gl = this.gl;
        const lineData = [];
        if (this._skeletonCache.revision !== scene.renderRevision) {
            this._skeletonCache = { revision: scene.renderRevision, meshes: scene.meshes.filter(mesh => mesh.skeleton.bones.length) };
        }
        this._skeletonCache.meshes.forEach(mesh => {
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
        gl.uniformMatrix4fv(this.uniforms.uModel, false, this._identity);
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
        gl.depthFunc(gl.LESS);
    }
}

function makeCameraKey(camera, width, height) {
    let h = 2166136261;
    const values = [camera.position[0], camera.position[1], camera.position[2], camera.target[0], camera.target[1], camera.target[2], camera.fov, camera.near, camera.far, camera.orthographicHeight, camera.viewMode === 'perspective' ? 1 : 0, width, height];
    for (const value of values) { const bits = Math.round(Number(value) * 100000); h = Math.imul(h ^ bits, 16777619); }
    return h >>> 0;
}

function meshInFrustumFast(mesh, planes, camera) {
    const center = mesh.boundsCenter;
    if (mesh._cullTransformRevision !== mesh.transformRevision || !mesh._cullWorldCenter) {
        const model = mesh.getModelMatrix();
        mesh._cullWorldCenter = [
            model[0] * center[0] + model[4] * center[1] + model[8] * center[2] + model[12],
            model[1] * center[0] + model[5] * center[1] + model[9] * center[2] + model[13],
            model[2] * center[0] + model[6] * center[1] + model[10] * center[2] + model[14]
        ];
        const scale = mesh.scale || [1, 1, 1];
        mesh._cullWorldRadius = (Number(mesh.boundsRadius) || 0) * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]), 1e-6) * 1.03;
        mesh._cullTransformRevision = mesh.transformRevision;
    }
    const [wx, wy, wz] = mesh._cullWorldCenter;
    const radius = mesh._cullWorldRadius || 0;
    for (const plane of planes) if (plane[0] * wx + plane[1] * wy + plane[2] * wz + plane[3] < -radius) return false;
    // Tiny-object culling for very large scenes. Keep an object if it is likely to cover at least ~0.65 pixel.
    if (camera.viewMode === 'perspective' && sceneObjectCullEnabled(mesh)) {
        const dx = wx - camera.position[0], dy = wy - camera.position[1], dz = wz - camera.position[2];
        const distance = Math.max(0.01, Math.hypot(dx, dy, dz));
        const projectedRadius = radius * 1080 / (distance * Math.max(0.25, Math.tan(camera.fov / 2)));
        if (projectedRadius < 0.325) return false;
    }
    return true;
}

function sceneObjectCullEnabled(mesh) { return !!mesh && !mesh.alwaysVisible; }

function normalMatrixFromModel(m) {
    const a00=m[0], a01=m[4], a02=m[8], a10=m[1], a11=m[5], a12=m[9], a20=m[2], a21=m[6], a22=m[10];
    const b01=a22*a11-a12*a21, b11=-a22*a10+a12*a20, b21=a21*a10-a11*a20;
    let det=a00*b01+a01*b11+a02*b21;
    if (Math.abs(det)<1e-8) return new Float32Array([1,0,0,0,1,0,0,0,1]);
    det=1/det;
    return new Float32Array([b01*det,(-a22*a01+a02*a21)*det,(a12*a01-a02*a11)*det,b11*det,(a22*a00-a02*a20)*det,(-a12*a00+a02*a10)*det,b21*det,(-a21*a00+a01*a20)*det,(a11*a00-a01*a10)*det]);
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
    const add = value => { hash = Math.imul(hash ^ (Number(value) | 0), 16777619); };
    add(scene.geometryRevision);
    add(scene.lightRevision);
    add(scene.meshes.length);
    scene.meshes.forEach(mesh => {
        add(mesh.geometryRevision);
        add(mesh.renderStateVersion);
        add(mesh.transformRevision);
        add(mesh.skinRevision);
    });
    return hash >>> 0;
}

/** Extract 6 frustum planes from combined view-projection (column-major). */
function extractFrustumPlanes(view, proj) {
    // clip = proj * view (column-major multiply)
    const clip = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            clip[c * 4 + r] =
                proj[0 * 4 + r] * view[c * 4 + 0] +
                proj[1 * 4 + r] * view[c * 4 + 1] +
                proj[2 * 4 + r] * view[c * 4 + 2] +
                proj[3 * 4 + r] * view[c * 4 + 3];
        }
    }
    const planes = [];
    // left, right, bottom, top, near, far
    const coeffs = [
        [clip[3] + clip[0], clip[7] + clip[4], clip[11] + clip[8], clip[15] + clip[12]],
        [clip[3] - clip[0], clip[7] - clip[4], clip[11] - clip[8], clip[15] - clip[12]],
        [clip[3] + clip[1], clip[7] + clip[5], clip[11] + clip[9], clip[15] + clip[13]],
        [clip[3] - clip[1], clip[7] - clip[5], clip[11] - clip[9], clip[15] - clip[13]],
        [clip[3] + clip[2], clip[7] + clip[6], clip[11] + clip[10], clip[15] + clip[14]],
        [clip[3] - clip[2], clip[7] - clip[6], clip[11] - clip[10], clip[15] - clip[14]]
    ];
    for (const p of coeffs) {
        const len = Math.hypot(p[0], p[1], p[2]) || 1;
        planes.push([p[0] / len, p[1] / len, p[2] / len, p[3] / len]);
    }
    return planes;
}

function meshInFrustum(mesh, planes) {
    const center = mesh.boundsCenter;
    const localRadius = Number(mesh.boundsRadius) || 0;
    if (!center || !localRadius) return true;
    const model = mesh.getModelMatrix();
    const worldCenter = transformPoint(model, center);
    const scale = mesh.scale || [1, 1, 1];
    const radius = localRadius * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]), 1e-6) * 1.03;
    for (let i = 0; i < planes.length; i++) {
        const plane = planes[i];
        const dist = plane[0] * worldCenter[0] + plane[1] * worldCenter[1] + plane[2] * worldCenter[2] + plane[3];
        if (dist < -radius) return false;
    }
    return true;
}

function distanceSqToMesh(mesh, camera) {
    const center = mesh.boundsCenter;
    const model = mesh.getModelMatrix();
    const worldCenter = center ? transformPoint(model, center) : [mesh.position[0], mesh.position[1], mesh.position[2]];
    const dx = worldCenter[0] - camera.position[0];
    const dy = worldCenter[1] - camera.position[1];
    const dz = worldCenter[2] - camera.position[2];
    return dx * dx + dy * dy + dz * dz;
}

function setBackfaceCulling(gl, material) {
    gl.frontFace(gl.CCW);
    if (material?.doubleSided) gl.disable(gl.CULL_FACE);
    else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
    }
}
