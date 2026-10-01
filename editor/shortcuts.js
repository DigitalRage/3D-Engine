export function dispatchEditorShortcut(event, callbacks, { isTextEntry = false } = {}) {
    if (isTextEntry || event.altKey) return false;
    const key = event.key.toLowerCase();
    const modified = event.ctrlKey || event.metaKey;

    if (modified && key === 'z') {
        event.preventDefault();
        (event.shiftKey ? callbacks.onRedo : callbacks.onUndo)?.();
        return true;
    }
    if (modified && key === 'y') {
        event.preventDefault();
        callbacks.onRedo?.();
        return true;
    }
    if (modified && key === 'd') {
        event.preventDefault();
        callbacks.onDuplicate?.();
        return true;
    }
    if (modified) return false;

    const views = { Numpad1: 'front', Numpad3: 'right', Numpad7: 'top' };
    const view = views[event.code];
    if (view) {
        event.preventDefault();
        callbacks.onSetCameraView?.(view);
        return true;
    }

    const modes = { '1': 'vertex', '2': 'edge', '3': 'face', '4': 'mesh' };
    if (modes[key]) {
        event.preventDefault();
        callbacks.onSetPickMode?.(modes[key]);
        return true;
    }

    const tools = { g: 'move', r: 'rotate', s: 'scale' };
    if (tools[key]) {
        event.preventDefault();
        callbacks.onSetTransformTool?.(tools[key]);
        return true;
    }
    if (key === 'e') {
        event.preventDefault();
        callbacks.onExtrude?.();
        return true;
    }
    if (key === 'x') {
        event.preventDefault();
        if (callbacks.confirmDelete?.() !== false) callbacks.onDelete?.();
        return true;
    }
    return false;
}
