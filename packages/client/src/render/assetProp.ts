// Shared GLB-PROP LOADER. Loads an external glTF/GLB set-piece, scale-normalises it via its bounding
// box, seats it on the ground (+ centres it on X/Z), and plays EVERY baked clip so animated props
// move. Used by BOTH the Props preview tab (render in a gallery) and the in-map prop layer (render in
// a live MapView) — one implementation, no fork. A shared DRACOLoader is attached so DRACO-compressed
// assets (e.g. LittlestTokyo) decode; its decoder files are served from public/draco/.
//
// Materials are CLONED on load so we never mutate three's shared GLTF cache and disposal is leak-safe.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { fitScale } from './assetCharacter';

/** Default normalised height (metres) when none is given. */
export const PROP_DEFAULT_HEIGHT = 2;

/** A loaded prop: its scene group (feet at y = 0, centred on X/Z), clip names, an animation pump
 *  + leak-free disposal. */
export interface LoadedProp {
  readonly group: THREE.Object3D;
  readonly clips: readonly string[];
  update(dt: number): void;
  dispose(): void;
}

/**
 * A shared DRACO decoder, created lazily + reused (so we don't spin a decoder worker per load). The
 * decoder files live in public/draco/ (three's `libs/draco/gltf/`), served as static assets.
 */
let _draco: DRACOLoader | null = null;
function dracoLoader(): DRACOLoader {
  if (!_draco) {
    _draco = new DRACOLoader();
    _draco.setDecoderPath('/draco/');
  }
  return _draco;
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * Load + normalise a glTF/GLB prop. Async (network + parse). Scale-normalises so the bounding-box
 * height equals `targetHeight`, drops it onto the ground (min.y → 0) and centres it on X/Z, then plays
 * every baked clip. Geometries + cloned materials are tracked for leak-free disposal.
 */
export async function loadAssetProp(
  url: string,
  opts: { targetHeight?: number } = {},
): Promise<LoadedProp> {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader());
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;

  // Clone materials (never mutate three's shared GLTF cache); collect geometries for disposal.
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const src = mesh.material;
    const cloneOne = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      materials.add(c);
      return c;
    };
    if (Array.isArray(src)) mesh.material = src.map(cloneOne);
    else if (src) mesh.material = cloneOne(src);
  });

  // Scale-normalise to the target height, then seat on the ground + centre on X/Z.
  _box.setFromObject(model);
  _box.getSize(_size);
  model.scale.setScalar(fitScale(_size.y, opts.targetHeight ?? PROP_DEFAULT_HEIGHT));
  _box.setFromObject(model);
  model.position.y -= _box.min.y;
  model.position.x -= (_box.min.x + _box.max.x) / 2;
  model.position.z -= (_box.min.z + _box.max.z) / 2;

  // Play every baked clip (props are set-dressing — no idle/walk selection, just "alive").
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations.map((c) => c.name);
  for (const clip of gltf.animations) mixer.clipAction(clip).play();

  return {
    group: model,
    clips,
    update: (dt) => mixer.update(dt),
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      model.removeFromParent();
    },
  };
}
