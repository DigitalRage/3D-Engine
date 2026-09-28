import { mat4 } from './mat4.js';

export class Camera {
    constructor() {
        this.position = [0, 0, 5];
        this.target = [0, 0, 0];
        this.up = [0, 1, 0];
        this.fov = 60 * Math.PI / 180;
        this.near = 0.1;
        this.far = 100;
    }

    getViewMatrix() {
        return mat4.lookAt(this.position, this.target, this.up);
    }

    getProjectionMatrix(aspect) {
        return mat4.perspective(this.fov, aspect, this.near, this.far);
    }
}
