import { DirectionalLight } from './light.js';

export class Scene {
    constructor() {
        this.name = 'Untitled Scene';
        this.assetId = null;
        this.meshes = [];
        this.light = new DirectionalLight();
    }

    add(mesh) {
        this.meshes.push(mesh);
    }

    remove(mesh) {
        this.meshes = this.meshes.filter(m => m !== mesh);
    }

    move(mesh, index) {
        const currentIndex = this.meshes.indexOf(mesh);
        if (currentIndex < 0) return false;
        const targetIndex = Math.max(0, Math.min(this.meshes.length - 1, Math.floor(index)));
        if (currentIndex === targetIndex) return false;
        this.meshes.splice(currentIndex, 1);
        this.meshes.splice(targetIndex, 0, mesh);
        return true;
    }

    update(dt) {
        this.meshes.forEach(mesh => mesh.animationPlayer?.update(dt));
    }
}
