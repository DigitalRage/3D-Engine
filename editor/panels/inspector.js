const faceNames = ['Front', 'Back', 'Left', 'Right', 'Top', 'Bottom'];

export function createInspectorPanel(gl, textureLibrary, onSelectFace, onHistory = () => {}) {
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
        input.addEventListener('change', () => { onHistory(); onInput(Number(input.value) || 0); });
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
            input.addEventListener('change', () => {
                onHistory();
                const nextValue = Number(input.value) || 0;
                onInput(index, degrees ? nextValue * Math.PI / 180 : nextValue);
            });
            fields.appendChild(input);
        });
        group.appendChild(fields);
        info.appendChild(group);
    }

    function addTextureSelect(label, selectedId, onChange) {
        const group = document.createElement('div');
        group.className = 'field-group';
        const labelElement = document.createElement('label');
        labelElement.className = 'field-label';
        labelElement.textContent = label;
        group.appendChild(labelElement);
        const select = document.createElement('select');
        select.className = 'editor-input';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'No image';
        select.appendChild(empty);
        textureLibrary.assets.forEach(asset => {
            const option = document.createElement('option');
            option.value = asset.id;
            option.textContent = asset.name;
            select.appendChild(option);
        });
        select.value = selectedId || '';
        select.addEventListener('change', () => onChange(textureLibrary.get(select.value)));
        group.appendChild(select);
        return group;
    }

    function addTextureUpload(label, onTexture) {
        const group = document.createElement('div');
        group.className = 'field-group';
        const labelElement = document.createElement('label');
        labelElement.className = 'field-label';
        labelElement.textContent = label;
        group.appendChild(labelElement);
        const file = document.createElement('input');
        file.className = 'editor-input';
        file.type = 'file';
        file.accept = 'image/*';
        file.addEventListener('change', async () => {
            if (!file.files[0]) return;
            const asset = await textureLibrary.addFile(file.files[0]);
            onTexture(asset);
            renderFaceEditor();
        });
        group.appendChild(file);
        return group;
    }

    function addCheckbox(label, checked, onChange) {
        const group = document.createElement('label');
        group.className = 'check-row field-group';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        group.append(input, document.createTextNode(label));
        return group;
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

        const faceCount = currentMesh.faceCount || currentMesh.faces.length;
        currentFace = Math.max(0, Math.min(faceCount - 1, currentFace || 0));
        const rigInfo = document.createElement('div');
        rigInfo.className = 'inspector-empty';
        rigInfo.textContent = `Rig: ${currentMesh.skeleton.bones.length} bone${currentMesh.skeleton.bones.length === 1 ? '' : 's'}${currentMesh.animationPlayer.playing ? ' - playing' : ''}`;
        info.appendChild(rigInfo);

        const faceTitle = document.createElement('div');
        faceTitle.className = 'face-title';
        faceTitle.textContent = `Editing ${faceNames[currentFace] || `Face ${currentFace + 1}`} face`;
        info.appendChild(faceTitle);
        const faceNavigator = document.createElement('div');
        faceNavigator.className = 'navigator-row';
        const previousFace = document.createElement('button');
        previousFace.type = 'button';
        previousFace.textContent = '‹';
        previousFace.title = 'Previous face';
        previousFace.disabled = faceCount < 2;
        const faceInput = document.createElement('input');
        faceInput.className = 'editor-input navigator-index';
        faceInput.type = 'number';
        faceInput.min = '1';
        faceInput.max = String(Math.max(1, faceCount));
        faceInput.value = String(currentFace + 1);
        const nextFace = document.createElement('button');
        nextFace.type = 'button';
        nextFace.textContent = '›';
        nextFace.title = 'Next face';
        nextFace.disabled = faceCount < 2;
        const faceCountLabel = document.createElement('span');
        faceCountLabel.className = 'navigator-count';
        faceCountLabel.textContent = `/ ${faceCount}`;
        const setFace = index => {
            currentFace = Math.max(0, Math.min(faceCount - 1, index));
            onSelectFace(currentFace);
            renderFaceEditor();
        };
        previousFace.addEventListener('click', () => setFace(currentFace - 1));
        nextFace.addEventListener('click', () => setFace(currentFace + 1));
        faceInput.addEventListener('change', () => setFace((Number(faceInput.value) || 1) - 1));
        faceNavigator.append(previousFace, faceInput, faceCountLabel, nextFace);
        info.appendChild(faceNavigator);

        const vertexCount = Math.floor(currentMesh.positions.length);
        let currentVertexIndex = currentMesh.selectedVertex
            ? currentMesh.faces[currentMesh.selectedVertex.faceIndex]?.[currentMesh.selectedVertex.vertexIndex]
            : currentMesh.faces[currentFace]?.[0];
        currentVertexIndex = Number.isInteger(currentVertexIndex)
            ? currentVertexIndex
            : 0;
        currentVertexIndex = Math.max(0, Math.min(Math.max(0, vertexCount - 1), currentVertexIndex));

        const sharedVertexTitle = document.createElement('div');
        sharedVertexTitle.className = 'panel-title';
        sharedVertexTitle.textContent = `Shared vertices (${vertexCount})`;
        info.appendChild(sharedVertexTitle);
        const vertexNavigator = document.createElement('div');
        vertexNavigator.className = 'navigator-row';
        const previousVertex = document.createElement('button');
        previousVertex.type = 'button';
        previousVertex.textContent = '‹';
        previousVertex.disabled = vertexCount < 2;
        const vertexInput = document.createElement('input');
        vertexInput.className = 'editor-input navigator-index';
        vertexInput.type = 'number';
        vertexInput.min = '1';
        vertexInput.max = String(Math.max(1, vertexCount));
        vertexInput.value = String(currentVertexIndex + 1);
        const nextVertex = document.createElement('button');
        nextVertex.type = 'button';
        nextVertex.textContent = '›';
        nextVertex.disabled = vertexCount < 2;
        const vertexCountLabel = document.createElement('span');
        vertexCountLabel.className = 'navigator-count';
        vertexCountLabel.textContent = `/ ${vertexCount}`;
        let vertexFields = null;
        const setVertex = index => {
            currentVertexIndex = Math.max(0, Math.min(vertexCount - 1, index));
            vertexInput.value = String(currentVertexIndex + 1);
            if (vertexFields) renderVertexFields();
        };
        previousVertex.addEventListener('click', () => setVertex(currentVertexIndex - 1));
        nextVertex.addEventListener('click', () => setVertex(currentVertexIndex + 1));
        vertexInput.addEventListener('change', () => setVertex((Number(vertexInput.value) || 1) - 1));
        vertexNavigator.append(previousVertex, vertexInput, vertexCountLabel, nextVertex);
        info.appendChild(vertexNavigator);

        vertexFields = document.createElement('div');
        vertexFields.className = 'vertex-editor-fields';
        info.appendChild(vertexFields);
        function renderVertexFields() {
            vertexFields.replaceChildren();
            const value = currentMesh.positions[currentVertexIndex] || [0, 0, 0];
            const label = document.createElement('div');
            label.className = 'field-label';
            label.textContent = `Vertex ${currentVertexIndex + 1}`;
            vertexFields.appendChild(label);
            const fields = document.createElement('div');
            fields.className = 'vector-fields';
            for (let axis = 0; axis < 3; axis++) {
                const input = document.createElement('input');
                input.className = 'editor-input';
                input.type = 'number';
                input.step = '0.05';
                input.value = value[axis];
                input.addEventListener('change', () => {
                    const position = [...(currentMesh.positions[currentVertexIndex] || [0, 0, 0])];
                    position[axis] = Number(input.value) || 0;
                    currentMesh.setVertexPosition(currentVertexIndex, position);
                    onHistory();
                });
                fields.appendChild(input);
            }
            vertexFields.appendChild(fields);
        }
        renderVertexFields();

        const name = document.createElement('input');
        name.className = 'editor-input field-group';
        name.value = currentMesh.name;
        name.addEventListener('change', () => { onHistory(); currentMesh.name = name.value || 'Mesh'; });
        info.appendChild(name);
        const shading = document.createElement('select');
        shading.className = 'editor-input field-group';
        shading.setAttribute('aria-label', 'Mesh shading mode');
        [['toon', 'Anime two-tone'], ['flat', 'Flat color']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            shading.appendChild(option);
        });
        shading.value = currentMesh.material.shading || 'toon';
        shading.addEventListener('change', () => {
            onHistory();
            currentMesh.material.shading = shading.value;
            currentMesh.updateRenderQueues();
        });
        info.appendChild(shading);
        info.appendChild(addCheckbox('Double-sided geometry (slower)', !!currentMesh.material.doubleSided, checked => {
            onHistory();
            currentMesh.material.doubleSided = checked;
            currentMesh.updateRenderQueues();
        }));
        addVectorField('Position', currentMesh.position, (index, value) => { currentMesh.position[index] = value; currentMesh.markTransformChanged(); });
        addVectorField('Rotation', currentMesh.rotation, (index, value) => { currentMesh.rotation[index] = value; currentMesh.markTransformChanged(); }, true);
        addVectorField('Scale', currentMesh.scale, (index, value) => { currentMesh.scale[index] = value; currentMesh.markTransformChanged(); });

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
        const faceColor = currentMesh.faceColors[currentFace] || [1, 1, 1, 1];
        color.value = '#' + faceColor.slice(0, 3).map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
        color.addEventListener('change', () => {
            onHistory();
            const alpha = faceColor[3] ?? 1;
            const rgb = [1, 3, 5].map(offset => parseInt(color.value.slice(offset, offset + 2), 16) / 255);
            faceColor.splice(0, faceColor.length, ...rgb, alpha);
            currentMesh.updateRenderQueues();
        });
        colorRow.appendChild(color);
        colorGroup.appendChild(colorRow);
        info.appendChild(colorGroup);
        const opacityGroup = document.createElement('div');
        opacityGroup.className = 'field-group';
        const opacityLabel = document.createElement('label');
        opacityLabel.className = 'field-label';
        opacityLabel.textContent = 'Opacity';
        opacityGroup.appendChild(opacityLabel);
        const opacity = document.createElement('input');
        opacity.className = 'opacity-input editor-input';
        opacity.type = 'range';
        opacity.min = '0';
        opacity.max = '1';
        opacity.step = '0.01';
        opacity.value = faceColor[3] ?? 1;
        opacity.setAttribute('aria-label', 'Face opacity');
        const opacityValue = document.createElement('output');
        opacityValue.className = 'range-value';
        opacityValue.textContent = `${Math.round(Number(opacity.value) * 100)}%`;
        opacity.addEventListener('change', () => {
            onHistory();
            faceColor[3] = Number(opacity.value);
            currentMesh.updateRenderQueues();
            opacityValue.textContent = `${Math.round(Number(opacity.value) * 100)}%`;
        });
        opacity.addEventListener('input', () => { opacityValue.textContent = `${Math.round(Number(opacity.value) * 100)}%`; });
        opacityGroup.append(opacity, opacityValue);
        info.appendChild(opacityGroup);

        info.appendChild(addTextureSelect('Mesh image', currentMesh.textureAssetId, asset => {
            onHistory();
            currentMesh.textureAssetId = asset?.id || null;
            currentMesh.material.texture = asset?.texture || null;
            currentMesh.material.useTexture = !!asset;
            currentMesh.updateRenderQueues();
        }));
        info.appendChild(addTextureUpload('Add image to library', asset => {
            onHistory();
            currentMesh.textureAssetId = asset.id;
            currentMesh.material.texture = asset.texture;
            currentMesh.material.useTexture = true;
            currentMesh.updateRenderQueues();
        }));

        info.appendChild(addTextureSelect('Face image override', currentMesh.faceTextureIds[currentFace], asset => {
            onHistory();
            currentMesh.faceTextureIds[currentFace] = asset?.id || null;
            currentMesh.faceTextures[currentFace] = asset?.texture || null;
            currentMesh.updateRenderQueues();
        }));
        info.appendChild(addTextureUpload('Add face image', asset => {
            onHistory();
            currentMesh.faceTextureIds[currentFace] = asset.id;
            currentMesh.faceTextures[currentFace] = asset.texture;
            currentMesh.updateRenderQueues();
        }));

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
        uvControls.appendChild(addCheckbox('Reflect image horizontally', !!transform.flipX, value => { transform.flipX = value; }));
        uvControls.appendChild(addCheckbox('Reflect image vertically', !!transform.flipY, value => { transform.flipY = value; }));
        info.appendChild(uvControls);
    }

    function setMesh(mesh) {
        currentMesh = mesh;
        currentFace = mesh?.selectedFace >= 0 ? mesh.selectedFace : 0;
        renderFaceEditor();
    }

    return { element: panel, setMesh, setFace: faceIndex => { currentFace = faceIndex; renderFaceEditor(); }, refresh: renderFaceEditor };
}
