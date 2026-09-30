export class Material {
    constructor({
        baseColor = [1, 1, 1],
        color = null,
        metallic = 0,
        roughness = 0.5,
        emission = [0, 0, 0],
        opacity = undefined,
        useTexture = false,
        texture = null,
        shading = 'toon',
        albedo = null,
        normal = null,
        roughnessMap = null,
        metallicMap = null,
        emissionMap = null,
        textureSlots = null,
        assetId = null,
        name = 'Material'
    } = {}) {
        const resolvedColor = color ?? baseColor;
        this.assetId = assetId;
        this.name = name;
        this.baseColor = [resolvedColor[0], resolvedColor[1], resolvedColor[2]];
        const resolvedOpacity = opacity ?? resolvedColor[3] ?? 1;
        this.opacity = Number(resolvedOpacity);
        this.metallic = Number(metallic ?? 0);
        this.roughness = Number(roughness ?? 0.5);
        this.emission = Array.isArray(emission) ? [...emission] : [0, 0, 0];
        this.shading = shading || 'toon';
        this.useTexture = !!useTexture || !!texture || !!albedo;
        const slots = textureSlots || {
            albedo: texture ?? albedo ?? null,
            normal: normal ?? null,
            roughness: roughnessMap ?? null,
            metallic: metallicMap ?? null,
            emission: emissionMap ?? null
        };
        this.textureSlots = {
            albedo: slots.albedo || null,
            normal: slots.normal || null,
            roughness: slots.roughness || null,
            metallic: slots.metallic || null,
            emission: slots.emission || null
        };
        this.texture = this.textureSlots.albedo;
    }

    static fromLegacy(data = {}) {
        return new Material({
            baseColor: data.baseColor ?? data.color ?? [1, 1, 1],
            color: data.color ?? data.baseColor ?? [1, 1, 1],
            metallic: data.metallic ?? 0,
            roughness: data.roughness ?? 0.5,
            emission: data.emission ?? [0, 0, 0],
            opacity: data.opacity ?? (data.color?.[3] ?? 1),
            useTexture: data.useTexture ?? !!(data.texture || data.albedo),
            texture: data.texture ?? data.albedo ?? null,
            shading: data.shading ?? 'toon',
            albedo: data.albedo ?? data.texture ?? null,
            normal: data.normal ?? null,
            roughnessMap: data.roughnessMap ?? null,
            metallicMap: data.metallicMap ?? null,
            emissionMap: data.emissionMap ?? null,
            textureSlots: data.textureSlots || null,
            assetId: data.assetId || null,
            name: data.name || 'Material'
        });
    }

    static fromJSON(data = {}) {
        if (!data || typeof data !== 'object') return new Material();
        return Material.fromLegacy(data);
    }

    get color() {
        return [...this.baseColor, this.opacity];
    }

    set color(value) {
        const rgb = Array.isArray(value) ? value : [1, 1, 1];
        this.baseColor = [rgb[0], rgb[1], rgb[2]];
        this.opacity = Number(value?.[3] ?? this.opacity ?? 1);
    }

    get albedo() {
        return this.textureSlots.albedo;
    }

    set albedo(value) {
        this.textureSlots.albedo = value || null;
        this.texture = value || null;
        this.useTexture = !!value;
    }

    toJSON() {
        const slotValue = value => {
            if (!value) return null;
            if (typeof value === 'string') return value;
            if (typeof value === 'object' && 'id' in value) return value.id;
            return null;
        };
        return {
            assetId: this.assetId || null,
            name: this.name,
            baseColor: [...this.baseColor],
            metallic: this.metallic,
            roughness: this.roughness,
            emission: [...this.emission],
            opacity: this.opacity,
            shading: this.shading,
            textureSlots: {
                albedo: slotValue(this.textureSlots.albedo),
                normal: slotValue(this.textureSlots.normal),
                roughness: slotValue(this.textureSlots.roughness),
                metallic: slotValue(this.textureSlots.metallic),
                emission: slotValue(this.textureSlots.emission)
            },
            textureAssetId: slotValue(this.textureSlots.albedo),
            useTexture: !!this.textureSlots.albedo
        };
    }

    bind(gl, program) {
        const uColor = gl.getUniformLocation(program, 'uColor');
        const uUseTexture = gl.getUniformLocation(program, 'uUseTexture');
        const uTexture = gl.getUniformLocation(program, 'uTexture');
        const uToonShading = gl.getUniformLocation(program, 'uToonShading');
        const uBaseColor = gl.getUniformLocation(program, 'uBaseColor');
        const uMetallic = gl.getUniformLocation(program, 'uMetallic');
        const uRoughness = gl.getUniformLocation(program, 'uRoughness');
        const uEmission = gl.getUniformLocation(program, 'uEmission');
        const uOpacity = gl.getUniformLocation(program, 'uOpacity');

        gl.uniform4fv(uColor, new Float32Array([this.baseColor[0], this.baseColor[1], this.baseColor[2], this.opacity]));
        if (uBaseColor) gl.uniform3fv(uBaseColor, new Float32Array(this.baseColor));
        if (uMetallic) gl.uniform1f(uMetallic, this.metallic);
        if (uRoughness) gl.uniform1f(uRoughness, this.roughness);
        if (uEmission) gl.uniform3fv(uEmission, new Float32Array(this.emission));
        if (uOpacity) gl.uniform1f(uOpacity, this.opacity);
        gl.uniform1i(uUseTexture, this.useTexture ? 1 : 0);
        gl.uniform1f(uToonShading, this.shading === 'toon' ? 1 : 0);

        if (this.useTexture && this.texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.uniform1i(uTexture, 0);
        }
    }
}
