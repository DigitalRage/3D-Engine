export class Gizmos {
    constructor(scene, camera, canvas, callbacks = {}) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.callbacks = callbacks;
        this.dragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.moved = false;
        this.distance = Math.hypot(...camera.position);
        this.yaw = Math.atan2(camera.position[0], camera.position[2]);
        this.pitch = Math.asin(camera.position[1] / this.distance);
        this.bindEvents();
    }

    update() {
        this.updateCamera();
    }

    bindEvents() {
        this.canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 && event.button !== 2) return;
            this.dragging = true;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
            this.moved = false;
            this.canvas.setPointerCapture(event.pointerId);
        });
        this.canvas.addEventListener('pointermove', event => {
            if (!this.dragging) return;
            this.moved = true;
            this.yaw -= (event.clientX - this.lastX) * 0.01;
            this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - (event.clientY - this.lastY) * 0.01));
            this.lastX = event.clientX;
            this.lastY = event.clientY;
        });
        this.canvas.addEventListener('pointerup', event => {
            this.dragging = false;
            this.canvas.releasePointerCapture(event.pointerId);
            if (!this.moved) this.pick(event.clientX, event.clientY);
        });
        this.canvas.addEventListener('wheel', event => {
            event.preventDefault();
            this.distance = Math.max(1, Math.min(30, this.distance * Math.exp(event.deltaY * 0.001)));
        }, { passive: false });
        this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    }

    pick(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = 1 - ((clientY - rect.top) / rect.height) * 2;
        let best = null;
        for (const mesh of this.scene.meshes) {
            const model = mesh.getModelMatrix();
            mesh.polygons.forEach((polygon, faceIndex) => {
                polygon.forEach((vertex, vertexIndex) => {
                    const projected = this.project(vertex, model);
                    const distance = Math.hypot(projected[0] - x, projected[1] - y);
                    if (distance < (best?.distance ?? 0.08) && distance < 0.08) best = { mesh, faceIndex, vertexIndex, distance, vertex: true };
                });
                const center = polygon.reduce((sum, vertex) => sum.map((value, axis) => value + vertex[axis] / polygon.length), [0, 0, 0]);
                const projected = this.project(center, model);
                const distance = Math.hypot(projected[0] - x, projected[1] - y);
                if (distance < (best?.distance ?? 0.18) && distance < 0.18) best = { mesh, faceIndex, distance, vertex: false };
            });
        }
        if (!best) return;
        if (best.vertex) this.callbacks.onPickVertex?.(best.mesh, best.faceIndex, best.vertexIndex);
        else this.callbacks.onPickFace?.(best.mesh, best.faceIndex);
    }

    project(point, model) {
        const view = this.camera.getViewMatrix();
        const projection = this.camera.getProjectionMatrix(this.canvas.width / this.canvas.height);
        const world = multiplyMatrixVector(model, [...point, 1]);
        const viewed = multiplyMatrixVector(view, world);
        const clip = multiplyMatrixVector(projection, viewed);
        return [clip[0] / clip[3], clip[1] / clip[3]];
    }

    updateCamera() {
        const target = this.camera.target;
        const horizontal = this.distance * Math.cos(this.pitch);
        this.camera.position = [
            target[0] + horizontal * Math.sin(this.yaw),
            target[1] + this.distance * Math.sin(this.pitch),
            target[2] + horizontal * Math.cos(this.yaw)
        ];
    }

    syncFromCamera() {
        const offset = this.camera.position.map((value, index) => value - this.camera.target[index]);
        this.distance = Math.hypot(...offset);
        this.yaw = Math.atan2(offset[0], offset[2]);
        this.pitch = Math.asin(offset[1] / this.distance);
    }
}

function multiplyMatrixVector(matrix, vector) {
    return [
        matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2] + matrix[12] * vector[3],
        matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2] + matrix[13] * vector[3],
        matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2] + matrix[14] * vector[3],
        matrix[3] * vector[0] + matrix[7] * vector[1] + matrix[11] * vector[2] + matrix[15] * vector[3]
    ];
}
