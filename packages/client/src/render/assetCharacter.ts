// The ASSET-CHARACTER framework (preview-only): load an external glTF/GLB, scale-normalise it, drive
// its baked clips through an AnimationMixer, and RECOLOR its materials — all behind a controllable
// surface that PARALLELS the procedural avatar (render/avatar.ts) so the Models preview tab can drive
// EITHER the same way (setTier / setBrightness / setOpacity / setEmissive / animate / dispose).
//
// This proves the "modular, asset-based" path is feasible in our engine: a CC0 Quaternius model loads
// via three's GLTFLoader, normalises to a target height via its bounding box, plays Idle/Walk clips,
// and accepts our clearance-tier colours on top of its own materials. It is NOT wired into the match —
// only the preview imports it, so the game (index.html) bundle is unaffected.
//
// Defensive recolor: we CLONE each material on load (so we never mutate three's shared GLTF-cached
// materials, and disposal is leak-safe), remember each clone's BASE colour, and only touch materials
// that look like MeshStandardMaterial/MeshPhysicalMaterial (they carry a `.color`/`.emissive`).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetModelDef } from './assetModels';

// --- Pure helpers (exported + unit-tested; data-in / data-out, minimal THREE) -------------------

/** Default normalised height (metres) when a def omits `targetHeight` — matches the avatar height. */
export const ASSET_DEFAULT_HEIGHT = 1.8;

/** Above this planar speed (m/s) the character plays its WALK clip; below, its IDLE clip. */
export const ASSET_WALK_THRESHOLD = 0.15;

/**
 * Uniform scale factor that makes a model of bounding-box height `bboxHeight` stand `targetHeight`
 * tall. Degenerate/empty boxes (height ≤ 0) return 1 so we never divide by zero or flip the model.
 */
export function fitScale(bboxHeight: number, targetHeight = ASSET_DEFAULT_HEIGHT): number {
  if (!(bboxHeight > 0) || !(targetHeight > 0)) return 1;
  return targetHeight / bboxHeight;
}

/**
 * Choose which baked clip to play for a given planar speed, by NAME from the def, tolerating models
 * whose clips are named differently or absent. Returns the chosen clip name, or null when the model
 * ships no clips (the caller then no-ops the mixer). Pure: takes clip names + speed + def.
 *
 *  - speed > threshold  → the def's walkClip if present, else idleClip, else the first clip.
 *  - otherwise          → the def's idleClip if present, else the first clip.
 *  - a named clip that isn't actually present falls back to the first available clip.
 */
export function pickClip(
  clipNames: readonly string[],
  speed: number,
  def: Pick<AssetModelDef, 'idleClip' | 'walkClip'>,
  threshold = ASSET_WALK_THRESHOLD,
): string | null {
  if (clipNames.length === 0) return null;
  const first = clipNames[0] ?? null;
  const has = (name: string | undefined): string | null =>
    name !== undefined && clipNames.includes(name) ? name : null;

  if (speed > threshold) {
    return has(def.walkClip) ?? has(def.idleClip) ?? first;
  }
  return has(def.idleClip) ?? first;
}

// --- The controllable asset character -----------------------------------------------------------

/**
 * An asset-loaded character, mirroring the procedural AvatarBody's controllable surface so the
 * preview can drive both interchangeably.
 */
export interface AssetCharacter {
  /** The loaded model, scale-normalised to the def's target height, feet at y = 0. */
  readonly group: THREE.Object3D;
  /** The model's name + licence + credit, for the inspector's attribution panel. */
  readonly def: AssetModelDef;
  /** Clip names baked into the model (for debugging / the info panel). */
  readonly clips: readonly string[];
  /** Drive the AnimationMixer: blend to walk above the speed threshold, else idle. `dt` seconds. */
  animate(dt: number, speed: number): void;
  /** Blend EVERY recolorable material toward the tier hue by the def's tint strength. */
  setTier(hex: number): void;
  /** Multiply EVERY material's colour from its remembered BASE (downed/out dimming). 1 = full. */
  setBrightness(mult: number): void;
  /** Set opacity + transparent on EVERY recolorable material (downed ghost / cloak). */
  setOpacity(opacity: number): void;
  /** Set emissive colour + intensity on EVERY recolorable material (invuln gold shell). */
  setEmissive(hex: number, intensity: number): void;
  /** Stop the mixer + dispose every geometry + every CLONED material (no leaks). */
  dispose(): void;
}

/** A material that carries a `.color` (Standard/Physical/Basic/Lambert/Phong) — what we recolor. */
type ColorMaterial = THREE.Material & {
  color: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/** A cloned material plus its remembered BASE colour so brightness/tier are re-derived, not stacked. */
interface TrackedAssetMat {
  readonly material: ColorMaterial;
  readonly base: THREE.Color;
}

/** Narrow to a material we can safely recolor (has a Color `.color`). Defensive across loaders. */
function isColorMaterial(mat: THREE.Material): mat is ColorMaterial {
  return (mat as { color?: unknown }).color instanceof THREE.Color;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * Load a glTF/GLB character and wrap it in the controllable AssetCharacter surface. Async (network +
 * parse). Scale-normalises via the bounding box, drops feet to y = 0, clones + tracks all materials
 * for recolor, and wires an AnimationMixer over the baked clips.
 */
export async function loadAssetCharacter(def: AssetModelDef): Promise<AssetCharacter> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(def.url);
  const model = gltf.scene;

  // ---- Clone materials so we never mutate three's shared GLTF cache, then track each with its base
  // colour. A geometry list is collected for leak-free disposal. We touch only colour materials.
  const tracked: TrackedAssetMat[] = [];
  const geometries = new Set<THREE.BufferGeometry>();

  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const src = mesh.material;
    // Clone per mesh-slot so each draw owns its material — we never mutate three's shared GLTF
    // cache, and disposal is leak-safe.
    const cloneOne = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      if (isColorMaterial(c)) tracked.push({ material: c, base: c.color.clone() });
      return c;
    };
    if (Array.isArray(src)) {
      mesh.material = src.map(cloneOne);
    } else if (src) {
      mesh.material = cloneOne(src);
    }
  });

  // ---- Scale-normalise to the target height via the bounding box, then drop feet to y = 0.
  _box.setFromObject(model);
  _box.getSize(_size);
  const scale = fitScale(_size.y, def.targetHeight ?? ASSET_DEFAULT_HEIGHT);
  model.scale.setScalar(scale);
  // Recompute the box at the new scale to seat the feet exactly on the ground.
  _box.setFromObject(model);
  model.position.y -= _box.min.y;

  // ---- Animation: a mixer over the baked clips, indexed by name. We crossfade between the active
  // idle/walk action and the next one when the chosen clip changes (no per-frame allocation).
  const mixer = new THREE.AnimationMixer(model);
  const clipNames: string[] = gltf.animations.map((c) => c.name);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    actions.set(clip.name, action);
  }
  let current: THREE.AnimationAction | null = null;
  let currentName: string | null = null;

  const animate = (dt: number, speed: number): void => {
    const wanted = pickClip(clipNames, speed, def);
    if (wanted !== null && wanted !== currentName) {
      const next = actions.get(wanted);
      if (next) {
        next.reset();
        next.enabled = true;
        next.setEffectiveWeight(1);
        next.play();
        if (current && current !== next) {
          // Quick crossfade so idle↔walk reads smoothly; reuses the existing actions (no alloc).
          current.crossFadeTo(next, 0.25, false);
        }
        current = next;
        currentName = wanted;
      }
    }
    mixer.update(dt);
  };

  // ---- Recolor API, mirroring the procedural avatar. brightness is re-derived from each base so the
  // operations are order-independent + idempotent.
  let brightness = 1;
  const tierColor = new THREE.Color(0xffffff);
  let tierStrength = 0; // 0 until setTier is called; def.tint.strength sets how far we blend
  const tmp = new THREE.Color();

  const applyColors = (): void => {
    for (const tm of tracked) {
      // base * brightness, then blend toward the tier hue by the configured strength.
      tmp.copy(tm.base).multiplyScalar(brightness);
      if (tierStrength > 0) tmp.lerp(tierColor, tierStrength);
      tm.material.color.copy(tmp);
    }
  };

  const setTier = (hex: number): void => {
    tierColor.set(hex);
    tierStrength = def.tint?.strength ?? 0.5;
    applyColors();
  };

  const setBrightness = (mult: number): void => {
    brightness = mult;
    applyColors();
  };

  const setOpacity = (opacity: number): void => {
    const transparent = opacity < 1;
    for (const tm of tracked) {
      tm.material.opacity = opacity;
      tm.material.transparent = transparent;
      tm.material.needsUpdate = true;
    }
  };

  const setEmissive = (hex: number, intensity: number): void => {
    for (const tm of tracked) {
      if (tm.material.emissive) {
        tm.material.emissive.set(hex);
        tm.material.emissiveIntensity = intensity;
      }
    }
  };

  const dispose = (): void => {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    for (const g of geometries) g.dispose();
    for (const tm of tracked) tm.material.dispose();
    model.removeFromParent();
  };

  return {
    group: model,
    def,
    clips: clipNames,
    animate,
    setTier,
    setBrightness,
    setOpacity,
    setEmissive,
    dispose,
  };
}
