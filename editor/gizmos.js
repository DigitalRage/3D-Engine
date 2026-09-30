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
        this.pickMode = 'face';
        this.activePick = null;
        this.activeButton = 0;
        this.axisConstraint = null;
        this.distance = Math.hypot(...camera.position);
        this.yaw = Math.atan2(camera.position[0], camera.position[2]);
        this.pitch = Math.asin(camera.position[1] / this.distance);
        this.bindEvents();
    }

    update() {
        this.updateCamera();
    }

    bindEvents() {
        window.addEventListener('keydown', event => {
            if (event.ctrlKey || event.metaKey || event.altKey || isTextInput(document.activeElement)) return;
            const axis = event.key.toLowerCase();
            if (['x', 'y', 'z'].includes(axis)) this.axisConstraint = axis;
        });
        window.addEventListener('keyup', event => {
            if (this.axisConstraint === event.key.toLowerCase()) this.axisConstraint = null;
        });
        window.addEventListener('blur', () => { this.axisConstraint = null; });
        this.canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
            this.dragging = true;
            this.activeButton = event.button;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
            this.moved = false;
            this.activePick = event.button === 0 && !event.shiftKey ? this.pick(event.clientX, event.clientY) : null;
            this.historySnapshot = this.activePick && this.pickMode !== 'orbit' ? this.callbacks.onHistoryStart?.() : null;
            this.canvas.setPointerCapture(event.pointerId);
        });
        this.canvas.addEventListener('pointermove', event => {
            if (!this.dragging) return;
            const deltaX = event.clientX - this.lastX;
            const deltaY = event.clientY - this.lastY;
            this.moved = this.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2;
            if ((this.activeButton === 1 || event.shiftKey) && this.activeButton !== 2) {
                this.panCamera(deltaX, deltaY);
            } else if (this.activeButton === 0 && this.activePick && this.pickMode !== 'orbit') {
                this.dragSelection(deltaX, deltaY);
            } else {
                this.yaw -= deltaX * 0.01;
                this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - deltaY * 0.01));
            }
            this.lastX = event.clientX;
            this.lastY = event.clientY;
        });
        this.canvas.addEventListener('pointerup', event => {
            this.dragging = false;
            this.canvas.releasePointerCapture(event.pointerId);
            if (!this.moved && this.activeButton === 0 && !event.shiftKey) this.pick(event.clientX, event.clientY);
            if (this.historySnapshot) this.callbacks.onHistoryEnd?.(this.historySnapshot);
            this.historySnapshot = null;
            this.activePick = null;
        });
        this.canvas.addEventListener('wheel', event => {
            event.preventDefault();
            this.distance = Math.max(1, Math.min(30, this.distance * Math.exp(event.deltaY * 0.001)));
        }, { passive: false });
        this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    }

    setPickMode(mode) {
        this.pickMode = mode;
    }

    dragSelection(deltaX, deltaY) {
        const pick = this.activePick;
        const worldDelta = this.getDragDelta(deltaX, deltaY);
        if (this.pickMode === 'mesh') {
            for (let axis = 0; axis < 3; axis++) pick.mesh.position[axis] += worldDelta[axis];
            return;
        }
        const localDelta = transformDirectionInverse(pick.mesh.getModelMatrix(), worldDelta);
        const vertices = this.pickMode === 'face'
            ? pick.mesh.polygons[pick.faceIndex]
            : [pick.mesh.polygons[pick.faceIndex][pick.vertexIndex]];
        if (this.pickMode === 'vertex') {
            const position = [...pick.vertexPosition];
            for (let axis = 0; axis < 3; axis++) position[axis] += localDelta[axis];
            pick.mesh.setFaceVertex(pick.faceIndex, pick.vertexIndex, position);
            pick.vertexPosition = position;
            return;
        }
        vertices.forEach(vertex => {
            for (let axis = 0; axis < 3; axis++) vertex[axis] += localDelta[axis];
        });
        pick.mesh.rebuildRenderData();
    }

    getDragDelta(deltaX, deltaY) {
        if (this.axisConstraint) {
            const axisIndex = { x: 0, y: 1, z: 2 }[this.axisConstraint];
            const axis = [0, 0, 0];
            axis[axisIndex] = 1;
            const rect = this.canvas.getBoundingClientRect();
            const origin = this.projectWorld(this.camera.target);
            const endpoint = this.projectWorld(this.camera.target.map((value, index) => value + axis[index]));
            const screenAxis = [(endpoint[0] - origin[0]) * rect.width / 2, -(endpoint[1] - origin[1]) * rect.height / 2];
            const screenLengthSquared = screenAxis[0] ** 2 + screenAxis[1] ** 2;
            if (screenLengthSquared < 1e-6) return [0, 0, 0];
            const amount = (deltaX * screenAxis[0] + deltaY * screenAxis[1]) / screenLengthSquared;
            return axis.map(value => value * amount);
        }

        const forward = normalize(this.camera.target.map((value, index) => value - this.camera.position[index]));
        const right = normalize(cross(forward, this.camera.up));
        const up = normalize(cross(right, forward));
        const rect = this.canvas.getBoundingClientRect();
        const amount = 2 * this.distance * Math.tan(this.camera.fov / 2) / Math.max(1, rect.height);
        return right.map((value, index) => (value * deltaX - up[index] * deltaY) * amount);
    }

    projectWorld(point) {
        const view = this.camera.getViewMatrix();
        const projection = this.camera.getProjectionMatrix(this.canvas.width / this.canvas.height);
        const viewed = multiplyMatrixVector(view, [...point, 1]);
        const clip = multiplyMatrixVector(projection, viewed);
        return [clip[0] / clip[3], clip[1] / clip[3]];
    }

    pick(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = 1 - ((clientY - rect.top) / rect.height) * 2;
        const ray = this.createRay(x, y);
        let hit = null;
        for (const mesh of this.scene.meshes) {
            const model = mesh.getModelMatrix();
            mesh.polygons.forEach((polygon, faceIndex) => {
                if (polygon.length < 3) return;
                const worldVertices = polygon.map(vertex => transformPoint(model, mesh.getDeformedPoint(vertex)));
                for (let index = 1; index < worldVertices.length - 1; index++) {
                    const distance = intersectRayTriangle(ray.origin, ray.direction, worldVertices[0], worldVertices[index], worldVertices[index + 1]);
                    if (distance !== null && (hit === null || distance < hit.distance)) {
                        hit = { mesh, faceIndex, distance };
                    }
                }
            });
        }
        if (!hit) return null;

        if (this.pickMode === 'vertex') {
            const polygon = hit.mesh.polygons[hit.faceIndex];
            let nearestVertex = null;
            let nearestDistance = 0.08;
            polygon.forEach((vertex, vertexIndex) => {
                const projected = this.project(hit.mesh.getDeformedPoint(vertex), hit.mesh.getModelMatrix());
                const distance = Math.hypot(projected[0] - x, projected[1] - y);
                if (distance < nearestDistance) {
                    nearestVertex = { ...hit, vertexIndex, vertexPosition: [...vertex], vertex: true, screenDistance: distance };
                    nearestDistance = distance;
                }
            });
            if (nearestVertex) {
                this.callbacks.onPickVertex?.(nearestVertex.mesh, nearestVertex.faceIndex, nearestVertex.vertexIndex);
                return nearestVertex;
            }
        }

        this.callbacks.onPickFace?.(hit.mesh, hit.faceIndex);
        return hit;
    }

    createRay(x, y) {
        const forward = normalize(this.camera.target.map((value, index) => value - this.camera.position[index]));
        const right = normalize(cross(forward, this.camera.up));
        const up = cross(right, forward);
        const tangent = Math.tan(this.camera.fov / 2);
        const aspect = this.canvas.width / this.canvas.height;
        const direction = normalize(forward.map((value, index) => value + right[index] * x * tangent * aspect + up[index] * y * tangent));
        return { origin: [...this.camera.position], direction };
    }

    panCamera(deltaX, deltaY) {
        const amount = this.distance / Math.max(1, this.canvas.height) * 2;
        const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        for (let axis = 0; axis < 3; axis++) {
            const movement = -deltaX * amount * right[axis];
            this.camera.target[axis] += movement;
            this.camera.position[axis] += movement;
        }
        const verticalMovement = deltaY * amount;
        this.camera.target[1] += verticalMovement;
        this.camera.position[1] += verticalMovement;
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

function transformPoint(matrix, point) {
    const transformed = multiplyMatrixVector(matrix, [...point, 1]);
    return transformed.slice(0, 3).map(value => value / transformed[3]);
}

function intersectRayTriangle(origin, direction, a, b, c) {
    const edge1 = subtract(b, a);
    const edge2 = subtract(c, a);
    const p = cross(direction, edge2);
    const determinant = dot(edge1, p);
    if (Math.abs(determinant) < 1e-8) return null;
    const inverseDeterminant = 1 / determinant;
    const offset = subtract(origin, a);
    const u = dot(offset, p) * inverseDeterminant;
    if (u < 0 || u > 1) return null;
    const q = cross(offset, edge1);
    const v = dot(direction, q) * inverseDeterminant;
    if (v < 0 || u + v > 1) return null;
    const distance = dot(edge2, q) * inverseDeterminant;
    return distance >= 0 ? distance : null;
}

function subtract(a, b) {
    return a.map((value, index) => value - b[index]);
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
    return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function normalize(vector) {
    const length = Math.hypot(...vector) || 1;
    return vector.map(value => value / length);
}

function transformDirectionInverse(matrix, vector) {
    const a00 = matrix[0], a01 = matrix[4], a02 = matrix[8];
    const a10 = matrix[1], a11 = matrix[5], a12 = matrix[9];
    const a20 = matrix[2], a21 = matrix[6], a22 = matrix[10];
    const determinant = a00 * (a11 * a22 - a12 * a21)
        - a01 * (a10 * a22 - a12 * a20)
        + a02 * (a10 * a21 - a11 * a20);
    if (Math.abs(determinant) < 1e-10) return [...vector];
    const inverse = 1 / determinant;
    return [
        ((a11 * a22 - a12 * a21) * vector[0] + (a02 * a21 - a01 * a22) * vector[1] + (a01 * a12 - a02 * a11) * vector[2]) * inverse,
        ((a12 * a20 - a10 * a22) * vector[0] + (a00 * a22 - a02 * a20) * vector[1] + (a02 * a10 - a00 * a12) * vector[2]) * inverse,
        ((a10 * a21 - a11 * a20) * vector[0] + (a01 * a20 - a00 * a21) * vector[1] + (a00 * a11 - a01 * a10) * vector[2]) * inverse
    ];
}

function isTextInput(element) {
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName) || element?.isContentEditable;
}
