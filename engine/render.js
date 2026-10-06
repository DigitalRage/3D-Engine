import { StaticBatchManager, selectionKey } from './staticBatch.js';
import { traceDirectionalShadowFaces } from './raytracing.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.overlayCanvas = document.getElementById('viewport-overlay');
        this.gl = canvas.getContext('webgl2', {
            antialias: false,
            depth: true,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        }) || canvas.getContext('webgl', {
            antialias: false,
            depth: true,
            alpha: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false,
        });
        if (!this.gl) throw new Error('WebGL2/WebGL not supported');
        this.isWebGL2 = typeof this.gl.drawElementsInstanced === 'function' && typeof this.gl.vertexAttribDivisor === 'function';
        this.instancingExtension = this.isWebGL2 ? null : this.gl.getExtension('ANGLE_instanced_arrays');
        if (!this.isWebGL2 && !this.instancingExtension) this.instancingExtension = null;
        this.instanceBuffer = null;
        this.instanceScratch = new Float32Array(0);
        this.instanceBufferCapacity = 0;
        this.renderScale = 0.80;
        this._lastRenderScale = this.renderScale;
        this.autoQuality = false;

        this.resize();
        this.gl.clearColor(0.1, 0.1, 0.15, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        window.addEventListener('resize', () => this.resize());

        this.program = null;
        this.staticProgram = null;
        this.staticUniforms = null;
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
        this._glStateReady = false;
        this._lastPresentedKey = null;
        this._lastLightRevision = -1;
        this._staticLightRevision = -1;
        this._staticUniformState = { toon: null, texture: null, useTexture: null };
        this._frustumScratch = new Float32Array(24);
        this._dynamicCandidates = [];
        this._dynamicCandidateKey = '';
        this._cullingCellSize = 64;
        this.cullingEnabled = true;
        // A deliberately conservative margin prevents edge popping from floating-point
        // disagreement between mesh bounds and the GPU clipper. This is still cheap
        // because the spatial grid has already removed most of the world.
        this.cullingMargin = 0.10;
        // Keep a just-visible command alive for one additional frame. This prevents
        // camera rotation from producing a visible pop when bounds land on a frustum
        // plane because of floating-point differences.
        this.cullingGraceFrames = 1;
        this.reversedZ = false;
        this._depthFunc = null;
        this._lastRenderViewRevision = -1;
        this._lastRenderProjectionRevision = -1;
        this._selectionProvider = () => new Set();
        this.staticBatchManager = null;
        this._staticCandidateScratch = [];
        this._staticBatchKey = '';
        this._qualityEma = 16.7;
        this._qualityLastAdjust = 0;
        this.ready = this.initProgram();
    }

    async initProgram() {
        const gl = this.gl;
        const vs = this.createShader(gl.VERTEX_SHADER, FLAT_VERTEX_SHADER);
        const fs = this.createShader(gl.FRAGMENT_SHADER, FLAT_FRAGMENT_SHADER);

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog));
        }

        this.program = prog;
        this.uniforms = {
            uViewProj: gl.getUniformLocation(prog, 'uViewProj'),
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
            aInstanceColor: gl.getAttribLocation(prog, 'aInstanceColor'),
            aPosition: gl.getAttribLocation(prog, 'aPosition'),
            aNormal: gl.getAttribLocation(prog, 'aNormal'),
            aColor: gl.getAttribLocation(prog, 'aColor'),
            aUV: gl.getAttribLocation(prog, 'aUV')
        };

        // Static batches live in world space, so they deserve a tiny shader that
        // does not carry the model-matrix/instancing/UV-transform branches used by
        // editable meshes. This is the dominant path for large city scenes.
        const staticVs = this.createShader(gl.VERTEX_SHADER, STATIC_VERTEX_SHADER);
        const staticFs = this.createShader(gl.FRAGMENT_SHADER, STATIC_FRAGMENT_SHADER);
        const staticProg = gl.createProgram();
        gl.attachShader(staticProg, staticVs);
        gl.attachShader(staticProg, staticFs);
        gl.linkProgram(staticProg);
        if (!gl.getProgramParameter(staticProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(staticProg));
        this.staticProgram = staticProg;
        this.staticUniforms = {
            uViewProj: gl.getUniformLocation(staticProg, 'uViewProj'),
            uColor: gl.getUniformLocation(staticProg, 'uColor'),
            uUseTexture: gl.getUniformLocation(staticProg, 'uUseTexture'),
            uTexture: gl.getUniformLocation(staticProg, 'uTexture'),
            uFaceSelected: gl.getUniformLocation(staticProg, 'uFaceSelected'),
            uRayShadowed: gl.getUniformLocation(staticProg, 'uRayShadowed'),
            uToonShading: gl.getUniformLocation(staticProg, 'uToonShading'),
            uLightDirection: gl.getUniformLocation(staticProg, 'uLightDirection'),
            uLightColor: gl.getUniformLocation(staticProg, 'uLightColor'),
            uLightIntensity: gl.getUniformLocation(staticProg, 'uLightIntensity'),
            uLightThreshold: gl.getUniformLocation(staticProg, 'uLightThreshold'),
            uShadeColor: gl.getUniformLocation(staticProg, 'uShadeColor'),
            aPosition: gl.getAttribLocation(staticProg, 'aPosition'),
            aNormal: gl.getAttribLocation(staticProg, 'aNormal'),
            aColor: gl.getAttribLocation(staticProg, 'aColor'),
            aUV: gl.getAttribLocation(staticProg, 'aUV')
        };

        gl.useProgram(this.program);
        gl.clearColor(0.1, 0.1, 0.15, 1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(this._depthFunc || gl.LESS);
        gl.frontFace(gl.CCW);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        this._glStateReady = true;
        this.staticBatchManager = new StaticBatchManager(gl, this.staticProgram, this.staticUniforms);
        this.reversedZ = this.isWebGL2;
        this._depthFunc = this.reversedZ ? gl.GREATER : gl.LESS;
        gl.clearDepth?.(this.reversedZ ? 0 : 1);
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
        const scale = Math.max(0.35, Math.min(1, Number(this.renderScale) || 1));
        this.canvas.width = Math.max(320, Math.floor(window.innerWidth * scale));
        this.canvas.height = Math.max(240, Math.floor(window.innerHeight * scale));
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        if (this.overlayCanvas) {
            this.overlayCanvas.width = window.innerWidth;
            this.overlayCanvas.height = window.innerHeight;
        }
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this._lastRenderScale = scale;
    }

    setRenderScale(scale) {
        const next = Math.max(0.35, Math.min(1, Number(scale) || 1));
        if (Math.abs(next - this.renderScale) < 0.001) return;
        this.renderScale = next;
        this._renderPlanCache = null;
        this._lastPresentedKey = null;
        this.resize();
    }

    setSelectionProvider(provider) {
        this._selectionProvider = typeof provider === 'function' ? provider : () => new Set();
        this._renderPlanCache = null;
        this._staticBatchKey = '';
    }

    setAutoQuality(enabled) {
        this.autoQuality = !!enabled;
    }

    updateAdaptiveQuality(frameMs, now = performance.now()) {
        if (!this.autoQuality || !Number.isFinite(frameMs) || frameMs <= 0) return;
        this._qualityEma = this._qualityEma * 0.9 + frameMs * 0.1;
        if (now - this._qualityLastAdjust < 2500) return;
        let next = this.renderScale;
        if (this._qualityEma > 38) next -= 0.025;
        else if (this._qualityEma < 17 && this.renderScale < 1) next += 0.025;
        next = Math.max(0.35, Math.min(1, Math.round(next * 20) / 20));
        if (Math.abs(next - this.renderScale) >= 0.001) this.setRenderScale(next);
        this._qualityLastAdjust = now;
    }

    setCullingGraceFrames(frames = 1) {
        this.cullingGraceFrames = Math.max(0, Math.floor(Number(frames) || 0));
    }

    setRenderMode(mode) {
        if (!['wireframe', 'solid', 'material', 'anime'].includes(mode)) throw new RangeError(`Unknown render mode: ${mode}`);
        this.renderMode = mode;
    }

    render(scene, camera) {
        const renderStart = performance.now();
        const gl = this.gl;
        if (!this.program) return;

        const aspect = this.canvas.width / this.canvas.height;
        if (camera.reverseZ !== this.reversedZ) { camera.reverseZ = this.reversedZ; camera._projectionDirty = true; }
        const view = camera.getViewMatrix();
        const proj = camera.getProjectionMatrix(aspect);
        const viewProj = camera.getViewProjectionMatrix(aspect);
        const cameraKey = (camera._viewRevision || 0) * 1000000 + (camera._projectionRevision || 0);
        scene.syncSpatialIndex?.();
        const cellX = Math.floor(camera.position[0] / this._cullingCellSize);
        const cellY = Math.floor(camera.position[1] / this._cullingCellSize);
        const cellZ = Math.floor(camera.position[2] / this._cullingCellSize);
        const spatialKey = `${scene.spatialIndex?.revision || 0}|${cellX}|${cellY}|${cellZ}|${Math.round((camera.far || 1000) * 4) / 4}|${this.staticBatchManager?.revision || 0}|${this.cullingEnabled ? 1 : 0}`;
        let planKey = `${scene.renderRevision}|${this.renderMode}|${this._staticBatchKey}|${spatialKey}`;
        const presentKey = `${scene.renderRevision}|${scene.poseRevision || 0}|${cameraKey}|${this.renderMode}`;
        const light = scene.light;
        if (this._lastPresentedKey === presentKey && this.renderMode !== 'wireframe') return;

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(this._depthFunc || gl.LESS);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.useProgram(this.program);
        const frameId = ++this.frameId;
        this._lastCullState = null;
        this._staticUniformState.toon = null;
        this._staticUniformState.texture = null;
        this._staticUniformState.useTexture = null;
        const stats = { drawCalls: 0, triangles: 0, objects: 0, culled: 0 };

        // The camera rotates constantly. Keep one combined matrix so the hot loop
        // uploads exactly one matrix and frustum extraction does not multiply matrices.
        gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
        gl.uniformMatrix4fv(this.uniforms.uModel, false, this._identity);
        gl.uniform1f(this.uniforms.uInstanced, 0);
        gl.uniform4f(this.uniforms.uColor, 1, 1, 1, 1);
        gl.uniform1f(this.uniforms.uFaceSelected, 0);
        gl.uniform1f(this.uniforms.uRayShadowed, 0);
        gl.uniform4f(this.uniforms.uUVTransform, 1, 1, 0, 0);
        gl.uniform1f(this.uniforms.uUVRotation, 0);
        gl.uniform2f(this.uniforms.uUVCenter, 0.5, 0.5);

        if (light && this._lastLightRevision !== scene.lightRevision) {
            const dx = light.direction[0], dy = light.direction[1], dz = light.direction[2];
            const lightLength = Math.hypot(dx, dy, dz);
            const lx = lightLength > 1e-8 ? dx / lightLength : 0;
            const ly = lightLength > 1e-8 ? dy / lightLength : -1;
            const lz = lightLength > 1e-8 ? dz / lightLength : 0;
            gl.uniform3f(this.uniforms.uLightDirection, lx, ly, lz);
            gl.uniform3fv(this.uniforms.uLightColor, light.color);
            gl.uniform1f(this.uniforms.uLightIntensity, light.intensity);
            gl.uniform1f(this.uniforms.uLightThreshold, light.threshold);
            gl.uniform3fv(this.uniforms.uShadeColor, light.shadeColor);
            this._lastLightRevision = scene.lightRevision;
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

        const selected = this._selectionProvider?.() || new Set();
        const selectedKey = selectionKey(selected);
        const staticKey = `${scene.staticBatchRevision ?? scene.renderRevision}|${selectedKey}|${meshCount}`;
        if (this.staticBatchManager && this._staticBatchKey !== staticKey) {
            this.staticBatchManager.build(scene, selected);
            this._staticBatchKey = staticKey;
            this._renderPlanCache = null;
        }
        // Static batching can update the key above. Recompute after the build so the
        // freshly-built plan is valid for the very next camera frame as well.
        planKey = `${scene.renderRevision}|${this.renderMode}|${this._staticBatchKey}|${spatialKey}`;

        let plan = this._renderPlanCache?.key === planKey ? this._renderPlanCache.plan : null;
        if (!plan || this.renderMode === 'wireframe') {
            const transparentFaces = [];
            const instanceGroups = new Map();
            const opaqueMeshes = [];
            if (this._dynamicCandidateKey !== spatialKey) {
                this._dynamicCandidateKey = spatialKey;
                const allCandidates = scene.spatialIndex?.querySphere(
                    camera.position[0], camera.position[1], camera.position[2],
                    Math.max(1, Number(camera.far) || 1000) + this._cullingCellSize * 1.75,
                    this._dynamicCandidates
                ) || (scene.meshes || []);
                this._dynamicCandidates = allCandidates.filter(mesh => mesh?._renderStaticBatchExcluded);
            }
            const candidateMeshes = this._dynamicCandidates;

            for (const mesh of candidateMeshes) {
                if (mesh._boundsDirty) mesh.refreshBounds?.();
                if (mesh.dirtyFlags.geometry || mesh.dirtyFlags.uvs) mesh.rebuildRenderData({ buildEditorData: !mesh.lazyTopology });
                else if (mesh.dirtyFlags.materials || mesh.dirtyFlags.selection) mesh.updateRenderQueues();
                if (mesh._boundsDirty) mesh.refreshBounds?.();

                const opaque = mesh.opaqueFaceIndices?.length || !mesh.transparentFaceIndices?.length;
                if (opaque) {
                    const key = (this.isWebGL2 || this.instancingExtension) ? mesh.getInstanceBatchKey() : null;
                    if (key) {
                        let group = instanceGroups.get(key);
                        if (!group) instanceGroups.set(key, group = []);
                        group.push(mesh);
                    } else {
                        opaqueMeshes.push(mesh);
                    }
                }

                if (mesh.transparentFaceIndices?.length) {
                    const model = mesh.getModelMatrix();
                    for (const faceIndex of mesh.transparentFaceIndices) {
                        const polygon = mesh.polygons?.[faceIndex];
                        if (!polygon?.length) continue;
                        let cx = 0, cy = 0, cz = 0;
                        for (const vertex of polygon) { cx += vertex[0]; cy += vertex[1]; cz += vertex[2]; }
                        const inv = 1 / polygon.length;
                        const local = [cx * inv, cy * inv, cz * inv];
                        const world = transformPoint(model, local);
                        transparentFaces.push({ mesh, faceIndex, x: world[0], y: world[1], z: world[2], distance: 0 });
                    }
                }
            }

            const staticBatches = this.staticBatchManager?.queryCandidates?.(camera) || this.staticBatchManager?.batches || [];
            // Opaque work is sorted only when the cached plan is rebuilt. Camera rotation
            // therefore preserves a front-to-back-ish order without paying a sort every
            // mouse movement. The order is deterministic to avoid depth-order jitter.
            const opaqueCommands = [];
            for (const batch of staticBatches) opaqueCommands.push({ kind: 'staticBatch', batch });
            for (const meshes of instanceGroups.values()) {
                if (meshes.length > 1) opaqueCommands.push({ kind: 'instances', meshes, bounds: unionMeshBounds(meshes) });
                else opaqueMeshes.push(meshes[0]);
            }
            for (const mesh of opaqueMeshes) {
                const bounds = getCachedWorldSphere(mesh);
                opaqueCommands.push({ kind: 'mesh', mesh, bounds });
            }
            const cameraPosition = camera.position;
            const staticCommands = opaqueCommands.filter(command => command.kind === 'staticBatch');
            const dynamicCommands = opaqueCommands.filter(command => command.kind !== 'staticBatch');
            staticCommands.sort((a, b) => commandDistanceSq(a, cameraPosition) - commandDistanceSq(b, cameraPosition) || commandStableId(a) - commandStableId(b));
            dynamicCommands.sort((a, b) => commandDistanceSq(a, cameraPosition) - commandDistanceSq(b, cameraPosition) || commandStableId(a) - commandStableId(b));
            plan = { opaqueCommands: staticCommands.concat(dynamicCommands), transparentFaces };
            this._renderPlanCache = { key: planKey, plan };
        }

        if (this.renderMode === 'wireframe') {
            gl.disable(gl.CULL_FACE);
            for (const mesh of scene.meshes) {
                if (mesh?.alwaysVisible || !this.cullingEnabled) {
                    mesh.draw(gl, this.program, null, frameId, this.renderMode, stats);
                    continue;
                }
                // Wireframe is an inspection mode: exact frustum culling would make
                // partially-visible edges disappear while the user is orbiting.
                mesh.draw(gl, this.program, null, frameId, this.renderMode, stats);
            }
            this.frameStats = { ...stats, cpuMs: performance.now() - renderStart };
            this._lastPresentedKey = presentKey;
            return;
        }

        const frustum = extractFrustumPlanes(viewProj, this._frustumScratch);
        gl.depthMask(true);

        const staticCount = plan.opaqueCommands.findIndex(command => command.kind !== 'staticBatch');
        const staticEnd = staticCount < 0 ? plan.opaqueCommands.length : staticCount;
        if (staticEnd > 0 && this.staticProgram) {
            gl.useProgram(this.staticProgram);
            gl.uniformMatrix4fv(this.staticUniforms.uViewProj, false, viewProj);
            if (light && this._staticLightRevision !== scene.lightRevision) {
                const dx = light.direction[0], dy = light.direction[1], dz = light.direction[2];
                const len = Math.hypot(dx, dy, dz);
                gl.uniform3f(this.staticUniforms.uLightDirection, len > 1e-8 ? dx / len : 0, len > 1e-8 ? dy / len : -1, len > 1e-8 ? dz / len : 0);
                gl.uniform3fv(this.staticUniforms.uLightColor, light.color);
                gl.uniform1f(this.staticUniforms.uLightIntensity, light.intensity);
                gl.uniform1f(this.staticUniforms.uLightThreshold, light.threshold);
                gl.uniform3fv(this.staticUniforms.uShadeColor, light.shadeColor);
                this._staticLightRevision = scene.lightRevision;
            }
            gl.uniform4f(this.staticUniforms.uColor, 1, 1, 1, 1);
            gl.uniform1f(this.staticUniforms.uFaceSelected, 0);
            gl.uniform1f(this.staticUniforms.uRayShadowed, 0);
            this._staticUniformState.toon = null;
            this._staticUniformState.texture = null;
            this._staticUniformState.useTexture = null;
            for (let i = 0; i < staticEnd; i++) {
                const command = plan.opaqueCommands[i];
                if (!this.isCommandVisible(command, command.batch, frustum, frameId)) { stats.culled++; continue; }
                this.setBackfaceCullingCached(command.batch);
                this.drawStaticBatch(command.batch, stats);
            }
        }

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
        gl.uniformMatrix4fv(this.uniforms.uModel, false, this._identity);
        gl.uniform1f(this.uniforms.uInstanced, 0);
        gl.uniform4f(this.uniforms.uColor, 1, 1, 1, 1);
        gl.uniform1f(this.uniforms.uFaceSelected, 0);
        gl.uniform1f(this.uniforms.uRayShadowed, 0);
        gl.uniform4f(this.uniforms.uUVTransform, 1, 1, 0, 0);
        gl.uniform1f(this.uniforms.uUVRotation, 0);
        gl.uniform2f(this.uniforms.uUVCenter, 0.5, 0.5);

        for (let commandIndex = staticEnd; commandIndex < plan.opaqueCommands.length; commandIndex++) {
            const command = plan.opaqueCommands[commandIndex];
            if (command.kind === 'mesh') {
                const b = command.bounds;
                if (!this.isCommandVisible(command, b, frustum, frameId, command.mesh.alwaysVisible)) { stats.culled++; continue; }
                this.setBackfaceCullingCached(command.mesh.material);
                command.mesh.draw(gl, this.program, command.mesh.opaqueFaceIndices, frameId, this.renderMode, stats);
                continue;
            }
            const b = command.bounds;
            if (!this.isCommandVisible(command, b, frustum, frameId, command.meshes[0]?.alwaysVisible)) { stats.culled += command.meshes.length; continue; }
            this.setBackfaceCullingCached(command.meshes[0].material);
            this.drawInstancedMeshes(command, frameId, stats);
        }

        if (plan.transparentFaces.length) {
            for (const face of plan.transparentFaces) {
                const dx = face.x - camera.position[0], dy = face.y - camera.position[1], dz = face.z - camera.position[2];
                face.distance = dx * dx + dy * dy + dz * dz;
            }
            plan.transparentFaces.sort((a, b) => b.distance - a.distance);
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
        stats.objects = Math.max(0, meshCount - stats.culled);
        this.frameStats = { ...stats, cpuMs: performance.now() - renderStart };
        this._lastPresentedKey = presentKey;
    }

    drawStaticBatch(batch, stats) {
        const gl = this.gl;
        const uniforms = this.staticUniforms;
        if (batch.vao) {
            if (gl.bindVertexArray) gl.bindVertexArray(batch.vao);
            else this.staticBatchManager?._vaoExtension?.bindVertexArrayOES(batch.vao);
        }
        if (this._staticUniformState.toon !== (this.renderMode === 'anime' && batch.shading === 'toon')) {
            const toon = this.renderMode === 'anime' && batch.shading === 'toon' ? 1 : 0;
            gl.uniform1f(uniforms.uToonShading, toon);
            this._staticUniformState.toon = !!toon;
        }
        const texture = batch.texture || null;
        if (this._staticUniformState.useTexture !== !!texture) {
            gl.uniform1i(uniforms.uUseTexture, texture ? 1 : 0);
            this._staticUniformState.useTexture = !!texture;
        }
        if (texture !== this._staticUniformState.texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            if (texture) gl.uniform1i(uniforms.uTexture, 0);
            this._staticUniformState.texture = texture;
        }
        gl.drawElements(gl.TRIANGLES, batch.indexCount, batch.indexType, 0);
        stats.drawCalls++;
        stats.triangles += batch.indexCount / 3;
    }

    isCommandVisible(command, bounds, frustum, frameId, alwaysVisible = false) {
        if (alwaysVisible || !this.cullingEnabled || !bounds || !Number.isFinite(bounds.r)) {
            command._lastVisibleFrame = frameId;
            return true;
        }
        const radius = bounds.r * (1 + this.cullingMargin);
        if (sphereInFrustum(frustum, bounds.x, bounds.y, bounds.z, radius)) {
            command._lastVisibleFrame = frameId;
            return true;
        }
        const lastVisible = command._lastVisibleFrame ?? -Infinity;
        return frameId - lastVisible <= this.cullingGraceFrames;
    }

    setBackfaceCullingCached(material) {
        const enabled = !material?.doubleSided;
        if (this._lastCullState === enabled) return;
        this._lastCullState = enabled;
        const gl = this.gl;
        if (enabled) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        else gl.disable(gl.CULL_FACE);
    }

    drawInstancedMeshes(command, frameId, stats) {
        const gl = this.gl;
        const template = command.meshes[0];
        const meshes = command.meshes;
        template.initBuffers(gl, this.program);
        if (gl.createVertexArray) gl.bindVertexArray(template.vao);
        else template.vaoExtension.bindVertexArrayOES(template.vao);

        if (!this.instanceBuffer) this.instanceBuffer = gl.createBuffer();
        const instanceStride = 20;
        const requiredFloats = meshes.length * instanceStride;
        let dirty = !command.instanceData || command.instanceRevisions?.length !== meshes.length;
        if (!dirty) {
            for (let i = 0; i < meshes.length; i++) {
                if (command.instanceRevisions[i] !== meshes[i].transformRevision) { dirty = true; break; }
            }
        }
        if (dirty) {
            command.instanceData = new Float32Array(requiredFloats);
            command.instanceRevisions = new Int32Array(meshes.length);
            for (let i = 0; i < meshes.length; i++) {
                const base = i * instanceStride;
                const model = meshes[i].getModelMatrix();
                command.instanceData.set(model, base);
                const color = meshes[i].material?.color || [1, 1, 1, 1];
                command.instanceData[base + 16] = color[0] ?? 1;
                command.instanceData[base + 17] = color[1] ?? 1;
                command.instanceData[base + 18] = color[2] ?? 1;
                command.instanceData[base + 19] = color[3] ?? 1;
                command.instanceRevisions[i] = meshes[i].transformRevision;
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        if (this.instanceBufferCapacity < requiredFloats) {
            this.instanceBufferCapacity = Math.max(requiredFloats, Math.max(instanceStride * 64, this.instanceBufferCapacity * 2));
            gl.bufferData(gl.ARRAY_BUFFER, this.instanceBufferCapacity * 4, gl.DYNAMIC_DRAW);
        }
        if (dirty) gl.bufferSubData(gl.ARRAY_BUFFER, 0, command.instanceData);

        // Attribute state is stable for a template. Cache the setup on the mesh so
        // camera-only frames only bind the VAO and issue the instanced draw.
        if (!template._instancedRendererVAO) this._createInstancedVAO(template);
        if (template._instancedRendererVAO) {
            if (gl.bindVertexArray) gl.bindVertexArray(template._instancedRendererVAO);
            else template._instancedRendererVAOExt.bindVertexArrayOES(template._instancedRendererVAO);
        }

        gl.uniformMatrix4fv(this.uniforms.uModel, false, this._identity);
        gl.uniform1f(this.uniforms.uInstanced, 1);
        gl.uniform1f(this.uniforms.uToonShading, this.renderMode === 'anime' && template.material.shading === 'toon' ? 1 : 0);
        if (template.vertexWeights.size || template.skinningSignature) template.updateSkinningBuffers(gl);
        const uniforms = template.getUniformLocations(gl, this.program);
        for (const batch of template.getDrawBatches(template.opaqueFaceIndices)) {
            if (template.bakeFaceColors) gl.uniform4f(uniforms.uColor, 1, 1, 1, 1);
            else gl.uniform4fv(uniforms.uColor, batch.color);
            gl.uniform1i(uniforms.uUseTexture, 0);
            gl.uniform1f(uniforms.uFaceSelected, batch.selected ? 1 : 0);
            gl.uniform1f(uniforms.uRayShadowed, batch.shadowed ? 1 : 0);
            gl.uniform4f(uniforms.uUVTransform, batch.transform.scale[0] * (batch.transform.flipX ? -1 : 1), batch.transform.scale[1] * (batch.transform.flipY ? -1 : 1), batch.transform.offset[0], batch.transform.offset[1]);
            gl.uniform1f(uniforms.uUVRotation, batch.transform.rotation);
            gl.uniform2f(uniforms.uUVCenter, batch.uvCenter[0], batch.uvCenter[1]);
            this.drawElementsInstanced(gl.TRIANGLES, batch.count, template.indexType, batch.offset * template.indexBytes, meshes.length);
            stats.drawCalls++;
            stats.triangles += batch.count / 3 * meshes.length;
        }

        if (gl.createVertexArray) gl.bindVertexArray(null);
        else template.vaoExtension.bindVertexArrayOES(null);
    }

    _createInstancedVAO(template) {
        const gl = this.gl;
        if (!this.instanceBuffer || !template.positionBuffer || !template.normalBuffer || !template.colorBuffer || !template.uvBuffer) return;
        const vaoExt = !gl.createVertexArray ? (gl.getExtension('OES_vertex_array_object')) : null;
        const vao = gl.createVertexArray ? gl.createVertexArray() : vaoExt?.createVertexArrayOES();
        if (!vao) return;
        const bindVao = value => gl.bindVertexArray ? gl.bindVertexArray(value) : vaoExt.bindVertexArrayOES(value);
        bindVao(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, template.positionBuffer);
        gl.enableVertexAttribArray(this.uniforms.aPosition);
        gl.vertexAttribPointer(this.uniforms.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, template.normalBuffer);
        gl.enableVertexAttribArray(this.uniforms.aNormal);
        gl.vertexAttribPointer(this.uniforms.aNormal, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, template.colorBuffer);
        gl.enableVertexAttribArray(this.uniforms.aColor);
        gl.vertexAttribPointer(this.uniforms.aColor, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, template.uvBuffer);
        gl.enableVertexAttribArray(this.uniforms.aUV);
        gl.vertexAttribPointer(this.uniforms.aUV, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, template.indexBuffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        const stride = 20 * 4;
        for (let i = 0; i < 4; i++) {
            const attribute = this.uniforms.aInstance[i];
            if (attribute < 0) continue;
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, stride, i * 16);
            this.setInstanceDivisor(attribute, 1);
        }
        if (this.uniforms.aInstanceColor >= 0) {
            gl.enableVertexAttribArray(this.uniforms.aInstanceColor);
            gl.vertexAttribPointer(this.uniforms.aInstanceColor, 4, gl.FLOAT, false, stride, 64);
            this.setInstanceDivisor(this.uniforms.aInstanceColor, 1);
        }
        bindVao(null);
        template._instancedRendererVAO = vao;
        template._instancedRendererVAOExt = vaoExt;
    }

    setInstanceDivisor(attribute, divisor) {
        if (attribute < 0) return;
        if (this.isWebGL2) this.gl.vertexAttribDivisor(attribute, divisor);
        else if (this.instancingExtension) this.instancingExtension.vertexAttribDivisorANGLE(attribute, divisor);
    }

    drawElementsInstanced(mode, count, type, offset, instances) {
        if (this.isWebGL2) this.gl.drawElementsInstanced(mode, count, type, offset, instances);
        else if (this.instancingExtension) this.instancingExtension.drawElementsInstancedANGLE(mode, count, type, offset, instances);
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
        gl.depthFunc(this._depthFunc || gl.LESS);
    }
}

function getCachedWorldSphere(mesh) {
    const world = mesh?.getWorldBounds?.();
    if (world) return { x: world.center[0], y: world.center[1], z: world.center[2], r: world.radius };
    const center = mesh?.boundsCenter;
    if (!center || !mesh?.boundsRadius) return null;
    const model = mesh.getModelMatrix();
    const x = model[0] * center[0] + model[4] * center[1] + model[8] * center[2] + model[12];
    const y = model[1] * center[0] + model[5] * center[1] + model[9] * center[2] + model[13];
    const z = model[2] * center[0] + model[6] * center[1] + model[10] * center[2] + model[14];
    return { x, y, z, r: mesh.boundsRadius * Math.max(Math.hypot(model[0],model[1],model[2]), Math.hypot(model[4],model[5],model[6]), Math.hypot(model[8],model[9],model[10])) * 1.04 };
}

function unionMeshBounds(meshes) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const mesh of meshes) {
        const b = getCachedWorldSphere(mesh);
        if (!b) continue;
        minX = Math.min(minX, b.x - b.r); minY = Math.min(minY, b.y - b.r); minZ = Math.min(minZ, b.z - b.r);
        maxX = Math.max(maxX, b.x + b.r); maxY = Math.max(maxY, b.y + b.r); maxZ = Math.max(maxZ, b.z + b.r);
    }
    if (!Number.isFinite(minX)) return null;
    const x = (minX + maxX) * 0.5, y = (minY + maxY) * 0.5, z = (minZ + maxZ) * 0.5;
    return { x, y, z, r: Math.hypot(maxX - x, maxY - y, maxZ - z) };
}

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
function extractFrustumPlanes(viewProj, out = new Float32Array(24)) {
    const m = viewProj;
    setFrustumPlane(out, 0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    setFrustumPlane(out, 4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    setFrustumPlane(out, 8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    setFrustumPlane(out, 12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    setFrustumPlane(out, 16, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    setFrustumPlane(out, 20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    return out;
}

function setFrustumPlane(out, offset, x, y, z, w) {
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    out[offset] = x * inv;
    out[offset + 1] = y * inv;
    out[offset + 2] = z * inv;
    out[offset + 3] = w * inv;
}

function sphereInFrustum(planes, x, y, z, radius) {
    for (let i = 0; i < 24; i += 4) {
        if (planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3] < -radius) return false;
    }
    return true;
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


const STATIC_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec2 aUV;
uniform mat4 uViewProj;
varying vec3 vColor;
varying vec3 vNormal;
varying vec2 vUV;
void main(){
  vColor=aColor;
  vNormal=aNormal;
  vUV=aUV;
  gl_Position=uViewProj*vec4(aPosition,1.0);
}`;

const STATIC_FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vColor;varying vec3 vNormal;varying vec2 vUV;
uniform bool uUseTexture;uniform sampler2D uTexture;uniform vec4 uColor;uniform float uFaceSelected;uniform float uToonShading;uniform float uRayShadowed;uniform vec3 uLightDirection;uniform vec3 uLightColor;uniform float uLightIntensity;uniform float uLightThreshold;uniform vec3 uShadeColor;
void main(){
  vec3 color=vColor*uColor.rgb;float alpha=uColor.a;
  if(uUseTexture){vec4 texel=texture2D(uTexture,vUV);color*=texel.rgb;alpha*=texel.a;}
  if(uToonShading>0.5){
    vec3 n=normalize(vNormal);
    float ndl=max(dot(n,-uLightDirection),0.0);
    float diffuse=clamp(ndl*uLightIntensity,0.0,1.0);
    float band=smoothstep(uLightThreshold-0.055,uLightThreshold+0.055,diffuse);
    vec3 shadowTone=uShadeColor*0.82;
    vec3 litTone=mix(uShadeColor*0.96,uLightColor,0.78);
    vec3 tone=uRayShadowed>0.5?shadowTone:mix(shadowTone,litTone,band);
    float upward=max(n.y,0.0)*0.08;
    float rim=pow(1.0-max(n.z,0.0),3.0)*0.045;
    color*=tone+vec3(upward+rim);
    color+=uLightColor*pow(ndl,24.0)*0.035;
  }
  color=mix(color,vec3(1.0,0.72,0.12),uFaceSelected*0.35);
  gl_FragColor=vec4(color,alpha);
}`;

const FLAT_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec2 aUV;
attribute vec4 aInstance0;
attribute vec4 aInstance1;
attribute vec4 aInstance2;
attribute vec4 aInstance3;
attribute vec4 aInstanceColor;
uniform mat4 uModel;
uniform float uInstanced;
uniform mat4 uViewProj;
uniform vec4 uUVTransform;
uniform float uUVRotation;
uniform vec2 uUVCenter;
varying vec3 vColor;
varying vec3 vNormal;
varying vec2 vUV;
void main(){
  vColor=aColor;
  if(uInstanced>0.5)vColor*=aInstanceColor.rgb;
  vec2 uv=aUV-uUVCenter;float c=cos(uUVRotation),s=sin(uUVRotation);uv=mat2(c,-s,s,c)*uv;vUV=uv*uUVTransform.xy+uUVCenter+uUVTransform.zw;
  mat4 model=uModel;if(uInstanced>0.5)model=mat4(aInstance0,aInstance1,aInstance2,aInstance3);
  vec3 modelScale=vec3(length(model[0].xyz),length(model[1].xyz),length(model[2].xyz));
  vec3 inverseSquaredScale=vec3(1.0)/max(modelScale*modelScale,vec3(0.0000001));
  vNormal=normalize(mat3(model)*(aNormal*inverseSquaredScale));
  gl_Position=uViewProj*model*vec4(aPosition,1.0);
}`;
const FLAT_FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vColor;varying vec3 vNormal;varying vec2 vUV;
uniform bool uUseTexture;uniform sampler2D uTexture;uniform vec4 uColor;uniform float uFaceSelected;uniform float uToonShading;uniform float uRayShadowed;uniform vec3 uLightDirection;uniform vec3 uLightColor;uniform float uLightIntensity;uniform float uLightThreshold;uniform vec3 uShadeColor;
void main(){
  vec3 color=vColor*uColor.rgb;float alpha=uColor.a;
  if(uUseTexture){vec4 texel=texture2D(uTexture,vUV);color*=texel.rgb;alpha*=texel.a;}
  if(uToonShading>0.5){
    vec3 n=normalize(vNormal);
    float ndl=max(dot(n,-uLightDirection),0.0);
    float diffuse=clamp(ndl*uLightIntensity,0.0,1.0);
    float band=smoothstep(uLightThreshold-0.055,uLightThreshold+0.055,diffuse);
    vec3 shadowTone=uShadeColor*0.82;
    vec3 litTone=mix(uShadeColor*0.96,uLightColor,0.78);
    vec3 tone=uRayShadowed>0.5?shadowTone:mix(shadowTone,litTone,band);
    float upward=max(n.y,0.0)*0.08;
    float rim=pow(1.0-max(n.z,0.0),3.0)*0.045;
    color*=tone+vec3(upward+rim);
    color+=uLightColor*pow(ndl,24.0)*0.035;
  }
  color=mix(color,vec3(1.0,0.72,0.12),uFaceSelected*0.35);
  gl_FragColor=vec4(color,alpha);
}`;

function commandDistanceSq(command, cameraPosition){
    let x = 0, y = 0, z = 0;
    if (command.bounds) {
        x = command.bounds.x; y = command.bounds.y; z = command.bounds.z;
    } else if (command.batch?.boundsCenter) {
        x = command.batch.boundsCenter[0]; y = command.batch.boundsCenter[1]; z = command.batch.boundsCenter[2];
    }
    const dx = x - cameraPosition[0], dy = y - cameraPosition[1], dz = z - cameraPosition[2];
    return dx * dx + dy * dy + dz * dz;
}

function commandStableId(command){
    if (command.kind === 'staticBatch') return Number(command.batch?.id) || 0;
    if (command.kind === 'mesh') return Number(command.mesh?.id) || 0;
    return Number(command.meshes?.[0]?.id) || 0;
}

function distanceSqToBatch(batch,camera){const c=batch.boundsCenter;const dx=c[0]-camera.position[0],dy=c[1]-camera.position[1],dz=c[2]-camera.position[2];return dx*dx+dy*dy+dz*dz;}
function batchInFrustumFast(batch, planes, margin = 0){const c=batch.boundsCenter;return !!c&&sphereInFrustum(planes,c[0],c[1],c[2],(batch.boundsRadius||0)*(1+Math.max(0,margin)));}
