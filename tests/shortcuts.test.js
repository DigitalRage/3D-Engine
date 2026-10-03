import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchEditorShortcut } from '../editor/shortcuts.js';

function keyEvent(key, options = {}) {
    return {
        key,
        code: options.code || '',
        ctrlKey: !!options.ctrlKey,
        metaKey: !!options.metaKey,
        altKey: !!options.altKey,
        shiftKey: !!options.shiftKey,
        preventDefault() { this.defaultPrevented = true; }
    };
}

test('numeric keys select component and object modes', () => {
    const modes = [];
    for (const [key, mode] of [['1', 'vertex'], ['2', 'edge'], ['3', 'face'], ['4', 'mesh']]) {
        const event = keyEvent(key);
        assert.equal(dispatchEditorShortcut(event, { onSetPickMode: value => modes.push(value) }), true);
        assert.equal(event.defaultPrevented, true);
        assert.equal(modes.at(-1), mode);
    }
});

test('G/R/S/E and Ctrl+D route to editor actions', () => {
    const actions = [];
    for (const [key, tool] of [['g', 'move'], ['r', 'rotate'], ['s', 'scale']]) {
        dispatchEditorShortcut(keyEvent(key), { onSetTransformTool: value => actions.push(value) });
    }
    dispatchEditorShortcut(keyEvent('e'), { onExtrude: () => actions.push('extrude') });
    dispatchEditorShortcut(keyEvent('d', { ctrlKey: true }), { onDuplicate: () => actions.push('duplicate') });
    assert.deepEqual(actions, ['move', 'rotate', 'scale', 'extrude', 'duplicate']);
});

test('X confirms delete and numpad keys select camera views', () => {
    const actions = [];
    dispatchEditorShortcut(keyEvent('x'), {
        confirmDelete: () => true,
        onDelete: () => actions.push('delete')
    });
    for (const [code, view] of [['Numpad1', 'front'], ['Numpad3', 'right'], ['Numpad7', 'top']]) {
        dispatchEditorShortcut(keyEvent(code.slice(-1), { code }), { onSetCameraView: value => actions.push(value) });
    }
    assert.deepEqual(actions, ['delete', 'front', 'right', 'top']);
});

test('shortcuts remain native while editing text and delete can be canceled', () => {
    let called = false;
    assert.equal(dispatchEditorShortcut(keyEvent('g'), { onSetTransformTool() { called = true; } }, { isTextEntry: true }), false);
    assert.equal(dispatchEditorShortcut(keyEvent('x'), { confirmDelete: () => false, onDelete() { called = true; } }), true);
    assert.equal(called, false);
});
