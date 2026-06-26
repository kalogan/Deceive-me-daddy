// The ASSET-MODEL REGISTRY (preview-only, the MODULAR SEAM). This is pure DATA: a list of external
// glTF/GLB character packs the preview can load + recolor + animate via render/assetCharacter. It is
// the single place you EXTEND to add another CC0 pack — drop a `.glb` under public/models, add a
// `AssetModelDef` entry here, and the Models preview tab picks it up automatically. Nothing here is
// imported by the GAME (main.ts/WorldView/NpcView) — it rides ONLY behind preview.html.
//
// Each entry names the served URL (public/ is copied verbatim into dist/, so '/models/foo.glb' works
// in dev and in the built preview), the licence + attribution (shown in the inspector so credit is
// visible), an optional target height for scale-normalisation, the idle/walk clip names to drive the
// AnimationMixer, and an optional tint strength controlling how strongly our clearance-tier colour is
// blended into the model's materials (so the recolor demo reads on a textured asset).

export interface AssetModelDef {
  /** Stable unique id (used by the picker + `assetModelById`). */
  readonly id: string;
  /** Human-friendly name shown in the picker + info panel. */
  readonly name: string;
  /** Served URL of the GLB/glTF. `public/` is copied into `dist/`, so '/models/x.glb' resolves. */
  readonly url: string;
  /** Licence tag (e.g. 'CC0') — shown so attribution is visible in the harness. */
  readonly license: string;
  /** Full attribution line (author / source) — shown in the info panel + CREDITS.md. */
  readonly credit: string;
  /** Normalise the model so its bounding-box height equals this many metres (default 1.8). */
  readonly targetHeight?: number;
  /** Animation clip name to play at rest (falls back to the first clip if absent). */
  readonly idleClip?: string;
  /** Animation clip name to play while moving (falls back to idle if absent). */
  readonly walkClip?: string;
  /** Recolor strength: how far the materials blend toward the tier hue (0 = none, 1 = full). */
  readonly tint?: { readonly strength: number };
}

/**
 * The available asset packs. At least the CC0 RobotExpressive demo (a rigged, multi-clip Quaternius
 * model from the three.js examples) so the preview proves the loader + recolor + animation path end
 * to end. ADD A PACK by appending another entry + dropping the file under public/models.
 */
export const ASSET_MODELS: readonly AssetModelDef[] = [
  {
    id: 'robot-expressive',
    name: 'Robot Expressive',
    url: '/models/RobotExpressive.glb',
    license: 'CC0',
    credit: 'RobotExpressive.glb — by Tomás Laulhé / Quaternius (CC0), via the three.js examples.',
    targetHeight: 1.8,
    idleClip: 'Idle',
    walkClip: 'Walking',
    tint: { strength: 0.55 },
  },
  {
    id: 'fox',
    name: 'Fox',
    url: '/models/Fox.glb',
    license: 'CC0 / CC-BY 4.0',
    credit:
      'Fox.glb — model by PixelMannen (CC0), rig + animation by tomkranis, glTF conversion by @AsoboStudio & @scurest (CC-BY 4.0), via the Khronos glTF Sample Assets.',
    // A quadruped: it is longer than tall, so normalise to a shorter height than the humanoids.
    targetHeight: 1.4,
    idleClip: 'Survey',
    walkClip: 'Walk',
    tint: { strength: 0.5 },
  },
  {
    id: 'cesium-man',
    name: 'Cesium Man',
    url: '/models/CesiumMan.glb',
    license: 'CC-BY 4.0',
    credit: 'CesiumMan.glb — © 2017 Cesium (CC-BY 4.0), via the Khronos glTF Sample Assets.',
    targetHeight: 1.8,
    // Ships a single (unnamed) walk-cycle clip; idle/walk both fall back to it.
    tint: { strength: 0.6 },
  },
  {
    id: 'rigged-figure',
    name: 'Rigged Figure',
    url: '/models/RiggedFigure.glb',
    license: 'CC-BY 4.0',
    credit: 'RiggedFigure.glb — © 2017 Cesium (CC-BY 4.0), via the Khronos glTF Sample Assets.',
    targetHeight: 1.8,
    // A single (unnamed) clip; flat-shaded materials, so the tier recolor reads cleanly.
    tint: { strength: 0.6 },
  },
];

/** Look up a registered model by id. Returns undefined on a miss (pure, no THREE/DOM). */
export function assetModelById(id: string): AssetModelDef | undefined {
  return ASSET_MODELS.find((m) => m.id === id);
}
