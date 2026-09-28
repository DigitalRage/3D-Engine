export class Scene {
    constructor() {
        this.meshes = [];
    }

    add(mesh) {
        this.meshes.push(mesh);
    }

    remove(mesh) {
        this.meshes = this.meshes.filter(m => m !== mesh);
    }

    update(dt) {
        this.meshes.forEach(mesh => mesh.animationPlayer?.update(dt));
    }
}
