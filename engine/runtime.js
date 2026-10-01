/**
 * Lightweight Game Runtime – run a scene without the full editor overhead.
 * Supports update loop, simple input, AABB physics, first-person walk mode,
 * fly camera, and play/pause. Designed for anime-style flat-shaded scenes.
 */
import { Scene } from './scene.js';
import { Camera } from './camera.js';

export class GameRuntime {
    constructor(renderer, scene, camera, options = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.playing = false;
        this.timeScale = 1;
        this.elapsed = 0;
        this.input = new InputManager();
        this.physics = new SimplePhysics(scene);
        this.scripts = new Map();
        this.onUpdate = options.onUpdate || null;
        this.onRender = options.onRender || null;
        this.lastTime = performance.now();
        this._raf = null;
        this.fixedDt = 1 / 60;
        this.accumulator = 0;
        this._fpsState = null;
        this._pointerLocked = false;
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.lastTime = performance.now();
        this.loop();
    }

    pause() {
        this.playing = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
        this._releasePointerLock();
    }

    stop() {
        this.pause();
        this.elapsed = 0;
        this.scene.meshes.forEach(m => {
            if (m.animationPlayer) m.animationPlayer.stop();
        });
    }

    loop = () => {
        if (!this.playing) return;
        const now = performance.now();
        let dt = Math.min(0.1, (now - this.lastTime) / 1000) * this.timeScale;
        this.lastTime = now;
        this.elapsed += dt;

        this.accumulator += dt;
        while (this.accumulator >= this.fixedDt) {
            this.fixedUpdate(this.fixedDt);
            this.accumulator -= this.fixedDt;
        }
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
        this.onRender?.(this);
        this._raf = requestAnimationFrame(this.loop);
    };

    fixedUpdate(dt) {
        this.physics.step(dt);
    }

    update(dt) {
        this.input.update();
        this.scene.update(dt);
        for (const [key, fn] of this.scripts) {
            try { fn(dt, this); } catch (e) { console.warn('Script error', key, e); }
        }
        this.onUpdate?.(dt, this);
    }

    addScript(key, updateFn) {
        this.scripts.set(key, updateFn);
    }

    removeScript(key) {
        this.scripts.delete(key);
    }

    /**
     * Free-fly camera (no gravity). WASD move, Q/E down/up, RMB or Shift+LMB look.
     */
    enableFlyCamera(speed = 4) {
        this.removeScript('__firstPerson');
        this.addScript('__flyCamera', (dt) => {
            const cam = this.camera;
            if (cam.viewMode !== 'perspective') return;
            const forward = normalize([
                cam.target[0] - cam.position[0],
                cam.target[1] - cam.position[1],
                cam.target[2] - cam.position[2]
            ]);
            const right = normalize(cross(forward, cam.up || [0, 1, 0]));
            const move = (dir, amount) => {
                for (let i = 0; i < 3; i++) {
                    cam.position[i] += dir[i] * amount;
                    cam.target[i] += dir[i] * amount;
                }
            };
            if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) move(forward, speed * dt);
            if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) move(forward, -speed * dt);
            if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) move(right, -speed * dt);
            if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) move(right, speed * dt);
            if (this.input.isDown('KeyQ')) move([0, 1, 0], -speed * dt);
            if (this.input.isDown('KeyE')) move([0, 1, 0], speed * dt);
            if (this.input.mouseButtons[2] || (this.input.mouseButtons[0] && this.input.isDown('ShiftLeft'))) {
                const sens = 0.002;
                const yaw = -this.input.mouseDelta[0] * sens;
                const pitch = -this.input.mouseDelta[1] * sens;
                const offset = [
                    cam.position[0] - cam.target[0],
                    cam.position[1] - cam.target[1],
                    cam.position[2] - cam.target[2]
                ];
                const dist = Math.hypot(...offset) || 1;
                let yawA = Math.atan2(offset[0], offset[2]) + yaw;
                let pitchA = Math.asin(Math.max(-0.99, Math.min(0.99, offset[1] / dist))) + pitch;
                cam.position[0] = cam.target[0] + dist * Math.sin(yawA) * Math.cos(pitchA);
                cam.position[1] = cam.target[1] + dist * Math.sin(pitchA);
                cam.position[2] = cam.target[2] + dist * Math.cos(yawA) * Math.cos(pitchA);
            }
            this.input.mouseDelta[0] = 0;
            this.input.mouseDelta[1] = 0;
        });
    }

    /**
     * First-person walk mode with gravity and AABB collision against scene meshes.
     * WASD move, Space jump, Shift sprint, mouse look (click canvas to lock pointer).
     */
    enableFirstPersonCamera(options = {}) {
        const {
            speed = 6,
            sprintMultiplier = 1.75,
            eyeHeight = 1.7,
            radius = 0.35,
            gravity = -22,
            jumpSpeed = 8.5,
            mouseSensitivity = 0.0022
        } = options;

        this.removeScript('__flyCamera');
        this.physics.rebuildStaticColliders();

        const cam = this.camera;
        cam.viewMode = 'perspective';
        // Keep far plane large enough for city exploration
        if (cam.far < 250) cam.far = 250;

        const state = {
            yaw: Math.atan2(
                (cam.target[0] - cam.position[0]),
                (cam.target[2] - cam.position[2])
            ),
            pitch: 0,
            velocityY: 0,
            grounded: false,
            // feet position (camera is eyeHeight above feet)
            x: cam.position[0],
            y: Math.max(0.05, cam.position[1] - eyeHeight),
            z: cam.position[2]
        };
        this._fpsState = state;

        // Click-to-lock pointer for smoother look
        const canvas = this.renderer?.canvas || document.getElementById('viewport');
        const onClick = () => {
            if (!this.playing) return;
            canvas?.requestPointerLock?.();
        };
        const onLockChange = () => {
            this._pointerLocked = document.pointerLockElement === canvas;
        };
        canvas?.addEventListener('click', onClick);
        document.addEventListener('pointerlockchange', onLockChange);
        this._fpsCleanup = () => {
            canvas?.removeEventListener('click', onClick);
            document.removeEventListener('pointerlockchange', onLockChange);
            this._releasePointerLock();
        };

        this.addScript('__firstPerson', (dt) => {
            if (cam.viewMode !== 'perspective') return;

            // Mouse look: pointer lock OR hold RMB / Shift+LMB
            const lookActive = this._pointerLocked
                || this.input.mouseButtons[2]
                || (this.input.mouseButtons[0] && this.input.isDown('ShiftLeft'));
            if (lookActive) {
                state.yaw -= this.input.mouseDelta[0] * mouseSensitivity;
                state.pitch -= this.input.mouseDelta[1] * mouseSensitivity;
                state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch));
            }
            this.input.mouseDelta[0] = 0;
            this.input.mouseDelta[1] = 0;

            const forward = [Math.sin(state.yaw), 0, Math.cos(state.yaw)];
            const right = [Math.cos(state.yaw), 0, -Math.sin(state.yaw)];

            let moveX = 0;
            let moveZ = 0;
            if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) {
                moveX += forward[0];
                moveZ += forward[2];
            }
            if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) {
                moveX -= forward[0];
                moveZ -= forward[2];
            }
            if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) {
                moveX -= right[0];
                moveZ -= right[2];
            }
            if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) {
                moveX += right[0];
                moveZ += right[2];
            }

            const len = Math.hypot(moveX, moveZ);
            if (len > 1e-6) {
                moveX /= len;
                moveZ /= len;
            }

            const sprint = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
            const moveSpeed = speed * (sprint && !lookActive ? sprintMultiplier : sprint && this._pointerLocked ? sprintMultiplier : 1);
            // When looking with Shift+LMB, don't sprint from that same Shift — only sprint if pointer-locked or separate
            const effectiveSpeed = (this._pointerLocked || !lookActive) && sprint ? speed * sprintMultiplier : speed;

            const dx = moveX * effectiveSpeed * dt;
            const dz = moveZ * effectiveSpeed * dt;

            // Horizontal collision (slide along walls)
            const tryMove = (nx, nz) => {
                if (!this.physics.collidesCapsule(nx, state.y, nz, radius, eyeHeight * 0.9)) {
                    state.x = nx;
                    state.z = nz;
                    return true;
                }
                return false;
            };
            if (!tryMove(state.x + dx, state.z + dz)) {
                if (!tryMove(state.x + dx, state.z)) {
                    tryMove(state.x, state.z + dz);
                }
            }

            // Gravity + jump
            if (state.grounded && (this.input.isDown('Space') || this.input.isDown('KeySpace'))) {
                state.velocityY = jumpSpeed;
                state.grounded = false;
            }
            state.velocityY += gravity * dt;
            let newY = state.y + state.velocityY * dt;

            // Ground / floor probes against static colliders
            const groundY = this.physics.groundHeight(state.x, state.z, radius, state.y, 0.55);
            if (newY <= groundY) {
                newY = groundY;
                state.velocityY = 0;
                state.grounded = true;
            } else {
                state.grounded = false;
            }

            // Ceiling / building tops: if moving up into a collider, stop
            if (state.velocityY > 0 && this.physics.collidesCapsule(state.x, newY, state.z, radius, eyeHeight * 0.9)) {
                state.velocityY = 0;
                // settle just below obstacle
                newY = state.y;
            }

            state.y = newY;

            // Apply to camera (eye position + look target)
            const eyeY = state.y + eyeHeight;
            const lookDist = 1;
            cam.position[0] = state.x;
            cam.position[1] = eyeY;
            cam.position[2] = state.z;
            cam.target[0] = state.x + Math.sin(state.yaw) * Math.cos(state.pitch) * lookDist;
            cam.target[1] = eyeY + Math.sin(state.pitch) * lookDist;
            cam.target[2] = state.z + Math.cos(state.yaw) * Math.cos(state.pitch) * lookDist;
        });
    }

    _releasePointerLock() {
        if (document.pointerLockElement) {
            document.exitPointerLock?.();
        }
        this._pointerLocked = false;
        this._fpsCleanup?.();
        this._fpsCleanup = null;
    }
}

class InputManager {
    constructor() {
        this.keys = new Set();
        this.mouseButtons = [false, false, false];
        this.mouseDelta = [0, 0];
        this.mousePos = [0, 0];
        window.addEventListener('keydown', e => this.keys.add(e.code));
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        window.addEventListener('mousedown', e => { this.mouseButtons[e.button] = true; });
        window.addEventListener('mouseup', e => { this.mouseButtons[e.button] = false; });
        window.addEventListener('mousemove', e => {
            this.mouseDelta[0] += e.movementX;
            this.mouseDelta[1] += e.movementY;
            this.mousePos[0] = e.clientX;
            this.mousePos[1] = e.clientY;
        });
        window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.fill(false); });
    }
    isDown(code) { return this.keys.has(code); }
    update() {}
}

/**
 * Dynamic rigid bodies + static mesh AABB colliders for first-person / platformer use.
 * Assumes meshes are axis-aligned boxes (position + scale of unit cube geometry).
 */
class SimplePhysics {
    constructor(scene) {
        this.scene = scene;
        this.bodies = new Map();
        this.staticColliders = [];
    }

    addBody(mesh, { velocity = [0, 0, 0], gravity = -9.8, radius = 0.5 } = {}) {
        this.bodies.set(mesh, { velocity: [...velocity], gravity, radius, grounded: false });
    }

    removeBody(mesh) {
        this.bodies.delete(mesh);
    }

    /** Build AABB list from all scene meshes (for player collision). */
    rebuildStaticColliders() {
        this.staticColliders = [];
        for (const mesh of this.scene.meshes) {
            const box = meshWorldAABB(mesh);
            if (!box) continue;
            // Skip extremely flat decorative strips if desired — keep all for solid city feel
            this.staticColliders.push(box);
        }
    }

    /**
     * Highest standable surface under (x,z) at or below refY + stepHeight.
     * Returns y of standable top face, or 0 as default floor.
     */
    groundHeight(x, z, radius = 0.3, refY = 2, stepHeight = 0.55) {
        let best = 0; // default infinite ground plane at y=0
        const maxStand = refY + stepHeight;
        for (const box of this.staticColliders) {
            if (x + radius <= box.minX || x - radius >= box.maxX) continue;
            if (z + radius <= box.minZ || z - radius >= box.maxZ) continue;
            // Only surfaces we can step onto or stand on (not building roofs high above)
            if (box.maxY > best && box.maxY <= maxStand) {
                best = box.maxY;
            }
        }
        return best;
    }

    /** Capsule-ish test: vertical segment from y to y+height with horizontal radius. */
    collidesCapsule(x, y, z, radius, height) {
        const minY = y;
        const maxY = y + height;
        for (const box of this.staticColliders) {
            if (x + radius <= box.minX || x - radius >= box.maxX) continue;
            if (z + radius <= box.minZ || z - radius >= box.maxZ) continue;
            if (maxY <= box.minY || minY >= box.maxY) continue;
            return true;
        }
        return false;
    }

    step(dt) {
        for (const [mesh, body] of this.bodies) {
            if (!this.scene.meshes.includes(mesh)) continue;
            body.velocity[1] += body.gravity * dt;
            mesh.position[0] += body.velocity[0] * dt;
            mesh.position[1] += body.velocity[1] * dt;
            mesh.position[2] += body.velocity[2] * dt;

            // Dynamic body vs static colliders
            if (this.staticColliders.length) {
                const r = body.radius;
                let grounded = false;
                for (const box of this.staticColliders) {
                    const px = mesh.position[0], py = mesh.position[1], pz = mesh.position[2];
                    if (Math.abs(px - (box.minX + box.maxX) * 0.5) > (box.maxX - box.minX) * 0.5 + r) continue;
                    if (Math.abs(pz - (box.minZ + box.maxZ) * 0.5) > (box.maxZ - box.minZ) * 0.5 + r) continue;
                    const bottom = py - r;
                    if (bottom < box.maxY && py + r > box.minY && body.velocity[1] <= 0) {
                        mesh.position[1] = box.maxY + r;
                        body.velocity[1] = 0;
                        grounded = true;
                    }
                }
                body.grounded = grounded;
            } else if (mesh.position[1] - body.radius < 0) {
                mesh.position[1] = body.radius;
                body.velocity[1] = 0;
                body.grounded = true;
            } else {
                body.grounded = false;
            }

            for (const other of this.scene.meshes) {
                if (other === mesh || !this.bodies.has(other)) continue;
                if (aabbOverlap(mesh, other)) {
                    const dy = (mesh.position[1] - other.position[1]);
                    if (Math.abs(dy) < 1.2) {
                        mesh.position[1] += Math.sign(dy || 1) * 0.05;
                        body.velocity[1] = 0;
                    }
                }
            }
            mesh.invalidateTransformCache?.();
            mesh.transformRevision = (mesh.transformRevision || 0) + 1;
        }
    }
}

function meshWorldAABB(mesh) {
    if (!mesh || !mesh.position || !mesh.scale) return null;
    const px = mesh.position[0], py = mesh.position[1], pz = mesh.position[2];
    const sx = Math.abs(mesh.scale[0]) * 0.5;
    const sy = Math.abs(mesh.scale[1]) * 0.5;
    const sz = Math.abs(mesh.scale[2]) * 0.5;
    // Ignore degenerate
    if (sx < 1e-6 && sy < 1e-6 && sz < 1e-6) return null;
    return {
        minX: px - sx, maxX: px + sx,
        minY: py - sy, maxY: py + sy,
        minZ: pz - sz, maxZ: pz + sz,
        mesh
    };
}

function aabbOverlap(a, b) {
    const ra = 0.5, rb = 0.5;
    return Math.abs(a.position[0] - b.position[0]) < ra + rb &&
           Math.abs(a.position[1] - b.position[1]) < ra + rb &&
           Math.abs(a.position[2] - b.position[2]) < ra + rb;
}

function normalize(v) {
    const l = Math.hypot(...v) || 1;
    return v.map(x => x / l);
}
function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
