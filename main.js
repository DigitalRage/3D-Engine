import { Renderer } from './engine/render.js';
import { Scene } from './engine/scene.js';
import { Camera } from './engine/camera.js';
import { Mesh } from './engine/mesh.js';
import { Material } from './engine/material.js';
import { loadTexture } from './engine/loader.js';
import { Editor } from './editor/editor.js';
import { GameRuntime } from './engine/runtime.js';

const canvas = document.getElementById('viewport');
const renderer = new Renderer(canvas);
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

async function init() {
    // Clear poisoned oversized scene cache from previous Chrome sessions
    try { localStorage.removeItem("lightweight-3d-scenes"); } catch (e) { /* ignore */ }

    await renderer.ready;

    let tex = null;
    try {
        tex = await loadTexture('./assets/textures/example.webp', renderer.gl);
    } catch (e) {
        console.warn('Failed to load example.webp, continuing without texture.', e);
    }

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

    editor = new Editor(scene, camera, renderer);
    if (tex) editor.textureLibrary.addTexture('example.webp', tex, './assets/textures/example.webp');
    editor.ui.refreshTextures();
    await editor.initializeScenes();

    window.togglePlayMode = () => {
        playMode = !playMode;
        if (playMode) {
            savedCamera = {
                position: [...camera.position],
                target: [...camera.target],
                far: camera.far,
                viewMode: camera.viewMode
            };

            // Start near city plaza for exploration
            camera.position = [-150, 1.7, 18];
            camera.target = [-150, 1.5, 0];
            camera.far = 600;

            runtime = new GameRuntime(renderer, scene, camera, {
                onUpdate: () => {}
            });

            runtime.enableFirstPersonCamera({
                speed: 8,
                sprintMultiplier: 1.9,
                eyeHeight: 1.7,
                radius: 0.4,
                gravity: -24,
                jumpSpeed: 9,
                mouseSensitivity: 0.0022
            });

            scene.meshes.forEach(m => {
                if (m.name?.includes('Cube') || m.name?.includes('Sphere')) {
                    runtime.physics.addBody(m, { gravity: -12, radius: 0.5 });
                }
            });

            runtime.play();
            editor.ui?.setStatus?.(
                'Play mode — WASD walk, arrows look, Space jump, Shift sprint, click lock mouse. Esc exits.'
            );
            const ui = document.getElementById('ui-root');
            if (ui) {
                ui.style.pointerEvents = 'none';
                ui.style.opacity = '0.35';
            }
        } else {
            runtime?.stop();
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

    loop();
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
    editor.update();
    renderer.render(scene, camera);
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
