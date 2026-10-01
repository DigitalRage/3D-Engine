export function createAssetsPanel(textureLibrary, onImportMesh, onImportTexture, prefabActions = {}) {
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

    const prefabTitle = document.createElement('div');
    prefabTitle.className = 'panel-title asset-section-title';
    prefabTitle.textContent = 'Prefabs';
    panel.appendChild(prefabTitle);

    const prefabList = document.createElement('select');
    prefabList.className = 'editor-input';
    prefabList.multiple = true;
    prefabList.size = 4;
    prefabList.setAttribute('aria-label', 'Prefab assets');
    panel.appendChild(prefabList);

    const prefabName = document.createElement('input');
    prefabName.className = 'editor-input field-group';
    prefabName.type = 'text';
    prefabName.placeholder = 'Prefab name';
    prefabName.setAttribute('aria-label', 'Prefab name');
    panel.appendChild(prefabName);

    const prefabActionsElement = document.createElement('div');
    prefabActionsElement.className = 'asset-list';
    panel.appendChild(prefabActionsElement);
    const prefabStatus = document.createElement('output');
    prefabStatus.className = 'asset-info';
    panel.appendChild(prefabStatus);

    const selectedPrefabIds = () => [...prefabList.selectedOptions].map(option => option.value);
    const runPrefabAction = async (action, success) => {
        try {
            await action();
            prefabStatus.textContent = success;
        } catch (error) {
            prefabStatus.textContent = `Prefab operation failed: ${error.message || error}`;
        }
        refreshPrefabs();
    };
    const addPrefabButton = (label, callback, success) => {
        const button = document.createElement('button');
        button.className = 'editor-button';
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => runPrefabAction(callback, success));
        prefabActionsElement.appendChild(button);
        return button;
    };
    addPrefabButton('Create from selection', () => prefabActions.create?.(prefabName.value), 'Prefab created');
    const instantiateButton = addPrefabButton('Instantiate', () => prefabActions.instantiate?.(selectedPrefabIds()[0]), 'Prefab instantiated');
    const updateButton = addPrefabButton('Update Prefab', () => prefabActions.update?.(selectedPrefabIds()[0]), 'Prefab updated');
    addPrefabButton('Revert Instance', () => prefabActions.revert?.(), 'Prefab instance reverted');
    const nestedButton = addPrefabButton('Compose Nested', () => prefabActions.createNested?.(prefabName.value, selectedPrefabIds()), 'Nested prefab created');

    function refreshPrefabs() {
        const previousSelection = new Set(selectedPrefabIds());
        prefabList.innerHTML = '';
        const prefabs = prefabActions.list?.() || [];
        prefabs.forEach(prefab => {
            const option = document.createElement('option');
            option.value = prefab.id;
            option.textContent = prefab.name;
            option.title = `${prefab.id} (${prefab.data?.nodes?.length || 0} nodes)`;
            option.selected = previousSelection.has(prefab.id);
            prefabList.appendChild(option);
        });
        instantiateButton.disabled = !prefabs.length;
        updateButton.disabled = !prefabs.length;
        nestedButton.disabled = selectedPrefabIds().length === 0;
        if (!prefabs.length && !prefabStatus.textContent) prefabStatus.textContent = 'No prefabs yet.';
    }

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
            refreshPrefabs();
            return;
        }
        textureLibrary.assets.forEach(asset => {
            const item = document.createElement('div');
            item.className = 'asset-item';
            item.textContent = asset.name;
            textureList.appendChild(item);
        });
        refreshPrefabs();
    }
    refresh();

    return { element: panel, refresh, refreshPrefabs };
}
