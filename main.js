import { Renderer } from './engine/render.js';
import { Scene } from './engine/scene.js';
import { Camera } from './engine/camera.js';
import { Mesh } from './engine/mesh.js';
import { Material } from './engine/material.js';
import { loadTexture } from './engine/loader.js';
import { Editor } from './editor/editor.js';

const canvas = document.getElementById('viewport');
const renderer = new Renderer(canvas);
const audioManager = createAudioBridge();
const scene = new Scene();
const camera = new Camera();
camera.position = [0, 1.7, 4];
camera.target = [0, 1.5, 0];
camera.far = 250;

let editor;
let runtime = null;
let playMode = false;
let lastTime = performance.now();
let fpsWindowStart = lastTime;
let measuredFrames = 0;
let measuredWorkMs = 0;
let savedCamera = null;
let playerCharacter = null;

async function init() {
    setLoadingProgress(4, 'Starting renderer');
    await renderer.ready;
    setLoadingProgress(18, 'Renderer ready');
    await nextFrame();

    // Do not block first paint on optional example assets or the 3 MB+ built-in audio module.
    let tex = null;

    const mat = new Material({
        color: [0.78, 0.84, 0.92],
        useTexture: false,
        texture: tex,
        shading: 'toon'
    });

    const cube = Mesh.createCube(mat);
    cube.name = 'Main Cube';
    cube.position = [0, 0.5, 0];
    scene.add(cube);

    setLoadingProgress(24, 'Building editor');
    await nextFrame();
    editor = new Editor(scene, camera, renderer, audioManager);
    setLoadingProgress(48, 'Loading scenes');
    await nextFrame();
    await editor.initializeScenes();
    setLoadingProgress(76, 'Preparing viewport');
    await nextFrame();
    loop();
    setLoadingProgress(100, 'Ready');
    hideLoadingScreen();
    void loadDeferredAssets();

    let playModeTransition = null;
    window.togglePlayMode = async () => {
        if (playModeTransition) return playModeTransition;
        playModeTransition = (async () => {
            if (!playMode) {
                const [{ GameRuntime }, { PlayerCharacter }] = await Promise.all([
                    import('./engine/runtime.js'),
                    import('./engine/player.js')
                ]);
                playMode = true;
                savedCamera = {
                    position: [...camera.position],
                    target: [...camera.target],
                    far: camera.far,
                    viewMode: camera.viewMode
                };

                // Third-person exploration starts near the city plaza.
                const spawn = [-150, 0, 18];
                camera.position = [-150, 3.1, 23];
                camera.target = [-150, 1.0, 18];
                camera.far = 700;

                runtime = new GameRuntime(renderer, scene, camera, {
                    audio: audioManager,
                    onUpdate: () => {}
                });
                playerCharacter = new PlayerCharacter({ spawn });
                runtime.enableThirdPersonPlayer(playerCharacter, {
                    spawn,
                    moveSpeed: 5.2,
                    sprintMultiplier: 1.8,
                    jumpSpeed: 8.8,
                    gravity: -24,
                    radius: 0.34,
                    cameraDistance: 4.6,
                    cameraTargetHeight: 1.0
                });

                runtime.play();
                editor.ui?.setStatus?.(
                    'Play mode — WASD move, Arrow Keys or mouse/right-drag camera, Space jump, Shift sprint, Esc exits.'
                );
                const ui = document.getElementById('ui-root');
                if (ui) {
                    ui.style.pointerEvents = 'none';
                    ui.style.opacity = '0.35';
                }
            } else {
                playMode = false;
                runtime?.stop();
                runtime?.disableThirdPersonPlayer?.();
                playerCharacter = null;
                runtime = null;

                if (savedCamera) {
                    camera.position = [...savedCamera.position];
                    camera.target = [...savedCamera.target];
                    camera.far = savedCamera.far;
                    camera.viewMode = savedCamera.viewMode;
                    savedCamera = null;
                }
                editor.gizmos?.syncFromCamera?.();

                const ui = document.getElementById('ui-root');
                if (ui) {
                    ui.style.pointerEvents = '';
                    ui.style.opacity = '';
                }
                editor.ui?.setStatus?.('Editor mode');
            }
        })().finally(() => { playModeTransition = null; });
        return playModeTransition;
    };

    window.addEventListener('keydown', e => {
        if (e.code === 'Escape' && playMode) {
            window.togglePlayMode();
            e.preventDefault();
        }
        if ((e.code === 'KeyP' || e.code === 'F5') && !e.ctrlKey && !e.metaKey && !isTextInput(document.activeElement)) {
            window.togglePlayMode();
            e.preventDefault();
        }
    });

}

function createAudioBridge() {
    return {
        manager: null,
        async unlock(...args) { return this.manager?.unlock?.(...args) ?? false; },
        async loadManifest(...args) { return this.manager?.loadManifest?.(...args) ?? { version: 1, assets: [] }; },
        listSounds(...args) { return this.manager?.listSounds?.(...args) || []; },
        getSound(...args) { return this.manager?.getSound?.(...args) || null; },
        addLocalFiles(...args) { return this.manager?.addLocalFiles?.(...args) || []; },
        preview(...args) { return this.manager?.preview?.(...args) || null; },
        stopPreview(...args) { return this.manager?.stopPreview?.(...args); },
        playMusic(...args) { return this.manager?.playMusic?.(...args) || null; },
        stopMusic(...args) { return this.manager?.stopMusic?.(...args); },
        configureScene(...args) { return this.manager?.configureScene?.(...args); },
        play(...args) { return this.manager?.play?.(...args) || null; },
        enqueue(...args) { return this.manager?.enqueue?.(...args) || null; },
        setListenerFromCamera(...args) { return this.manager?.setListenerFromCamera?.(...args); },
        isUnlocked(...args) { return !!this.manager?.isUnlocked?.(...args); },
        get ready() { return this.manager?.ready || Promise.resolve(); }
    };
}

async function loadDeferredAssets() {
    // Optional texture library entry. It is intentionally not part of the critical startup path.
    try {
        const tex = await loadTexture('./assets/textures/example.webp', renderer.gl);
        editor?.textureLibrary.addTexture('example.webp', tex, './assets/textures/example.webp');
        editor?.ui.refreshTextures();
    } catch (error) {
        console.warn('Optional example texture unavailable; continuing without it.', error);
    }
    try {
        const { AudioManager } = await import('./engine/audio.js');
        audioManager.manager = new AudioManager();
        await audioManager.manager.ready;
        editor?.ui.refreshAudio?.();
        if (scene.audio) audioManager.configureScene(scene.audio);
    } catch (error) {
        console.warn('Deferred audio subsystem unavailable; the editor will remain silent.', error);
        editor?.ui.refreshAudio?.();
    }
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

window.__setEngineLoadingProgress = setLoadingProgress;
window.__hideEngineLoadingScreen = hideLoadingScreen;

function setLoadingProgress(percent, message) {
    const screen = document.getElementById('loading-screen');
    const fill = document.getElementById('loading-progress-fill');
    const label = document.getElementById('loading-status');
    const value = document.getElementById('loading-percent');
    if (!screen) return;
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    screen.classList.remove('hidden');
    if (fill) fill.style.width = `${clamped.toFixed(1)}%`;
    if (label) label.textContent = message || 'Loading';
    if (value) value.textContent = `${Math.round(clamped)}%`;
}

function hideLoadingScreen() {
    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    screen.classList.add('hidden');
    window.setTimeout(() => screen.remove(), 500);
}

function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function loop() {
    if (playMode && runtime) {
        requestAnimationFrame(loop);
        return;
    }
    const now = performance.now();
    const workStart = performance.now();
    scene.update(Math.min(0.1, (now - lastTime) / 1000));
    lastTime = now;
    editor.update(now);
    audioManager.setListenerFromCamera(camera);
    renderer.render(scene, camera);
    renderer.updateAdaptiveQuality?.(renderer.frameStats.cpuMs || (performance.now() - workStart), now);
    measuredWorkMs += performance.now() - workStart;
    measuredFrames++;
    const windowElapsed = performance.now() - fpsWindowStart;
    if (windowElapsed >= 250) {
        editor.ui.setInternalFps(measuredFrames * 1000 / measuredWorkMs, measuredWorkMs / measuredFrames);
        measuredFrames = 0;
        measuredWorkMs = 0;
        fpsWindowStart = performance.now();
    }
    requestAnimationFrame(loop);
}

init().catch(error => {
    console.error('Editor startup failed:', error);
    const message = document.createElement('pre');
    message.textContent = `Editor startup failed\n${error.message || error}`;
    message.style.cssText = 'position:fixed;left:16px;bottom:16px;max-width:calc(100vw - 32px);padding:12px;margin:0;color:#ffd8d8;background:#3a171d;border:1px solid #b85c68;font:13px/1.4 monospace;white-space:pre-wrap;z-index:10;';
    document.body.appendChild(message);
});
