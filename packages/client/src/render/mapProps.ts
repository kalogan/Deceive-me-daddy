// The IN-MAP PROP LAYER. Turns a content pack's authored `props` placements into rendered glTF/GLB
// set-pieces inside a live MapView. Each placement names a prop-registry id (render/propModels); we
// resolve it to a served GLB, load it via the shared loader (render/assetProp), normalise it to the
// registry's display height, then position / rotate / scale it per the placement.
//
// MapView DYNAMICALLY imports this module (only when a pack actually has props), so the base game
// bundle stays free of GLTFLoader/DRACOLoader — the import + GLB cost is paid only on prop-bearing
// maps (today: the Sandbox test range). Unknown prop ids are warned + skipped, never fatal.
import * as THREE from 'three';
import type { PropPlacement } from '@deceive/shared';
import { loadAssetProp, type LoadedProp } from './assetProp';
import { propModelById } from './propModels';

/** A mounted prop layer: a single group to add to the map root, an animation pump + disposal. */
export interface MapPropLayer {
  readonly group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

/**
 * Load + place every prop in `placements`. Resolves each id via the prop registry, loads the GLB,
 * wraps it in a transform holder (so the placement's scale multiplies the already-normalised model
 * without disturbing its ground-seating), and parents it under one group. Placements that fail to
 * load (or name an unknown prop) are skipped with a console warning — a bad prop never breaks the map.
 */
export async function loadMapProps(placements: readonly PropPlacement[]): Promise<MapPropLayer> {
  const group = new THREE.Group();
  const loaded: LoadedProp[] = [];

  await Promise.all(
    placements.map(async (p) => {
      const def = propModelById(p.prop);
      if (!def) {
        console.warn(`[mapProps] unknown prop id "${p.prop}" (placement "${p.id}") — skipping`);
        return;
      }
      try {
        const prop = await loadAssetProp(def.url, { targetHeight: def.displayHeight });
        // Wrap so the placement transform multiplies the normalised model (feet stay on the holder
        // origin). The holder is positioned at the authored point, yawed, and uniformly scaled.
        const holder = new THREE.Group();
        holder.add(prop.group);
        holder.position.set(p.position[0], p.position[1], p.position[2]);
        holder.rotation.y = p.rotationY;
        holder.scale.setScalar(p.scale);
        group.add(holder);
        loaded.push(prop);
      } catch (err) {
        console.warn(`[mapProps] failed to load prop "${p.prop}" (placement "${p.id}")`, err);
      }
    }),
  );

  return {
    group,
    update: (dt) => {
      for (const p of loaded) p.update(dt);
    },
    dispose: () => {
      for (const p of loaded) p.dispose();
      group.removeFromParent();
    },
  };
}
