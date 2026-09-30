export function createAssetsPanel(textureLibrary, onImportMesh, onImportTexture) {
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
    importLabel.textContent = 'Import exported scene or mesh';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => input.files[0] && onImportMesh(input.files[0]));
    importLabel.appendChild(input);
    panel.appendChild(importLabel);

    const textureTitle = document.createElement('div');
    textureTitle.className = 'panel-title asset-section-title';
    textureTitle.textContent = 'Image library';
    panel.appendChild(textureTitle);

    const textureList = document.createElement('div');
    textureList.className = 'asset-list';
    panel.appendChild(textureList);

    const textureLabel = document.createElement('label');
    textureLabel.className = 'editor-button';
    textureLabel.textContent = 'Add image';
    const textureInput = document.createElement('input');
    textureInput.type = 'file';
    textureInput.accept = 'image/*';
    textureInput.multiple = true;
    textureInput.style.display = 'none';
    textureInput.addEventListener('change', async () => {
        for (const file of textureInput.files) await onImportTexture(file);
        textureInput.value = '';
        refresh();
    });
    textureLabel.appendChild(textureInput);
    panel.appendChild(textureLabel);

    function refresh() {
        textureList.innerHTML = '';
        if (!textureLibrary.assets.length) {
            textureList.textContent = 'No images loaded.';
            return;
        }
        textureLibrary.assets.forEach(asset => {
            const item = document.createElement('div');
            item.className = 'asset-item';
            item.textContent = asset.name;
            textureList.appendChild(item);
        });
    }
    refresh();

    return { element: panel, refresh };
}
