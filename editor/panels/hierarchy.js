export function createHierarchyPanel(scene, { onSelect, onDelete, onReorder, getSelected, getSelectedItems = () => [] }) {
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
            const selectedItems = getSelectedItems();
            const isSelected = selectedItems instanceof Set ? selectedItems.has(mesh) : selectedItems.includes(mesh);
            li.className = 'hierarchy-item' + (mesh === getSelected() || isSelected ? ' selected' : '');
            li.draggable = true;
            li.dataset.meshIndex = String(i);
            const name = document.createElement('button');
            name.className = 'hierarchy-select';
            name.type = 'button';
            name.textContent = mesh.name || 'Mesh ' + i;
            name.addEventListener('click', event => onSelect(mesh, event.shiftKey || event.ctrlKey || event.metaKey));
            const remove = document.createElement('button');
            remove.className = 'hierarchy-delete';
            remove.type = 'button';
            remove.textContent = '×';
            remove.title = `Delete ${mesh.name || 'mesh'}`;
            remove.setAttribute('aria-label', `Delete ${mesh.name || 'mesh'}`);
            remove.addEventListener('click', () => onDelete(mesh));
            li.addEventListener('dragstart', event => {
                event.dataTransfer.setData('text/plain', String(i));
                event.dataTransfer.effectAllowed = 'move';
            });
            li.addEventListener('dragover', event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            });
            li.addEventListener('drop', event => {
                event.preventDefault();
                const fromIndex = Number(event.dataTransfer.getData('text/plain'));
                if (Number.isInteger(fromIndex)) onReorder(scene.meshes[fromIndex], i);
            });
            li.append(name, remove);
            list.appendChild(li);
        });
    }

    return { element: panel, refresh };
}
