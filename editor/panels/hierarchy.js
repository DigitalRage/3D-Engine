export function createHierarchyPanel(scene, onSelect) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Hierarchy';
    panel.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'hierarchy-list';
    panel.appendChild(list);

    function refresh() {
        list.innerHTML = '';
        scene.meshes.forEach((mesh, i) => {
            const li = document.createElement('li');
            li.className = 'hierarchy-item';
            li.textContent = mesh.name || 'Mesh ' + i;
            li.addEventListener('click', () => onSelect(mesh));
            list.appendChild(li);
        });
    }

    return { element: panel, refresh };
}
