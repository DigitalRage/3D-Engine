export function createInspectorPanel() {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Inspector';
    panel.appendChild(title);

    const info = document.createElement('div');
    panel.appendChild(info);

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

    function setMesh(mesh) {
        info.innerHTML = '';
        if (!mesh) {
            const empty = document.createElement('div');
            empty.className = 'inspector-empty';
            empty.textContent = 'Select an object from the hierarchy.';
            info.appendChild(empty);
            return;
        }

        const name = document.createElement('input');
        name.className = 'editor-input field-group';
        name.value = mesh.name;
        name.addEventListener('input', () => { mesh.name = name.value || 'Mesh'; });
        info.appendChild(name);
        addVectorField('Position', mesh.position, (index, value) => { mesh.position[index] = value; });
        addVectorField('Rotation', mesh.rotation, (index, value) => { mesh.rotation[index] = value; }, true);
        addVectorField('Scale', mesh.scale, (index, value) => { mesh.scale[index] = value; });

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
        color.value = '#' + mesh.material.color.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
        color.addEventListener('input', () => {
            mesh.material.color = [1, 3, 5].map(offset => parseInt(color.value.slice(offset, offset + 2), 16) / 255);
        });
        colorRow.appendChild(color);
        colorGroup.appendChild(colorRow);
        info.appendChild(colorGroup);
    }

    return { element: panel, setMesh };
}
