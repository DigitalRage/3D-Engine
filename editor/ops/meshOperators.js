const OPERATORS = {
    addVertex: (mesh, faceIndex, position) => mesh.addVertex(faceIndex, position),
    addFace: (mesh, vertices) => mesh.addFace(vertices),
    bridge: (mesh, faceIndex, targetFaceIndex) => mesh.bridge(faceIndex, targetFaceIndex),
    bevel: (mesh, faceIndex, amount) => mesh.bevel(faceIndex, amount),
    dissolve: (mesh, faceIndex) => mesh.dissolve(faceIndex),
    extrude: (mesh, faceIndex, distance) => mesh.extrudeFace(faceIndex, distance),
    fill: (mesh, faceIndex) => mesh.fill(faceIndex),
    flipNormals: mesh => mesh.flipNormals(),
    gridFill: (mesh, faceIndex, columns, rows) => mesh.gridFill(faceIndex, columns, rows),
    inset: (mesh, faceIndex, amount) => mesh.inset(faceIndex, amount),
    knife: (mesh, faceIndex, start, end) => mesh.knifeTool(faceIndex, start, end),
    loopCut: (mesh, faceIndex, segments) => mesh.loopCut(faceIndex, segments),
    mergeCoplanar: (mesh, faceIndex) => mesh.mergeCoplanarFace(faceIndex),
    mergeVertices: (mesh, faceIndex, vertexIndex, threshold) => mesh.mergeNearbyVertices(faceIndex, vertexIndex, threshold),
    quadRebuild: (mesh, faceIndex) => mesh.quadRebuild(faceIndex),
    recalculateNormals: mesh => mesh.recalculateNormals(),
    separate: (mesh, faceIndex) => mesh.separate(faceIndex),
    split: (mesh, faceIndex, axis) => mesh.split(faceIndex, axis),
    triangulate: (mesh, faceIndex) => mesh.triangulate(faceIndex)
};

export function runMeshOperator(mesh, name, ...args) {
    const operator = OPERATORS[name];
    if (!operator) throw new RangeError(`Unknown mesh operator: ${name}`);
    return operator(mesh, ...args);
}

export function listMeshOperators() {
    return [...Object.keys(OPERATORS)];
}
