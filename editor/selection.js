const SELECTION_MODES = new Set(['mesh', 'face', 'edge', 'vertex']);

export class SelectionModel {
    constructor(mode = 'face') {
        this.mode = mode;
        this.selectedMeshes = new Set();
        this.selectedFaces = new Set();
        this.selectedEdges = new Set();
        this.selectedVertices = new Set();
        this.active = null;
    }

    setMode(mode) {
        if (!SELECTION_MODES.has(mode)) throw new RangeError(`Unknown selection mode: ${mode}`);
        this.mode = mode;
    }

    selectMesh(mesh, { additive = false } = {}) {
        const previousActiveMesh = this.active?.mesh || null;
        if (additive && mesh && this.selectedMeshes.has(mesh)) this.selectedMeshes.delete(mesh);
        else {
            if (!additive) this.selectedMeshes.clear();
            if (mesh) this.selectedMeshes.add(mesh);
        }

        const activeMesh = mesh && this.selectedMeshes.has(mesh)
            ? mesh
            : [...this.selectedMeshes].at(-1) || null;
        if (previousActiveMesh !== activeMesh) this.clearElements();
        this.active = activeMesh ? { mode: 'mesh', mesh: activeMesh } : null;
        return activeMesh;
    }

    selectMeshes(meshes) {
        this.selectedMeshes.clear();
        meshes.forEach(mesh => this.selectedMeshes.add(mesh));
        this.clearElements();
        const activeMesh = [...this.selectedMeshes].at(-1) || null;
        this.active = activeMesh ? { mode: 'mesh', mesh: activeMesh } : null;
        return activeMesh;
    }

    selectElement(mesh, mode, value, details = {}, { additive = false } = {}) {
        if (!mesh || !['face', 'edge', 'vertex'].includes(mode)) return false;
        const previousActiveMesh = this.active?.mesh || null;
        if (previousActiveMesh !== mesh) this.clearElements();
        if (!additive) {
            this.selectedMeshes.clear();
            this.selectedMeshes.add(mesh);
            this.clearElements();
        } else {
            this.selectedMeshes.add(mesh);
        }

        const selected = this.selectionSet(mode);
        const wasSelected = selected.has(value);
        if (additive && wasSelected) selected.delete(value);
        else selected.add(value);
        if (additive && wasSelected) {
            const nextValue = [...selected].at(-1);
            this.active = nextValue === undefined
                ? null
                : { mode, mesh, value: nextValue, ...getElementDetails(mesh, mode, nextValue) };
        } else {
            this.active = { mode, mesh, value, ...details };
        }
        return !wasSelected || !additive;
    }

    selectionSet(mode = this.mode) {
        if (mode === 'mesh') return this.selectedMeshes;
        if (mode === 'face') return this.selectedFaces;
        if (mode === 'edge') return this.selectedEdges;
        if (mode === 'vertex') return this.selectedVertices;
        throw new RangeError(`Unknown selection mode: ${mode}`);
    }

    clearElements() {
        this.selectedFaces.clear();
        this.selectedEdges.clear();
        this.selectedVertices.clear();
    }

    clear() {
        this.selectedMeshes.clear();
        this.clearElements();
        this.active = null;
    }
}

function getElementDetails(mesh, mode, value) {
    if (mode === 'face') return { faceIndex: value };
    if (mode === 'edge') {
        const [a, b] = value.split(',').map(Number);
        const faceIndex = mesh.faces.findIndex(face => face.some((vertex, index) => {
            const next = face[(index + 1) % face.length];
            return (vertex === a && next === b) || (vertex === b && next === a);
        }));
        return { a, b, faceIndex };
    }
    const faceIndex = mesh.faces.findIndex(face => face.includes(value));
    return { faceIndex, vertexIndex: mesh.faces[faceIndex]?.indexOf(value) };
}

export function canonicalEdgeKey(a, b) {
    return a < b ? `${a},${b}` : `${b},${a}`;
}
