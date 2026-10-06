export const mat4 = {
    lookAt(eye, center, up, out = new Float32Array(16)) {
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

        out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
        out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
        out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
        out[12] = -(xx * ex + xy * ey + xz * ez);
        out[13] = -(yx * ex + yy * ey + yz * ez);
        out[14] = -(zx * ex + zy * ey + zz * ez);
        out[15] = 1;
        return out;
    },

    multiply(a, b, out = new Float32Array(16)) {
        const a00=a[0],a01=a[1],a02=a[2],a03=a[3];
        const a10=a[4],a11=a[5],a12=a[6],a13=a[7];
        const a20=a[8],a21=a[9],a22=a[10],a23=a[11];
        const a30=a[12],a31=a[13],a32=a[14],a33=a[15];
        let b0=b[0],b1=b[1],b2=b[2],b3=b[3];
        out[0]=a00*b0+a10*b1+a20*b2+a30*b3;
        out[1]=a01*b0+a11*b1+a21*b2+a31*b3;
        out[2]=a02*b0+a12*b1+a22*b2+a32*b3;
        out[3]=a03*b0+a13*b1+a23*b2+a33*b3;
        b0=b[4];b1=b[5];b2=b[6];b3=b[7];
        out[4]=a00*b0+a10*b1+a20*b2+a30*b3;
        out[5]=a01*b0+a11*b1+a21*b2+a31*b3;
        out[6]=a02*b0+a12*b1+a22*b2+a32*b3;
        out[7]=a03*b0+a13*b1+a23*b2+a33*b3;
        b0=b[8];b1=b[9];b2=b[10];b3=b[11];
        out[8]=a00*b0+a10*b1+a20*b2+a30*b3;
        out[9]=a01*b0+a11*b1+a21*b2+a31*b3;
        out[10]=a02*b0+a12*b1+a22*b2+a32*b3;
        out[11]=a03*b0+a13*b1+a23*b2+a33*b3;
        b0=b[12];b1=b[13];b2=b[14];b3=b[15];
        out[12]=a00*b0+a10*b1+a20*b2+a30*b3;
        out[13]=a01*b0+a11*b1+a21*b2+a31*b3;
        out[14]=a02*b0+a12*b1+a22*b2+a32*b3;
        out[15]=a03*b0+a13*b1+a23*b2+a33*b3;
        return out;
    },

    perspective(fov, aspect, near, far, out = new Float32Array(16), reverseZ = false) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = reverseZ ? 1 / (far - near) : 1 / (near - far);
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

    orthographic(height, aspect, near, far, out = new Float32Array(16), reverseZ = false) {
        const width = height * aspect;
        const left = -width / 2;
        const right = width / 2;
        const bottom = -height / 2;
        const top = height / 2;
        out[0] = 2 / (right - left);
        out[5] = 2 / (top - bottom);
        out[10] = reverseZ ? 2 / (far - near) : -2 / (far - near);
        out[12] = -(right + left) / (right - left);
        out[13] = -(top + bottom) / (top - bottom);
        out[14] = reverseZ ? (far + near) / (far - near) : -(far + near) / (far - near);
        out[15] = 1;
        return out;
    }
};
