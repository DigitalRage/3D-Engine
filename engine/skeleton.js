export class Bone {
    constructor(name, parent = null) {
        this.name = name;
        this.parent = parent;
        this.children = [];
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];
        this.length = 0.5;
        this.bindPosition = [...this.position];
        this.bindRotation = [...this.rotation];
        this.bindScale = [...this.scale];
        if (parent) parent.children.push(this);
    }
}

export class Skeleton {
    constructor() {
        this.bones = [];
    }

    addBone(name = `Bone ${this.bones.length + 1}`, parent = null) {
        if (this.find(name)) name = `${name} ${this.bones.length + 1}`;
        const bone = new Bone(name, parent);
        if (parent) bone.position = [0, parent.length, 0];
        bone.bindPosition = [...bone.position];
        bone.bindScale = [...bone.scale];
        this.bones.push(bone);
        return bone;
    }

    find(name) {
        return this.bones.find(bone => bone.name === name) || null;
    }

    removeBone(bone) {
        if (!this.bones.includes(bone)) return [];
        const removed = new Set();
        const collect = current => {
            removed.add(current);
            current.children.forEach(collect);
        };
        collect(bone);
        if (bone.parent) bone.parent.children = bone.parent.children.filter(child => child !== bone);
        this.bones = this.bones.filter(current => !removed.has(current));
        return [...removed];
    }

    getWorldTransforms(bindPose = false) {
        const transforms = new Map();
        const resolve = bone => {
            if (transforms.has(bone)) return transforms.get(bone);
            const localRotation = rotationMatrix(bindPose ? bone.bindRotation : bone.rotation);
            const localPosition = bindPose ? bone.bindPosition : bone.position;
            const localScale = bindPose ? bone.bindScale : bone.scale;
            const parent = bone.parent ? resolve(bone.parent) : null;
            const transform = parent
                ? {
                    rotation: multiplyRotation(parent.rotation, localRotation),
                    position: add3(parent.position, rotate3(parent.rotation, scale3(localPosition, parent.scale))),
                    scale: multiply3(parent.scale, localScale)
                }
                : { rotation: localRotation, position: [...localPosition], scale: [...localScale] };
            transforms.set(bone, transform);
            return transform;
        };
        this.bones.forEach(resolve);
        return transforms;
    }
}

function rotationMatrix([x, y, z]) {
    const cx = Math.cos(x), sx = Math.sin(x);
    const cy = Math.cos(y), sy = Math.sin(y);
    const cz = Math.cos(z), sz = Math.sin(z);
    return [
        [cy * cz, cz * sx * sy - cx * sz, sx * sz + cx * cz * sy],
        [cy * sz, cx * cz + sx * sy * sz, cx * sy * sz - cz * sx],
        [-sy, cy * sx, cx * cy]
    ];
}

function multiplyRotation(a, b) {
    return a.map(row => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
}

function rotate3(matrix, vector) {
    return matrix.map(row => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function add3(a, b) {
    return a.map((value, index) => value + b[index]);
}

function scale3(vector, scale) {
    return vector.map((value, index) => value * scale[index]);
}

function multiply3(a, b) {
    return a.map((value, index) => value * b[index]);
}
