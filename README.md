# Salvage Studio

A ground-up replacement for the previous custom renderer/editor. The old engine is not part of this project.

## Rendering base

This build uses a self-contained WebGL2 renderer written for Salvage Studio. There are no CDN imports, no import maps, and no runtime dependency on npm packages, so the editor can boot from the extracted folder without waiting for a third-party engine download.

The renderer uses one persistent shader pipeline, cached procedural meshes, instanced draw calls, camera-space culling, a reusable instance buffer, and a separate dynamic character path.

## Editor features

- Scene hierarchy
- Object creation: box, sphere, capsule, cylinder, cone, torus, plane, empty, directional light
- Selection and inspector
- Transform editing for position, rotation and scale
- Static/dynamic render selection
- Static batch group for authored environment geometry
- Scene export to JSON
- Play/Stop mode isolation
- Orbit camera with drag, shift-drag pan and wheel zoom
- Third-person character with movement-facing rotation
- Procedural exploration world rebuilt from scratch
- Distinct world zones and landmarks
- Runtime HUD and objective/status information

## Performance architecture

- WebGL2 instanced rendering for repeated world geometry
- Persistent shader program and procedural mesh caches
- One reusable per-instance matrix buffer
- Camera-side conservative depth culling without per-frame object-tree rebuilds
- Separate runtime character transforms from editor scene objects
- Capped simulation delta so stalls cannot create runaway physics updates
- Device pixel ratio capped at 1.5 to avoid needless fill-rate costs
- World layout organized into large sectors for future streaming/HLOD systems

## Run

The editor can be opened directly from the extracted folder. A local HTTP server is still recommended when integrating external assets later.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/`.

## Controls

Editor: Q Select, W Move, E Rotate, R Scale. Drag to orbit. Shift-drag to pan. Wheel to zoom. Delete removes the selected object. Ctrl/Cmd+S exports the scene.

Play mode: WASD moves relative to the camera, Shift sprints, Space is reserved for jump extension, drag orbits the third-person camera, Escape exits.


## Boot reliability

The landing page uses a normal local JavaScript file. The editor does not import a CDN, does not use an import map, and does not require npm or an online engine package to open. WebGL2 initialization happens directly after the Open Editor action.
