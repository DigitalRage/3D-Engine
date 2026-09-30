const textureTransparency = new WeakMap();

export async function loadTexture(url, gl) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch texture: ' + url);
    return loadTextureBlob(await resp.blob(), gl);
}

export async function loadTextureBlob(blob, gl) {
    const img = await createImageBitmap(blob, { imageOrientation: 'flipY' });
    const hasTransparency = detectTransparency(img);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                  gl.RGBA, gl.UNSIGNED_BYTE, img);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);
    textureTransparency.set(tex, hasTransparency);
    return tex;
}

export function textureHasTransparency(texture) {
    return textureTransparency.get(texture) ?? true;
}

function detectTransparency(image) {
    try {
        const canvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(image.width, image.height)
            : document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return true;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
            if (pixels[alphaIndex] < 255) return true;
        }
        return false;
    } catch {
        return true;
    }
}

export async function loadShaderSource(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch shader: ' + url);
    return await resp.text();
}
