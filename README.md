# Flat Shaded 3D Engine / Anime-Style Editor + Game Runtime

**[Open the HTML User Manual](docs/manual.html)** — full shortcuts, tools, play mode, and troubleshooting.

A lightweight, browser-based 3D editor and game engine focused on **anime / toon aesthetics** with flat shading, hard raytraced directional shadows, and high performance for thousands of objects.

## Key Features

### Editor
- Mesh modeling tools: extrude, inset, bevel, loop cut, bridge, fill, dissolve, split, separate, triangulate, knife, merge, etc.
- Multi-selection (meshes, faces, edges, vertices)
- Transform gizmos (move / rotate / scale) with snapping and axis constraints
- UV editing, face colors, per-face textures
- Skeleton + keyframe animation
- Prefabs (including nested) with override / revert
- Multi-scene management with sub-scenes and streaming
- Undo / redo (mesh commands + scene snapshots)
- Import / export scene JSON
- Texture library

### Anime Aesthetic & Raytracing
- Toon / cel shading with configurable light threshold and shade color
- **Raytraced hard directional shadows** (BVH-accelerated, cached by geometry signature)
- Flat face coloring, optional textures with UV transforms
- Wireframe / solid / material / anime render modes

### Game Engine / Runtime
- `GameRuntime` – drop-in play mode that disables heavy editor UI
- Simple input manager (keyboard + mouse)
- Fly / orbit camera controls (WASD + mouse)
- Lightweight AABB physics + gravity for platformer-style prototypes
- Per-object update scripts
- Press **P** or **F5** to enter Play mode, **Esc** to return to Editor

### Performance Optimizations (thousands of objects, lag-free transforms)
- **Cached model matrices** – only recomputed when transform actually changes
- **Frustum culling** (sphere approximation of AABB) skips off-screen meshes
- **GPU instancing** for identical geometry/material batches
- **Dirty-flag system** – geometry / UVs / materials / selection / skeleton only rebuild what changed
- **Shadow BVH cache** – rebuild only when geometry or transforms of toon meshes change
- **Incremental asset registration** – full scene asset refresh deferred (not on every gizmo drag)
- **Batched primitive creation** with yield points so the UI stays responsive when spawning 10k+ objects
- Transform end no longer forces full hierarchy + asset rebuild for small selections

## Quick Start

```bash
# Serve the folder (any static server)
npx serve .
# or python -m http.server
```

Open the page. Default scene contains a cube.

- **1 / 2 / 3 / 4** – vertex / edge / face / object mode
- **G / R / S** – move / rotate / scale
- **E** – extrude
- **Ctrl+D** – duplicate
- **X** – delete (with confirm)
- **P** or **F5** – Play mode
- **Esc** – exit Play mode

## Using as a Game Engine

```js
import { GameRuntime } from './engine/runtime.js';

const runtime = new GameRuntime(renderer, scene, camera);
runtime.enableFlyCamera(5);
runtime.physics.addBody(myMesh, { gravity: -12, radius: 0.5 });
runtime.addScript('player', (dt, rt) => {
  // custom logic
});
runtime.play();
```

## Architecture Notes

- Core engine lives under `engine/` (Mesh, Scene, Renderer, Camera, Skeleton, Animation, AssetManager, PrefabManager, Raytracing, Runtime).
- Editor UI and tools under `editor/`.
- Scenes persist in `localStorage` via `SceneManager`.
- All shading is intentionally flat / toon-first; raytracing is used for clean anime shadows rather than photorealism.

Built for speed, clarity, and the distinctive look of anime 3D.
