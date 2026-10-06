import { Mesh } from './mesh.js';
import { Material } from './material.js';
import { AnimationClip } from './animation.js';

/**
 * Low-poly anime third-person player. Deliberately uses angular, tapered solids
 * rather than spheres so joints retain a coherent PS1-style silhouette.
 */
export class PlayerCharacter {
    constructor({ name = 'Player Character', spawn = [0, 0, 0] } = {}) {
        this.name = name;
        this.spawn = [...spawn];
        this.mesh = createPlayerMesh(name);
        this.mesh.runtimeOnly = true;
        this.mesh.playerCharacter = this;
        this.animations = createPlayerAnimations();
        this.state = 'idle';
        this.scene = null;
        this.body = null;
        this.yaw = 0;
        this.cameraYaw = 0;
        this.cameraPitch = 15 * Math.PI / 180;
        this.cameraDistance = 4.8;
        this.cameraTargetHeight = 1.12;
        this.moveSpeed = 5.2;
        this.sprintMultiplier = 1.8;
        this.jumpSpeed = 8.8;
        this.mouseSensitivity = 0.0023;
        this.cameraSmoothing = 0.18;
        this._lastMoving = false;
        this._lastSprinting = false;
        this._lastAirborne = false;
        this._cameraArrowSpeed = 1.85;
    }

    addToScene(scene, spawn = this.spawn) {
        if (!scene) return this.mesh;
        this.scene = scene;
        this.spawn = [...spawn];
        this.mesh.position = [...this.spawn];
        if (!scene.meshes.includes(this.mesh)) scene.add(this.mesh);
        this.mesh.animationPlayer.play(this.animations.idle, 0);
        return this.mesh;
    }

    removeFromScene() {
        if (this.scene?.meshes.includes(this.mesh)) this.scene.remove(this.mesh);
        this.body = null;
        this.scene = null;
    }

    setBody(body) { this.body = body; }

    prePhysics(dt, input) {
        if (!this.body) return;
        const orbitYaw = this.cameraYaw;
        const forward = [-Math.sin(orbitYaw), 0, -Math.cos(orbitYaw)];
        const right = [Math.cos(orbitYaw), 0, -Math.sin(orbitYaw)];
        let x = 0, z = 0;
        // Arrow keys intentionally belong to the third-person camera, not movement.
        if (input.isDown('KeyW')) { x += forward[0]; z += forward[2]; }
        if (input.isDown('KeyS')) { x -= forward[0]; z -= forward[2]; }
        if (input.isDown('KeyD')) { x += right[0]; z += right[2]; }
        if (input.isDown('KeyA')) { x -= right[0]; z -= right[2]; }
        const length = Math.hypot(x, z);
        const moving = length > 0.001;
        const sprinting = moving && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
        const speed = this.moveSpeed * (sprinting ? this.sprintMultiplier : 1);
        const velocity = this.body.velocity;
        if (moving) {
            x /= length; z /= length;
            velocity[0] = x * speed;
            velocity[2] = z * speed;
            const targetYaw = Math.atan2(-x, -z);
            this.yaw = dampAngle(this.yaw, targetYaw, 1 - Math.exp(-14 * dt));
            this.mesh.rotation[1] = this.yaw;
        } else {
            const drag = Math.pow(0.0008, dt);
            velocity[0] *= drag;
            velocity[2] *= drag;
        }

        if (input.isDown('Space') && this.body.grounded && !this._jumpHeld) {
            velocity[1] = this.jumpSpeed;
            this.body.grounded = false;
            this._jumpHeld = true;
        }
        if (!input.isDown('Space')) this._jumpHeld = false;
        this._moving = moving;
        this._sprinting = sprinting;
    }

    postPhysics(dt, input, camera) {
        if (!this.body) return;
        const airborne = !this.body.grounded;
        let nextState = 'idle';
        if (airborne) nextState = this.body.velocity[1] > 0.25 ? 'jump' : 'fall';
        else if (this._moving) nextState = this._sprinting ? 'run' : 'walk';
        if (nextState !== this.state) {
            this.state = nextState;
            const clip = this.animations[nextState] || this.animations.idle;
            this.mesh.animationPlayer.play(clip, 0);
        }

        // Camera orbit: mouse plus arrow-key look.
        const delta = input.mouseDelta;
        if (input.mouseButtons[2] || (input.mouseButtons[0] && input.isDown('ShiftLeft'))) {
            this.cameraYaw -= delta[0] * this.mouseSensitivity;
            this.cameraPitch = clamp(this.cameraPitch - delta[1] * this.mouseSensitivity, 6 * Math.PI / 180, 70 * Math.PI / 180);
        }
        const arrowYaw = (input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0);
        const arrowPitch = (input.isDown('ArrowDown') ? 1 : 0) - (input.isDown('ArrowUp') ? 1 : 0);
        this.cameraYaw += arrowYaw * this._cameraArrowSpeed * dt;
        this.cameraPitch = clamp(this.cameraPitch + arrowPitch * this._cameraArrowSpeed * 0.72 * dt, 6 * Math.PI / 180, 70 * Math.PI / 180);

        const target = [this.mesh.position[0], this.mesh.position[1] + this.cameraTargetHeight, this.mesh.position[2]];
        const horizontal = this.cameraDistance * Math.cos(this.cameraPitch);
        const vertical = this.cameraDistance * Math.sin(this.cameraPitch);
        const desired = [
            target[0] + Math.sin(this.cameraYaw) * horizontal,
            target[1] + vertical,
            target[2] + Math.cos(this.cameraYaw) * horizontal
        ];
        const smoothing = 1 - Math.exp(-12 * dt);
        for (let i = 0; i < 3; i++) {
            camera.position[i] += (desired[i] - camera.position[i]) * smoothing;
            camera.target[i] += (target[i] - camera.target[i]) * smoothing;
        }
        camera.far = Math.max(camera.far, 700);
        input.mouseDelta[0] = 0;
        input.mouseDelta[1] = 0;
    }
}

function createPlayerMesh(name) {
    const geometry = buildGeometry();
    const material = new Material({
        name: 'Player Anime Silhouette',
        color: [0.008, 0.008, 0.012],
        baseColor: [0.008, 0.008, 0.012],
        opacity: 1,
        shading: 'toon',
        roughness: 0.86,
        metallic: 0,
        useTexture: false,
        doubleSided: false
    });
    const mesh = new Mesh(material);
    mesh.setTopology(geometry.positions, geometry.faces);
    mesh.name = name;
    mesh.faceColors = geometry.faceMaterials.map(type => type === 'eye' ? [1, 1, 1, 1] : [0.008, 0.008, 0.012, 1]);
    mesh.faceUvs = geometry.faces.map(face => face.map(() => [0, 0]));

    const bones = createRig(mesh);
    for (let i = 0; i < geometry.vertexWeights.length; i++) {
        const entries = geometry.vertexWeights[i];
        if (!entries?.length) continue;
        const weights = new Map();
        let total = 0;
        for (const [boneName, weight] of entries) {
            const bone = bones.get(boneName);
            if (!bone || weight <= 0) continue;
            weights.set(bone, weight);
            total += weight;
        }
        if (weights.size) {
            if (total > 0 && Math.abs(total - 1) > 0.0001) {
                weights.forEach((value, bone) => weights.set(bone, value / total));
            }
            mesh.vertexWeights.set(i, { bindPosition: [...mesh.positions[i]], weights });
        }
    }
    mesh.rebuildRenderData();
    mesh.selectedFace = -1;
    mesh.selectedVertex = null;
    return mesh;
}

function createRig(mesh) {
    const root = mesh.skeleton.addBone('Root');
    root.position = [0, 0, 0];
    root.length = 0.2;
    root.bindPosition = [...root.position];

    const pelvis = addBone(mesh, 'Pelvis', root, [0, 0.72, 0], 0.24);
    const spine = addBone(mesh, 'Spine', pelvis, [0, 0.25, 0], 0.30);
    const chest = addBone(mesh, 'Chest', spine, [0, 0.31, 0], 0.26);
    const neck = addBone(mesh, 'Neck', chest, [0, 0.18, 0], 0.15);
    addBone(mesh, 'Head', neck, [0, 0.20, 0], 0.36);

    const armL = addBone(mesh, 'UpperArm.L', chest, [-0.36, 0.01, 0], 0.31);
    addBone(mesh, 'ForeArm.L', armL, [-0.30, -0.27, 0], 0.25);
    addBone(mesh, 'Hand.L', mesh.skeleton.find('ForeArm.L'), [-0.035, -0.23, -0.01], 0.14);
    const armR = addBone(mesh, 'UpperArm.R', chest, [0.36, 0.01, 0], 0.31);
    addBone(mesh, 'ForeArm.R', armR, [0.30, -0.27, 0], 0.25);
    addBone(mesh, 'Hand.R', mesh.skeleton.find('ForeArm.R'), [0.035, -0.23, -0.01], 0.14);

    const legL = addBone(mesh, 'UpperLeg.L', pelvis, [-0.21, -0.10, 0], 0.37);
    addBone(mesh, 'LowerLeg.L', legL, [0, -0.36, 0], 0.26);
    addBone(mesh, 'Foot.L', mesh.skeleton.find('LowerLeg.L'), [0, -0.24, -0.07], 0.20);
    const legR = addBone(mesh, 'UpperLeg.R', pelvis, [0.21, -0.10, 0], 0.37);
    addBone(mesh, 'LowerLeg.R', legR, [0, -0.36, 0], 0.26);
    addBone(mesh, 'Foot.R', mesh.skeleton.find('LowerLeg.R'), [0, -0.24, -0.07], 0.20);
    return new Map(mesh.skeleton.bones.map(bone => [bone.name, bone]));
}

function addBone(mesh, name, parent, position, length) {
    const bone = mesh.skeleton.addBone(name, parent);
    bone.position = [...position];
    bone.bindPosition = [...position];
    bone.bindRotation = [0, 0, 0];
    bone.bindScale = [1, 1, 1];
    bone.length = length;
    return bone;
}

function buildGeometry() {
    const positions = [];
    const faces = [];
    const faceMaterials = [];
    const vertexWeights = [];

    const addVertex = (p, weights) => {
        positions.push([...p]);
        vertexWeights.push(weights ? [...weights] : []);
        return positions.length - 1;
    };
    const addTriangle = (a, b, c, material = 'body') => {
        faces.push([a, b, c]);
        faceMaterials.push(material);
    };

    // Low-poly tapered solid with a beveled middle ring. The overlap at joints,
    // plus mixed weights around the joint rings, keeps animation transitions clean.
    const addPart = ({start, end, r0, r1, segments = 9, boneA, boneB = boneA, zScale = 1, cap = true}) => {
        const axis = normalize(sub(end, start));
        const basisA = normalize(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
        const basisB = cross(axis, basisA);
        const rings = [];
        for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
            const t = ringIndex / 2;
            const center = lerp(start, end, t);
            const radius = r0 * (1 - t) + r1 * t;
            const ring = [];
            const wA = ringIndex === 0 ? 1 : ringIndex === 1 ? 0.62 : 0.12;
            const wB = 1 - wA;
            const weights = boneA === boneB ? [[boneA, 1]] : [[boneA, wA], [boneB, wB]];
            for (let i = 0; i < segments; i++) {
                const a = Math.PI * 2 * i / segments;
                const c = Math.cos(a), s = Math.sin(a);
                ring.push(addVertex(add(center, add(scale(basisA, radius * c), scale(basisB, radius * s * zScale))), weights));
            }
            rings.push(ring);
        }
        for (let r = 0; r < 2; r++) {
            for (let i = 0; i < segments; i++) {
                const j = (i + 1) % segments;
                addTriangle(rings[r][i], rings[r + 1][i], rings[r + 1][j]);
                addTriangle(rings[r][i], rings[r + 1][j], rings[r][j]);
            }
        }
        if (cap) {
            const a = addVertex(start, [[boneA, 1]]);
            const b = addVertex(end, [[boneB, 1]]);
            for (let i = 0; i < segments; i++) {
                const j = (i + 1) % segments;
                addTriangle(a, rings[0][j], rings[0][i]);
                addTriangle(b, rings[2][i], rings[2][j]);
            }
        }
    };

    // Torso/pelvis: broad shoulders tapering into a narrow waist, all part of one silhouette.
    addPart({start:[0,0.58,0], end:[0,0.84,0], r0:0.30, r1:0.34, zScale:0.84, boneA:'Pelvis', boneB:'Spine'});
    addPart({start:[0,0.82,0], end:[0,1.18,0], r0:0.34, r1:0.31, zScale:0.78, boneA:'Spine', boneB:'Chest'});
    addPart({start:[0,1.16,0], end:[0,1.40,0], r0:0.31, r1:0.40, zScale:0.72, boneA:'Chest'});

    // Arms, with wide shoulder-to-elbow taper and cleaner forearms.
    addPart({start:[-0.36,1.39,0], end:[-0.66,1.04,0], r0:0.14, r1:0.115, segments:8, boneA:'UpperArm.L', boneB:'ForeArm.L', zScale:0.78});
    addPart({start:[-0.66,1.04,0], end:[-0.70,0.73,0], r0:0.115, r1:0.08, segments:8, boneA:'ForeArm.L', boneB:'Hand.L', zScale:0.75});
    addPart({start:[-0.70,0.75,-0.005], end:[-0.72,0.57,-0.045], r0:0.085, r1:0.07, segments:8, boneA:'Hand.L', zScale:0.82});
    addPart({start:[0.36,1.39,0], end:[0.66,1.04,0], r0:0.14, r1:0.115, segments:8, boneA:'UpperArm.R', boneB:'ForeArm.R', zScale:0.78});
    addPart({start:[0.66,1.04,0], end:[0.70,0.73,0], r0:0.115, r1:0.08, segments:8, boneA:'ForeArm.R', boneB:'Hand.R', zScale:0.75});
    addPart({start:[0.70,0.75,-0.005], end:[0.72,0.57,-0.045], r0:0.085, r1:0.07, segments:8, boneA:'Hand.R', zScale:0.82});

    // Legs: strong anime proportions and angular boots.
    addPart({start:[-0.21,0.62,0], end:[-0.22,0.28,0], r0:0.145, r1:0.115, segments:8, boneA:'UpperLeg.L', boneB:'LowerLeg.L', zScale:0.72});
    addPart({start:[-0.22,0.28,0], end:[-0.22,0.03,0], r0:0.115, r1:0.085, segments:8, boneA:'LowerLeg.L', boneB:'Foot.L', zScale:0.68});
    addPart({start:[-0.22,0.06,-0.02], end:[-0.22,-0.10,-0.13], r0:0.095, r1:0.10, segments:8, boneA:'Foot.L', zScale:0.92});
    addPart({start:[0.21,0.62,0], end:[0.22,0.28,0], r0:0.145, r1:0.115, segments:8, boneA:'UpperLeg.R', boneB:'LowerLeg.R', zScale:0.72});
    addPart({start:[0.22,0.28,0], end:[0.22,0.03,0], r0:0.115, r1:0.085, segments:8, boneA:'LowerLeg.R', boneB:'Foot.R', zScale:0.68});
    addPart({start:[0.22,0.06,-0.02], end:[0.22,-0.10,-0.13], r0:0.095, r1:0.10, segments:8, boneA:'Foot.R', zScale:0.92});

    // Neck and angular anime head: jaw is tapered, not spherical.
    addPart({start:[0,1.39,0], end:[0,1.58,0], r0:0.10, r1:0.105, segments:8, boneA:'Neck', boneB:'Head', zScale:0.82});
    addPart({start:[0,1.56,0], end:[0,1.78,0], r0:0.19, r1:0.23, segments:8, boneA:'Head', zScale:0.88});
    addPart({start:[0,1.77,0], end:[0,1.98,0], r0:0.23, r1:0.16, segments:8, boneA:'Head', zScale:0.90});

    // Seven angular hair spikes, deliberately wedge-like rather than rounded.
    const spikes = [
        [-0.22, 1.93, 0.00, -0.42, 2.13, 0.05],
        [-0.10, 2.00, -0.04, -0.18, 2.28, -0.01],
        [0.00, 2.02, -0.05, 0.05, 2.34, -0.02],
        [0.12, 2.00, -0.04, 0.28, 2.29, 0.00],
        [0.22, 1.94, 0.00, 0.49, 2.13, 0.05],
        [-0.12, 1.99, 0.12, -0.27, 2.17, 0.25],
        [0.10, 1.99, 0.12, 0.23, 2.17, 0.25]
    ];
    for (const [sx,sy,sz,tx,ty,tz] of spikes) addSpike([sx,sy,sz],[tx,ty,tz],'Head');

    // White polygonal eyes: 10 triangles per eye.
    addEye(-0.076, 1.78, -0.220, 0.067, 10, 'Head');
    addEye(0.076, 1.78, -0.220, 0.067, 10, 'Head');

    return { positions, faces, faceMaterials, vertexWeights };

    function addSpike(base, tip, bone) {
        const dir = normalize(sub(tip, base));
        const sideA = normalize(cross(dir, [0, 1, 0]));
        const sideB = normalize(cross(dir, sideA));
        const b0 = addVertex(add(base, scale(sideA, 0.07)), [[bone, 1]]);
        const b1 = addVertex(add(base, scale(sideA, -0.07)), [[bone, 1]]);
        const b2 = addVertex(add(base, scale(sideB, 0.055)), [[bone, 1]]);
        const tipI = addVertex(tip, [[bone, 1]]);
        addTriangle(b0,b1,tipI);
        addTriangle(b1,b2,tipI);
        addTriangle(b2,b0,tipI);
        addTriangle(b2,b1,b0);
    }

    function addEye(cx, cy, cz, radius, segments, bone) {
        const center = addVertex([cx,cy,cz], [[bone,1]]);
        const ring=[];
        for (let i=0;i<segments;i++) {
            const a = 2*Math.PI*i/segments;
            ring.push(addVertex([cx+radius*Math.cos(a),cy+radius*Math.sin(a),cz], [[bone,1]]));
        }
        for (let i=0;i<segments;i++) addTriangle(center,ring[(i+1)%segments],ring[i],'eye');
    }
}

function createPlayerAnimations() {
    const idle = new AnimationClip('Idle', 2.0);
    const walk = new AnimationClip('Walk', 0.8);
    const run = new AnimationClip('Run', 0.55);
    const jump = new AnimationClip('Jump', 0.7);
    const fall = new AnimationClip('Fall', 0.7);

    key(idle, 'Spine', 'rotation', [[0, 0, 0], [0.5, 0.02, 0], [1, 0, 0], [1.5, -0.02, 0], [2, 0, 0]], [0, 0.025, 0, -0.025, 0]);
    key(idle, 'Head', 'rotation', [[0, 0, 0], [1, 0.03, 0], [2, 0, 0]], [0, 0.035, 0]);
    addCycle(walk, 0.8, 0.45, 0.55);
    addCycle(run, 0.55, 0.75, 0.82);

    key(jump, 'UpperArm.L', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0.65, -1.05, -0.9]);
    key(jump, 'UpperArm.R', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0.65, -1.05, -0.9]);
    key(jump, 'UpperLeg.L', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0, 0.20, 0.12]);
    key(jump, 'UpperLeg.R', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0, -0.20, -0.12]);
    key(fall, 'UpperArm.L', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0.2, 0.5, 0.45]);
    key(fall, 'UpperArm.R', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0.2, 0.5, 0.45]);
    key(fall, 'UpperLeg.L', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [-0.1, 0.15, 0.08]);
    key(fall, 'UpperLeg.R', 'rotation', [[0,0,0], [0.35,0,0], [0.7,0,0]], [0.1, 0.15, 0.08]);
    return { idle, walk, run, jump, fall };
}

function addCycle(clip, duration, legSwing, armSwing) {
    key(clip, 'UpperLeg.L', 'rotation', [[0,0,0], [duration/4,0,0], [duration/2,0,0], [duration*0.75,0,0], [duration,0,0]], [legSwing, -legSwing, legSwing, -legSwing, legSwing]);
    key(clip, 'UpperLeg.R', 'rotation', [[0,0,0], [duration/4,0,0], [duration/2,0,0], [duration*0.75,0,0], [duration,0,0]], [-legSwing, legSwing, -legSwing, legSwing, -legSwing]);
    key(clip, 'LowerLeg.L', 'rotation', [[0,0,0], [duration/4,0,0], [duration/2,0,0], [duration*0.75,0,0], [duration,0,0]], [0, 0.24, 0.08, 0.22, 0]);
    key(clip, 'LowerLeg.R', 'rotation', [[0,0,0], [duration/4,0,0], [duration/2,0,0], [duration*0.75,0,0], [duration,0,0]], [0, 0.08, 0.24, 0.08, 0]);
    key(clip, 'UpperArm.L', 'rotation', [[0,0,0], [duration/4,0,0], [duration/2,0,0], [duration*0.75,0,0], [duration,0,0]], [-armSwing, armSwing, -armSwing, armSwing, -armSwing]);
    key(clip, 'UpperArm.R', 'rotation', [[0,0,0], [duration/4,0,0], [duration/2,0,0], [duration*0.75,0,0], [duration,0,0]], [armSwing, -armSwing, armSwing, -armSwing, armSwing]);
}

function key(clip, boneName, property, timesAndMarker, values) {
    for (let i = 0; i < timesAndMarker.length; i++) clip.addBoneKeyframe(boneName, property, timesAndMarker[i][0], [values[i] || 0, timesAndMarker[i][1] || 0, timesAndMarker[i][2] || 0]);
}

function sub(a,b){return a.map((v,i)=>v-b[i]);}
function add(a,b){return a.map((v,i)=>v+b[i]);}
function scale(a,s){return a.map(v=>v*s);}
function lerp(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t);}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];}
function normalize(a){const l=Math.hypot(...a)||1;return a.map(v=>v/l);}
function dampAngle(current, target, amount){const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+delta*amount;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
