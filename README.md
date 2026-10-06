# Lightweight 3D Engine - Potato Edition

A rebuilt WebGL editor/runtime focused on three things: real 3D model integrity, usable textures, and surviving very large low-poly scenes on weak hardware.

## Rendering architecture

- WebGL 2 is preferred, with WebGL 1 + ANGLE instancing fallback.
- Core shaders are bundled in `engine/render.js`, so local `file://` launches do not wait on shader fetches.
- Static opaque geometry is merged into spatial GPU batches at runtime when its material/UV state is batch-compatible. The editor still keeps every source object separate and editable.
- Dynamic, selected, skinned, transparent, and texture-incompatible meshes keep their individual rendering paths. Compatible static albedo textures can be batched too.
- Frustum culling operates on both ordinary meshes and static batches.
- Hardware instancing remains available for repeated dynamic geometry.
- Adaptive render resolution can automatically reduce internal resolution when frame time rises, then recover quality when the GPU has headroom.
- Manual Render Resolution is available from 35% to 100%.
- Texture uploads use linear filtering, WebGL2 NPOT mipmaps, and up to 4x anisotropic filtering when the GPU exposes it.

## Textures

The engine can import image files through the Assets panel and assign them to faces/materials. OBJ + MTL imports now understand `map_Kd` references when the corresponding image files are selected alongside the OBJ/MTL files.

OBJ remains the primary interchange format. The engine does not ship the old large JSON map files. The small audio manifest JSON is retained because it is an asset index, not a scene/map format.

## Player

The project retains the low-poly anime silhouette player, skeleton, third-person camera, animation system, jumping, sprinting, and camera-relative controls.

## Optimization pass

- Large OBJ files are parsed directly from `ArrayBuffer` bytes instead of first splitting a 15+ MB string into thousands of line strings. The approach is broadly similar to the byte-oriented strategy used by fast OBJ parsers such as `kig/ObjParse`, but the parser here is integrated specifically with this engine's material/color/UV data model.
- Large static imports go straight through `setStaticTopology()` instead of constructing editor adjacency/proxy data and then rebuilding the same render data a second time.
- Static batches use pre-sized typed arrays and can share a compatible albedo texture rather than forcing every textured mesh down the unbatched path.
- Once static batches exist, camera movement only evaluates dynamic render candidates instead of walking the complete source-mesh list.
- Play-mode-only runtime/player modules are loaded on demand, keeping them out of initial startup parsing.
- `tests/tokyo-load-benchmark.js` performs a warmed median benchmark over the complete OBJ parse + static render-buffer build path. On the optimization machine, the latest shipped-tree median is 349.64 ms versus the pre-optimization 969.2 ms reference, a measured 2.77x speedup for this workload.


### Rotation-heavy rendering

The renderer is optimized for camera rotation as the normal case rather than assuming a static viewport:

- Camera view/projection matrices are cached in reusable typed arrays. A mouse rotation rebuilds only the view matrix and one combined view-projection matrix.
- Frustum planes are extracted directly from the cached view-projection matrix, avoiding a second matrix multiplication and temporary plane arrays each frame.
- Render-plan generation is scene-driven instead of camera-driven. Opaque commands are built once per scene/render-state change, then cheaply visibility-tested every frame.
- Opaque depth sorting was removed from the rotation hot path. With depth testing enabled, repeatedly sorting hundreds or thousands of opaque commands while the camera turns was pure CPU overhead for this engine's workload.
- Dynamic mesh world-space bounding spheres are cached and reused for frustum tests. Transparent face world centers are also cached between camera frames, with only their camera distance resorted when needed.
- Hardware-instanced groups cache their per-instance transform/color buffer. Camera-only frames no longer regenerate or upload instance matrices.
- Static batches use persistent interleaved VAOs and a dedicated world-space shader. Static geometry therefore avoids model-matrix transforms, instancing branches, and repeated vertex-attribute setup.
- The default internal render scale is 75% instead of 60%, while adaptive quality can reduce it automatically on slower hardware.

The latest rotation benchmarks report a 0.021 ms median CPU render cost for the 8,393-object Tokyo scene and 0.049 ms for a 2,200-mesh dynamic rotation stress test after warm-up. These are CPU-side engine measurements; actual FPS still depends on the user's GPU, resolution, shader cost, and scene content.

## Performance philosophy

The editor and runtime deliberately use different representations when useful: editable source objects remain separate, while the renderer is allowed to create transient GPU batches. This avoids the earlier tradeoff where merging the scene for speed destroyed editability.

## Validation

The complete JavaScript test set passes 63/63 tests. The Tokyo OBJ contains 8,393 separate objects and 239,754 render triangles.


## Open-world runtime architecture

The runtime now maintains a conservative spatial grid for dynamic renderables and static batches. Camera rotation reuses the same broad-phase candidate set as long as the camera remains in the same world cell; only the cheap frustum test changes. Translation updates the candidate set without scanning every object in the world.

WebGL 2 uses a reversed-Z depth buffer with reusable camera matrices to greatly increase depth precision across long view distances and reduce z-fighting in open-world scenes. Automatic dynamic-resolution changes are opt-in and rate-limited so the drawing buffer is not repeatedly resized during camera movement.

Imported static meshes automatically detect strongly inconsistent winding and enable two-sided rendering for those assets instead of silently dropping their back-facing polygons.

## Open-world foundation

The engine now exposes `engine/index.js` as a public runtime entry point and includes a location-driven `WorldPartition` streamer. A game can register world cells with asynchronous load/unload callbacks, a bounded number of simultaneous I/O jobs, optional forward preloading, and a larger unload radius than load radius so crossing a cell boundary does not immediately thrash memory and VRAM.

Example:

```js
import { Renderer, Scene, Camera, GameRuntime, WorldPartition } from './engine/index.js';

const world = new WorldPartition({
    cellSize: 256,
    loadRadius: 2,
    unloadRadius: 3,
    maxConcurrentLoads: 2,
    preloadForwardCells: 1
});

world.registerCell('city-0-0', {
    x: 0,
    z: 0,
    data: { sceneUrl: '/world/city-0-0.bin' },
    async load(data) {
        // Fetch/decode the cell and add its meshes to your Scene here.
    },
    async unload(data) {
        // Remove the cell's meshes and release its GPU resources here.
    }
});

const runtime = new GameRuntime(renderer, scene, camera, { worldPartition: world });
```

`GameRuntime` calls the partition from the frame loop without awaiting it, so streaming work does not stall rendering. The partition uses O(1) X/Z cell lookup with load/unload hysteresis and is intended to be paired with the renderer's spatial grid, static batching, and frustum culling. Physics now keeps a dense body list and reuses nearby-collider scratch storage, avoiding repeated scene scans during movement.

### Correctness fixes in the rotation pass

- Fixed the dynamic render-candidate filter that accidentally excluded the very meshes that were supposed to remain on the dynamic path. This directly caused the reported symptom where collision could still see geometry that the renderer had discarded.
- Geometry changes now invalidate local bounds and the scene spatial index before culling. Rebuilt meshes therefore cannot inherit a zero-radius or stale culling sphere.
- Imported topology now protects consistently inward-wound components from back-face culling. Normal outward-wound components still keep normal back-face culling for performance.
- Added a one-frame culling grace period. A mesh that was visible on the previous frame is allowed one additional frame when its conservative bound lands exactly outside a frustum plane. This reduces rotational edge popping without disabling culling.
- Editor transform fields now use the engine's transform invalidation path, keeping world bounds, spatial indexing, static-batch eligibility, and render revisions synchronized.
- Static-batch eligibility is invalidated in both directions. A mesh that becomes batchable after an edit is no longer permanently stranded on the dynamic path.

### Current validation

The complete test suite passes with 63 tests. The latest shipped-tree Tokyo load median is 349.64 ms versus the 969.2 ms pre-optimization reference, about 2.77x faster. The latest rotation-hot-path median is 0.027 ms and the 2,200-mesh dynamic rotation stress median is 0.051 ms on this machine after warm-up. These CPU measurements are not a substitute for hardware-specific GPU FPS.

The browser container used for this development environment cannot initialize a working ANGLE/EGL graphics backend, so hardware GPU frame-rate claims are intentionally not included.
