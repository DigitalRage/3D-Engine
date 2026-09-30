export class Material {
    constructor({ color = [1,1,1], useTexture = false, texture = null, shading = 'toon' } = {}) {
        this.color = color;
        this.useTexture = useTexture;
        this.texture = texture;
        this.shading = shading;
    }

    bind(gl, program) {
        const uColor = gl.getUniformLocation(program, 'uColor');
        const uUseTexture = gl.getUniformLocation(program, 'uUseTexture');
        const uTexture = gl.getUniformLocation(program, 'uTexture');
        const uToonShading = gl.getUniformLocation(program, 'uToonShading');

        gl.uniform4fv(uColor, new Float32Array([this.color[0], this.color[1], this.color[2], this.color[3] ?? 1]));
        gl.uniform1i(uUseTexture, this.useTexture ? 1 : 0);
        gl.uniform1f(uToonShading, this.shading === 'toon' ? 1 : 0);

        if (this.useTexture && this.texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.uniform1i(uTexture, 0);
        }
    }
}
