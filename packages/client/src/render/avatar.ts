// The shared avatar body — a stylized low-poly humanoid. Used by BOTH WorldView (players)
// and NpcView (the crowd) so a disguised player renders with the EXACT same mesh as the
// NPCs they blend among (PROJECT_BRIEF §1 — "anyone could be the spy"). The agent's identity
// is therefore NOT in the silhouette (that would leak who's a player); it shows in the HUD.
// Tier is conveyed by COLOUR (WorldView/NpcView tint `material`), so a single shape serves
// every tier and a disguise swap is a pure recolour — no tell.
//
// The whole figure is MERGED into one BufferGeometry → one Mesh + one material, preserving
// the { group, body, material } contract the views drive (tier tint, reveal/downed/cloak/
// invulnerable styling all manipulate that single material/mesh).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const AVATAR_RADIUS = 0.4;
export const AVATAR_HEIGHT = 1.8;

export interface AvatarBody {
  group: THREE.Group;
  body: THREE.Mesh;
  /** The shared material — colour it by tier; the whole figure reuses it for a uniform look. */
  material: THREE.MeshStandardMaterial;
}

/** A box of size (w,h,d) translated to (x,y,z), as a standalone geometry to be merged. */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * Build a fresh, white low-poly humanoid CENTRED on the group origin (feet near -H/2, head
 * near +H/2 — the views position the group at render.y + AVATAR_HEIGHT/2, so feet land on the
 * ground). A small brow/visor on the +Z face keeps facing readable. Caller adds it to a
 * scene/group and colours by tier.
 */
export function buildAvatarBody(): AvatarBody {
  const group = new THREE.Group();

  // y runs from about -0.9 (feet) to +0.85 (head top). All parts share one material.
  const parts: THREE.BufferGeometry[] = [
    box(0.2, 0.82, 0.24, -0.12, -0.49, 0), // left leg
    box(0.2, 0.82, 0.24, 0.12, -0.49, 0), // right leg
    box(0.52, 0.64, 0.3, 0, 0.02, 0), // torso
    box(0.15, 0.6, 0.2, -0.34, 0.04, 0), // left arm
    box(0.15, 0.6, 0.2, 0.34, 0.04, 0), // right arm
    box(0.46, 0.12, 0.28, 0, 0.38, 0), // shoulders
    box(0.18, 0.14, 0.18, 0, 0.47, 0), // neck
    box(0.34, 0.34, 0.32, 0, 0.66, 0), // head
    box(0.36, 0.09, 0.12, 0, 0.66, 0.18), // brow/visor (reads facing, +Z front)
  ];

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();

  // Flat-shaded stylised look; the views tint `color`/`emissive`/`opacity` per tier + state.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.06,
    flatShading: true,
  });
  const body = new THREE.Mesh(merged, material);
  body.castShadow = true;
  group.add(body);

  return { group, body, material };
}
