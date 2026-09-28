export async function loadTexture(url, gl) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch texture: ' + url);
    return loadTextureBlob(await resp.blob(), gl);
}

export async function loadTextureBlob(blob, gl) {
    const img = await createImageBitmap(blob);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                  gl.RGBA, gl.UNSIGNED_BYTE, img);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

export async function loadShaderSource(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch shader: ' + url);
    return await resp.text();
}
