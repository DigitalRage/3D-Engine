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
    loop();
}

function loop() {
    const now = performance.now();
    scene.update(Math.min(0.1, (now - lastTime) / 1000));
    lastTime = now;
    editor.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

init();
