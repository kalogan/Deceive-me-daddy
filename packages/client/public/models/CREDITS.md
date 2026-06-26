# Model attribution

External character models bundled for the preview harness's **Models** tab (an evaluation tool
for comparing our procedural avatar against asset-based glTF/GLB models). These are NOT used by
the game itself — only the preview (`preview.html`) loads them.

- **RobotExpressive.glb** — by Tomás Laulhé / Quaternius, CC0 (Public Domain), via the three.js
  examples (`examples/models/gltf/RobotExpressive/`).
- **Fox.glb** — model by PixelMannen (CC0); rig + animation © 2014 tomkranis (CC-BY 4.0); glTF
  conversion © 2017 @AsoboStudio & @scurest (CC-BY 4.0). Via the Khronos glTF Sample Assets
  (`Models/Fox/`).
- **CesiumMan.glb** — © 2017 Cesium, CC-BY 4.0. Via the Khronos glTF Sample Assets
  (`Models/CesiumMan/`).
- **RiggedFigure.glb** — © 2017 Cesium, CC-BY 4.0. Via the Khronos glTF Sample Assets
  (`Models/RiggedFigure/`).

## Adding another CC0 pack

1. Drop the `.glb` (or `.gltf` + buffers) under `packages/client/public/models/`.
2. Add an entry to `ASSET_MODELS` in `packages/client/src/render/assetModels.ts`
   (id, name, `url: '/models/<file>.glb'`, license, credit, optional `targetHeight`,
   `idleClip` / `walkClip`, `tint.strength`).
3. Credit the source here.

The Models picker, recolor demo, and animation toggle pick it up automatically — no other code
changes. Only use assets whose licence permits redistribution (e.g. CC0 / public domain).
