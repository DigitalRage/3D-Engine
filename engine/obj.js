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
    const source = String(text);
    let current = null;
    let lineStart = 0;

    while (lineStart < source.length) {
        let lineEnd = source.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = source.length;
        let start = lineStart;
        while (start < lineEnd && source.charCodeAt(start) <= 32) start++;
        let end = lineEnd;
        while (end > start && source.charCodeAt(end - 1) <= 32) end--;
        if (start < end && source.charCodeAt(start) !== 35) {
            let commandEnd = start;
            while (commandEnd < end && source.charCodeAt(commandEnd) > 32) commandEnd++;
            let argStart = commandEnd;
            while (argStart < end && source.charCodeAt(argStart) <= 32) argStart++;
            const command = source.slice(start, commandEnd);
            const args = argStart < end ? source.slice(argStart, end) : '';
            switch (command) {
                case 'newmtl':
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
                    break;
                case 'Kd':
                    if (current) current.baseColor = parseColorArgs(source, argStart, end, DEFAULT_COLOR);
                    break;
                case 'Ka':
                    if (current) current.ambient = parseColorArgs(source, argStart, end, DEFAULT_COLOR);
                    break;
                case 'Ke':
                    if (current) current.emission = parseColorArgs(source, argStart, end, [0, 0, 0]);
                    break;
                case 'd':
                    if (current) current.opacity = clamp01(readFirstNumber(source, argStart, end, 1));
                    break;
                case 'Tr':
                    if (current) current.opacity = 1 - clamp01(readFirstNumber(source, argStart, end, 0));
                    break;
                case 'Ns':
                    if (current) current.roughness = 1 - clamp01(readFirstNumber(source, argStart, end, 0) / 1000);
                    break;
                case 'Pm':
                    if (current) current.metallic = clamp01(readFirstNumber(source, argStart, end, 0));
                    break;
                case 'map_Kd':
                    if (current) current.texturePath = args || null;
                    break;
                default:
                    break;
            }
        }
        lineStart = lineEnd + 1;
    }
    return materials;
}

export function parseOBJ(text = '', { materials = new Map(), defaultColor = DEFAULT_COLOR } = {}) {
    const source = String(text);
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
            sourceVertexMap: new Map()
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
        const existing = current.sourceVertexMap.get(sourceIndex);
        if (existing !== undefined) return existing;
        const vertex = sourcePositions[sourceIndex];
        if (!vertex) throw new Error(`OBJ face references invalid vertex index: ${sourceIndex + 1}`);
        const localIndex = current.positions.length;
        current.sourceVertexMap.set(sourceIndex, localIndex);
        current.positions.push([vertex[0], vertex[1], vertex[2]]);
        return localIndex;
    };

    const colorCache = new Map();
    const getMaterialColor = materialName => {
        if (colorCache.has(materialName)) return colorCache.get(materialName);
        const color = normalizeColor(materials.get(materialName)?.baseColor, defaultColor);
        colorCache.set(materialName, color);
        return color;
    };

    const sourceLength = source.length;
    let lineStart = 0;
    while (lineStart < sourceLength) {
        let lineEnd = source.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = sourceLength;
        let start = lineStart;
        while (start < lineEnd && source.charCodeAt(start) <= 32) start++;
        let end = lineEnd;
        while (end > start && source.charCodeAt(end - 1) <= 32) end--;

        if (start < end && source.charCodeAt(start) !== 35) {
            let commandEnd = start;
            while (commandEnd < end && source.charCodeAt(commandEnd) > 32) commandEnd++;
            const command = source.slice(start, commandEnd);
            let cursor = commandEnd;
            while (cursor < end && source.charCodeAt(cursor) <= 32) cursor++;

            switch (command) {
                case 'mtllib':
                    if (cursor < end) mtllibs.push(source.slice(cursor, end));
                    break;
                case 'o':
                    beginObject(cursor < end ? source.slice(cursor, end) : `Object_${objects.length + 1}`);
                    break;
                case 'g':
                    if (!sawObjectDirective) beginObject(cursor < end ? source.slice(cursor, end) : `Object_${objects.length + 1}`);
                    else if (!current) ensureObject(currentObjectName || 'Object');
                    break;
                case 'v': {
                    const x = readNumberToken(source, cursor, end);
                    cursor = x.end;
                    const y = readNumberToken(source, cursor, end);
                    cursor = y.end;
                    const z = readNumberToken(source, cursor, end);
                    if (x.end > x.start && y.end > y.start && z.end > z.start) {
                        sourcePositions.push([x.value || 0, y.value || 0, z.value || 0]);
                    }
                    break;
                }
                case 'vt': {
                    const u = readNumberToken(source, cursor, end);
                    cursor = u.end;
                    const v = readNumberToken(source, cursor, end);
                    if (u.end > u.start && v.end > v.start) sourceUvs.push([u.value || 0, v.value || 0]);
                    break;
                }
                case 'usemtl':
                    currentMaterial = cursor < end ? source.slice(cursor, end) : null;
                    break;
                case 'f': {
                    if (cursor >= end) break;
                    if (!current) ensureObject(currentObjectName || `Object_${objects.length + 1}`);
                    const face = [];
                    const faceUvs = sourceUvs.length ? [] : null;
                    while (cursor < end) {
                        while (cursor < end && source.charCodeAt(cursor) <= 32) cursor++;
                        if (cursor >= end) break;
                        let tokenEnd = cursor;
                        while (tokenEnd < end && source.charCodeAt(tokenEnd) > 32) tokenEnd++;

                        let slash1 = tokenEnd;
                        for (let i = cursor; i < tokenEnd; i++) {
                            if (source.charCodeAt(i) === 47) { slash1 = i; break; }
                        }
                        const sourceIndex = resolveIndexFast(source, cursor, slash1, sourcePositions.length);
                        if (sourceIndex < 0 || sourceIndex >= sourcePositions.length) {
                            throw new Error(`OBJ face references invalid vertex index: ${source.slice(cursor, tokenEnd)}`);
                        }
                        face.push(getLocalVertex(sourceIndex));

                        if (faceUvs) {
                            let uvIndex = -1;
                            if (slash1 < tokenEnd) {
                                let slash2 = tokenEnd;
                                for (let i = slash1 + 1; i < tokenEnd; i++) {
                                    if (source.charCodeAt(i) === 47) { slash2 = i; break; }
                                }
                                if (slash2 > slash1 + 1) {
                                    uvIndex = resolveIndexFast(source, slash1 + 1, slash2, sourceUvs.length);
                                }
                            }
                            const uv = (uvIndex >= 0 && uvIndex < sourceUvs.length) ? sourceUvs[uvIndex] : null;
                            faceUvs.push(uv ? [uv[0], uv[1]] : [0, 0]);
                        }

                        cursor = tokenEnd;
                    }
                    if (face.length >= 3) {
                        current.faces.push(face);
                        if (faceUvs) current.faceUvs.push(faceUvs);
                        current.faceMaterials.push(currentMaterial);
                    }
                    break;
                }
                default:
                    break;
            }
        }
        lineStart = lineEnd + 1;
    }

    const usableObjects = objects.filter(object => object.faces.length > 0);
    return {
        version: 1,
        mtllibs,
        materials: [...materials.entries()],
        objects: usableObjects.map((object, objectIndex) => ({
            name: object.name || `Object_${objectIndex + 1}`,
            positions: object.positions,
            faces: object.faces,
            faceUvs: sourceUvs.length ? object.faceUvs : [],
            faceColors: object.faceMaterials.map(materialName => [...getMaterialColor(materialName)]),
            faceMaterials: object.faceMaterials,
            materialNames: [...new Set(object.faceMaterials.filter(Boolean))]
        }))
    };
}


/**
 * Byte-oriented OBJ parser used by browser File/ArrayBuffer imports. OBJ is an
 * ASCII-oriented interchange format, so parsing the bytes directly avoids a
 * full UTF-16 decode plus thousands of split/slice allocations on huge models.
 */
export function parseOBJBuffer(input, { materials = new Map(), defaultColor = DEFAULT_COLOR } = {}) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const sourcePositions = [];
    const sourceUvs = [];
    const objects = [];
    const mtllibs = [];
    const decoder = new TextDecoder();
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
            sourceVertexMap: new Map()
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
        const existing = current.sourceVertexMap.get(sourceIndex);
        if (existing !== undefined) return existing;
        const vertex = sourcePositions[sourceIndex];
        if (!vertex) throw new Error(`OBJ face references invalid vertex index: ${sourceIndex + 1}`);
        const localIndex = current.positions.length;
        current.sourceVertexMap.set(sourceIndex, localIndex);
        current.positions.push([vertex[0], vertex[1], vertex[2]]);
        return localIndex;
    };

    const colorCache = new Map();
    const getMaterialColor = materialName => {
        if (colorCache.has(materialName)) return colorCache.get(materialName);
        const color = normalizeColor(materials.get(materialName)?.baseColor, defaultColor);
        colorCache.set(materialName, color);
        return color;
    };

    let lineStart = 0;
    const length = bytes.length;
    while (lineStart < length) {
        let lineEnd = lineStart;
        while (lineEnd < length && bytes[lineEnd] !== 10) lineEnd++;
        let cursor = lineStart;
        while (cursor < lineEnd && bytes[cursor] <= 32) cursor++;
        if (cursor < lineEnd && bytes[cursor] !== 35) {
            const c0 = bytes[cursor++];
            if (c0 === 118) { // v / vt / vn
                const c1 = cursor < lineEnd ? bytes[cursor] : 0;
                if (c1 === 116) { // vt
                    cursor++;
                    const uStart = cursor;
                    const u = readFloatBytes(bytes, cursor, lineEnd); cursor = lastFloatEnd;
                    const vStart = cursor;
                    const v = readFloatBytes(bytes, cursor, lineEnd);
                    cursor = lastFloatEnd;
                    if (cursor > vStart && vStart > uStart) sourceUvs.push([u || 0, v || 0]);
                } else if (c1 === 110) { // vn, ignored: this engine derives flat face normals
                    cursor = lineEnd;
                } else { // v
                    const xStart = cursor;
                    const x = readFloatBytes(bytes, cursor, lineEnd); cursor = lastFloatEnd;
                    const yStart = cursor;
                    const y = readFloatBytes(bytes, cursor, lineEnd); cursor = lastFloatEnd;
                    const zStart = cursor;
                    const z = readFloatBytes(bytes, cursor, lineEnd);
                    cursor = lastFloatEnd;
                    if (xStart < yStart && yStart < zStart && cursor > zStart) sourcePositions.push([x || 0, y || 0, z || 0]);
                }
            } else if (c0 === 102) { // f
                if (cursor >= lineEnd) { lineStart = lineEnd + 1; continue; }
                if (!current) ensureObject(currentObjectName || `Object_${objects.length + 1}`);
                const face = [];
                const faceUvs = sourceUvs.length ? [] : null;
                while (cursor < lineEnd) {
                    while (cursor < lineEnd && bytes[cursor] <= 32) cursor++;
                    if (cursor >= lineEnd) break;
                    const tokenStart = cursor;
                    let tokenEnd = cursor;
                    let slash1 = -1;
                    while (tokenEnd < lineEnd && bytes[tokenEnd] > 32) {
                        if (slash1 < 0 && bytes[tokenEnd] === 47) slash1 = tokenEnd;
                        tokenEnd++;
                    }
                    const sourceIndex = resolveIndexBytes(bytes, tokenStart, slash1 >= 0 ? slash1 : tokenEnd, sourcePositions.length);
                    if (sourceIndex < 0 || sourceIndex >= sourcePositions.length) {
                        throw new Error(`OBJ face references invalid vertex index: ${decoder.decode(bytes.subarray(tokenStart, tokenEnd))}`);
                    }
                    face.push(getLocalVertex(sourceIndex));
                    if (faceUvs) {
                        let uvIndex = -1;
                        if (slash1 >= 0 && slash1 + 1 < tokenEnd) {
                            let slash2 = tokenEnd;
                            for (let i = slash1 + 1; i < tokenEnd; i++) {
                                if (bytes[i] === 47) { slash2 = i; break; }
                            }
                            if (slash2 > slash1 + 1) uvIndex = resolveIndexBytes(bytes, slash1 + 1, slash2, sourceUvs.length);
                        }
                        const uv = uvIndex >= 0 && uvIndex < sourceUvs.length ? sourceUvs[uvIndex] : null;
                        faceUvs.push(uv ? [uv[0], uv[1]] : [0, 0]);
                    }
                    cursor = tokenEnd;
                }
                if (face.length >= 3) {
                    current.faces.push(face);
                    if (faceUvs) current.faceUvs.push(faceUvs);
                    current.faceMaterials.push(currentMaterial);
                }
            } else if (c0 === 111) { // o
                while (cursor < lineEnd && bytes[cursor] <= 32) cursor++;
                beginObject(cursor < lineEnd ? decoder.decode(bytes.subarray(cursor, lineEnd)) : `Object_${objects.length + 1}`);
            } else if (c0 === 103) { // g
                while (cursor < lineEnd && bytes[cursor] <= 32) cursor++;
                if (!sawObjectDirective) beginObject(cursor < lineEnd ? decoder.decode(bytes.subarray(cursor, lineEnd)) : `Object_${objects.length + 1}`);
                else if (!current) ensureObject(currentObjectName || 'Object');
            } else if (c0 === 117) { // usemtl
                if (cursor < lineEnd && bytes[cursor] === 115 && bytes[cursor + 1] === 101 && bytes[cursor + 2] === 109 && bytes[cursor + 3] === 116 && bytes[cursor + 4] === 108) {
                    cursor += 5;
                    while (cursor < lineEnd && bytes[cursor] <= 32) cursor++;
                    currentMaterial = cursor < lineEnd ? decoder.decode(bytes.subarray(cursor, lineEnd)) : null;
                }
            } else if (c0 === 109) { // mtllib
                if (cursor < lineEnd && bytes[cursor] === 116 && bytes[cursor + 1] === 108 && bytes[cursor + 2] === 108 && bytes[cursor + 3] === 105 && bytes[cursor + 4] === 98) {
                    cursor += 5;
                    while (cursor < lineEnd && bytes[cursor] <= 32) cursor++;
                    if (cursor < lineEnd) mtllibs.push(decoder.decode(bytes.subarray(cursor, lineEnd)));
                }
            }
        }
        lineStart = lineEnd + 1;
    }

    const usableObjects = objects.filter(object => object.faces.length > 0);
    return {
        version: 1,
        mtllibs,
        materials: [...materials.entries()],
        objects: usableObjects.map((object, objectIndex) => ({
            name: object.name || `Object_${objectIndex + 1}`,
            positions: object.positions,
            faces: object.faces,
            faceUvs: sourceUvs.length ? object.faceUvs : [],
            faceColors: object.faceMaterials.map(materialName => [...getMaterialColor(materialName)]),
            faceMaterials: object.faceMaterials,
            materialNames: [...new Set(object.faceMaterials.filter(Boolean))]
        }))
    };
}

let lastFloatEnd = 0;

function readFloatBytes(bytes, start, end) {
    let i = start;
    while (i < end && bytes[i] <= 32) i++;
    const tokenStart = i;
    let sign = 1;
    if (bytes[i] === 45) { sign = -1; i++; }
    else if (bytes[i] === 43) i++;

    let integer = 0;
    let digits = 0;
    while (i < end) {
        const d = bytes[i] - 48;
        if (d < 0 || d > 9) break;
        integer = integer * 10 + d;
        digits++;
        i++;
    }

    let value = integer;
    if (i < end && bytes[i] === 46) {
        i++;
        let fraction = 0;
        let scale = 1;
        while (i < end) {
            const d = bytes[i] - 48;
            if (d < 0 || d > 9) break;
            fraction = fraction * 10 + d;
            scale *= 10;
            i++;
        }
        value += fraction / scale;
    }

    if (i < end && (bytes[i] === 101 || bytes[i] === 69)) {
        i++;
        let exponentSign = 1;
        if (bytes[i] === 45) { exponentSign = -1; i++; }
        else if (bytes[i] === 43) i++;
        let exponent = 0;
        let exponentDigits = 0;
        while (i < end) {
            const d = bytes[i] - 48;
            if (d < 0 || d > 9) break;
            exponent = exponent * 10 + d;
            exponentDigits++;
            i++;
        }
        if (exponentDigits) value *= 10 ** (exponent * exponentSign);
    }
    lastFloatEnd = i;
    return sign * value;
}

function resolveIndexBytes(bytes, start, end, length) {
    if (start >= end) return -1;
    let i = start;
    let sign = 1;
    if (bytes[i] === 45) { sign = -1; i++; }
    else if (bytes[i] === 43) i++;
    let value = 0;
    let digits = 0;
    for (; i < end; i++) {
        const d = bytes[i] - 48;
        if (d < 0 || d > 9) break;
        value = value * 10 + d;
        digits++;
    }
    if (!digits || value === 0) return -1;
    return sign > 0 ? value - 1 : length - value;
}

function parseColorArgs(source, start, end, fallback) {
    const values = [0, 0, 0];
    let cursor = start;
    for (let i = 0; i < 3; i++) {
        const token = readNumberToken(source, cursor, end);
        values[i] = token.end > token.start ? token.value : fallback[i];
        cursor = token.end;
    }
    return normalizeColor(values, fallback);
}

function readFirstNumber(source, start, end, fallback) {
    const token = readNumberToken(source, start, end);
    return token.end > token.start ? token.value : fallback;
}

function readNumberToken(source, start, end) {
    let cursor = start;
    while (cursor < end && source.charCodeAt(cursor) <= 32) cursor++;
    const tokenStart = cursor;
    while (cursor < end && source.charCodeAt(cursor) > 32) cursor++;
    return { start: tokenStart, end: cursor, value: tokenStart < cursor ? Number(source.slice(tokenStart, cursor)) : 0 };
}

function resolveIndexFast(source, start, end, length) {
    if (start >= end) return -1;
    let cursor = start;
    let sign = 1;
    if (source.charCodeAt(cursor) === 45) {
        sign = -1;
        cursor++;
    } else if (source.charCodeAt(cursor) === 43) {
        cursor++;
    }
    let value = 0;
    let hasDigit = false;
    for (; cursor < end; cursor++) {
        const code = source.charCodeAt(cursor) - 48;
        if (code < 0 || code > 9) break;
        value = value * 10 + code;
        hasDigit = true;
    }
    if (!hasDigit || value === 0) return -1;
    return sign > 0 ? value - 1 : length - value;
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
