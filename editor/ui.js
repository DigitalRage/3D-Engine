import { createHierarchyPanel } from './panels/hierarchy.js';
import { createInspectorPanel } from './panels/inspector.js';
import { createAssetsPanel } from './panels/assets.js';

export function createUI(root, options) {
    const { scene, onSelect, onSelectFace, onAddCube, onAddFace, onAddVertex, onAddBone, onPlayAnimation, onImportMesh, onDelete, onResetCamera, onExport } = options;
    root.style.pointerEvents = 'auto';
    root.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
        #ui-root { color: #e8edf5; font: 13px/1.4 system-ui, sans-serif; }
        .editor-shell { display: flex; flex-direction: column; gap: 8px; padding: 12px; width: min(100% - 24px, 920px); box-sizing: border-box; }
        .editor-toolbar, .editor-panel { background: rgba(16, 22, 32, 0.92); border: 1px solid rgba(164, 183, 211, 0.2); box-shadow: 0 10px 30px rgba(0,0,0,.25); }
        .editor-toolbar { display: flex; align-items: center; gap: 6px; padding: 7px; }
        .editor-title { margin: 0 12px 0 4px; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; color: #9ed8ff; }
        .editor-button { border: 1px solid #3b526d; background: #1b2a3b; color: #e8edf5; padding: 6px 10px; cursor: pointer; border-radius: 3px; }
        .editor-button:hover { background: #29425c; }
        .editor-panels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .editor-panel { min-width: 0; padding: 10px; max-height: calc(100vh - 105px); overflow: auto; scrollbar-width: thin; scrollbar-color: #526c88 #101722; }
        .panel-title { margin: 0 0 8px; color: #9ed8ff; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
        .hierarchy-list { list-style: none; padding: 0; margin: 0; }
        .hierarchy-item { padding: 6px 8px; cursor: pointer; border-radius: 3px; }
        .hierarchy-item:hover, .hierarchy-item.selected { background: #284a68; }
        .inspector-empty, .asset-info { color: #9aa9ba; }
        .field-group { margin: 0 0 10px; }
        .field-label { display: block; margin-bottom: 4px; color: #9aa9ba; font-size: 11px; text-transform: uppercase; }
        .vector-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
        .editor-input { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid #3b526d; background: #101722; color: #e8edf5; padding: 5px; }
        .face-title { margin: 0 0 8px; color: #ffd071; font-weight: 700; }
        .face-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 12px; }
        .face-button { border: 1px solid #3b526d; background: #101722; color: #c8d4e2; padding: 5px 3px; cursor: pointer; font-size: 11px; }
        .face-button:hover, .face-button.selected { background: #6a4e1c; border-color: #ffd071; color: #fff; }
        .color-row { display: flex; align-items: center; gap: 8px; }
        .color-input { width: 42px; height: 28px; border: 0; padding: 0; background: none; }
        @media (max-width: 700px) { .editor-panels { grid-template-columns: 1fr; } .editor-toolbar { flex-wrap: wrap; } .editor-title { width: 100%; } }
    `;
    root.appendChild(style);
    window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() !== 'f' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        root.style.display = root.style.display === 'none' ? '' : 'none';
    });

    const container = document.createElement('div');
    container.className = 'editor-shell';
    root.appendChild(container);

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const title = document.createElement('h1');
    title.className = 'editor-title';
    title.textContent = 'Lightweight 3D';
    toolbar.appendChild(title);
    const button = (label, handler) => {
        const element = document.createElement('button');
        element.className = 'editor-button';
        element.type = 'button';
        element.textContent = label;
        element.addEventListener('click', handler);
        toolbar.appendChild(element);
    };
    button('+ Cube', onAddCube);
    button('+ Face', onAddFace);
    button('+ Vertex', onAddVertex);
    button('+ Bone', onAddBone);
    button('Play', onPlayAnimation);
    button('Delete', onDelete);
    button('Reset View', onResetCamera);
    button('Export', onExport);
    container.appendChild(toolbar);

    const panels = document.createElement('div');
    panels.className = 'editor-panels';
    container.appendChild(panels);

    const hierarchy = createHierarchyPanel(scene, onSelect);
    const inspector = createInspectorPanel(options.gl, onSelectFace);
    const assets = createAssetsPanel(onImportMesh);

    panels.appendChild(hierarchy.element);
    panels.appendChild(inspector.element);
    panels.appendChild(assets);

    return {
        setSelected: mesh => inspector.setMesh(mesh),
        setFace: faceIndex => inspector.setFace(faceIndex),
        refreshHierarchy: hierarchy.refresh
    };
}
