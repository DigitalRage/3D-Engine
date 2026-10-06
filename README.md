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
- Native OBJ import/export for scenes and model assets (multi-object OBJ supported; MTL colors supported)
- Legacy JSON scene import/export retained for compatibility
- Texture library
- OGG audio library and mixer panel (manifest-backed `assets/sound/` browser)
- Background music, crossfades, looping, queued/overlap/replace action cues, polyphony limits, cooldowns, preview playback, and 2D/3D spatial sound

### Anime Aesthetic & Raytracing
- Toon / cel shading with configurable light threshold and shade color
- **Raytraced hard directional shadows** (BVH-accelerated, cached by geometry signature)
- Flat face coloring, optional textures with UV transforms
- Wireframe / solid / material / anime render modes

### Audio Engine
- `AudioManager` uses browser Web Audio with lazy initialization for autoplay-policy compatibility.
- Four buses (`music`, `sfx`, `ui`, `voice`) plus a master bus, each with volume/mute controls and a safety compressor.
- Playback handles support pause, resume, seek, loop, playback rate, fade, and optional 3D positioning.
- `assets/sound/index.json` is the OGG manifest; `tools/build-sound-manifest.mjs` scans `assets/sound/*.ogg`. The packaged manifest is also embedded in `index.html` so the library works when the editor is opened directly from `file://`. Packaged `file://` OGGs use direct HTML media playback instead of `MediaElementSource`, avoiding Chromium's local-file Web Audio muting behavior; normal HTTP/blob audio keeps the full Web Audio mixer path.
- Scene audio configuration is exported into scene JSON, including background music and action cues.

### Game Engine / Runtime
- `GameRuntime` – drop-in play mode that disables heavy editor UI
- Simple input manager (keyboard + mouse)
- Fly / orbit camera controls (WASD + mouse)
- Runtime audio helpers: `rt.playSound(...)`, `rt.queueSound(...)`, and `rt.triggerAudioAction(...)`
- Lightweight AABB physics + gravity for platformer-style prototypes
- Per-object update scripts
- Press **P** or **F5** to enter Play mode, **Esc** to return to Editor

### Performance Optimizations (thousands of objects, lag-free transforms)
- **Cached model matrices** – only recomputed when transform actually changes
- **Frustum culling** uses cached local bounding spheres transformed into world space; it is conservative under rotation/non-uniform scale
- **Front-to-back opaque sorting** improves GPU early-Z rejection
- **Hardware back-face culling** skips hidden opaque faces; materials can opt into double-sided rendering
- **GPU instancing** for repeated geometry with per-instance material colors, so thousands of differently colored copies can share the same GPU geometry
- **Dirty-flag system** – geometry / UVs / materials / selection / skeleton only rebuild what changed
- **Shadow BVH cache** – rebuild only when geometry or transforms of toon meshes change
- **Incremental asset registration** – full scene asset refresh deferred (not on every gizmo drag)
- **Batched primitive creation** with yield points so the UI stays responsive when spawning 10k+ objects
- Transform end no longer forces full hierarchy + asset rebuild for small selections
- **Virtualized hierarchy** renders only the visible rows, so scenes with thousands of objects do not create thousands of live DOM nodes
- **Compact inspector navigation** edits one face/vertex at a time instead of generating a control for every polygon and vertex
- **Targeted transform history** records only the meshes/components actually moved; drag history no longer serializes the whole scene on pointer-down/up
- **Fast component editing** updates shared vertices, affected normals, and only the changed GPU buffer ranges in place
- **Accelerated object picking** uses object bounds directly in object mode instead of traversing every face
- **Static merged mesh fast-load path** skips editor edge adjacency/polygon Proxy construction and builds GPU render buffers directly
- Static merged meshes expose a lazy compatibility polygon view so inspecting them does not materialize the full topology unless actually needed
- **Import-shell meshes** skip legacy polygon Proxy construction until component editing actually needs it
- **Batch scene insertion** avoids thousands of reactive-array revision updates while importing large scenes
- **Startup persistence fast path** avoids rewriting or deep-cloning the already structured-cloned IndexedDB scene on every launch
- **Loading screen with live progress** keeps the page responsive and shows object-load progress in the lower-right percentage readout
- **Camera/world-bounds cache** avoids repeated model-matrix math during frustum culling
- **Animation update cache** skips scanning/updating thousands of meshes when no animation is playing
- **Gizmo redraw cache** avoids repainting the 2D overlay when nothing visual changed

## OBJ Workflow

- **Import OBJ Scene** accepts an `.obj` file and an optional companion `.mtl` file.
- **Import OBJ model / scene** in Assets accepts multi-object OBJ files and creates one Mesh per OBJ object.
- **Export OBJ + MTL** writes the current authored meshes as separate OBJ objects and generates a companion material library. Object transforms are baked into the exported vertex positions.
- **Legacy JSON** remains available when the engine-specific scene features (lighting, audio, prefabs, animation metadata) need to be preserved exactly.

## Included Tokyo OBJ

- `assets/Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.obj` contains the latest Tokyo map as separate OBJ objects.
- `assets/Tokyo_Flat_Stylized_Anime_Modern_UprightTreesBuildings_CrystalsInverted.mtl` contains the flat/toon material colors.
- The export preserves the source face winding, so the crystals remain inverted while the upright trees, pillars, and buildings remain correctly oriented.

## Quick Start

```bash
# Serve the folder (any static server)
npx serve .
# or python -m http.server
```

Open the page. Default scene contains a cube.

### Adding OGG sounds

Place `.ogg` files in `assets/sound/`, then rebuild the manifest:

```bash
node tools/build-sound-manifest.mjs
```

Open the **Audio** panel to preview sounds, choose background music, set mixer levels, and author action cues. The panel also has **Choose OGG Files** for loading local OGG files directly into the current session. Action cues can be triggered by runtime scripts, for example:

```js
rt.triggerAudioAction('player.jump', { position: [x, y, z] });
```

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
- Scene documents persist in IndexedDB via `SceneManager`, so large imported maps are not limited by the browser's small `localStorage` quota. Older `localStorage` scene data is migrated automatically on first launch. `localStorage` remains available only as a fallback when IndexedDB is unavailable.
- All shading is intentionally flat / toon-first; raytracing is used for clean anime shadows rather than photorealism.

Built for speed, clarity, and the distinctive look of anime 3D.

## Large merged scene support

Imported scenes may use `bakeFaceColors: true` plus `staticOptimized: true` to keep flat per-face color while rendering the entire opaque mesh in a single draw call. Scene serialization converts runtime-observed Proxy arrays to plain arrays before IndexedDB/local persistence because `structuredClone()` cannot clone Proxy objects. The static importer skips editor-only topology work that can otherwise freeze the browser on very large meshes. Large meshes automatically use 32-bit element indices when `OES_element_index_uint` is available. Very dense anime scenes skip expensive per-face raytraced shadows above 20,000 triangles.


### Built-in OGG playback
Packaged OGG assets are embedded for deterministic playback when the editor is launched directly from `file://`; imported OGG files continue to use Blob URLs.


## Editor performance
The editor uses batched in-place vertex edits for drag operations, partial WebGL buffer uploads, selection-aware multi-component transforms, cached shadow signatures, throttled DOM status updates, virtualized hierarchy rendering, compact inspector navigation, targeted transform history, accelerated object picking, and formal independently scrollable editor panels. Large static meshes avoid rebuilding editor topology during normal rendering.

A local performance benchmark on a 6,400-face grid moving 100 vertices across 100 drag updates measured approximately **10.4 s** for the old full-rebuild approach versus **0.05 s** for the in-place path (about **203× faster** in that test). Actual gains vary with mesh size, GPU, and browser.

### Startup and frame-time optimization
The engine now loads large scenes in responsive chunks, avoids redundant IndexedDB writes/deep copies on startup, delays built-in audio initialization, preloads the core shaders, and shows a live loading overlay. The previous aggressive instance grouping could collapse thousands of differently shaded objects into a few huge batches and increase GPU overdraw; the current renderer restores material-aware grouping and smaller 512-instance batches to avoid that regression. Rendering uses cached visibility plans, GPU instancing with per-instance color, material/face-state-aware instance grouping, front-to-back ordering inside instance batches, reusable instance upload buffers, cached world-space culling bounds, a no-MSAA high-performance WebGL context, and skips per-frame animation scans when the scene is static.
