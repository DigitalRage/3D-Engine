export class Modeler {
    constructor() {
        this.vertices = [];
        this.colors = [];
        this.uvs = [];
        this.indices = [];
    }

    addVertex(x, y, z, r = 1, g = 1, b = 1, u = 0, v = 0) {
        this.vertices.push([x, y, z]);
        this.colors.push([r, g, b]);
        this.uvs.push([u, v]);
    }

    addFace(i0, i1, i2) {
        this.indices.push([i0, i1, i2]);
    }

    toJSON() {
        return {
            vertices: this.vertices,
            colors: this.colors,
            uvs: this.uvs,
            indices: this.indices
        };
    }
}
