export class Bone {
    constructor(name, parent = null) {
        this.name = name;
        this.parent = parent;
        this.children = [];
        this.position = [0, 0, 0];
        this.rotation = [0, 0, 0];
        this.scale = [1, 1, 1];
        if (parent) parent.children.push(this);
    }
}

export class Skeleton {
    constructor() {
        this.bones = [];
    }

    addBone(name = `Bone ${this.bones.length + 1}`, parent = null) {
        const bone = new Bone(name, parent);
        this.bones.push(bone);
        return bone;
    }

    find(name) {
        return this.bones.find(bone => bone.name === name) || null;
    }
}
