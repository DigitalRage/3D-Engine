export const mat4 = {
    lookAt(eye, center, up) {
        const [ex, ey, ez] = eye;
        const [cx, cy, cz] = center;
        const [ux, uy, uz] = up;

        let zx = ex - cx, zy = ey - cy, zz = ez - cz;
        const zlen = Math.hypot(zx, zy, zz);
        zx /= zlen; zy /= zlen; zz /= zlen;

        let xx = uy * zz - uz * zy;
        let xy = uz * zx - ux * zz;
        let xz = ux * zy - uy * zx;
        const xlen = Math.hypot(xx, xy, xz);
        xx /= xlen; xy /= xlen; xz /= xlen;

        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        const out = new Float32Array(16);
        out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
        out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
        out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
        out[12] = -(xx * ex + xy * ey + xz * ez);
        out[13] = -(yx * ex + yy * ey + yz * ez);
        out[14] = -(zx * ex + zy * ey + zz * ez);
        out[15] = 1;
        return out;
    },

    perspective(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        const out = new Float32Array(16);
        out[0] = f / aspect;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;

        out[4] = 0;
        out[5] = f;
        out[6] = 0;
        out[7] = 0;

        out[8] = 0;
        out[9] = 0;
        out[10] = (far + near) * nf;
        out[11] = -1;

        out[12] = 0;
        out[13] = 0;
        out[14] = (2 * far * near) * nf;
        out[15] = 0;
        return out;
    },

    orthographic(height, aspect, near, far) {
        const width = height * aspect;
        const left = -width / 2;
        const right = width / 2;
        const bottom = -height / 2;
        const top = height / 2;
        const out = new Float32Array(16);
        out[0] = 2 / (right - left);
        out[5] = 2 / (top - bottom);
        out[10] = -2 / (far - near);
        out[12] = -(right + left) / (right - left);
        out[13] = -(top + bottom) / (top - bottom);
        out[14] = -(far + near) / (far - near);
        out[15] = 1;
        return out;
    }
};
