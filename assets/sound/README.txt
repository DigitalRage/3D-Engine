OGG SOUND LIBRARY
=================

Put .ogg files in this folder, then run:

  node tools/build-sound-manifest.mjs

The editor's Audio panel reads assets/sound/index.json and exposes every
listed OGG as a selectable sound for previews, background music, and action
cues.

You can also edit index.json manually. Each asset supports:
  id       Stable identifier used by scripts/scenes
  name     Editor-friendly display name
  path     File name/path relative to assets/sound
  loopable Optional boolean
  tags     Optional string array
  volume   Optional base gain (0..1)
