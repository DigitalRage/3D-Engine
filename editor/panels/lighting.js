export function createLightingPanel(light, onHistory = () => {}) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel lighting-panel';
    const refreshers = [];

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = light.name;
    panel.appendChild(title);

    const name = document.createElement('input');
    name.className = 'editor-input field-group';
    name.type = 'text';
    name.value = light.name;
    name.setAttribute('aria-label', 'Light name');
    name.addEventListener('change', () => {
        onHistory();
        light.name = name.value.trim() || 'Key Light';
        title.textContent = light.name;
    });
    refreshers.push(() => { name.value = light.name; });
    panel.appendChild(name);

    function addNumber(label, value, onChange, { step = '0.1', min = '-10', max = '10', readValue = () => value } = {}) {
        const group = document.createElement('label');
        group.className = 'field-group';
        const caption = document.createElement('span');
        caption.className = 'field-label';
        caption.textContent = label;
        const input = document.createElement('input');
        input.className = 'editor-input';
        input.type = 'number';
        input.step = step;
        input.min = min;
        input.max = max;
        input.value = String(value);
        input.addEventListener('change', () => {
            onHistory();
            onChange(Number(input.value) || 0);
        });
        refreshers.push(() => { input.value = String(readValue()); });
        group.append(caption, input);
        panel.appendChild(group);
    }

    ['X', 'Y', 'Z'].forEach((axis, index) => {
        addNumber(`Direction ${axis}`, light.direction[index], value => { light.direction[index] = value; }, { readValue: () => light.direction[index] });
    });
    addNumber('Intensity', light.intensity, value => { light.intensity = value; }, { step: '0.05', min: '0', max: '2', readValue: () => light.intensity });
    addNumber('Light band threshold', light.threshold, value => { light.threshold = value; }, { step: '0.05', min: '0', max: '1', readValue: () => light.threshold });

    function addColor(label, color, onChange, readColor) {
        const group = document.createElement('label');
        group.className = 'color-row field-group';
        const caption = document.createElement('span');
        caption.className = 'field-label';
        caption.textContent = label;
        const input = document.createElement('input');
        input.className = 'color-input';
        input.type = 'color';
        input.value = `#${color.slice(0, 3).map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
        input.addEventListener('change', () => {
            onHistory();
            onChange([1, 3, 5].map(offset => parseInt(input.value.slice(offset, offset + 2), 16) / 255));
        });
        refreshers.push(() => {
            const nextColor = readColor();
            input.value = `#${nextColor.slice(0, 3).map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
        });
        group.append(caption, input);
        panel.appendChild(group);
    }

    addColor('Light tint', light.color, color => { light.color = color; }, () => light.color);
    addColor('Shadow tint', light.shadeColor, color => { light.shadeColor = color; }, () => light.shadeColor);

    refreshers.push(() => { title.textContent = light.name; });
    return { element: panel, refresh: () => refreshers.forEach(refresh => refresh()) };
}
