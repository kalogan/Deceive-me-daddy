// The shared avatar — a stylised low-poly SPY AGENT with a lightweight PROCEDURAL RIG. Used by
// BOTH WorldView (players) and NpcView (the crowd) so a disguised player renders identically
// to the NPCs they blend among (PROJECT_BRIEF §1). Identity is NOT in the silhouette (that
// would leak who's a player); tier shows by COLOUR (the views tint `material`).
//
// Rig: the static upper body (coat torso + shoulders + collar + neck + head + fedora) is one
// merged mesh; the two legs and two arms (each tapered with a hand/foot cap) hang from pivot
// groups so `animate(dt, speed)` can swing them in a walk cycle (and rest at idle). Every TINTED
// mesh SHARES one material, so the views' tier-tint + reveal/downed/cloak/invulnerable styling
// (color/opacity/emissive on `material`) still drives the whole figure. A single fixed dark
// accent material handles the hat band + visor so those stay constant regardless of tier. `body`
// is the upper-body mesh (a representative for the views); `dispose()` frees every geometry +
// both materials.
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

/**
 * A tapered four-sided prism (truncated pyramid) of height `h` running down the -Y axis from the
 * origin: cross-section `wTop x dTop` at the top tapering to `wBot x dBot` at the bottom. Used for
 * the coat torso and the limbs so edges read as a fitted spy silhouette rather than pure cubes.
 */
function taper(
  wTop: number,
  dTop: number,
  wBot: number,
  dBot: number,
  h: number,
  x: number,
  yTop: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, h, 4, 1);
  // CylinderGeometry(r=0.5) gives a unit square cross-section (corner-to-corner ~1); rotate 45°
  // so faces point along X/Z, then scale per-row to the requested top/bottom footprints.
  g.rotateY(Math.PI / 4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const half = h / 2;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    const t = (half - py) / h; // 0 at top, 1 at bottom
    const sw = wTop + (wBot - wTop) * t;
    const sd = dTop + (dBot - dTop) * t;
    pos.setX(i, pos.getX(i) * sw);
    pos.setZ(i, pos.getZ(i) * sd);
  }
  g.computeVertexNormals();
  // Move so the top sits at yTop and the prism hangs down, then offset in X/Z.
  g.translate(x, yTop - half, z);
  return g;
}

/** A pivot group at (x, pivotY) holding `mesh` so rotating the pivot's X swings the limb. */
function limb(mesh: THREE.Mesh, x: number, pivotY: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, pivotY, 0);
  pivot.add(mesh);
  return pivot;
}

/** Build a fresh, white rigged spy agent centred on the group origin (feet near -H/2). */
export function buildAvatarBody(): AvatarBody {
  const group = new THREE.Group();

  // The one tinted material every body panel shares (the views drive tier colour / reveal / etc).
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.06,
    flatShading: true,
  });

  // A constant dark accent for the hat band + visor — stays the same regardless of tier so the
  // figure always reads as a hatted, visored agent.
  const accent = new THREE.MeshStandardMaterial({
    color: 0x1a1d24,
    roughness: 0.45,
    metalness: 0.25,
    flatShading: true,
  });

  // ---- Static upper body (shares `material`): a fitted coat that tapers to the waist, defined
  // shoulders, a collar, neck, head and a fedora crown — merged into one mesh for one draw call.
  const upperParts = [
    // Coat: broad at the shoulders, tapering in to a belted waist; a little belly depth.
    taper(0.5, 0.32, 0.34, 0.26, 0.5, 0, 0.28, 0),
    // Coat tail / skirt flaring back out below the belt (reads as a long spy coat).
    taper(0.36, 0.28, 0.46, 0.32, 0.16, 0, -0.22, 0),
    box(0.5, 0.05, 0.32, 0, -0.22, 0), // belt line
    box(0.5, 0.14, 0.3, 0, 0.35, 0), // shoulders / coat yoke
    box(0.24, 0.1, 0.26, 0, 0.45, 0.02), // collar (slight forward read)
    box(0.16, 0.12, 0.16, 0, 0.5, 0), // neck
    box(0.3, 0.3, 0.3, 0, 0.66, 0), // head
    box(0.46, 0.05, 0.46, 0, 0.78, 0), // fedora brim
    box(0.32, 0.12, 0.32, 0, 0.86, 0), // fedora crown
  ];
  const upperGeo = mergeGeometries(upperParts, false);
  for (const p of upperParts) p.dispose();
  upperGeo.computeVertexNormals();
  const body = new THREE.Mesh(upperGeo, material);
  body.castShadow = true;
  group.add(body);

  // ---- Accent: hat band wrapping the crown + a visor strip across the brow (constant colour).
  const accentParts = [
    box(0.34, 0.05, 0.34, 0, 0.805, 0), // hat band just above the brim
    box(0.3, 0.06, 0.06, 0, 0.64, 0.15), // visor / shades across the face (+Z faces forward)
  ];
  const accentGeo = mergeGeometries(accentParts, false);
  for (const p of accentParts) p.dispose();
  accentGeo.computeVertexNormals();
  const accentMesh = new THREE.Mesh(accentGeo, accent);
  accentMesh.castShadow = true;
  group.add(accentMesh);

  // ---- Limbs (share `material`): each leg is a tapered trouser with a wedge shoe cap; each arm
  // a tapered coat sleeve with a small hand cap. Built so the top sits at the pivot and hangs.
  const legParts = [
    taper(0.2, 0.24, 0.16, 0.2, 0.74, 0, 0, 0), // trouser
    box(0.18, 0.1, 0.3, 0, -0.79, 0.05), // shoe (extends forward +Z)
  ];
  const legGeo = mergeGeometries(legParts, false);
  for (const p of legParts) p.dispose();
  legGeo.computeVertexNormals();

  const armParts = [
    taper(0.15, 0.2, 0.12, 0.16, 0.52, 0, 0, 0), // sleeve
    box(0.13, 0.13, 0.16, 0, -0.58, 0), // hand
  ];
  const armGeo = mergeGeometries(armParts, false);
  for (const p of armParts) p.dispose();
  armGeo.computeVertexNormals();

  const leftLegMesh = new THREE.Mesh(legGeo, material);
  const rightLegMesh = new THREE.Mesh(legGeo, material);
  const leftArmMesh = new THREE.Mesh(armGeo, material);
  const rightArmMesh = new THREE.Mesh(armGeo, material);
  for (const m of [leftLegMesh, rightLegMesh, leftArmMesh, rightArmMesh]) m.castShadow = true;

  const leftLeg = limb(leftLegMesh, -0.12, -0.08);
  const rightLeg = limb(rightLegMesh, 0.12, -0.08);
  const leftArm = limb(leftArmMesh, -0.32, 0.32);
  const rightArm = limb(rightArmMesh, 0.32, 0.32);
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
    accentMesh.position.y = body.position.y; // hat/visor ride with the breathing bob
  };

  return {
    group,
    body,
    material,
    animate,
    dispose: () => {
      upperGeo.dispose();
      accentGeo.dispose();
      legGeo.dispose();
      armGeo.dispose();
      material.dispose();
      accent.dispose();
    },
  };
}
