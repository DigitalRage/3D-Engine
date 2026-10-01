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
        this.transformTool = 'select';
        this.transformSpace = 'world';
        this.snap = { position: false, rotation: false, scale: false, positionStep: 0.5, rotationStep: 15, scaleStep: 0.1 };
        this.selectedMesh = null;
        this.overlay = document.getElementById('viewport-overlay');
        this.overlayContext = this.overlay?.getContext('2d') || null;
        this.activePick = null;
        this.transformDrag = null;
        this.activeButton = 0;
        this.axisConstraint = null;
        this.modifierSelection = false;
        this.hoveredAxis = null;
        this.distance = Math.hypot(...camera.position);
        this.yaw = Math.atan2(camera.position[0], camera.position[2]);
        this.pitch = Math.asin(camera.position[1] / this.distance);
        this.bindEvents();
    }

    update() {
        this.updateCamera();
        this.drawTransformGizmo();
    }

    bindEvents() {
        window.addEventListener('keydown', event => {
            if (!this.transformDrag || event.ctrlKey || event.metaKey || event.altKey || isTextInput(document.activeElement)) return;
            const axis = event.key.toLowerCase();
            if (!['x', 'y', 'z'].includes(axis)) return;
            this.axisConstraint = axis;
            this.lockTransformAxis({ x: 0, y: 1, z: 2 }[axis]);
            event.preventDefault();
            event.stopImmediatePropagation();
        }, { capture: true });
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
            this.modifierSelection = event.shiftKey || event.ctrlKey || event.metaKey;
            const handle = event.button === 0 ? this.hitTransformHandle(event.clientX, event.clientY) : null;
            if (handle) {
                const lockedAxis = { x: 0, y: 1, z: 2 }[this.axisConstraint];
                const activeHandle = Number.isInteger(lockedAxis) ? { ...handle, axis: lockedAxis } : handle;
                this.transformDrag = this.beginTransformDrag(activeHandle, event.clientX, event.clientY);
                this.activePick = null;
                this.historySnapshot = this.callbacks.onHistoryStart?.();
                this.canvas.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
            }
            this.transformDrag = null;
            this.activePick = event.button === 0 && this.pickMode !== 'orbit'
                ? this.pick(event.clientX, event.clientY, { additive: this.modifierSelection })
                : null;
            this.historySnapshot = this.activePick && !this.modifierSelection && this.transformTool === 'select'
                ? this.callbacks.onHistoryStart?.()
                : null;
            this.canvas.setPointerCapture(event.pointerId);
        });
        this.canvas.addEventListener('pointermove', event => {
            if (!this.dragging) {
                const axis = this.hitTransformHandle(event.clientX, event.clientY)?.axis ?? null;
                if (axis !== this.hoveredAxis) {
                    this.hoveredAxis = axis;
                    this.drawTransformGizmo();
                }
                return;
            }
            const deltaX = event.clientX - this.lastX;
            const deltaY = event.clientY - this.lastY;
            this.moved = this.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2;
            if (this.transformDrag) {
                this.applyTransform(event.clientX, event.clientY);
            } else if (this.activeButton === 1 || (this.activeButton === 0 && event.shiftKey && !this.activePick)) {
                this.panCamera(deltaX, deltaY);
            } else if (this.activeButton === 0 && this.activePick) {
                if (this.transformTool === 'select' && this.pickMode !== 'orbit' && !this.modifierSelection) this.dragSelection(deltaX, deltaY);
            } else {
                if (this.camera.viewMode !== 'perspective') {
                    this.camera.setViewMode('perspective');
                    this.syncFromCamera();
                    this.callbacks.onCameraViewChange?.('perspective');
                }
                this.yaw -= deltaX * 0.01;
                this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - deltaY * 0.01));
            }
            this.lastX = event.clientX;
            this.lastY = event.clientY;
        });
        this.canvas.addEventListener('pointerup', event => {
            this.dragging = false;
            if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
            if (this.historySnapshot) this.callbacks.onHistoryEnd?.(this.historySnapshot);
            if (this.transformDrag) this.callbacks.onTransform?.(this.transformDrag.mesh);
            this.historySnapshot = null;
            this.activePick = null;
            this.transformDrag = null;
        });
        this.canvas.addEventListener('wheel', event => {
            event.preventDefault();
            if (this.camera.viewMode === 'perspective') this.distance = Math.max(1, Math.min(30, this.distance * Math.exp(event.deltaY * 0.001)));
            else this.camera.orthographicHeight = Math.max(0.5, Math.min(100, this.camera.orthographicHeight * Math.exp(event.deltaY * 0.001)));
        }, { passive: false });
        this.canvas.addEventListener('contextmenu', event => event.preventDefault());
        this.canvas.addEventListener('pointerleave', () => {
            if (this.hoveredAxis === null) return;
            this.hoveredAxis = null;
            this.drawTransformGizmo();
        });
    }

    setPickMode(mode) {
        this.pickMode = mode;
    }

    setSelected(mesh) {
        this.selectedMesh = mesh;
        this.drawTransformGizmo();
    }

    setTransformTool(tool) {
        if (!['select', 'move', 'rotate', 'scale'].includes(tool)) throw new RangeError(`Unknown transform tool: ${tool}`);
        this.transformTool = tool;
        this.drawTransformGizmo();
    }

    setTransformSpace(space) {
        if (!['world', 'local'].includes(space)) throw new RangeError(`Unknown transform space: ${space}`);
        this.transformSpace = space;
        this.drawTransformGizmo();
    }

    setAxisConstraint(axis) {
        this.axisConstraint = this.axisConstraint === axis ? null : axis;
        if (this.transformDrag && this.axisConstraint) this.lockTransformAxis({ x: 0, y: 1, z: 2 }[this.axisConstraint]);
        this.drawTransformGizmo();
    }

    setSnap(options) {
        Object.assign(this.snap, options);
    }

    setViewMode(mode) {
        this.camera.setViewMode(mode);
        this.syncFromCamera();
        this.drawTransformGizmo();
    }

    getWorldAxis(axisIndex, mesh = this.selectedMesh) {
        const axis = [0, 0, 0];
        axis[axisIndex] = 1;
        return this.transformSpace === 'local' && mesh ? normalize(rotateEuler(axis, mesh.rotation)) : axis;
    }

    getGizmoWorldLength() {
        const worldPerPixel = this.camera.viewMode === 'perspective'
            ? 2 * this.distance * Math.tan(this.camera.fov / 2) / Math.max(1, this.canvas.height)
            : this.camera.orthographicHeight / Math.max(1, this.canvas.height);
        return worldPerPixel * 92;
    }

    getAxisData(mesh, axisIndex) {
        const origin = [...mesh.position];
        const axis = this.getWorldAxis(axisIndex, mesh);
        const worldLength = this.getGizmoWorldLength();
        const endpoint = origin.map((value, index) => value + axis[index] * worldLength);
        const screenOrigin = this.projectScreen(origin);
        const screenEndpoint = this.projectScreen(endpoint);
        return {
            axis,
            origin,
            worldLength,
            screenOrigin,
            screenEndpoint,
            screenLength: Math.hypot(screenEndpoint[0] - screenOrigin[0], screenEndpoint[1] - screenOrigin[1])
        };
    }

    projectScreen(point) {
        const [x, y] = this.projectWorld(point);
        const rect = this.canvas.getBoundingClientRect();
        return [rect.left + (x + 1) * rect.width * 0.5, rect.top + (1 - y) * rect.height * 0.5];
    }

    getRotateRingPoints(mesh, axisIndex, steps = 48) {
        const normal = this.getWorldAxis(axisIndex, mesh);
        const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const tangent = normalize(cross(normal, helper));
        const bitangent = normalize(cross(normal, tangent));
        const radius = this.getGizmoWorldLength() * 0.8;
        return Array.from({ length: steps + 1 }, (_, step) => {
            const angle = step / steps * Math.PI * 2;
            const point = mesh.position.map((value, index) => value
                + radius * (tangent[index] * Math.cos(angle) + bitangent[index] * Math.sin(angle)));
            return this.projectScreen(point);
        });
    }

    hitTransformHandle(clientX, clientY) {
        if (this.transformTool === 'select' || !this.selectedMesh) return null;
        let closest = null;
        let closestDistance = 11;
        for (let axis = 0; axis < 3; axis++) {
            const points = this.transformTool === 'rotate'
                ? this.getRotateRingPoints(this.selectedMesh, axis, 48)
                : [this.getAxisData(this.selectedMesh, axis).screenOrigin, this.getAxisData(this.selectedMesh, axis).screenEndpoint];
            for (let index = 0; index < points.length - 1; index++) {
                const distance = distanceToSegment([clientX, clientY], points[index], points[index + 1]);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closest = { axis, mesh: this.selectedMesh };
                }
            }
        }
        return closest;
    }

    drawTransformGizmo() {
        const context = this.overlayContext;
        if (!context || !this.overlay) return;
        context.clearRect(0, 0, this.overlay.width, this.overlay.height);
        const mesh = this.selectedMesh;
        if (!mesh || this.transformTool === 'select') return;
        const colors = ['#f06b64', '#74d48a', '#63a9f0'];
        const axes = this.transformTool === 'rotate'
            ? [0, 1, 2].map(axis => this.getRotateRingPoints(mesh, axis))
            : [0, 1, 2].map(axis => {
                const data = this.getAxisData(mesh, axis);
                return [data.screenOrigin, data.screenEndpoint];
            });
        context.lineCap = 'round';
        context.lineJoin = 'round';
        axes.forEach((points, axis) => {
            context.beginPath();
            points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
            const highlighted = this.axisConstraint === ['x', 'y', 'z'][axis] || this.hoveredAxis === axis;
            context.strokeStyle = highlighted ? '#ffffff' : colors[axis];
            context.lineWidth = highlighted ? 5 : 3;
            context.stroke();
            if (this.transformTool === 'move' || this.transformTool === 'scale') {
                const [startX, startY] = points[0];
                const [endX, endY] = points[1];
                if (this.transformTool === 'scale') {
                    context.fillStyle = colors[axis];
                    context.fillRect(endX - 5, endY - 5, 10, 10);
                } else {
                    const angle = Math.atan2(endY - startY, endX - startX);
                    context.beginPath();
                    context.moveTo(endX, endY);
                    context.lineTo(endX - 12 * Math.cos(angle - 0.45), endY - 12 * Math.sin(angle - 0.45));
                    context.lineTo(endX - 12 * Math.cos(angle + 0.45), endY - 12 * Math.sin(angle + 0.45));
                    context.closePath();
                    context.fillStyle = colors[axis];
                    context.fill();
                }
            }
        });
        const center = this.projectScreen(mesh.position);
        context.beginPath();
        context.arc(center[0], center[1], 5, 0, Math.PI * 2);
        context.fillStyle = '#f5f7fa';
        context.fill();
    }

    beginTransformDrag(handle, clientX, clientY) {
        const mesh = handle.mesh;
        const drag = {
            mesh,
            axis: handle.axis,
            tool: this.transformTool,
            startX: clientX,
            startY: clientY,
            basePosition: [...mesh.position],
            baseRotation: [...mesh.rotation],
            baseRotationMatrix: getRotationMatrix(mesh.rotation),
            baseScale: [...mesh.scale]
        };
        drag.startAngle = this.getPointerAngle(clientX, clientY, mesh);
        return drag;
    }

    lockTransformAxis(axis) {
        const drag = this.transformDrag;
        if (!drag || drag.axis === axis) return;
        drag.axis = axis;
        drag.startX = this.lastX;
        drag.startY = this.lastY;
        drag.basePosition = [...drag.mesh.position];
        drag.baseRotation = [...drag.mesh.rotation];
        drag.baseRotationMatrix = getRotationMatrix(drag.mesh.rotation);
        drag.baseScale = [...drag.mesh.scale];
        drag.startAngle = this.getPointerAngle(drag.startX, drag.startY, drag.mesh);
    }

    getPointerAngle(clientX, clientY, mesh) {
        const [centerX, centerY] = this.projectScreen(mesh.position);
        return Math.atan2(clientY - centerY, clientX - centerX);
    }

    applyTransform(clientX, clientY) {
        const drag = this.transformDrag;
        if (!drag) return;
        const axisData = this.getAxisData(drag.mesh, drag.axis);
        const screenAxis = normalize([
            axisData.screenEndpoint[0] - axisData.screenOrigin[0],
            axisData.screenEndpoint[1] - axisData.screenOrigin[1],
            0
        ]);
        const pointerDelta = [clientX - drag.startX, clientY - drag.startY];
        const screenAmount = pointerDelta[0] * screenAxis[0] + pointerDelta[1] * screenAxis[1];
        if (drag.tool === 'move') {
            let amount = screenAmount * axisData.worldLength / Math.max(1, axisData.screenLength);
            const next = drag.basePosition.map((value, axis) => value + axisData.axis[axis] * amount);
            if (this.snap.position) {
                const step = Math.max(0.001, Number(this.snap.positionStep) || 0.5);
                if (this.transformSpace === 'world') {
                    next.forEach((value, axis) => { next[axis] = Math.round(value / step) * step; });
                } else {
                    amount = Math.round(amount / step) * step;
                    next.forEach((_, axis) => { next[axis] = drag.basePosition[axis] + axisData.axis[axis] * amount; });
                }
            }
            drag.mesh.position = next;
        } else if (drag.tool === 'rotate') {
            let angle = normalizeAngle(this.getPointerAngle(clientX, clientY, drag.mesh) - drag.startAngle);
            if (this.snap.rotation) {
                const step = Math.max(1, Number(this.snap.rotationStep) || 15) * Math.PI / 180;
                angle = Math.round(angle / step) * step;
            }
            const axis = [0, 0, 0];
            axis[drag.axis] = 1;
            const delta = axisRotationMatrix(axis, angle);
            const rotation = this.transformSpace === 'local'
                ? multiplyRotationMatrices(drag.baseRotationMatrix, delta)
                : multiplyRotationMatrices(delta, drag.baseRotationMatrix);
            drag.mesh.rotation = rotationMatrixToEuler(rotation);
        } else if (drag.tool === 'scale') {
            let value = drag.baseScale[drag.axis] + screenAmount / Math.max(60, axisData.screenLength);
            if (this.snap.scale) {
                const step = Math.max(0.001, Number(this.snap.scaleStep) || 0.1);
                value = Math.round(value / step) * step;
            }
            drag.mesh.scale[drag.axis] = Math.max(0.01, value);
        }
        this.callbacks.onTransformPreview?.(drag.mesh);
        this.drawTransformGizmo();
    }

    dragSelection(deltaX, deltaY) {
        const pick = this.activePick;
        const worldDelta = this.getDragDelta(deltaX, deltaY);
        if (this.pickMode === 'mesh') {
            for (let axis = 0; axis < 3; axis++) pick.mesh.position[axis] += worldDelta[axis];
            return;
        }
        const localDelta = transformDirectionInverse(pick.mesh.getModelMatrix(), worldDelta);
        if (this.pickMode === 'vertex') {
            const position = [...pick.vertexPosition];
            for (let axis = 0; axis < 3; axis++) position[axis] += localDelta[axis];
            pick.mesh.setFaceVertex(pick.faceIndex, pick.vertexIndex, position);
            pick.vertexPosition = position;
            return;
        }
        const vertices = this.pickMode === 'edge'
            ? [pick.mesh.positions[pick.a], pick.mesh.positions[pick.b]]
            : pick.mesh.polygons[pick.faceIndex];
        vertices.forEach(vertex => {
            for (let axis = 0; axis < 3; axis++) vertex[axis] += localDelta[axis];
            pick.mesh.updateBindVertex(vertex);
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
        const amount = this.camera.viewMode === 'perspective'
            ? 2 * this.distance * Math.tan(this.camera.fov / 2) / Math.max(1, rect.height)
            : this.camera.orthographicHeight / Math.max(1, rect.height);
        return right.map((value, index) => (value * deltaX - up[index] * deltaY) * amount);
    }

    projectWorld(point) {
        const view = this.camera.getViewMatrix();
        const projection = this.camera.getProjectionMatrix(this.canvas.width / this.canvas.height);
        const viewed = multiplyMatrixVector(view, [...point, 1]);
        const clip = multiplyMatrixVector(projection, viewed);
        return [clip[0] / clip[3], clip[1] / clip[3]];
    }

    pick(clientX, clientY, modifiers = { additive: false }) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 2 - 1;
        const y = 1 - ((clientY - rect.top) / rect.height) * 2;
        const ray = this.createRay(x, y);
        let hit = null;
        for (const mesh of this.scene.meshes) {
            const model = mesh.getModelMatrix();
            if (!mesh.vertexWeights.size && mesh.boundsMin && mesh.boundsMax) {
                const worldBounds = getWorldBounds(mesh.boundsMin, mesh.boundsMax, model);
                if (!rayIntersectsBounds(ray.origin, ray.direction, worldBounds.min, worldBounds.max, hit?.distance ?? Infinity)) continue;
            }
            const deformedVertices = new Map();
            mesh.polygons.forEach((polygon, faceIndex) => {
                if (polygon.length < 3) return;
                const worldVertices = polygon.map(vertex => {
                    if (!deformedVertices.has(vertex)) deformedVertices.set(vertex, transformPoint(model, mesh.getDeformedPoint(vertex)));
                    return deformedVertices.get(vertex);
                });
                for (let index = 1; index < worldVertices.length - 1; index++) {
                    const distance = intersectRayTriangle(ray.origin, ray.direction, worldVertices[0], worldVertices[index], worldVertices[index + 1]);
                    if (distance !== null && (hit === null || distance < hit.distance)) {
                        hit = { mesh, faceIndex, distance };
                    }
                }
            });
        }
        if (!hit) {
            this.callbacks.onPickEmpty?.(modifiers);
            return null;
        }

        if (this.pickMode === 'mesh') {
            this.callbacks.onPickMesh?.(hit.mesh, modifiers);
            return hit;
        }

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
                this.callbacks.onPickVertex?.(nearestVertex.mesh, nearestVertex.faceIndex, nearestVertex.vertexIndex, modifiers);
                return nearestVertex;
            }
        }

        if (this.pickMode === 'edge') {
            const face = hit.mesh.faces[hit.faceIndex];
            let nearestEdge = null;
            let nearestDistance = 12;
            face.forEach((a, corner) => {
                const b = face[(corner + 1) % face.length];
                const projectedA = this.project(hit.mesh.positions[a], hit.mesh.getModelMatrix());
                const projectedB = this.project(hit.mesh.positions[b], hit.mesh.getModelMatrix());
                const start = [(projectedA[0] + 1) * rect.width * 0.5, (1 - projectedA[1]) * rect.height * 0.5];
                const end = [(projectedB[0] + 1) * rect.width * 0.5, (1 - projectedB[1]) * rect.height * 0.5];
                const pointer = [clientX - rect.left, clientY - rect.top];
                const distance = distanceToSegment(pointer, start, end);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestEdge = { a: Math.min(a, b), b: Math.max(a, b) };
                }
            });
            if (nearestEdge) {
                const edgeKey = `${nearestEdge.a},${nearestEdge.b}`;
                this.callbacks.onPickEdge?.(hit.mesh, hit.faceIndex, edgeKey, nearestEdge.a, nearestEdge.b, modifiers);
                return { ...hit, ...nearestEdge, edgeKey, edge: true };
            }
            this.callbacks.onPickEmpty?.(modifiers);
            return null;
        }

        this.callbacks.onPickFace?.(hit.mesh, hit.faceIndex, modifiers);
        return hit;
    }

    createRay(x, y) {
        const forward = normalize(this.camera.target.map((value, index) => value - this.camera.position[index]));
        const right = normalize(cross(forward, this.camera.up));
        const up = cross(right, forward);
        const aspect = this.canvas.width / this.canvas.height;
        if (this.camera.viewMode !== 'perspective') {
            const verticalOffset = this.camera.orthographicHeight * y * 0.5;
            const horizontalOffset = this.camera.orthographicHeight * aspect * x * 0.5;
            const origin = this.camera.position.map((value, index) => value + right[index] * horizontalOffset + up[index] * verticalOffset);
            return { origin, direction: forward };
        }
        const tangent = Math.tan(this.camera.fov / 2);
        const direction = normalize(forward.map((value, index) => value + right[index] * x * tangent * aspect + up[index] * y * tangent));
        return { origin: [...this.camera.position], direction };
    }

    panCamera(deltaX, deltaY) {
        const right = normalize(cross(this.camera.target.map((value, index) => value - this.camera.position[index]), this.camera.up));
        const up = normalize(cross(right, this.camera.target.map((value, index) => value - this.camera.position[index])));
        const amount = this.camera.viewMode === 'perspective'
            ? this.distance / Math.max(1, this.canvas.height) * 2
            : this.camera.orthographicHeight / Math.max(1, this.canvas.height);
        for (let axis = 0; axis < 3; axis++) {
            const movement = -deltaX * amount * right[axis] + deltaY * amount * up[axis];
            this.camera.target[axis] += movement;
            this.camera.position[axis] += movement;
        }
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
        if (this.camera.viewMode !== 'perspective') return;
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
        this.distance = Math.max(1e-6, Math.hypot(...offset));
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

function getRotationMatrix([x, y, z]) {
    const cx = Math.cos(x), sx = Math.sin(x);
    const cy = Math.cos(y), sy = Math.sin(y);
    const cz = Math.cos(z), sz = Math.sin(z);
    return [
        [cy * cz, cy * sz, -sy],
        [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy],
        [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy]
    ];
}

function axisRotationMatrix(axis, angle) {
    const [x, y, z] = normalize(axis);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const inverseCosine = 1 - cosine;
    return [
        [cosine + x * x * inverseCosine, x * y * inverseCosine - z * sine, x * z * inverseCosine + y * sine],
        [y * x * inverseCosine + z * sine, cosine + y * y * inverseCosine, y * z * inverseCosine - x * sine],
        [z * x * inverseCosine - y * sine, z * y * inverseCosine + x * sine, cosine + z * z * inverseCosine]
    ];
}

function multiplyRotationMatrices(left, right) {
    return left.map(row => right[0].map((_, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
}

function rotationMatrixToEuler(matrix) {
    const y = Math.asin(Math.max(-1, Math.min(1, -matrix[0][2])));
    const cosineY = Math.cos(y);
    if (Math.abs(cosineY) > 1e-6) return [Math.atan2(matrix[1][2], matrix[2][2]), y, Math.atan2(matrix[0][1], matrix[0][0])];
    return [Math.atan2(-matrix[2][1], matrix[1][1]), y, 0];
}

function rotateEuler(vector, [x, y, z]) {
    const cx = Math.cos(x), sx = Math.sin(x);
    const cy = Math.cos(y), sy = Math.sin(y);
    const cz = Math.cos(z), sz = Math.sin(z);
    const rotation = [
        [cy * cz, cy * sz, -sy],
        [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy],
        [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy]
    ];
    return rotation.map(row => row.reduce((sum, value, axis) => sum + value * vector[axis], 0));
}

function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

function distanceToSegment(point, start, end) {
    const delta = [end[0] - start[0], end[1] - start[1]];
    const lengthSquared = delta[0] ** 2 + delta[1] ** 2;
    if (lengthSquared < 1e-8) return Math.hypot(point[0] - start[0], point[1] - start[1]);
    const amount = Math.max(0, Math.min(1, ((point[0] - start[0]) * delta[0] + (point[1] - start[1]) * delta[1]) / lengthSquared));
    return Math.hypot(point[0] - start[0] - delta[0] * amount, point[1] - start[1] - delta[1] * amount);
}

function getWorldBounds(minimum, maximum, model) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let corner = 0; corner < 8; corner++) {
        const point = [0, 1, 2].map(axis => corner & (1 << axis) ? maximum[axis] : minimum[axis]);
        const world = transformPoint(model, point);
        world.forEach((value, axis) => {
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
        });
    }
    return { min, max };
}

function rayIntersectsBounds(origin, direction, minimum, maximum, maxDistance) {
    let near = 0;
    let far = maxDistance;
    for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(direction[axis]) < 1e-10) {
            if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return false;
            continue;
        }
        const first = (minimum[axis] - origin[axis]) / direction[axis];
        const second = (maximum[axis] - origin[axis]) / direction[axis];
        near = Math.max(near, Math.min(first, second));
        far = Math.min(far, Math.max(first, second));
        if (far < near) return false;
    }
    return far >= 0;
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
