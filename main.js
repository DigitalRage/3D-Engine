import { Renderer } from './engine/render.js';
import { Scene } from './engine/scene.js';
import { Camera } from './engine/camera.js';
import { Mesh } from './engine/mesh.js';
import { Material } from './engine/material.js';
import { loadTexture } from './engine/loader.js';
import { Editor } from './editor/editor.js';

const canvas = document.getElementById('viewport');
const renderer = new Renderer(canvas);
const scene = new Scene();
const camera = new Camera();
camera.position = [0, 1.5, 4];

let editor;
let lastTime = performance.now();
let fpsWindowStart = lastTime;
let measuredFrames = 0;
let measuredWorkMs = 0;

async function init() {
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
        texture: tex
    });

    const cube = Mesh.createCube(mat);
    cube.name = 'Main Cube';
    cube.position = [0, 0.5, 0];
    scene.add(cube);

    editor = new Editor(scene, camera, renderer);
    if (tex) editor.textureLibrary.addTexture('example.webp', tex, './assets/textures/example.webp');
    editor.ui.refreshTextures();
    loop();
}

function loop() {
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
