# Architecture

Salvage Studio deliberately does not share code with the previous custom renderer.

`PlayCanvas Engine -> Scene graph -> WorldBuilder -> Editor facade -> Play mode controller`

The editor is an authoring layer over a production renderer rather than a renderer pretending to be an editor.

Future expansions should live behind these seams:

- `AssetPipeline`: glTF/GLB import, texture compression, mesh LOD generation, thumbnails, dependency tracking
- `WorldStreamer`: sector manifest, asynchronous cell loading, hysteresis and memory budget
- `GameplayRuntime`: fixed-step simulation, controller, camera, navigation and gameplay scripts
- `UndoStack`: command-based scene edits
- `ProjectIO`: versioned scene/material/prefab files
- `GizmoLayer`: viewport gizmos and snapping
- `Profiler`: CPU/GPU/frame graph and draw-call breakdown
