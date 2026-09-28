export class Gizmos {
    constructor(scene, camera, canvas) {
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;
        this.dragging = false;
        this.lastX = 0;
        this.lastY = 0;
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
            this.canvas.setPointerCapture(event.pointerId);
        });
        this.canvas.addEventListener('pointermove', event => {
            if (!this.dragging) return;
            this.yaw -= (event.clientX - this.lastX) * 0.01;
            this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - (event.clientY - this.lastY) * 0.01));
            this.lastX = event.clientX;
            this.lastY = event.clientY;
        });
        this.canvas.addEventListener('pointerup', event => {
            this.dragging = false;
            this.canvas.releasePointerCapture(event.pointerId);
        });
        this.canvas.addEventListener('wheel', event => {
            event.preventDefault();
            this.distance = Math.max(1, Math.min(30, this.distance * Math.exp(event.deltaY * 0.001)));
        }, { passive: false });
        this.canvas.addEventListener('contextmenu', event => event.preventDefault());
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
