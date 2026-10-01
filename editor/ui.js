import { createHierarchyPanel } from './panels/hierarchy.js';
import { createInspectorPanel } from './panels/inspector.js';
import { createAssetsPanel } from './panels/assets.js';
import { createBonesPanel } from './panels/bones.js';
import { createLightingPanel } from './panels/lighting.js';
import { DirectionalLight } from '../engine/light.js';
import { dispatchEditorShortcut } from './shortcuts.js';

export function createUI(root, options) {
    const { scene, onSelect, onSelectFace, onSetPickMode, onAddCube, onAddPlane, onAddSphere, onAddCylinder, onAddBatch, onDuplicate, onAddFace, onExtrudeFace, onMergeFace, onMergeVertices, onAddVertex, onAddBone, onRemoveBone, onCreateAnimation, onKeyPose, onDeleteBoneKeys, onSeekAnimation, onToggleAnimation, onRenameAnimation, onSetAnimationDuration, onImportMesh, onImportTexture, onDelete, onReorderMesh, onResetCamera, onExport, onUndo, onRedo, onHistory = () => {}, onKnifeTool, onBevel, onInset, onLoopCut, onBridge, onFill, onGridFill, onDissolve, onSplit, onSeparate, onTriangulate, onQuadRebuild, onRecalculateNormals, onFlipNormals } = options;
    const sceneActions = options.sceneActions || {};
    root.style.pointerEvents = 'none';
    root.innerHTML = '';
    let saveCurrentLayout = () => {};
    let resetCurrentLayout = () => {};

    const style = document.createElement('style');
    style.textContent = `
        #ui-root { color: #e8edf5; font: 13px/1.4 system-ui, sans-serif; }
        .internal-fps { position: fixed; right: 12px; bottom: 12px; z-index: 20; padding: 6px 9px; color: #bfe9d3; background: rgba(13, 23, 20, 0.92); border: 1px solid rgba(115, 190, 150, 0.45); font: 12px/1.3 ui-monospace, monospace; font-variant-numeric: tabular-nums; pointer-events: none; }
        .polygon-counter { position: fixed; right: 12px; bottom: 44px; z-index: 20; max-width: calc(100vw - 24px); padding: 6px 9px; color: #d7e8fa; background: rgba(15, 23, 34, 0.94); border: 1px solid rgba(130, 165, 202, 0.4); font: 12px/1.3 ui-monospace, monospace; font-variant-numeric: tabular-nums; pointer-events: none; }
        .viewport-stats { position: fixed; left: 12px; bottom: 12px; z-index: 20; padding: 6px 9px; color: #d7e8fa; background: rgba(15, 23, 34, 0.94); border: 1px solid rgba(130, 165, 202, 0.4); font: 12px/1.3 ui-monospace, monospace; font-variant-numeric: tabular-nums; pointer-events: none; }
        .operator-status { position: fixed; left: 12px; bottom: 44px; z-index: 20; max-width: min(50vw, 420px); overflow: hidden; padding: 6px 9px; color: #d7e8fa; background: rgba(15, 23, 34, 0.94); border: 1px solid rgba(130, 165, 202, 0.4); font: 12px/1.3 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
        .editor-shell { position: fixed; inset: 0; z-index: 10; display: grid; grid-template-columns: minmax(210px, 18vw) minmax(0, 1fr) minmax(250px, 22vw); grid-template-rows: auto minmax(180px, 1fr) minmax(190px, 28vh); grid-template-areas: 'toolbar toolbar toolbar' 'hierarchy viewport inspector' 'assets assets animation'; box-sizing: border-box; overflow: hidden; pointer-events: none; }
        .editor-toolbar { grid-area: toolbar; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; padding: 5px 8px; background: rgba(16, 20, 25, 0.98); border-bottom: 1px solid #343b43; pointer-events: auto; }
        .editor-toolbar-head { position: relative; display: flex; align-items: center; gap: 6px; min-height: 26px; }
        .tool-group { min-width: 0; }
        .tool-group summary { padding: 5px 8px; color: #9ed8ff; background: #101722; border: 1px solid #26384d; cursor: pointer; list-style: none; }
        .tool-group summary::-webkit-details-marker { display: none; }
        .tool-group summary::before { content: '+'; display: inline-block; width: 18px; color: #ffd071; }
        .tool-group[open] summary::before { content: '-'; }
        .tool-group-content { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 0 2px; }
        .scene-controls { display: grid; grid-template-columns: repeat(3, minmax(92px, 1fr)); gap: 5px; width: min(390px, 100%); }
        .scene-controls .scene-wide { grid-column: 1 / -1; }
        .scene-controls .check-row { grid-column: 1 / -1; margin: 0; }
        .scene-status { grid-column: 1 / -1; min-height: 16px; color: #9aa9ba; font: 11px/1.3 ui-monospace, monospace; }
        .batch-create-controls { display: grid; grid-template-columns: minmax(100px, 1fr) 80px 80px auto; gap: 5px; align-items: center; width: 100%; }
        .batch-create-status { grid-column: 1 / -1; min-height: 16px; color: #9aa9ba; font: 11px/1.3 ui-monospace, monospace; }
        .editor-title { margin: 0 8px 0 4px; font-size: 13px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; color: #e8edf5; white-space: nowrap; }
        .editor-button { border: 1px solid #48515b; background: #292f36; color: #e8edf5; padding: 5px 9px; cursor: pointer; border-radius: 2px; }
        .editor-button:hover { background: #3a424b; }
        .editor-panels { display: contents; }
        .editor-panel { box-sizing: border-box; width: 100%; min-width: 0; min-height: 0; padding: 10px; overflow: auto; scrollbar-width: thin; scrollbar-color: #59636e #171b20; pointer-events: auto; background: rgba(24, 28, 33, 0.97); }
        .panel-title { margin: 0 0 8px; color: #9ed8ff; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
        .hierarchy-list { list-style: none; padding: 0; margin: 0; }
        .hierarchy-item { display: flex; align-items: center; gap: 4px; padding: 2px; border: 1px solid transparent; }
        .hierarchy-item:hover, .hierarchy-item.selected { background: #284a68; border-color: #3b526d; }
        .hierarchy-select { flex: 1; min-width: 0; padding: 5px 7px; border: 0; background: transparent; color: #c8d4e2; text-align: left; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; cursor: pointer; }
        .hierarchy-delete { width: 28px; height: 28px; border: 1px solid #60464a; background: #321f25; color: #ffc2c2; cursor: pointer; }
        .hierarchy-delete:hover { background: #733b44; }
        .inspector-empty, .asset-info { color: #9aa9ba; }
        .field-group { margin: 0 0 10px; }
        .field-label { display: block; margin-bottom: 4px; color: #9aa9ba; font-size: 11px; text-transform: uppercase; }
        .vector-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
        .editor-input { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid #3b526d; background: #101722; color: #e8edf5; padding: 5px; pointer-events: auto; }
        .editor-panel button, .editor-panel label, .editor-panel input, .hierarchy-item { pointer-events: auto; }
        .panel-disclosure { position: relative; z-index: 2; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; color: #e8edf5; background: #181c21; border: 1px solid #343b43; pointer-events: auto; }
        .panel-disclosure[data-dock='hierarchy'] { grid-area: hierarchy; }
        .panel-disclosure[data-dock='inspector'] { grid-area: inspector; }
        .panel-disclosure[data-dock='assets'] { grid-area: assets; }
        .panel-disclosure[data-dock='animation'] { grid-area: animation; }
        .panel-disclosure:not([open]) { height: auto !important; }
        .panel-disclosure[open] { min-height: 0; }
        .panel-disclosure[open] > .editor-panel { flex: 1; }
        .panel-disclosure > summary { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 0 0 34px; min-height: 34px; box-sizing: border-box; padding: 4px 7px; color: #9ed8ff; background: rgba(16, 22, 32, 0.98); cursor: pointer; pointer-events: auto; list-style: none; }
        .panel-disclosure > summary::-webkit-details-marker { display: none; }
        .panel-disclosure > summary::before { content: '+'; display: inline-block; width: 18px; color: #ffd071; }
        .panel-disclosure[open] > summary::before { content: '-'; }
        .panel-drag-handle { position: absolute; top: 4px; left: 50%; width: 42px; height: 25px; padding: 0; border: 1px solid #3b526d; background: #101722; color: #9aa9ba; cursor: move; touch-action: none; transform: translateX(-50%); }
        .panel-drag-handle:active { color: #ffd071; }
        .panel-resize-handle { position: absolute; right: 1px; bottom: 1px; z-index: 12; display: none; width: 20px; height: 20px; padding: 0; border: 0; background: transparent; cursor: nwse-resize; pointer-events: auto; touch-action: none; }
        .panel-disclosure[data-floating='true'][open] > .panel-resize-handle { display: block; }
        .panel-disclosure[data-floating='true'] { position: fixed; z-index: 20; width: min(340px, calc(100vw - 24px)); height: min(55vh, 620px); max-height: calc(100vh - 16px); border: 1px solid #505963; box-shadow: 0 12px 32px rgba(0,0,0,.48); }
        .panel-disclosure[data-floating='true'] > .editor-panel { min-height: 0; }
        .panel-resize-handle::after { position: absolute; right: 3px; bottom: 3px; width: 9px; height: 9px; border-right: 2px solid #9aa9ba; border-bottom: 2px solid #9aa9ba; content: ''; }
        .editor-button.selected { background: #284a68; border-color: #9ed8ff; }
        .face-title { margin: 0 0 8px; color: #ffd071; font-weight: 700; }
        .face-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 12px; }
        .face-button { border: 1px solid #3b526d; background: #101722; color: #c8d4e2; padding: 5px 3px; cursor: pointer; font-size: 11px; }
        .face-button:hover, .face-button.selected { background: #6a4e1c; border-color: #ffd071; color: #fff; }
        .color-row { display: flex; align-items: center; gap: 8px; }
        .color-input { width: 42px; height: 28px; border: 0; padding: 0; background: none; }
        .check-row { display: flex; align-items: center; gap: 7px; color: #c8d4e2; text-transform: none; }
        .check-row input { width: auto; }
        .asset-section-title { margin-top: 18px; }
        .asset-list { display: grid; gap: 4px; margin-bottom: 8px; color: #c8d4e2; }
        .bone-list { display: grid; gap: 4px; max-height: 150px; overflow: auto; margin-bottom: 8px; }
        .bone-item { padding: 5px 7px; color: #c8d4e2; background: #101722; border: 1px solid #26384d; text-align: left; cursor: pointer; }
        .bone-item.selected { color: #fff; border-color: #9ed8ff; background: #284a68; }
        .bone-slider-group { margin-top: 8px; }
        .bone-slider-label { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .bone-slider-label output, .bone-weight-group output { color: #ffd071; font-variant-numeric: tabular-nums; }
        .range-value { color: #ffd071; font-size: 11px; font-variant-numeric: tabular-nums; }
        .bone-weight-group { margin-top: 16px; padding-top: 12px; border-top: 1px solid #344657; }
        .animation-editor { min-width: 0; margin: 12px 0; padding-top: 10px; border-top: 1px solid #344657; }
        .animation-clip-fields { display: grid; grid-template-columns: minmax(0, 1fr) 106px; gap: 6px; margin-bottom: 8px; }
        .animation-duration-label { display: grid; grid-template-columns: minmax(0, 1fr) 52px 12px; align-items: center; gap: 4px; color: #9aa9ba; font-size: 10px; text-transform: uppercase; }
        .animation-playback { display: grid; grid-template-columns: 52px minmax(0, 1fr) 52px; align-items: center; gap: 6px; margin-bottom: 8px; }
        .animation-timeline { padding: 0; }
        .animation-time { color: #ffd071; font: 11px/1.3 ui-monospace, monospace; text-align: right; }
        .animation-tracks { display: grid; gap: 3px; max-height: 112px; overflow: auto; margin: 6px 0 8px; }
        .animation-track { display: grid; grid-template-columns: minmax(64px, 30%) minmax(0, 1fr); align-items: center; gap: 6px; min-height: 20px; }
        .animation-track.selected .animation-track-name { color: #ffd071; }
        .animation-track-name { overflow: hidden; color: #c8d4e2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .animation-key-lane { position: relative; height: 18px; background: #101722; border: 1px solid #26384d; }
        .animation-keyframe { position: absolute; top: 50%; width: 9px; height: 9px; padding: 0; border: 1px solid #fff0bd; background: #ffd071; cursor: pointer; transform: translate(-50%, -50%) rotate(45deg); }
        .animation-key-actions { display: flex; flex-wrap: wrap; gap: 5px; }
        .animation-key-actions .editor-button { flex: 1; }
        .animation-empty { padding: 8px 0; }
        .skinning-disclosure { margin-top: 12px; }
        .skinning-disclosure .bone-weight-group { padding: 8px 0 0; border-top: 0; }
        .bone-weight-group .editor-button { margin: 4px 4px 0 0; }
        .asset-item { padding: 5px 7px; background: #101722; border: 1px solid #26384d; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .uv-workspace { grid-area: viewport; display: none; flex-direction: column; min-width: 0; min-height: 0; box-sizing: border-box; padding: 10px; background: rgba(24, 28, 33, 0.98); border: 1px solid #343b43; pointer-events: auto; }
        .uv-workspace-title { margin: 0 0 8px; color: #9ed8ff; font-size: 11px; text-transform: uppercase; }
        .uv-image-row { display: flex; align-items: center; gap: 8px; max-width: 400px; margin-bottom: 8px; color: #9aa9ba; font-size: 11px; text-transform: uppercase; }
        .uv-image-row .editor-input { flex: 1; }
        .uv-transform-row { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin-bottom: 8px; }
        .uv-transform-row .field-group { width: 110px; margin: 0; }
        .uv-transform-row .editor-button { height: 30px; }
        .uv-canvas { display: block; flex: 1; width: 100%; height: auto; min-height: 0; touch-action: none; cursor: grab; }
        .uv-canvas:active { cursor: grabbing; }
        .editor-shell.uv-mode .uv-workspace { display: flex; }
        .editor-shell.uv-mode .editor-panels { display: none; }
        @media (max-width: 760px) { .editor-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(150px, 36vh) minmax(110px, 22vh) minmax(110px, 22vh) minmax(110px, 22vh) minmax(110px, 22vh); grid-template-areas: 'toolbar' 'viewport' 'hierarchy' 'inspector' 'assets' 'animation'; overflow: auto; } .editor-toolbar { position: sticky; top: 0; z-index: 5; } .panel-disclosure[data-floating='true'] { max-width: calc(100vw - 16px); } }
    `;
    root.appendChild(style);
    const fpsReadout = document.createElement('div');
    fpsReadout.className = 'internal-fps';
    fpsReadout.textContent = 'Internal FPS --';
    root.appendChild(fpsReadout);
    const polygonReadout = document.createElement('div');
    polygonReadout.className = 'polygon-counter';
    polygonReadout.textContent = 'Current Mesh Polygons / All Polygons: 0 / 0';
    root.appendChild(polygonReadout);
    const viewportStats = document.createElement('div');
    viewportStats.className = 'viewport-stats';
    viewportStats.textContent = 'Draw calls 0 | Triangles 0 | Objects 0';
    root.appendChild(viewportStats);
    const operatorStatus = document.createElement('div');
    operatorStatus.className = 'operator-status';
    operatorStatus.textContent = 'Ready';
    root.appendChild(operatorStatus);
    const editorStatus = { tool: 'select', mode: 'face', space: 'world', snap: {}, last: 'Ready' };
    const labels = { select: 'Select', move: 'Move', rotate: 'Rotate', scale: 'Scale', mesh: 'Object', orbit: 'Orbit', face: 'Face', edge: 'Edge', vertex: 'Vertex' };
    const refreshStatus = () => {
        const counts = options.getSelectionCounts?.() || {};
        const snapOn = Object.entries(editorStatus.snap).some(([key, value]) => key.endsWith('Step') ? false : !!value);
        operatorStatus.textContent = `${labels[editorStatus.tool] || editorStatus.tool} | ${labels[editorStatus.mode] || editorStatus.mode} | ${String(editorStatus.space).toUpperCase()} | Snap ${snapOn ? 'On' : 'Off'} | M ${counts.meshes || 0} F ${counts.faces || 0} E ${counts.edges || 0} V ${counts.vertices || 0} | ${editorStatus.last}`;
    };
    window.addEventListener('keydown', event => {
        const handled = dispatchEditorShortcut(event, {
            onUndo,
            onRedo,
            onDuplicate,
            onDelete,
            onExtrude: onExtrudeFace,
            onSetPickMode: mode => setPickMode(mode),
            onSetTransformTool: mode => setTransformTool(mode),
            onSetCameraView: view => setCameraView(view),
            confirmDelete: () => window.confirm('Delete the selected mesh or meshes?')
        }, { isTextEntry: isTextEntry(document.activeElement) });
        if (handled) return;
        if ((event.key === 'Backspace' || event.key === 'Delete') && !isTextEntry(document.activeElement)) {
            event.preventDefault();
            onDelete();
            return;
        }
        if (event.key.toLowerCase() !== 'f' || isTextEntry(document.activeElement)) return;
        root.style.display = root.style.display === 'none' ? '' : 'none';
    });

    const container = document.createElement('div');
    container.className = 'editor-shell';
    root.appendChild(container);

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    const toolbarHead = document.createElement('div');
    toolbarHead.className = 'editor-toolbar-head';
    const title = document.createElement('h1');
    title.className = 'editor-title';
    title.textContent = 'Engine Editor';
    toolbarHead.appendChild(title);
    const saveLayoutButton = document.createElement('button');
    saveLayoutButton.className = 'editor-button';
    saveLayoutButton.type = 'button';
    saveLayoutButton.textContent = 'Save Layout';
    saveLayoutButton.addEventListener('click', () => saveCurrentLayout());
    const resetLayoutButton = document.createElement('button');
    resetLayoutButton.className = 'editor-button';
    resetLayoutButton.type = 'button';
    resetLayoutButton.textContent = 'Reset Layout';
    resetLayoutButton.addEventListener('click', () => resetCurrentLayout());
    toolbarHead.append(saveLayoutButton, resetLayoutButton);
    toolbar.appendChild(toolbarHead);
    let activeToolGroup = toolbarHead;

    const group = (label, open = false) => {
        const details = document.createElement('details');
        details.className = 'tool-group';
        details.open = open;
        const summary = document.createElement('summary');
        summary.textContent = label;
        const content = document.createElement('div');
        content.className = 'tool-group-content';
        details.append(summary, content);
        toolbar.appendChild(details);
        activeToolGroup = content;
    };

    const button = (label, handler) => {
        const element = document.createElement('button');
        element.className = 'editor-button';
        element.type = 'button';
        element.textContent = label;
        element.addEventListener('click', handler);
        activeToolGroup.appendChild(element);
        return element;
    };

    group('Modeling');
    button('+ Cube', onAddCube);
    button('+ Plane', onAddPlane);
    button('+ Sphere', onAddSphere);
    button('+ Cylinder', onAddCylinder);
    button('Duplicate', onDuplicate);
    const batchCreate = document.createElement('div');
    batchCreate.className = 'batch-create-controls';
    const batchType = document.createElement('select');
    batchType.className = 'editor-input';
    batchType.setAttribute('aria-label', 'Primitive type to add');
    ['Cube', 'Plane', 'Sphere', 'Cylinder'].forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        batchType.appendChild(option);
    });
    const batchAmount = document.createElement('input');
    batchAmount.className = 'editor-input';
    batchAmount.type = 'number';
    batchAmount.min = '1';
    batchAmount.max = '100000';
    batchAmount.step = '1';
    batchAmount.value = '100';
    batchAmount.setAttribute('aria-label', 'Number of meshes to add');
    const batchSpacing = document.createElement('input');
    batchSpacing.className = 'editor-input';
    batchSpacing.type = 'number';
    batchSpacing.min = '1.05';
    batchSpacing.max = '10';
    batchSpacing.step = '0.25';
    batchSpacing.value = '2';
    batchSpacing.setAttribute('aria-label', 'Grid spacing between meshes');
    const batchButton = document.createElement('button');
    batchButton.className = 'editor-button';
    batchButton.type = 'button';
    batchButton.textContent = 'Add copies';
    const batchStatus = document.createElement('output');
    batchStatus.className = 'batch-create-status';
    batchButton.addEventListener('click', async () => {
        const amount = Math.max(1, Math.min(100000, Math.floor(Number(batchAmount.value) || 1)));
        const spacing = Math.max(1.05, Math.min(10, Number(batchSpacing.value) || 2));
        batchAmount.value = String(amount);
        batchSpacing.value = String(spacing);
        batchButton.disabled = true;
        batchStatus.textContent = `Adding ${amount} ${batchType.value.toLowerCase()} meshes...`;
        try {
            await onAddBatch(batchType.value, amount, spacing, added => {
                batchStatus.textContent = `Added ${added} / ${amount}`;
            });
            batchStatus.textContent = `Added ${amount} ${batchType.value.toLowerCase()} meshes`;
        } catch (error) {
            batchStatus.textContent = `Batch stopped: ${error.message || error}`;
        } finally {
            batchButton.disabled = false;
        }
    });
    batchCreate.append(batchType, batchAmount, batchSpacing, batchButton, batchStatus);
    activeToolGroup.appendChild(batchCreate);
    button('+ Face', onAddFace);
    button('Extrude', onExtrudeFace);
    button('+ Vertex', onAddVertex);
    button('+ Bone', () => onAddBone(null));
    button('Delete', onDelete);

    group('Advanced Modeling');
    button('Knife', onKnifeTool);
    button('Bevel', onBevel);
    button('Inset', onInset);
    button('Loop Cut', onLoopCut);
    button('Bridge', onBridge);
    button('Fill', onFill);
    button('Grid Fill', onGridFill);
    button('Dissolve', onDissolve);
    button('Split', onSplit);
    button('Separate', onSeparate);
    button('Triangulate', onTriangulate);
    button('Quad Rebuild', onQuadRebuild);
    button('Normals', onRecalculateNormals);
    button('Flip Normals', onFlipNormals);

    group('Selection Mode');
    const modeButtons = document.createElement('div');
    modeButtons.className = 'tool-group-content';
    const modeGroup = activeToolGroup;
    modeGroup.appendChild(modeButtons);

    group('Transform');
    const transformButtons = new Map();
    const setTransformTool = mode => {
        transformButtons.forEach((element, key) => element.classList.toggle('selected', key === mode));
        options.onSetTransformTool?.(mode);
        editorStatus.tool = mode;
        refreshStatus();
    };
    [['Select', 'select'], ['Move', 'move'], ['Rotate', 'rotate'], ['Scale', 'scale']].forEach(([label, mode]) => {
        transformButtons.set(mode, button(label, () => setTransformTool(mode)));
    });
    transformButtons.get('select').classList.add('selected');
    const transformSpace = document.createElement('select');
    transformSpace.className = 'editor-input';
    transformSpace.setAttribute('aria-label', 'Transform space');
    [['world', 'World'], ['local', 'Local']].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        transformSpace.appendChild(option);
    });
    transformSpace.addEventListener('change', () => {
        options.onSetTransformSpace?.(transformSpace.value);
        editorStatus.space = transformSpace.value;
        refreshStatus();
    });
    activeToolGroup.appendChild(transformSpace);

    let selectedAxis = null;
    const axisButtons = new Map();
    ['x', 'y', 'z'].forEach(axis => {
        axisButtons.set(axis, button(axis.toUpperCase(), () => {
            selectedAxis = selectedAxis === axis ? null : axis;
            axisButtons.forEach((element, key) => element.classList.toggle('selected', key === selectedAxis));
            options.onSetAxisLock?.(axis);
        }));
    });
    const snapSettings = { position: false, rotation: false, scale: false, positionStep: 0.5, rotationStep: 15, scaleStep: 0.1 };
    const addSnapControl = (key, label, stepKey, defaultValue, minimum, increment) => {
        const labelElement = document.createElement('label');
        labelElement.className = 'check-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        const caption = document.createElement('span');
        caption.textContent = label;
        labelElement.append(checkbox, caption);
        activeToolGroup.appendChild(labelElement);
        const amount = document.createElement('input');
        amount.className = 'editor-input';
        amount.type = 'number';
        amount.min = String(minimum);
        amount.step = String(increment);
        amount.value = String(defaultValue);
        amount.disabled = true;
        amount.setAttribute('aria-label', `${label} increment`);
        activeToolGroup.appendChild(amount);
        const update = () => {
            snapSettings[key] = checkbox.checked;
            snapSettings[stepKey] = Math.max(minimum, Number(amount.value) || defaultValue);
            amount.value = String(snapSettings[stepKey]);
            amount.disabled = !checkbox.checked;
            options.onSetSnap?.({ ...snapSettings });
            editorStatus.snap = { ...snapSettings };
            refreshStatus();
        };
        checkbox.addEventListener('change', update);
        amount.addEventListener('change', update);
    };
    addSnapControl('position', 'Position snap', 'positionStep', 0.5, 0.001, 0.1);
    addSnapControl('rotation', 'Rotation snap', 'rotationStep', 15, 1, 1);
    addSnapControl('scale', 'Scale snap', 'scaleStep', 0.1, 0.001, 0.05);

    group('Camera');
    const cameraButtons = new Map();
    [['Perspective', 'perspective'], ['Front', 'front'], ['Back', 'back'], ['Left', 'left'], ['Right', 'right'], ['Top', 'top'], ['Bottom', 'bottom']].forEach(([label, view]) => {
        cameraButtons.set(view, button(label, () => {
            cameraButtons.forEach((element, key) => element.classList.toggle('selected', key === view));
            options.onSetCameraView?.(view);
        }));
    });
    const setCameraView = view => {
        cameraButtons.forEach((element, key) => element.classList.toggle('selected', key === view));
        options.onSetCameraView?.(view);
    };
    cameraButtons.get('perspective').classList.add('selected');

    group('Display');
    const renderButtons = new Map();
    [['Wireframe', 'wireframe'], ['Solid', 'solid'], ['Material', 'material'], ['Anime', 'anime']].forEach(([label, mode]) => {
        renderButtons.set(mode, button(label, () => {
            renderButtons.forEach((element, key) => element.classList.toggle('selected', key === mode));
            options.onSetRenderMode?.(mode);
        }));
    });
    renderButtons.get('anime').classList.add('selected');

    group('View & Scene');
    button('Center View', onResetCamera);
    button('Export', onExport);
    const sceneControls = document.createElement('div');
    sceneControls.className = 'scene-controls';
    activeToolGroup.appendChild(sceneControls);
    const createSceneSelect = label => {
        const select = document.createElement('select');
        select.className = 'editor-input scene-wide';
        select.setAttribute('aria-label', label);
        sceneControls.appendChild(select);
        return select;
    };
    const createSceneButton = (label, action, success) => {
        const element = document.createElement('button');
        element.className = 'editor-button';
        element.type = 'button';
        element.textContent = label;
        element.addEventListener('click', () => runSceneAction(action, success));
        sceneControls.appendChild(element);
        return element;
    };
    const sceneSelect = createSceneSelect('Active scene');
    const referenceTarget = createSceneSelect('Scene to reference');
    const referenceSelect = createSceneSelect('Referenced scene');
    const subSceneTarget = createSceneSelect('Sub-scene to load');
    const sceneStatus = document.createElement('output');
    sceneStatus.className = 'scene-status';
    sceneControls.appendChild(sceneStatus);
    const addReferenceButton = createSceneButton('Add Reference', () => sceneActions.addReference?.(referenceTarget.value), 'Scene reference added');
    const removeReferenceButton = createSceneButton('Remove Reference', () => sceneActions.removeReference?.(referenceSelect.value), 'Scene reference removed');
    const addSubSceneButton = createSceneButton('Add Sub-scene', () => sceneActions.addSubScene?.(subSceneTarget.value, streamingInput.checked), 'Sub-scene linked');
    const streamSubSceneButton = createSceneButton('Load Sub-scene', () => sceneActions.toggleSubScene?.(subSceneTarget.value), 'Sub-scene state updated');
    const newSceneButton = createSceneButton('New Scene', () => sceneActions.create?.(), 'Scene created');
    const saveSceneButton = createSceneButton('Save Scene', () => sceneActions.save?.(), 'Scene saved');
    const duplicateSceneButton = createSceneButton('Duplicate', () => sceneActions.duplicate?.(), 'Scene duplicated');
    const deleteSceneButton = createSceneButton('Delete Scene', () => sceneActions.delete?.(), 'Scene deleted');
    const streamingLabel = document.createElement('label');
    streamingLabel.className = 'check-row';
    const streamingInput = document.createElement('input');
    streamingInput.type = 'checkbox';
    streamingInput.checked = true;
    streamingLabel.append(streamingInput, document.createTextNode('Stream on demand'));
    sceneControls.appendChild(streamingLabel);
    const loadSceneLabel = document.createElement('label');
    loadSceneLabel.className = 'editor-button';
    loadSceneLabel.textContent = 'Import Scene';
    const loadSceneInput = document.createElement('input');
    loadSceneInput.type = 'file';
    loadSceneInput.accept = '.json,application/json';
    loadSceneInput.hidden = true;
    loadSceneInput.addEventListener('change', () => {
        const file = loadSceneInput.files?.[0];
        if (file) runSceneAction(() => sceneActions.loadFile?.(file), 'Scene imported');
        loadSceneInput.value = '';
    });
    loadSceneLabel.appendChild(loadSceneInput);
    sceneControls.appendChild(loadSceneLabel);
    sceneSelect.addEventListener('change', () => runSceneAction(() => sceneActions.switch?.(sceneSelect.value), 'Scene switched'));

    function refreshScenes() {
        const records = sceneActions.list?.() || [];
        const activeId = sceneActions.activeId?.() || '';
        const activeRecord = records.find(record => record.id === activeId);
        const fill = (select, entries, selectedId, placeholder) => {
            select.innerHTML = '';
            if (!entries.length) {
                const empty = document.createElement('option');
                empty.value = '';
                empty.textContent = placeholder;
                select.appendChild(empty);
            }
            entries.forEach(record => {
                const option = document.createElement('option');
                option.value = record.id;
                option.textContent = record.name;
                select.appendChild(option);
            });
            if (entries.some(record => record.id === selectedId)) select.value = selectedId;
        };
        fill(sceneSelect, records, activeId, 'No scenes');
        fill(referenceTarget, records.filter(record => record.id !== activeId), referenceTarget.value, 'No other scenes');
        const referencedRecords = (activeRecord?.references || []).map(id => records.find(record => record.id === id)).filter(Boolean);
        fill(referenceSelect, referencedRecords, referenceSelect.value, 'No references');
        const subSceneRecords = records.filter(record => record.id !== activeId);
        fill(subSceneTarget, subSceneRecords, subSceneTarget.value, 'No available sub-scenes');
        const subScene = sceneActions.subSceneState?.(subSceneTarget.value);
        streamSubSceneButton.textContent = subScene?.loaded ? 'Unload Sub-scene' : 'Load Sub-scene';
        streamSubSceneButton.disabled = !subScene;
        addSubSceneButton.disabled = !subSceneTarget.value || !!subScene;
        addReferenceButton.disabled = !referenceTarget.value || !!activeRecord?.references.includes(referenceTarget.value);
        removeReferenceButton.disabled = !referenceSelect.value;
        deleteSceneButton.disabled = records.length <= 1;
        saveSceneButton.disabled = !activeId;
        duplicateSceneButton.disabled = !activeId;
    }

    async function runSceneAction(action, success) {
        try {
            if (typeof action !== 'function') return;
            await action();
            sceneStatus.textContent = success;
        } catch (error) {
            sceneStatus.textContent = `Scene operation failed: ${error.message || error}`;
        }
        refreshScenes();
    }

    [referenceTarget, referenceSelect, subSceneTarget].forEach(select => select.addEventListener('change', refreshScenes));
    refreshScenes();
    const uvWorkspace = document.createElement('div');
    uvWorkspace.className = 'uv-workspace';
    const uvTitle = document.createElement('h2');
    uvTitle.className = 'uv-workspace-title';
    uvTitle.textContent = 'Mesh and UV Editing';
    const uvImageRow = document.createElement('label');
    uvImageRow.className = 'uv-image-row';
    uvImageRow.appendChild(document.createTextNode('Image'));
    const uvImageSelect = document.createElement('select');
    uvImageSelect.className = 'editor-input';
    uvImageRow.appendChild(uvImageSelect);
    uvImageSelect.addEventListener('change', () => {
        if (!selectedMesh) return;
        onHistory();
        const asset = options.textureLibrary.get(uvImageSelect.value);
        selectedMesh.textureAssetId = asset?.id || null;
        selectedMesh.material.texture = asset?.texture || null;
        selectedMesh.material.useTexture = !!asset;
        selectedMesh.updateRenderQueues();
        drawUvWorkspace();
    });
    const uvTransformRow = document.createElement('div');
    uvTransformRow.className = 'uv-transform-row';
    const uvRotationGroup = document.createElement('label');
    uvRotationGroup.className = 'field-group';
    const uvRotationLabel = document.createElement('span');
    uvRotationLabel.className = 'field-label';
    uvRotationLabel.textContent = 'Side rotation';
    const uvRotation = document.createElement('input');
    uvRotation.className = 'editor-input';
    uvRotation.type = 'range';
    uvRotation.min = '-180';
    uvRotation.max = '180';
    uvRotation.step = '1';
    uvRotation.value = '0';
    const uvRotationValue = document.createElement('output');
    uvRotationValue.className = 'range-value';
    uvRotationValue.textContent = '0 deg (0%)';
    const uvRotationLabelRow = document.createElement('div');
    uvRotationLabelRow.className = 'bone-slider-label';
    uvRotationLabelRow.append(uvRotationLabel, uvRotationValue);
    uvRotationGroup.append(uvRotationLabelRow, uvRotation);
    uvTransformRow.appendChild(uvRotationGroup);
    let previousUvRotation = 0;

    const makeUvDimensionControl = (label, axis) => {
        const group = document.createElement('label');
        group.className = 'field-group';
        const labelElement = document.createElement('span');
        labelElement.className = 'field-label';
        labelElement.textContent = label;
        const input = document.createElement('input');
        input.className = 'editor-input';
        input.type = 'number';
        input.min = '0.01';
        input.max = '4';
        input.step = '0.01';
        input.addEventListener('change', () => {
            if (!selectedMesh) return;
            const dimensions = selectedMesh.getFaceDimensions(selectedMesh.selectedFace);
            if (!dimensions) return;
            onHistory();
            const oldSize = axis === 0 ? dimensions.width : dimensions.length;
            const nextSize = Math.max(0.01, Number(input.value) || oldSize);
            selectedMesh.scaleFaceGeometry(selectedMesh.selectedFace, axis === 0 ? nextSize / oldSize : 1, axis === 1 ? nextSize / oldSize : 1);
            drawUvWorkspace();
            refreshUvTransformControls(false);
        });
        group.append(labelElement, input);
        uvTransformRow.appendChild(group);
        return input;
    };
    const uvWidth = makeUvDimensionControl('Side width', 0);
    const uvLength = makeUvDimensionControl('Side length', 1);
    const uvActionButton = (label, rotation, scaleX, scaleY) => {
        const action = document.createElement('button');
        action.className = 'editor-button';
        action.type = 'button';
        action.textContent = label;
        action.addEventListener('click', () => {
            if (!selectedMesh) return;
            onHistory();
            selectedMesh.rotateFaceGeometry(selectedMesh.selectedFace, rotation);
            selectedMesh.scaleFaceGeometry(selectedMesh.selectedFace, scaleX, scaleY);
            drawUvWorkspace();
            refreshUvTransformControls(false);
        });
        uvTransformRow.appendChild(action);
    };
    uvActionButton('Rotate -90', -Math.PI / 2, 1, 1);
    uvActionButton('Rotate +90', Math.PI / 2, 1, 1);
    uvActionButton('Widen', 0, 1.25, 1);
    uvActionButton('Lengthen', 0, 1, 1.25);
    const imageTransformRow = document.createElement('div');
    imageTransformRow.className = 'uv-transform-row';
    const imageRotationGroup = document.createElement('label');
    imageRotationGroup.className = 'field-group';
    const imageRotationLabel = document.createElement('span');
    imageRotationLabel.className = 'field-label';
    imageRotationLabel.textContent = 'Selected face image rotation';
    const imageRotation = document.createElement('input');
    imageRotation.className = 'editor-input';
    imageRotation.type = 'range';
    imageRotation.min = '-180';
    imageRotation.max = '180';
    imageRotation.step = '1';
    imageRotation.value = '0';
    const imageRotationValue = document.createElement('output');
    imageRotationValue.className = 'range-value';
    imageRotationValue.textContent = '0 deg (0%)';
    const imageRotationLabelRow = document.createElement('div');
    imageRotationLabelRow.className = 'bone-slider-label';
    imageRotationLabelRow.append(imageRotationLabel, imageRotationValue);
    imageRotationGroup.append(imageRotationLabelRow, imageRotation);
    imageTransformRow.appendChild(imageRotationGroup);
    let previousImageRotation = 0;
    const imageMirrorButton = (label, axis) => {
        const mirror = document.createElement('button');
        mirror.className = 'editor-button';
        mirror.type = 'button';
        mirror.textContent = label;
        mirror.addEventListener('click', () => {
            if (!selectedMesh) return;
            onHistory();
            const transform = selectedMesh.faceUvTransforms[selectedMesh.selectedFace];
            const property = axis === 0 ? 'flipX' : 'flipY';
            transform[property] = !transform[property];
            mirror.classList.toggle('selected', transform[property]);
        });
        imageTransformRow.appendChild(mirror);
        return mirror;
    };
    const mirrorU = imageMirrorButton('Reflect U', 0);
    const mirrorV = imageMirrorButton('Reflect V', 1);
    const mergeFaceButton = document.createElement('button');
    mergeFaceButton.className = 'editor-button';
    mergeFaceButton.type = 'button';
    mergeFaceButton.textContent = 'Merge coplanar face';
    mergeFaceButton.addEventListener('click', () => {
        onMergeFace?.();
        refreshUvTransformControls();
        drawUvWorkspace();
    });
    imageTransformRow.appendChild(mergeFaceButton);
    const mergeVerticesButton = document.createElement('button');
    mergeVerticesButton.className = 'editor-button';
    mergeVerticesButton.type = 'button';
    mergeVerticesButton.textContent = 'Weld selected vertices';
    mergeVerticesButton.addEventListener('click', () => {
        onMergeVertices?.();
        drawUvWorkspace();
    });
    imageTransformRow.appendChild(mergeVerticesButton);
    imageRotation.addEventListener('input', () => {
        if (!selectedMesh) return;
        onHistory();
        const nextRotation = Number(imageRotation.value);
        imageRotationValue.textContent = `${nextRotation} deg (${Math.round(Math.abs(nextRotation) / 180 * 100)}%)`;
        selectedMesh.faceUvTransforms[selectedMesh.selectedFace].rotation += (nextRotation - previousImageRotation) * Math.PI / 180;
        previousImageRotation = nextRotation;
    });

    function refreshFaceImageControls() {
        const transform = selectedMesh?.faceUvTransforms[selectedMesh.selectedFace];
        imageRotation.disabled = !transform;
        mirrorU.disabled = !transform;
        mirrorV.disabled = !transform;
        mergeFaceButton.disabled = !transform;
        mergeVerticesButton.disabled = !selectedMesh?.selectedVertex;
        previousImageRotation = 0;
        imageRotation.value = '0';
        imageRotationValue.textContent = '0 deg (0%)';
        mirrorU.classList.toggle('selected', !!transform?.flipX);
        mirrorV.classList.toggle('selected', !!transform?.flipY);
    }
    uvRotation.addEventListener('input', () => {
        if (!selectedMesh) return;
        onHistory();
        const nextRotation = Number(uvRotation.value);
        uvRotationValue.textContent = `${nextRotation} deg (${Math.round(Math.abs(nextRotation) / 180 * 100)}%)`;
        selectedMesh.rotateFaceGeometry(selectedMesh.selectedFace, (nextRotation - previousUvRotation) * Math.PI / 180);
        previousUvRotation = nextRotation;
        drawUvWorkspace();
        refreshUvTransformControls(false);
        uvRotation.value = String(previousUvRotation);
    });

    function refreshUvTransformControls(resetRotation = true) {
        const dimensions = selectedMesh && selectedMesh.getFaceDimensions(selectedMesh.selectedFace);
        uvWidth.value = dimensions ? dimensions.width.toFixed(2) : '';
        uvLength.value = dimensions ? dimensions.length.toFixed(2) : '';
        uvWidth.disabled = !dimensions;
        uvLength.disabled = !dimensions;
        uvRotation.disabled = !dimensions;
        if (resetRotation) {
            previousUvRotation = 0;
            uvRotation.value = '0';
        }
    }

    const uvCanvas = document.createElement('canvas');
    uvCanvas.className = 'uv-canvas';
    uvCanvas.width = 1000;
    uvCanvas.height = 680;
    uvWorkspace.append(uvTitle, uvImageRow, uvTransformRow, imageTransformRow, uvCanvas);
    let selectedMesh = null;
    let uvDrag = null;
    const uvRegion = { x: 270, y: 80, width: 460, height: 460 };

    function drawUvWorkspace() {
        if (!selectedMesh || !container.classList.contains('uv-mode')) return;
        const context = uvCanvas.getContext('2d');
        context.clearRect(0, 0, uvCanvas.width, uvCanvas.height);
        context.fillStyle = '#111923';
        context.fillRect(0, 0, uvCanvas.width, uvCanvas.height);
        const selectedFace = selectedMesh.selectedFace;
        const faceTextureId = selectedMesh.faceTextureIds[selectedFace];
        const imageAsset = options.textureLibrary.get(faceTextureId || selectedMesh.textureAssetId);
        if (imageAsset?.previewImage?.complete && imageAsset.previewImage.naturalWidth) {
            context.drawImage(imageAsset.previewImage, uvRegion.x, uvRegion.y, uvRegion.width, uvRegion.height);
        } else {
            context.fillStyle = '#202b37';
            context.fillRect(uvRegion.x, uvRegion.y, uvRegion.width, uvRegion.height);
            context.strokeStyle = '#344657';
            for (let position = 0; position <= 1; position += 0.1) {
                const x = uvRegion.x + uvRegion.width * position;
                const y = uvRegion.y + uvRegion.height * position;
                context.beginPath();
                context.moveTo(x, uvRegion.y);
                context.lineTo(x, uvRegion.y + uvRegion.height);
                context.moveTo(uvRegion.x, y);
                context.lineTo(uvRegion.x + uvRegion.width, y);
                context.stroke();
            }
        }
        context.strokeStyle = '#c4d6e6';
        context.lineWidth = 1.5;
        selectedMesh.faceUvs.forEach((faceUvs, faceIndex) => {
            if (!faceUvs?.length) return;
            context.beginPath();
            faceUvs.forEach(([u, v], vertexIndex) => {
                const x = uvRegion.x + u * uvRegion.width;
                const y = uvRegion.y + (1 - v) * uvRegion.height;
                if (vertexIndex === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            });
            context.closePath();
            context.fillStyle = faceIndex === selectedMesh.selectedFace ? 'rgba(255, 194, 75, 0.25)' : 'rgba(128, 190, 224, 0.12)';
            context.fill();
            context.strokeStyle = faceIndex === selectedMesh.selectedFace ? '#ffc24b' : '#c4d6e6';
            context.stroke();
        });
    }

    function uvAtPointer(event) {
        const rect = uvCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * uvCanvas.width / rect.width;
        const y = (event.clientY - rect.top) * uvCanvas.height / rect.height;
        return [(x - uvRegion.x) / uvRegion.width, 1 - (y - uvRegion.y) / uvRegion.height];
    }

    function refreshUvTextures() {
        uvImageSelect.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'No image';
        uvImageSelect.appendChild(empty);
        options.textureLibrary.assets.forEach(asset => {
            const option = document.createElement('option');
            option.value = asset.id;
            option.textContent = asset.name;
            uvImageSelect.appendChild(option);
        });
        uvImageSelect.value = selectedMesh?.textureAssetId || '';
    }

    uvCanvas.addEventListener('pointerdown', event => {
        if (!selectedMesh) return;
        const [u, v] = uvAtPointer(event);
        const faceIndex = selectedMesh.faceUvs.findIndex(faceUvs => pointInPolygon([u, v], faceUvs));
        if (faceIndex < 0) return;
        selectedMesh.selectedFace = faceIndex;
        onSelectFace(faceIndex);
        onHistory();
        refreshUvTransformControls();
        refreshFaceImageControls();
        uvDrag = { faceIndex, x: event.clientX, y: event.clientY };
        uvCanvas.setPointerCapture(event.pointerId);
        drawUvWorkspace();
    });
    uvCanvas.addEventListener('pointermove', event => {
        if (!uvDrag || !selectedMesh) return;
        const rect = uvCanvas.getBoundingClientRect();
        selectedMesh.moveFaceUVs(uvDrag.faceIndex, (event.clientX - uvDrag.x) * uvCanvas.width / rect.width / uvRegion.width, -(event.clientY - uvDrag.y) * uvCanvas.height / rect.height / uvRegion.height);
        uvDrag.x = event.clientX;
        uvDrag.y = event.clientY;
        drawUvWorkspace();
    });
    uvCanvas.addEventListener('pointerup', event => {
        uvDrag = null;
        if (uvCanvas.hasPointerCapture(event.pointerId)) uvCanvas.releasePointerCapture(event.pointerId);
    });

    const modeLabels = new Map([['vertex', 'Vertex'], ['edge', 'Edge'], ['face', 'Face'], ['mesh', 'Object'], ['orbit', 'Orbit']]);
    const pickModeButtons = new Map();
    const setPickMode = mode => {
        onSetPickMode(mode);
        setTransformTool('select');
        editorStatus.mode = mode;
        container.classList.remove('uv-mode');
        uvModeButton.classList.remove('selected');
        pickModeButtons.forEach((element, key) => element.classList.toggle('selected', key === mode));
        refreshStatus();
    };
    ['vertex', 'edge', 'face', 'mesh', 'orbit'].forEach(mode => {
        const modeButton = document.createElement('button');
        modeButton.className = 'editor-button' + (mode === 'face' ? ' selected' : '');
        modeButton.type = 'button';
        modeButton.textContent = modeLabels.get(mode);
        modeButton.dataset.pickMode = mode;
        modeButton.addEventListener('click', () => setPickMode(mode));
        pickModeButtons.set(mode, modeButton);
        modeButtons.appendChild(modeButton);
    });
    const uvModeButton = document.createElement('button');
    uvModeButton.className = 'editor-button';
    uvModeButton.type = 'button';
    uvModeButton.textContent = 'UV';
    uvModeButton.title = 'Toggle UV workspace';
    uvModeButton.addEventListener('click', () => {
        const active = !container.classList.contains('uv-mode');
        container.classList.toggle('uv-mode', active);
        uvModeButton.classList.toggle('selected', active);
        if (active) drawUvWorkspace();
    });
    modeButtons.appendChild(uvModeButton);
    container.appendChild(toolbar);
    container.appendChild(uvWorkspace);

    const panels = document.createElement('div');
    panels.className = 'editor-panels';
    container.appendChild(panels);

    const hierarchy = createHierarchyPanel(scene, {
        onSelect,
        onDelete,
        onReorder: onReorderMesh,
        getSelected: () => selectedMesh,
        getSelectedItems: () => options.getSelectedItems?.() || []
    });
    const inspector = createInspectorPanel(options.gl, options.textureLibrary, onSelectFace, onHistory);
    const assets = createAssetsPanel(options.textureLibrary, onImportMesh, onImportTexture, options.prefabActions);
    const bones = createBonesPanel({ onAddBone, onRemoveBone, onCreateAnimation, onKeyPose, onDeleteBoneKeys, onSeekAnimation, onToggleAnimation, onRenameAnimation, onSetAnimationDuration, onHistory, onChange: options.onBonePoseChange });
    if (!scene.light) scene.light = new DirectionalLight();
    const lighting = createLightingPanel(scene.light, onHistory);

    const layoutStorageKey = 'lightweight-3d-layout';
    const panelDefaults = {
        hierarchy: { dock: 'hierarchy', open: true },
        inspector: { dock: 'inspector', open: true },
        assets: { dock: 'assets', open: true },
        'rig-and-animation': { dock: 'animation', open: true },
        'key-light': { dock: 'inspector', open: false, floating: true }
    };
    let savedLayout = {};
    try { savedLayout = JSON.parse(localStorage.getItem(layoutStorageKey) || '{}'); } catch {}
    const persistPanelLayout = disclosure => {
        try {
            const layout = JSON.parse(localStorage.getItem(layoutStorageKey) || '{}');
            const rect = disclosure.getBoundingClientRect();
            layout[disclosure.dataset.panel] = {
                dock: disclosure.dataset.dock,
                floating: disclosure.dataset.floating === 'true',
                open: disclosure.open,
                ...(disclosure.dataset.floating === 'true' ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : {})
            };
            localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
        } catch {}
    };

    const panelDisclosure = (label, element, index) => {
        const disclosure = document.createElement('details');
        disclosure.className = 'panel-disclosure';
        const panelKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const defaults = panelDefaults[panelKey] || { dock: 'assets', open: false };
        const savedPanel = savedLayout[panelKey];
        const positionKey = `lightweight-3d-panel:${panelKey}`;
        let legacyPosition = null;
        try {
            legacyPosition = JSON.parse(localStorage.getItem(positionKey) || 'null');
        } catch {}
        disclosure.dataset.panel = panelKey;
        disclosure.dataset.dock = savedPanel?.dock || defaults.dock;
        const isFloating = typeof savedPanel?.floating === 'boolean' ? savedPanel.floating : !!legacyPosition || !!defaults.floating;
        disclosure.dataset.floating = String(isFloating);
        disclosure.open = typeof savedPanel?.open === 'boolean' ? savedPanel.open : defaults.open;
        if (isFloating) {
            const position = savedPanel || legacyPosition || {};
            disclosure.style.top = `${Math.max(8, Math.min(window.innerHeight - 44, Number(position.top) || 64 + index * 42))}px`;
            disclosure.style.right = Number.isFinite(position.left) ? 'auto' : '12px';
            if (Number.isFinite(position.left)) disclosure.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, position.left))}px`;
            if (Number.isFinite(position.width)) disclosure.style.width = `${Math.max(220, Math.min(window.innerWidth - 16, position.width))}px`;
            if (Number.isFinite(position.height)) disclosure.style.height = `${Math.max(120, Math.min(window.innerHeight - 16, position.height))}px`;
        }
        disclosure.addEventListener('toggle', () => persistPanelLayout(disclosure));
        const summary = document.createElement('summary');
        const title = document.createElement('span');
        title.textContent = label;
        const dragHandle = document.createElement('button');
        dragHandle.className = 'panel-drag-handle';
        dragHandle.type = 'button';
        dragHandle.textContent = ':::';
        dragHandle.title = `Drag ${label} panel`;
        dragHandle.setAttribute('aria-label', `Move ${label} panel`);
        dragHandle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = disclosure.getBoundingClientRect();
            dragHandle.setPointerCapture(event.pointerId);
            disclosure.dataset.floating = 'true';
            disclosure.dataset.dragPointer = String(event.pointerId);
            disclosure.dataset.dragX = String(event.clientX - rect.left);
            disclosure.dataset.dragY = String(event.clientY - rect.top);
            disclosure.style.right = 'auto';
            disclosure.style.left = `${rect.left}px`;
            disclosure.style.top = `${rect.top}px`;
            disclosure.style.width = `${rect.width}px`;
            disclosure.style.height = `${rect.height}px`;
        });
        dragHandle.addEventListener('pointermove', event => {
            if (disclosure.dataset.dragPointer !== String(event.pointerId)) return;
            const maxLeft = Math.max(0, window.innerWidth - Math.min(120, disclosure.offsetWidth));
            const maxTop = Math.max(0, window.innerHeight - 36);
            const left = Math.max(0, Math.min(maxLeft, event.clientX - Number(disclosure.dataset.dragX)));
            const top = Math.max(0, Math.min(maxTop, event.clientY - Number(disclosure.dataset.dragY)));
            disclosure.style.left = `${left}px`;
            disclosure.style.top = `${top}px`;
        });
        const finishPanelDrag = event => {
            if (disclosure.dataset.dragPointer !== String(event.pointerId)) return;
            delete disclosure.dataset.dragPointer;
            delete disclosure.dataset.dragX;
            delete disclosure.dataset.dragY;
            const dock = event.clientX < 36 ? 'hierarchy'
                : event.clientX > window.innerWidth - 36 ? 'inspector'
                    : event.clientY > window.innerHeight - 36 ? (event.clientX < window.innerWidth / 2 ? 'assets' : 'animation')
                        : null;
            if (dock) {
                const occupied = Array.from(panels.children).find(panel => panel !== disclosure && panel.dataset.dock === dock && panel.dataset.floating !== 'true');
                if (occupied) {
                    occupied.dataset.dock = disclosure.dataset.dock;
                    persistPanelLayout(occupied);
                }
                disclosure.dataset.dock = dock;
                disclosure.dataset.floating = 'false';
                ['left', 'top', 'right', 'width', 'height'].forEach(property => disclosure.style.removeProperty(property));
            }
            persistPanelLayout(disclosure);
        };
        dragHandle.addEventListener('pointerup', finishPanelDrag);
        dragHandle.addEventListener('pointercancel', finishPanelDrag);
        const resizeHandle = document.createElement('button');
        resizeHandle.className = 'panel-resize-handle';
        resizeHandle.type = 'button';
        resizeHandle.title = `Drag to resize ${label} panel`;
        resizeHandle.setAttribute('aria-label', `Resize ${label} panel`);
        resizeHandle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !disclosure.open || disclosure.dataset.floating !== 'true') return;
            event.preventDefault();
            event.stopPropagation();
            const rect = disclosure.getBoundingClientRect();
            disclosure.dataset.resizePointer = String(event.pointerId);
            disclosure.dataset.resizeX = String(event.clientX);
            disclosure.dataset.resizeY = String(event.clientY);
            disclosure.dataset.resizeWidth = String(rect.width);
            disclosure.dataset.resizeHeight = String(rect.height);
            resizeHandle.setPointerCapture(event.pointerId);
        });
        resizeHandle.addEventListener('pointermove', event => {
            if (disclosure.dataset.resizePointer !== String(event.pointerId)) return;
            const left = disclosure.getBoundingClientRect().left;
            const top = disclosure.getBoundingClientRect().top;
            const minWidth = Math.min(220, window.innerWidth - 24);
            const minHeight = Math.min(120, window.innerHeight - 24);
            const maxWidth = Math.max(minWidth, window.innerWidth - left - 8);
            const maxHeight = Math.max(minHeight, window.innerHeight - top - 8);
            const width = Number(disclosure.dataset.resizeWidth) + event.clientX - Number(disclosure.dataset.resizeX);
            const height = Number(disclosure.dataset.resizeHeight) + event.clientY - Number(disclosure.dataset.resizeY);
            disclosure.style.width = `${Math.max(minWidth, Math.min(maxWidth, width))}px`;
            disclosure.style.height = `${Math.max(minHeight, Math.min(maxHeight, height))}px`;
        });
        const finishPanelResize = event => {
            if (disclosure.dataset.resizePointer !== String(event.pointerId)) return;
            ['resizePointer', 'resizeX', 'resizeY', 'resizeWidth', 'resizeHeight'].forEach(key => delete disclosure.dataset[key]);
            disclosure.dataset.resized = 'true';
            persistPanelLayout(disclosure);
        };
        resizeHandle.addEventListener('pointerup', finishPanelResize);
        resizeHandle.addEventListener('pointercancel', finishPanelResize);
        summary.append(title, dragHandle);
        disclosure.append(summary, element, resizeHandle);
        return disclosure;
    };
    panels.appendChild(panelDisclosure('Hierarchy', hierarchy.element, 0));
    panels.appendChild(panelDisclosure('Inspector', inspector.element, 1));
    panels.appendChild(panelDisclosure('Assets', assets.element, 2));
    panels.appendChild(panelDisclosure('Rig and Animation', bones.element, 3));
    panels.appendChild(panelDisclosure('Key Light', lighting.element, 4));
    saveCurrentLayout = () => panels.querySelectorAll('.panel-disclosure').forEach(persistPanelLayout);
    resetCurrentLayout = () => {
        try { localStorage.removeItem(layoutStorageKey); } catch {}
        panels.querySelectorAll('.panel-disclosure').forEach(disclosure => {
            const defaults = panelDefaults[disclosure.dataset.panel] || { dock: 'assets', open: false };
            disclosure.dataset.dock = defaults.dock;
            disclosure.dataset.floating = String(!!defaults.floating);
            disclosure.open = defaults.open;
            ['left', 'top', 'right', 'width', 'height'].forEach(property => disclosure.style.removeProperty(property));
            if (defaults.floating) {
                disclosure.style.top = '64px';
                disclosure.style.right = '12px';
            }
        });
        saveCurrentLayout();
    };

    return {
        setSelected: mesh => { selectedMesh = mesh; inspector.setMesh(mesh); bones.setMesh(mesh); refreshUvTextures(); refreshUvTransformControls(); refreshFaceImageControls(); drawUvWorkspace(); },
        setFace: faceIndex => { inspector.setFace(faceIndex); refreshUvTransformControls(); refreshFaceImageControls(); drawUvWorkspace(); },
        refreshHierarchy: hierarchy.refresh,
        refreshBones: bones.refresh,
        setInternalFps: (fps, frameMs) => { fpsReadout.textContent = `Internal FPS ${Math.round(fps)} | ${frameMs.toFixed(2)} ms`; },
        setPolygonCount: (current, total) => { polygonReadout.textContent = `Current Mesh Polygons / All Polygons: ${current} / ${total}`; },
        setStatus: message => { editorStatus.last = message; refreshStatus(); },
        setEditorState: state => { Object.assign(editorStatus, state); refreshStatus(); },
        refreshStatus,
        setViewportStats: stats => {
            if (!stats) return;
            viewportStats.textContent = `Draw calls ${stats.drawCalls} | Triangles ${stats.triangles} | Objects ${stats.objects}`;
        },
        setStatus: message => { operatorStatus.textContent = message; },
        setCameraView: view => cameraButtons.forEach((element, key) => element.classList.toggle('selected', key === view)),
        refreshTextures: () => { assets.refresh(); inspector.refresh(); refreshUvTextures(); },
        refreshPrefabs: assets.refreshPrefabs,
        refreshScenes,
        refreshLight: lighting.refresh,
        updateUvWorkspace: drawUvWorkspace,
        updateAnimationWorkspace: (time, playing) => bones.updatePlayback(time, playing),
        setPickMode: mode => {
            setPickMode(mode);
        }
    };

}

function isTextEntry(element) {
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName) || element?.isContentEditable;
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
        const [x, y] = polygon[current];
        const [previousX, previousY] = polygon[previous];
        const intersects = (y > point[1]) !== (previousY > point[1]) && point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x;
        if (intersects) inside = !inside;
    }
    return inside;
}
