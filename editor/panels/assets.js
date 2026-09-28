export function createAssetsPanel() {
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

    return panel;
}
