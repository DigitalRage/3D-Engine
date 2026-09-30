import { mat4 } from './mat4.js';

export class Camera {
    constructor() {
        this.position = [0, 0, 5];
        this.target = [0, 0, 0];
        this.up = [0, 1, 0];
        this.fov = 60 * Math.PI / 180;
        this.near = 0.1;
        this.far = 100;
        this.viewMode = 'perspective';
        this.orthographicHeight = 8;
    }

    getViewMatrix() {
        return mat4.lookAt(this.position, this.target, this.up);
    }

    getProjectionMatrix(aspect) {
        if (this.viewMode !== 'perspective') {
            return mat4.orthographic(this.orthographicHeight, aspect, this.near, this.far);
        }
        return mat4.perspective(this.fov, aspect, this.near, this.far);
    }

    setViewMode(mode) {
        const directions = {
            front: { direction: [0, 0, 1], up: [0, 1, 0] },
            back: { direction: [0, 0, -1], up: [0, 1, 0] },
            left: { direction: [-1, 0, 0], up: [0, 1, 0] },
            right: { direction: [1, 0, 0], up: [0, 1, 0] },
            top: { direction: [0, 1, 0], up: [0, 0, -1] },
            bottom: { direction: [0, -1, 0], up: [0, 0, 1] }
        };
        if (mode !== 'perspective' && !directions[mode]) throw new RangeError(`Unknown camera view: ${mode}`);
        this.viewMode = mode;
        if (mode === 'perspective') {
            this.up = [0, 1, 0];
            return;
        }
        const view = directions[mode];
        const distance = Math.max(1, Math.hypot(...this.position.map((value, axis) => value - this.target[axis])));
        this.up = [...view.up];
        this.position = this.target.map((value, axis) => value + view.direction[axis] * distance);
    }
}
