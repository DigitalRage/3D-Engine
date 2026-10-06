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
        this.reverseZ = false;

        // Camera rotation happens constantly in the editor/runtime. Keep the
        // matrices alive and only rebuild them when their inputs actually change.
        this._viewMatrix = new Float32Array(16);
        this._projectionMatrix = new Float32Array(16);
        this._viewProjectionMatrix = new Float32Array(16);
        this._viewSnapshot = new Float64Array(9);
        this._projectionSnapshot = new Float64Array(6);
        this._viewAspect = NaN;
        this._viewDirty = true;
        this._projectionDirty = true;
        this._viewRevision = 0;
        this._projectionRevision = 0;
        this._viewProjectionRevision = -1;
    }

    _syncView() {
        const p = this.position, t = this.target, u = this.up;
        const s = this._viewSnapshot;
        const changed = this._viewDirty
            || s[0] !== p[0] || s[1] !== p[1] || s[2] !== p[2]
            || s[3] !== t[0] || s[4] !== t[1] || s[5] !== t[2]
            || s[6] !== u[0] || s[7] !== u[1] || s[8] !== u[2];
        if (!changed) return false;
        mat4.lookAt(p, t, u, this._viewMatrix);
        s[0] = p[0]; s[1] = p[1]; s[2] = p[2];
        s[3] = t[0]; s[4] = t[1]; s[5] = t[2];
        s[6] = u[0]; s[7] = u[1]; s[8] = u[2];
        this._viewDirty = false;
        this._viewRevision++;
        return true;
    }

    _syncProjection(aspect) {
        const p = this._projectionSnapshot;
        const changed = this._projectionDirty
            || this._viewAspect !== aspect
            || p[0] !== this.fov || p[1] !== this.near || p[2] !== this.far
            || p[3] !== this.orthographicHeight
            || p[4] !== (this.viewMode === 'perspective' ? 1 : 0)
            || p[5] !== (this.reverseZ ? 1 : 0);
        if (!changed) return false;
        if (this.viewMode !== 'perspective') {
            mat4.orthographic(this.orthographicHeight, aspect, this.near, this.far, this._projectionMatrix, this.reverseZ);
        } else {
            mat4.perspective(this.fov, aspect, this.near, this.far, this._projectionMatrix, this.reverseZ);
        }
        p[0] = this.fov;
        p[1] = this.near;
        p[2] = this.far;
        p[3] = this.orthographicHeight;
        p[4] = this.viewMode === 'perspective' ? 1 : 0;
        p[5] = this.reverseZ ? 1 : 0;
        this._viewAspect = aspect;
        this._projectionDirty = false;
        this._projectionRevision++;
        return true;
    }

    getViewMatrix() {
        this._syncView();
        return this._viewMatrix;
    }

    getProjectionMatrix(aspect) {
        this._syncProjection(aspect);
        return this._projectionMatrix;
    }

    getViewProjectionMatrix(aspect) {
        const viewChanged = this._syncView();
        const projectionChanged = this._syncProjection(aspect);
        if (viewChanged || projectionChanged || this._viewProjectionRevision < 0) {
            mat4.multiply(this._projectionMatrix, this._viewMatrix, this._viewProjectionMatrix);
            this._viewProjectionRevision = this._viewRevision * 1000000 + this._projectionRevision;
        }
        return this._viewProjectionMatrix;
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
            this._viewDirty = true;
            this._projectionDirty = true;
            return;
        }
        const view = directions[mode];
        const dx = this.position[0] - this.target[0];
        const dy = this.position[1] - this.target[1];
        const dz = this.position[2] - this.target[2];
        const distance = Math.max(1, Math.hypot(dx, dy, dz));
        this.up = [...view.up];
        this.position = [
            this.target[0] + view.direction[0] * distance,
            this.target[1] + view.direction[1] * distance,
            this.target[2] + view.direction[2] * distance
        ];
        this._viewDirty = true;
        this._projectionDirty = true;
    }
}
