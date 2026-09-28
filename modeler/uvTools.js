export function planarUV(model, axis = 'y') {
    model.uvs = model.vertices.map(([x, y, z]) => {
        if (axis === 'y') return [(x + 1) * 0.5, (z + 1) * 0.5];
        if (axis === 'x') return [(y + 1) * 0.5, (z + 1) * 0.5];
        return [(x + 1) * 0.5, (y + 1) * 0.5];
    });
}
