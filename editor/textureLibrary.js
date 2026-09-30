import { loadTextureBlob } from '../engine/loader.js';

export class TextureLibrary {
    constructor(gl) {
        this.gl = gl;
        this.assets = [];
        this.nextId = 1;
    }

    async addFile(file) {
        const texture = await loadTextureBlob(file, this.gl);
        const previewUrl = URL.createObjectURL(file);
        return this.addTexture(file.name, texture, previewUrl, file);
    }

    addTexture(name, texture, previewUrl = null, sourceBlob = null) {
        const previewImage = previewUrl && typeof Image !== 'undefined' ? new Image() : null;
        if (previewImage) previewImage.src = previewUrl;
        const asset = {
            id: `texture-${this.nextId++}`,
            name: name || 'Image',
            texture,
            previewImage,
            sourceBlob,
            sourceUrl: previewUrl && !previewUrl.startsWith('blob:') ? previewUrl : null
        };
        this.assets.push(asset);
        return asset;
    }

    async getExportData() {
        const exported = [];
        for (const asset of this.assets) {
            let blob = asset.sourceBlob;
            if (!blob && asset.sourceUrl) {
                const response = await fetch(asset.sourceUrl);
                if (response.ok) blob = await response.blob();
            }
            if (!blob) continue;
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            }
            exported.push({ id: asset.id, name: asset.name, type: blob.type || 'application/octet-stream', data: btoa(binary) });
        }
        return exported;
    }

    async importExportedAsset(data) {
        const binary = atob(data.data);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const blob = new Blob([bytes], { type: data.type || 'application/octet-stream' });
        const file = new File([blob], data.name || 'Image', { type: blob.type });
        const asset = await this.addFile(file);
        return asset;
    }

    get(id) {
        return this.assets.find(asset => asset.id === id) || null;
    }
}
