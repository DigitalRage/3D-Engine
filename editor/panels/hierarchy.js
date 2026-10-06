export function createHierarchyPanel(scene, { onSelect, onDelete, onReorder, getSelected, getSelectedItems = () => [] }) {
    const panel = document.createElement('div');
    panel.className = 'editor-panel hierarchy-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Hierarchy';
    panel.appendChild(title);

    const scroll = document.createElement('div');
    scroll.className = 'hierarchy-scroll';
    const list = document.createElement('ul');
    list.className = 'hierarchy-list';
    scroll.appendChild(list);
    panel.appendChild(scroll);

    const itemHeight = 34;
    const overscan = 12;
    let framePending = false;

    function renderVisible() {
        framePending = false;
        const total = scene.meshes.length;
        list.style.height = `${total * itemHeight}px`;
        const top = Math.max(0, scroll.scrollTop);
        const viewport = Math.max(itemHeight, scroll.clientHeight || 400);
        const start = Math.max(0, Math.floor(top / itemHeight) - overscan);
        const end = Math.min(total, Math.ceil((top + viewport) / itemHeight) + overscan);
        const selected = getSelectedItems();
        const selectedSet = selected instanceof Set ? selected : new Set(selected || []);
        const active = getSelected();
        const fragment = document.createDocumentFragment();

        for (let i = start; i < end; i++) {
            const mesh = scene.meshes[i];
            if (!mesh) continue;
            const li = document.createElement('li');
            li.className = 'hierarchy-item' + (mesh === active || selectedSet.has(mesh) ? ' selected' : '');
            li.draggable = true;
            li.dataset.meshIndex = String(i);
            li.style.top = `${i * itemHeight}px`;

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
            fragment.appendChild(li);
        }
        list.replaceChildren(fragment);
    }

    function requestRender() {
        if (framePending) return;
        framePending = true;
        requestAnimationFrame(renderVisible);
    }

    scroll.addEventListener('scroll', requestRender, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(requestRender).observe(scroll);

    function refresh() {
        requestRender();
    }

    return { element: panel, refresh };
}
