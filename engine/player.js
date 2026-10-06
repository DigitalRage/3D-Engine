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
        // Movement follows the camera's horizontal heading, not the character's own heading.
        // This gives modern third-person controls instead of tank controls.
        const moveYaw = this.cameraYaw;
        const forward = [-Math.sin(moveYaw), 0, -Math.cos(moveYaw)];
        const right = [Math.cos(moveYaw), 0, -Math.sin(moveYaw)];
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
            this.cameraYaw += delta[0] * this.mouseSensitivity;
            this.cameraPitch = clamp(this.cameraPitch - delta[1] * this.mouseSensitivity, 6 * Math.PI / 180, 70 * Math.PI / 180);
        }
        const arrowYaw = (input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0);
        const arrowPitch = (input.isDown('ArrowDown') ? 1 : 0) - (input.isDown('ArrowUp') ? 1 : 0);
        const arrowTurn = arrowYaw * this._cameraArrowSpeed * dt;
        if (arrowTurn) {
            // Arrow keys orbit the camera only. The player turns when movement starts.
            this.cameraYaw += arrowTurn;
        }
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
    const reverseRanges = [];

    const addVertex = (p, weights = []) => {
        positions.push([...p]);
        vertexWeights.push(weights ? [...weights] : []);
        return positions.length - 1;
    };

    const addOrientedTriangle = (a, b, c, outward) => {
        const pa = positions[a], pb = positions[b], pc = positions[c];
        const ab = sub(pb, pa), ac = sub(pc, pa);
        const n = cross(ab, ac);
        if (dot(n, outward) < 0) faces.push([a, c, b]);
        else faces.push([a, b, c]);
    };

    const addChain = ({ points, radii, bones, segments = 10, zScale = 1, material = 'body', cap = true }) => {
        const rings = [];
        for (let r = 0; r < points.length; r++) {
            const prev = points[Math.max(0, r - 1)];
            const next = points[Math.min(points.length - 1, r + 1)];
            const tangent = normalize(sub(next, prev));
            const ref = Math.abs(tangent[2]) < 0.92 ? [0, 0, 1] : [1, 0, 0];
            const basisA = normalize(cross(tangent, ref));
            const basisB = normalize(cross(tangent, basisA));
            const ring = [];
            const bone = bones[r] || bones[bones.length - 1];
            const prevBone = bones[Math.max(0, r - 1)] || bone;
            const weights = prevBone === bone
                ? [[bone, 1]]
                : [[prevBone, 0.56], [bone, 0.44]];
            for (let i = 0; i < segments; i++) {
                const a = Math.PI * 2 * i / segments;
                const radial = add(scale(basisA, Math.cos(a) * radii[r]), scale(basisB, Math.sin(a) * radii[r] * zScale));
                ring.push(addVertex(add(points[r], radial), weights));
            }
            rings.push(ring);
        }

        const sideFaceStart = faces.length;
        for (let r = 0; r < rings.length - 1; r++) {
            const ringA = rings[r], ringB = rings[r + 1];
            const center = midpoint(points[r], points[r + 1]);
            for (let i = 0; i < segments; i++) {
                const j = (i + 1) % segments;
                const outward1 = normalize(sub(centroid4(ringA[i], ringA[j], ringB[j], ringB[i]), center));
                addOrientedTriangle(ringA[i], ringB[i], ringB[j], outward1);
                addOrientedTriangle(ringA[i], ringB[j], ringA[j], outward1);
                faceMaterials.push(material, material);
            }
        }
        reverseRanges.push([sideFaceStart, faces.length]);

        if (cap) {
            const startCenter = points[0];
            const endCenter = points[points.length - 1];
            const startDir = normalize(sub(points[0], points[1]));
            const endDir = normalize(sub(points[points.length - 1], points[points.length - 2]));
            const startCenterIndex = addVertex(startCenter, [[bones[0] || 'Root', 1]]);
            const endCenterIndex = addVertex(endCenter, [[bones[bones.length - 1] || 'Root', 1]]);
            for (let i = 0; i < segments; i++) {
                const j = (i + 1) % segments;
                addOrientedTriangle(startCenterIndex, rings[0][i], rings[0][j], startDir);
                faceMaterials.push(material);
                addOrientedTriangle(endCenterIndex, rings[rings.length - 1][j], rings[rings.length - 1][i], endDir);
                faceMaterials.push(material);
            }
        }
    };

    // Main torso is one continuous tapered volume, with a broad chest and compact waist.
    addChain({
        points: [[0,0.44,0],[0,0.61,0],[0,0.82,0],[0,1.07,0],[0,1.30,0],[0,1.40,0]],
        radii: [0.27,0.29,0.27,0.26,0.29,0.32],
        bones: ['Pelvis','Pelvis','Spine','Spine','Chest','Chest'],
        segments: 12, zScale: 0.74
    });

    // A connected, flared anime skirt/dress shape wraps around the pelvis and overlaps the thighs.
    addChain({
        points: [[0,0.63,0],[0,0.48,0],[0,0.31,0],[0,0.20,0]],
        radii: [0.30,0.34,0.39,0.43],
        bones: ['Pelvis','Pelvis','Pelvis','Pelvis'],
        segments: 12, zScale: 0.64
    });

    // Arms use shared joint rings so the elbow and shoulder remain continuous during animation.
    for (const side of [-1, 1]) {
        const label = side < 0 ? 'L' : 'R';
        addChain({
            points: [[0.30*side,1.32,0],[0.43*side,1.17,0],[0.60*side,0.98,-0.01],[0.65*side,0.77,-0.03],[0.63*side,0.59,-0.12]],
            radii: [0.135,0.120,0.095,0.075,0.062],
            bones: [`UpperArm.${label}`,`UpperArm.${label}`,`ForeArm.${label}`,`ForeArm.${label}`,`Hand.${label}`],
            segments: 10, zScale: 0.76
        });
    }

    // Legs overlap the skirt and remain continuous from thigh to ankle; feet extend forward.
    for (const side of [-1, 1]) {
        const label = side < 0 ? 'L' : 'R';
        addChain({
            points: [[0.17*side,0.54,0],[0.18*side,0.37,0],[0.18*side,0.17,0],[0.18*side,0.06,0],[0.18*side,0.03,-0.16]],
            radii: [0.145,0.120,0.095,0.075,0.090],
            bones: [`UpperLeg.${label}`,`UpperLeg.${label}`,`LowerLeg.${label}`,`LowerLeg.${label}`,`Foot.${label}`],
            segments: 10, zScale: 0.70
        });
    }

    // Neck overlaps the chest and the head starts inside it, preventing the classic floating-head gap.
    addChain({
        points: [[0,1.35,0],[0,1.48,0],[0,1.57,0]],
        radii: [0.10,0.095,0.135],
        bones: ['Neck','Neck','Head'],
        segments: 10, zScale: 0.80
    });

    // Angular head/face volume. It stays faceted, but its proportions read as anime rather than a capsule.
    addChain({
        points: [[0,1.53,0],[0,1.65,0],[0,1.82,0],[0,1.98,0],[0,2.08,0]],
        radii: [0.15,0.21,0.26,0.27,0.19],
        bones: ['Head','Head','Head','Head','Head'],
        segments: 12, zScale: 0.78
    });

    // A single faceted hair mass gives the bob shape seen in the reference, with overlapping locks for the silhouette.
    addChain({
        points: [[0,1.58,0.005],[0,1.72,0.01],[0,1.87,0.015],[0,2.03,0.01],[0,2.12,0.00]],
        radii: [0.23,0.29,0.34,0.32,0.22],
        bones: ['Head','Head','Head','Head','Head'],
        segments: 14, zScale: 0.76
    });

    // Side hair panels and bangs are wedge solids that intersect the main hair mass instead of floating beside it.
    addHairWedge([-0.26,1.86,0.02],[-0.48,1.54,0.01],[-0.29,1.57,-0.16],0.11);
    addHairWedge([ 0.26,1.86,0.02],[ 0.48,1.54,0.01],[ 0.29,1.57,-0.16],0.11);
    for (let i = -1; i <= 1; i++) {
        const x = i * 0.095;
        addBang([x-0.07,1.99,-0.22],[x+0.07,1.99,-0.22],[x*0.72,1.79,-0.30]);
    }

    // The only white geometry is the eyes. They sit almost flush with the face instead of protruding like separate objects.
    addEye(-0.095, 1.82, -0.267, 0.050, 0.038, 10, 'Head');
    addEye( 0.095, 1.82, -0.267, 0.050, 0.038, 10, 'Head');

    // The tube sides use the opposite winding convention from the WebGL front-face state,
    // while their caps and the custom hair solids already have deliberate outward winding.
    for (const [start, end] of reverseRanges) {
        for (let i = start; i < end; i++) faces[i] = [...faces[i]].reverse();
    }

    return { positions, faces, faceMaterials, vertexWeights };

    function addHairWedge(a, b, c, depth) {
        const tip = [c[0], c[1], c[2] - depth];
        const p0 = addVertex(a, [['Head',1]]);
        const p1 = addVertex(b, [['Head',1]]);
        const p2 = addVertex(c, [['Head',1]]);
        const p3 = addVertex(tip, [['Head',1]]);
        addOrientedTriangle(p0,p1,p2,normalize(cross(sub(b,a),sub(c,a)))); faceMaterials.push('body');
        addOrientedTriangle(p1,p3,p2,normalize(sub(midpoint(b,c),midpoint(a,c)))); faceMaterials.push('body');
        addOrientedTriangle(p2,p3,p0,normalize(sub(midpoint(c,a),midpoint(b,a)))); faceMaterials.push('body');
        addOrientedTriangle(p3,p1,p0,normalize(sub(midpoint(b,a),tip))); faceMaterials.push('body');
    }

    function addBang(left, right, tip) {
        const a = addVertex(left, [['Head',1]]);
        const b = addVertex(right, [['Head',1]]);
        const c = addVertex([tip[0],tip[1],tip[2]], [['Head',1]]);
        const back = addVertex([tip[0],tip[1]+0.055,tip[2]+0.095], [['Head',1]]);
        const hint = [0,0,-1];
        addOrientedTriangle(a,b,c,hint); faceMaterials.push('body');
        addOrientedTriangle(b,back,c,hint); faceMaterials.push('body');
        addOrientedTriangle(c,back,a,hint); faceMaterials.push('body');
        addOrientedTriangle(back,b,a,[0,1,0]); faceMaterials.push('body');
    }

    function addEye(cx, cy, cz, radiusX, radiusY, segments, bone) {
        const center = addVertex([cx,cy,cz], [[bone,1]]);
        const ring = [];
        for (let i=0;i<segments;i++) {
            const a = 2*Math.PI*i/segments;
            ring.push(addVertex([cx+radiusX*Math.cos(a), cy+radiusY*Math.sin(a), cz], [[bone,1]]));
        }
        for (let i=0;i<segments;i++) {
            const j = (i+1)%segments;
            addOrientedTriangle(center, ring[i], ring[j], [0,0,-1]);
            faceMaterials.push('eye');
        }
    }
}

function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function midpoint(a,b){return a.map((v,i)=>(v+b[i])*0.5);}
function centroid4(a,b,c,d){return [(a[0]+b[0]+c[0]+d[0])*0.25,(a[1]+b[1]+c[1]+d[1])*0.25,(a[2]+b[2]+c[2]+d[2])*0.25];}

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
