export function executeMeshCommand(editor, mesh, label, apply) {
    const before = captureMeshState(mesh);
    apply();
    const after = captureMeshState(mesh);
    if (meshStateSignature(before) === meshStateSignature(after)) {
        editor.ui.setStatus?.(`${label}: no change`);
        return false;
    }

    editor.undoStack.push({
        type: 'mesh-edit',
        label,
        mesh,
        undo: () => restoreMeshState(mesh, before),
        redo: () => restoreMeshState(mesh, after)
    });
    if (editor.undoStack.length > editor.maxHistoryLength) editor.undoStack.shift();
    editor.redoStack.length = 0;
    editor.ui.setStatus?.(`${label}: complete`);
    return true;
}

export function captureMeshState(mesh) {
    return {
        positions: mesh.positions.map(position => [...position]),
        faces: mesh.faces.map(face => [...face]),
        faceColors: mesh.faceColors.map(color => [...color]),
        faceUvs: mesh.faceUvs.map(faceUvs => faceUvs.map(uv => [...uv])),
        faceTextures: [...mesh.faceTextures],
        faceTextureIds: [...mesh.faceTextureIds],
        faceUvTransforms: mesh.faceUvTransforms.map(transform => ({
            scale: [...transform.scale],
            offset: [...transform.offset],
            rotation: transform.rotation,
            flipX: transform.flipX,
            flipY: transform.flipY
        })),
        vertexWeights: new Map([...mesh.vertexWeights].map(([index, skin]) => [index, {
            bindPosition: [...skin.bindPosition],
            weights: new Map(skin.weights)
        }])),
        selectedFace: mesh.selectedFace,
        selectedVertex: mesh.selectedVertex ? { ...mesh.selectedVertex } : null,
        skinRevision: mesh.skinRevision
    };
}

export function restoreMeshState(mesh, state) {
    mesh.setTopology(state.positions, state.faces);
    mesh.faceColors = state.faceColors.map(color => [...color]);
    mesh.faceUvs = state.faceUvs.map(faceUvs => faceUvs.map(uv => [...uv]));
    mesh.faceTextures = [...state.faceTextures];
    mesh.faceTextureIds = [...state.faceTextureIds];
    mesh.faceUvTransforms = state.faceUvTransforms.map(transform => ({
        scale: [...transform.scale],
        offset: [...transform.offset],
        rotation: transform.rotation,
        flipX: transform.flipX,
        flipY: transform.flipY
    }));
    mesh.vertexWeights = new Map([...state.vertexWeights].map(([index, skin]) => [index, {
        bindPosition: [...skin.bindPosition],
        weights: new Map(skin.weights)
    }]));
    mesh.selectedFace = state.selectedFace;
    mesh.selectedVertex = state.selectedVertex ? { ...state.selectedVertex } : null;
    mesh.skinRevision = state.skinRevision + 1;
    mesh.rebuildRenderData();
}

function meshStateSignature(state) {
    return JSON.stringify({
        positions: state.positions,
        faces: state.faces,
        faceColors: state.faceColors,
        faceUvs: state.faceUvs,
        faceTextureIds: state.faceTextureIds,
        faceUvTransforms: state.faceUvTransforms,
        vertexWeights: [...state.vertexWeights].map(([index, skin]) => [
            index,
            skin.bindPosition,
            [...skin.weights].map(([bone, weight]) => [bone.name, weight])
        ])
    });
}
