// The shared avatar — a stylised low-poly humanoid with a lightweight PROCEDURAL RIG. Used by
// BOTH WorldView (players) and NpcView (the crowd) so a disguised player renders identically
// to the NPCs they blend among (PROJECT_BRIEF §1). Identity is NOT in the silhouette (that
// would leak who's a player); tier shows by COLOUR (the views tint `material`).
//
// Rig: the static upper body (torso/shoulders/neck/head) is one merged mesh; the two legs and
// two arms hang from pivot groups so `animate(dt, speed)` can swing them in a walk cycle (and
// rest at idle). All five meshes SHARE one material, so the views' tier-tint + reveal/downed/
// cloak/invulnerable styling (color/opacity/emissive on `material`) still drives the whole
// figure. `body` is the upper-body mesh (a representative for the views); `dispose()` frees the
// three unique geometries + the material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const AVATAR_RADIUS = 0.4;
export const AVATAR_HEIGHT = 1.8;

export interface AvatarBody {
  group: THREE.Group;
  body: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Drive the procedural walk/idle animation. `dt` seconds, `speed` in m/s (planar). */
  animate(dt: number, speed: number): void;
  /** Free all part geometries + the material. */
  dispose(): void;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** A pivot group at (x, hipY) holding `mesh` so rotating the pivot's X swings the limb. */
function limb(mesh: THREE.Mesh, x: number, pivotY: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, pivotY, 0);
  pivot.add(mesh);
  return pivot;
}

/** Build a fresh, white rigged humanoid centred on the group origin (feet near -H/2). */
export function buildAvatarBody(): AvatarBody {
  const group = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.06,
    flatShading: true,
  });

  // Static upper body — torso + shoulders + neck + head + facing brow, merged into one mesh.
  const upperParts = [
    box(0.52, 0.64, 0.3, 0, 0.02, 0), // torso
    box(0.46, 0.12, 0.28, 0, 0.38, 0), // shoulders
    box(0.18, 0.14, 0.18, 0, 0.47, 0), // neck
    box(0.34, 0.34, 0.32, 0, 0.66, 0), // head
    box(0.36, 0.09, 0.12, 0, 0.66, 0.18), // brow/visor (reads facing, +Z)
  ];
  const upperGeo = mergeGeometries(upperParts, false);
  for (const p of upperParts) p.dispose();
  upperGeo.computeVertexNormals();
  const body = new THREE.Mesh(upperGeo, material);
  body.castShadow = true;
  group.add(body);

  // Limbs: one leg geometry (shared by both legs) hanging below the hip pivot; likewise arms.
  const legGeo = box(0.2, 0.82, 0.24, 0, -0.41, 0); // top at pivot, hangs down
  const armGeo = box(0.15, 0.6, 0.2, 0, -0.3, 0);

  const leftLegMesh = new THREE.Mesh(legGeo, material);
  const rightLegMesh = new THREE.Mesh(legGeo, material);
  const leftArmMesh = new THREE.Mesh(armGeo, material);
  const rightArmMesh = new THREE.Mesh(armGeo, material);
  for (const m of [leftLegMesh, rightLegMesh, leftArmMesh, rightArmMesh]) m.castShadow = true;

  const leftLeg = limb(leftLegMesh, -0.12, -0.08);
  const rightLeg = limb(rightLegMesh, 0.12, -0.08);
  const leftArm = limb(leftArmMesh, -0.34, 0.32);
  const rightArm = limb(rightArmMesh, 0.34, 0.32);
  group.add(leftLeg, rightLeg, leftArm, rightArm);

  // Walk/idle animation: a sin-driven swing whose frequency + amplitude scale with speed; arms
  // counter-swing the legs. At idle the limbs settle and the torso gets a faint breathing bob.
  let phase = 0;
  const animate = (dt: number, speed: number): void => {
    const moving = speed > 0.15;
    const freq = moving ? Math.min(2 + speed * 1.7, 12) : 2.2;
    phase += dt * freq;
    const swing = Math.min(speed * 0.17, 0.7);
    const s = Math.sin(phase) * swing;
    leftLeg.rotation.x = s;
    rightLeg.rotation.x = -s;
    leftArm.rotation.x = -s * 0.8;
    rightArm.rotation.x = s * 0.8;
    body.position.y = moving ? 0 : Math.sin(phase) * 0.015; // subtle idle breathing
  };

  return {
    group,
    body,
    material,
    animate,
    dispose: () => {
      upperGeo.dispose();
      legGeo.dispose();
      armGeo.dispose();
      material.dispose();
    },
  };
}
