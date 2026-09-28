export function createAssetsPanel(onImportMesh) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    const title = document.createElement('div');
    title.textContent = 'Assets';
    title.className = 'panel-title';
    panel.appendChild(title);

    const info = document.createElement('div');
    info.className = 'asset-info';
    info.textContent = 'Textures and model assets';
    panel.appendChild(info);

    const importLabel = document.createElement('label');
    importLabel.className = 'editor-button';
    importLabel.textContent = 'Import mesh JSON';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => input.files[0] && onImportMesh(input.files[0]));
    importLabel.appendChild(input);
    panel.appendChild(importLabel);

    return panel;
}
