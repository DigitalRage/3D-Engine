import { loadTextureBlob } from '../engine/loader.js';
import { AssetManager } from '../engine/assetManager.js';

export class TextureLibrary {
    constructor(gl, assetManager = new AssetManager()) {
        this.gl = gl;
        this.assetManager = assetManager;
        this.assets = [];
    }

    async addFile(file, assetOptions = {}) {
        const texture = await loadTextureBlob(file, this.gl);
        const previewUrl = URL.createObjectURL(file);
        return this.addTexture(file.name, texture, previewUrl, file, assetOptions);
    }

    addTexture(name, texture, previewUrl = null, sourceBlob = null, assetOptions = {}) {
        const previewImage = previewUrl && typeof Image !== 'undefined' ? new Image() : null;
        if (previewImage) previewImage.src = previewUrl;
        const asset = {
            id: assetOptions.id || null,
            name: name || 'Image',
            type: 'texture',
            texture,
            previewImage,
            sourceBlob,
            sourceUrl: previewUrl && !previewUrl.startsWith('blob:') ? previewUrl : null,
            metadata: assetOptions.metadata || { mimeType: sourceBlob?.type || null },
            thumbnail: assetOptions.thumbnail || previewUrl || null
        };
        const registered = this.assetManager.register({
            id: asset.id,
            name: asset.name,
            type: 'texture',
            resource: asset,
            metadata: asset.metadata,
            thumbnail: asset.thumbnail,
            data: assetOptions.data ?? null
        });
        asset.id = registered.id;
        asset.metadata = registered.metadata;
        asset.thumbnail = registered.thumbnail;
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
            const registered = this.assetManager.get(asset.id);
            exported.push({
                id: asset.id,
                name: asset.name,
                type: blob.type || 'application/octet-stream',
                assetType: 'texture',
                metadata: registered?.metadata || asset.metadata,
                dependencies: registered ? [...registered.dependencies] : [],
                thumbnail: asset.thumbnail?.startsWith('data:') ? asset.thumbnail : null,
                data: btoa(binary)
            });
        }
        return exported;
    }

    async importExportedAsset(data, assetOptions = {}) {
        const binary = atob(data.data);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const blob = new Blob([bytes], { type: data.type || 'application/octet-stream' });
        const file = new File([blob], data.name || 'Image', { type: blob.type });
        const asset = await this.addFile(file, {
            id: assetOptions.id || data.id,
            metadata: data.metadata,
            thumbnail: data.thumbnail
        });
        return asset;
    }

    get(id) {
        return this.assets.find(asset => asset.id === id) || null;
    }
}
