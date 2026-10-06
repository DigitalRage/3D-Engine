const DEFAULT_COLOR = [0.78, 0.84, 0.92];

function clamp01(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function normalizeColor(value, fallback = DEFAULT_COLOR) {
    if (!Array.isArray(value) || value.length < 3) return [...fallback];
    return [clamp01(value[0]), clamp01(value[1]), clamp01(value[2])];
}

function resolveIndex(token, length) {
    if (!token) return -1;
    const index = Number.parseInt(token, 10);
    if (!Number.isInteger(index) || index === 0) return -1;
    return index > 0 ? index - 1 : length + index;
}

function safeName(value, fallback = 'Object') {
    const name = String(value || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
    return name || fallback;
}

export function parseMTL(text = '') {
    const materials = new Map();
    let current = null;
    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const [command, ...rest] = line.split(/\s+/);
        const args = rest.join(' ');
        if (command === 'newmtl') {
            current = {
                name: args || `Material_${materials.size + 1}`,
                baseColor: [...DEFAULT_COLOR],
                opacity: 1,
                emission: [0, 0, 0],
                roughness: 0.5,
                metallic: 0,
                texturePath: null
            };
            materials.set(current.name, current);
            continue;
        }
        if (!current) continue;
        if (command === 'Kd') current.baseColor = normalizeColor(rest, DEFAULT_COLOR);
        else if (command === 'Ka') current.ambient = normalizeColor(rest, DEFAULT_COLOR);
        else if (command === 'Ke') current.emission = normalizeColor(rest, [0, 0, 0]);
        else if (command === 'd') current.opacity = clamp01(rest[0] ?? 1);
        else if (command === 'Tr') current.opacity = 1 - clamp01(rest[0] ?? 0);
        else if (command === 'Ns') current.roughness = 1 - clamp01(Number(rest[0] ?? 0) / 1000);
        else if (command === 'Pm') current.metallic = clamp01(rest[0] ?? 0);
        else if (command === 'map_Kd') current.texturePath = args || null;
    }
    return materials;
}

export function parseOBJ(text = '', { materials = new Map(), defaultColor = DEFAULT_COLOR } = {}) {
    const sourcePositions = [];
    const sourceUvs = [];
    const objects = [];
    const mtllibs = [];
    let current = null;
    let currentObjectName = null;
    let currentMaterial = null;
    let sawObjectDirective = false;

    const ensureObject = (name = 'Object') => {
        const resolved = String(name || 'Object').trim() || `Object_${objects.length + 1}`;
        if (current && current.name === resolved) return current;
        current = {
            name: resolved,
            positions: [],
            faces: [],
            faceUvs: [],
            faceMaterials: [],
            sourceVertexMap: new Map(),
            uvByFace: []
        };
        objects.push(current);
        return current;
    };

    const beginObject = name => {
        sawObjectDirective = true;
        currentObjectName = String(name || `Object_${objects.length + 1}`).trim() || `Object_${objects.length + 1}`;
        ensureObject(currentObjectName);
    };

    const getLocalVertex = sourceIndex => {
        if (!current) ensureObject(currentObjectName || 'Object');
        const key = String(sourceIndex);
        const existing = current.sourceVertexMap.get(key);
        if (existing !== undefined) return existing;
        const localIndex = current.positions.length;
        current.sourceVertexMap.set(key, localIndex);
        current.positions.push([...sourcePositions[sourceIndex]]);
        return localIndex;
    };

    const parseFaceVertex = token => {
        const [vToken, vtToken] = token.split('/');
        const sourceIndex = resolveIndex(vToken, sourcePositions.length);
        if (sourceIndex < 0 || sourceIndex >= sourcePositions.length) throw new Error(`OBJ face references invalid vertex index: ${token}`);
        const positionIndex = getLocalVertex(sourceIndex);
        const uvIndex = vtToken ? resolveIndex(vtToken, sourceUvs.length) : -1;
        return { positionIndex, uvIndex };
    };

    for (const rawLine of String(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const [command, ...rest] = line.split(/\s+/);
        switch (command) {
            case 'mtllib':
                mtllibs.push(rest.join(' ').trim());
                break;
            case 'o':
                beginObject(rest.join(' ') || `Object_${objects.length + 1}`);
                break;
            case 'g':
                if (!sawObjectDirective) beginObject(rest.join(' ') || `Object_${objects.length + 1}`);
                else if (!current) ensureObject(currentObjectName || 'Object');
                break;
            case 'v':
                if (rest.length >= 3) sourcePositions.push([Number(rest[0]) || 0, Number(rest[1]) || 0, Number(rest[2]) || 0]);
                break;
            case 'vt':
                if (rest.length >= 2) sourceUvs.push([Number(rest[0]) || 0, Number(rest[1]) || 0]);
                break;
            case 'usemtl':
                currentMaterial = rest.join(' ').trim() || null;
                break;
            case 'f': {
                if (rest.length < 3) break;
                if (!current) ensureObject(currentObjectName || `Object_${objects.length + 1}`);
                const corners = rest.map(parseFaceVertex);
                current.faces.push(corners.map(corner => corner.positionIndex));
                const uvs = corners.map(corner => corner.uvIndex >= 0 && corner.uvIndex < sourceUvs.length ? [...sourceUvs[corner.uvIndex]] : [0, 0]);
                current.faceUvs.push(uvs);
                current.faceMaterials.push(currentMaterial);
                break;
            }
            default:
                break;
        }
    }

    const usableObjects = objects.filter(object => object.faces.length > 0);
    return {
        version: 1,
        mtllibs,
        objects: usableObjects.map((object, objectIndex) => ({
            name: object.name || `Object_${objectIndex + 1}`,
            positions: object.positions,
            faces: object.faces,
            faceUvs: sourceUvs.length ? object.faceUvs : [],
            faceColors: object.faceMaterials.map(materialName => normalizeColor(materials.get(materialName)?.baseColor, defaultColor)),
            faceMaterials: object.faceMaterials,
            materialNames: [...new Set(object.faceMaterials.filter(Boolean))]
        }))
    };
}

function rotateXYZ(point, rotation) {
    let [x, y, z] = point;
    const [rx, ry, rz] = rotation;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    // Match Mesh#getModelMatrix rotation order.
    const r00 = cy * cz;
    const r01 = cy * sz;
    const r02 = -sy;
    const r10 = sx * sy * cz - cx * sz;
    const r11 = sx * sy * sz + cx * cz;
    const r12 = sx * cy;
    const r20 = cx * sy * cz + sx * sz;
    const r21 = cx * sy * sz - sx * cz;
    const r22 = cx * cy;
    return [
        r00 * x + r01 * y + r02 * z,
        r10 * x + r11 * y + r12 * z,
        r20 * x + r21 * y + r22 * z
    ];
}

function transformVertex(vertex, mesh) {
    const scale = mesh.scale || [1, 1, 1];
    const rotation = mesh.rotation || [0, 0, 0];
    const position = mesh.position || [0, 0, 0];
    const scaled = [vertex[0] * scale[0], vertex[1] * scale[1], vertex[2] * scale[2]];
    const rotated = rotateXYZ(scaled, rotation);
    return [rotated[0] + position[0], rotated[1] + position[1], rotated[2] + position[2]];
}

function colorKey(color, material) {
    const values = normalizeColor(color, DEFAULT_COLOR).map(value => Math.round(value * 255));
    const roughness = Math.round(Number(material?.roughness ?? 0.5) * 1000);
    const metallic = Math.round(Number(material?.metallic ?? 0) * 1000);
    const opacity = Math.round(Number(material?.opacity ?? 1) * 1000);
    return `${values.join('_')}_${roughness}_${metallic}_${opacity}`;
}

function getFaceColor(mesh, faceIndex) {
    return normalizeColor(mesh.faceColors?.[faceIndex], mesh.material?.baseColor || DEFAULT_COLOR);
}

function getObjectMaterialName(mesh, faceIndex, materialMap) {
    const color = getFaceColor(mesh, faceIndex);
    const key = colorKey(color, mesh.material);
    if (!materialMap.has(key)) {
        materialMap.set(key, {
            name: `mat_${materialMap.size + 1}_${key}`,
            color,
            opacity: Number(mesh.material?.opacity ?? color[3] ?? 1),
            emission: Array.isArray(mesh.material?.emission) ? mesh.material.emission : [0, 0, 0],
            roughness: Number(mesh.material?.roughness ?? 0.5),
            metallic: Number(mesh.material?.metallic ?? 0)
        });
    }
    return materialMap.get(key).name;
}

export function exportOBJ(meshes = [], { objectPrefix = 'Object', mtllibName = 'scene.mtl' } = {}) {
    const materialMap = new Map();
    const lines = [
        '# Lightweight 3D Engine OBJ export',
        '# Geometry transforms are baked into vertex positions.',
        `mtllib ${mtllibName}`,
        's off'
    ];
    let vertexOffset = 0;
    let uvOffset = 0;
    let objectIndex = 0;

    for (const mesh of meshes || []) {
        if (!mesh || !Array.isArray(mesh.positions) || !Array.isArray(mesh.faces) || !mesh.faces.length) continue;
        objectIndex += 1;
        lines.push(`o ${safeName(mesh.name, `${objectPrefix}_${objectIndex}`)}`);

        for (const vertex of mesh.positions) {
            const world = transformVertex(vertex, mesh);
            lines.push(`v ${world[0]} ${world[1]} ${world[2]}`);
        }

        const hasUvs = Array.isArray(mesh.faceUvs) && mesh.faceUvs.length === mesh.faces.length && mesh.faceUvs.some(face => Array.isArray(face) && face.length >= 3);
        if (hasUvs) {
            mesh.faces.forEach((face, faceIndex) => {
                const uvFace = mesh.faceUvs[faceIndex] || [];
                for (let corner = 0; corner < face.length; corner++) {
                    const uv = uvFace[corner] || [0, 0];
                    lines.push(`vt ${Number(uv[0]) || 0} ${Number(uv[1]) || 0}`);
                }
            });
        }

        let previousMaterial = null;
        let localUvCursor = 0;
        mesh.faces.forEach((face, faceIndex) => {
            const materialName = getObjectMaterialName(mesh, faceIndex, materialMap);
            if (materialName !== previousMaterial) {
                lines.push(`usemtl ${materialName}`);
                previousMaterial = materialName;
            }
            const refs = face.map((index, corner) => {
                const v = vertexOffset + Number(index) + 1;
                if (!hasUvs) return String(v);
                const vt = uvOffset + localUvCursor + corner + 1;
                return `${v}/${vt}`;
            });
            lines.push(`f ${refs.join(' ')}`);
            if (hasUvs) localUvCursor += face.length;
        });

        vertexOffset += mesh.positions.length;
        if (hasUvs) uvOffset += mesh.faces.reduce((sum, face) => sum + face.length, 0);
    }

    const mtlLines = [
        '# Lightweight 3D Engine material export'
    ];
    for (const material of materialMap.values()) {
        mtlLines.push(`newmtl ${material.name}`);
        mtlLines.push(`Kd ${material.color[0]} ${material.color[1]} ${material.color[2]}`);
        mtlLines.push(`Ke ${material.emission[0] || 0} ${material.emission[1] || 0} ${material.emission[2] || 0}`);
        mtlLines.push(`Ns ${Math.max(0, Math.min(1000, (1 - Math.max(0, Math.min(1, material.roughness))) * 1000))}`);
        mtlLines.push(`Pm ${Math.max(0, Math.min(1, material.metallic))}`);
        if (material.opacity < 1) {
            mtlLines.push(`d ${Math.max(0, Math.min(1, material.opacity))}`);
        }
        mtlLines.push('');
    }

    return {
        obj: `${lines.join('\n')}\n`,
        mtl: `${mtlLines.join('\n')}\n`,
        materialCount: materialMap.size,
        objectCount: objectIndex,
        mtllibName
    };
}
