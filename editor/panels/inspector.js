import { loadTextureBlob } from '../../engine/loader.js';

const faceNames = ['Front', 'Back', 'Left', 'Right', 'Top', 'Bottom'];

export function createInspectorPanel(gl, onSelectFace) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Inspector';
    panel.appendChild(title);

    const info = document.createElement('div');
    panel.appendChild(info);
    let currentMesh = null;
    let currentFace = 0;

    function addField(label, value, onInput, step = '0.1') {
        const group = document.createElement('div');
        group.className = 'field-group';
        const labelElement = document.createElement('label');
        labelElement.className = 'field-label';
        labelElement.textContent = label;
        group.appendChild(labelElement);
        const input = document.createElement('input');
        input.className = 'editor-input';
        input.type = 'number';
        input.step = step;
        input.value = value;
        input.addEventListener('input', () => onInput(Number(input.value) || 0));
        group.appendChild(input);
        return group;
    }

    function addVectorField(label, values, onInput, degrees = false) {
        const group = document.createElement('div');
        group.className = 'field-group';
        const labelElement = document.createElement('label');
        labelElement.className = 'field-label';
        labelElement.textContent = label;
        group.appendChild(labelElement);
        const fields = document.createElement('div');
        fields.className = 'vector-fields';
        values.forEach((value, index) => {
            const input = document.createElement('input');
            input.className = 'editor-input';
            input.type = 'number';
            input.step = '0.1';
            input.value = degrees ? (value * 180 / Math.PI).toFixed(1) : value;
            input.addEventListener('input', () => {
                const nextValue = Number(input.value) || 0;
                onInput(index, degrees ? nextValue * Math.PI / 180 : nextValue);
            });
            fields.appendChild(input);
        });
        group.appendChild(fields);
        info.appendChild(group);
    }

    function renderFaceEditor() {
        info.innerHTML = '';
        if (!currentMesh) {
            const empty = document.createElement('div');
            empty.className = 'inspector-empty';
            empty.textContent = 'Select an object from the hierarchy.';
            info.appendChild(empty);
            return;
        }

        const rigInfo = document.createElement('div');
        rigInfo.className = 'inspector-empty';
        rigInfo.textContent = `Rig: ${currentMesh.skeleton.bones.length} bone${currentMesh.skeleton.bones.length === 1 ? '' : 's'}${currentMesh.animationPlayer.playing ? ' - playing' : ''}`;
        info.appendChild(rigInfo);

        const faceTitle = document.createElement('div');
        faceTitle.className = 'face-title';
        faceTitle.textContent = `Editing ${faceNames[currentFace] || `Face ${currentFace + 1}`} face`;
        info.appendChild(faceTitle);
        const faceButtons = document.createElement('div');
        faceButtons.className = 'face-buttons';
        currentMesh.polygons.forEach((polygon, index) => {
            const button = document.createElement('button');
            button.className = 'face-button' + (index === currentFace ? ' selected' : '');
            button.type = 'button';
            button.textContent = faceNames[index] || `Face ${index + 1}`;
            button.addEventListener('click', () => {
                currentFace = index;
                onSelectFace(index);
                renderFaceEditor();
            });
            faceButtons.appendChild(button);
        });
        info.appendChild(faceButtons);

        const polygon = currentMesh.polygons[currentFace] || [];
        polygon.forEach((vertexValue, vertexIndex) => {
            const vertex = document.createElement('div');
            vertex.className = 'field-group';
            const label = document.createElement('div');
            label.className = 'field-label';
            label.textContent = `Vertex ${vertexIndex + 1}`;
            vertex.appendChild(label);
            const fields = document.createElement('div');
            fields.className = 'vector-fields';
            for (let axis = 0; axis < 3; axis++) {
                const value = vertexValue[axis];
                const input = document.createElement('input');
                input.className = 'editor-input';
                input.type = 'number';
                input.step = '0.05';
                input.value = value;
                input.addEventListener('input', () => {
                    const vertex = [...currentMesh.polygons[currentFace][vertexIndex]];
                    vertex[axis] = Number(input.value) || 0;
                    currentMesh.setFaceVertex(currentFace, vertexIndex, vertex);
                });
                fields.appendChild(input);
            }
            vertex.appendChild(fields);
            info.appendChild(vertex);
        });

        const name = document.createElement('input');
        name.className = 'editor-input field-group';
        name.value = currentMesh.name;
        name.addEventListener('input', () => { currentMesh.name = name.value || 'Mesh'; });
        info.appendChild(name);
        addVectorField('Position', currentMesh.position, (index, value) => { currentMesh.position[index] = value; });
        addVectorField('Rotation', currentMesh.rotation, (index, value) => { currentMesh.rotation[index] = value; }, true);
        addVectorField('Scale', currentMesh.scale, (index, value) => { currentMesh.scale[index] = value; });

        const colorGroup = document.createElement('div');
        colorGroup.className = 'field-group';
        const colorLabel = document.createElement('label');
        colorLabel.className = 'field-label';
        colorLabel.textContent = 'Material color';
        colorGroup.appendChild(colorLabel);
        const colorRow = document.createElement('div');
        colorRow.className = 'color-row';
        const color = document.createElement('input');
        color.className = 'color-input';
        color.type = 'color';
        color.value = '#' + currentMesh.faceColors[currentFace].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
        color.addEventListener('input', () => {
            currentMesh.faceColors[currentFace] = [1, 3, 5].map(offset => parseInt(color.value.slice(offset, offset + 2), 16) / 255);
        });
        colorRow.appendChild(color);
        colorGroup.appendChild(colorRow);
        info.appendChild(colorGroup);

        const textureGroup = document.createElement('div');
        textureGroup.className = 'field-group';
        const textureLabel = document.createElement('label');
        textureLabel.className = 'field-label';
        textureLabel.textContent = 'Image for this face (WebP or image)';
        textureGroup.appendChild(textureLabel);
        const file = document.createElement('input');
        file.className = 'editor-input';
        file.type = 'file';
        file.accept = 'image/webp,image/*';
        file.addEventListener('change', async () => {
            if (!file.files[0]) return;
            currentMesh.faceTextures[currentFace] = await loadTextureBlob(file.files[0], gl);
        });
        textureGroup.appendChild(file);
        info.appendChild(textureGroup);

        const transform = currentMesh.faceUvTransforms[currentFace];
        const uvControls = document.createElement('div');
        uvControls.className = 'field-group';
        const uvLabel = document.createElement('div');
        uvLabel.className = 'field-label';
        uvLabel.textContent = 'Image placement: scale X/Y, offset X/Y, rotation';
        uvControls.appendChild(uvLabel);
        [['Scale X', transform.scale, 0], ['Scale Y', transform.scale, 1], ['Offset X', transform.offset, 0], ['Offset Y', transform.offset, 1]].forEach(([label, target, index]) => {
            uvControls.appendChild(addField(label, target[index], value => { target[index] = value; }));
        });
        uvControls.appendChild(addField('Rotation (degrees)', transform.rotation * 180 / Math.PI, value => { transform.rotation = value * Math.PI / 180; }));
        info.appendChild(uvControls);
    }

    function setMesh(mesh) {
        currentMesh = mesh;
        currentFace = mesh?.selectedFace >= 0 ? mesh.selectedFace : 0;
        renderFaceEditor();
    }

    return { element: panel, setMesh, setFace: faceIndex => { currentFace = faceIndex; renderFaceEditor(); } };
}
