export function traceDirectionalShadowFaces(scene, light) {
    const shadowedFaces = new Map(scene.meshes.map(mesh => [mesh, Array(mesh.faceCount).fill(false)]));
    if (!light || !scene.meshes.some(mesh => mesh.material.shading === 'toon')) return shadowedFaces;

    const lightDirection = normalize(light.direction.map(value => -value));
    if (!lightDirection) return shadowedFaces;

    const worldPolygons = new Map();
    const triangles = [];
    scene.meshes.forEach(mesh => {
        const model = mesh.getModelMatrix();
        const pose = mesh.vertexWeights.size ? mesh.skeleton.getWorldTransforms() : null;
        const bind = mesh.vertexWeights.size ? mesh.skeleton.getWorldTransforms(true) : null;
        const polygons = mesh.polygons.map(polygon => polygon.map(vertex => {
            const local = mesh.vertexWeights.size ? mesh.getDeformedPoint(vertex, pose, bind) : vertex;
            return transformPoint(model, local);
        }));
        worldPolygons.set(mesh, polygons);

        polygons.forEach((polygon, faceIndex) => {
            if (polygon.length < 3) return;
            const color = mesh.faceColors[faceIndex] || mesh.material.color;
            if ((color[3] ?? 1) <= 0.01) return;
            for (let vertexIndex = 1; vertexIndex < polygon.length - 1; vertexIndex++) {
                const triangle = {
                    mesh,
                    faceIndex,
                    a: polygon[0],
                    b: polygon[vertexIndex],
                    c: polygon[vertexIndex + 1]
                };
                triangle.min = [0, 1, 2].map(axis => Math.min(triangle.a[axis], triangle.b[axis], triangle.c[axis]));
                triangle.max = [0, 1, 2].map(axis => Math.max(triangle.a[axis], triangle.b[axis], triangle.c[axis]));
                triangle.center = triangle.min.map((value, axis) => (value + triangle.max[axis]) * 0.5);
                triangles.push(triangle);
            }
        });
    });

    const bvh = buildBVH(triangles);
    if (!bvh) return shadowedFaces;

    scene.meshes.forEach(mesh => {
        if (mesh.material.shading !== 'toon') return;
        const polygons = worldPolygons.get(mesh);
        const faceShadows = shadowedFaces.get(mesh);
        polygons.forEach((polygon, faceIndex) => {
            if (polygon.length < 3) return;
            const center = polygon.reduce((sum, vertex) => sum.map((value, axis) => value + vertex[axis] / polygon.length), [0, 0, 0]);
            const origin = center.map((value, axis) => value + lightDirection[axis] * 0.0001);
            faceShadows[faceIndex] = hasOccluder(bvh, origin, lightDirection, mesh, faceIndex);
        });
    });
    return shadowedFaces;
}

function buildBVH(triangles) {
    if (!triangles.length) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    triangles.forEach(triangle => {
        for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], triangle.min[axis]);
            max[axis] = Math.max(max[axis], triangle.max[axis]);
        }
    });
    if (triangles.length <= 8) return { min, max, triangles };

    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    triangles.sort((a, b) => a.center[axis] - b.center[axis]);
    const middle = Math.floor(triangles.length / 2);
    const left = buildBVH(triangles.slice(0, middle));
    const right = buildBVH(triangles.slice(middle));
    return { min, max, left, right };
}

function hasOccluder(node, origin, direction, sourceMesh, sourceFace) {
    if (!node || !rayIntersectsBounds(origin, direction, node.min, node.max)) return false;
    if (node.triangles) {
        return node.triangles.some(triangle => {
            if (triangle.mesh === sourceMesh && triangle.faceIndex === sourceFace) return false;
            return rayIntersectsTriangle(origin, direction, triangle);
        });
    }
    return hasOccluder(node.left, origin, direction, sourceMesh, sourceFace)
        || hasOccluder(node.right, origin, direction, sourceMesh, sourceFace);
}

function rayIntersectsBounds(origin, direction, min, max) {
    let near = 0;
    let far = Infinity;
    for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(direction[axis]) < 1e-10) {
            if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
            continue;
        }
        const first = (min[axis] - origin[axis]) / direction[axis];
        const second = (max[axis] - origin[axis]) / direction[axis];
        near = Math.max(near, Math.min(first, second));
        far = Math.min(far, Math.max(first, second));
        if (far < near) return false;
    }
    return far > 1e-5;
}

function rayIntersectsTriangle(origin, direction, triangle) {
    const edgeA = subtract(triangle.b, triangle.a);
    const edgeB = subtract(triangle.c, triangle.a);
    const directionCrossEdgeB = cross(direction, edgeB);
    const determinant = dot(edgeA, directionCrossEdgeB);
    if (Math.abs(determinant) < 1e-8) return false;

    const inverse = 1 / determinant;
    const offset = subtract(origin, triangle.a);
    const u = dot(offset, directionCrossEdgeB) * inverse;
    if (u < 0 || u > 1) return false;
    const q = cross(offset, edgeA);
    const v = dot(direction, q) * inverse;
    if (v < 0 || u + v > 1) return false;
    return dot(edgeB, q) * inverse > 1e-5;
}

function transformPoint(matrix, point) {
    return [
        matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
        matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
        matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]
    ];
}

function normalize(vector) {
    const length = Math.hypot(...vector);
    return length > 1e-10 ? vector.map(value => value / length) : null;
}

function subtract(a, b) {
    return a.map((value, axis) => value - b[axis]);
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
    return a.reduce((sum, value, axis) => sum + value * b[axis], 0);
}
