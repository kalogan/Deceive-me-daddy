// The shared avatar — a VARIED stylised low-poly toon CIVILIAN with a lightweight PROCEDURAL
// RIG. Used by BOTH WorldView (players) and NpcView (the crowd). The art direction (Deceive
// Inc.) is "varied civilians": each character reads as a distinct individual — its own outfit,
// hair, skin and accessory — chosen DETERMINISTICALLY from a per-character `seed` so the look is
// stable across spawns/frames. Clearance TIER is no longer the whole-body colour; it shows as a
// smaller tier-coloured ACCENT (an armband + sash + visor tint) so the silhouette stays an
// individual while the tier is still readable at a glance.
//
// Rig: the static upper body (torso jacket + shoulders + collar + neck + head + hair) is one
// merged mesh; the two legs and two arms (each tapered with a hand/foot cap) hang from pivot
// groups so `animate(dt, speed)` swings them in a walk cycle (and rests at idle). Multiple
// materials cover the figure (garment, trousers, skin, hair, shoes, accessory + the tier
// accent), so the styling API encapsulates effects (tier / brightness / opacity / emissive) to
// fan them out across EVERY material — nothing breaks when a body has many colours. `body` is the
// upper-body mesh (a representative for the views). `material` stays the TIER-ACCENT material for
// back-compat. `dispose()` frees every geometry + every material (no leaks).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const AVATAR_RADIUS = 0.4;
export const AVATAR_HEIGHT = 1.8;

export interface AvatarBody {
  group: THREE.Group;
  /** Representative upper-body mesh (views reference it). */
  body: THREE.Mesh;
  /** BACK-COMPAT: the TIER-ACCENT material (kept so existing references keep working). */
  material: THREE.MeshStandardMaterial;
  /** Drive the procedural walk/idle animation. `dt` seconds, `speed` in m/s (planar). */
  animate(dt: number, speed: number): void;
  /** Set the clearance-tier accent colour (armband/sash/visor). Remembers it as that material's base. */
  setTier(hex: number): void;
  /** Multiply EVERY material's colour from its remembered BASE (downed/out dimming). 1 = full. */
  setBrightness(mult: number): void;
  /** Set opacity+transparent on EVERY material (downed ghost / Larcin cloak). */
  setOpacity(opacity: number): void;
  /** Set emissive colour+intensity on EVERY material (Chavez invuln gold shell). off = (0x000000, 0). */
  setEmissive(hex: number, intensity: number): void;
  /** Free ALL geometries + ALL materials. */
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
 * the torso and the limbs so edges read as fitted toon shapes rather than pure cubes.
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

// --- Seeded PRNG (mulberry32) -------------------------------------------------------------------
// The look MUST be stable: same seed → same character every frame/spawn. CLIENT RENDER ONLY —
// never the sim — so a tiny non-crypto PRNG is fine. The cosmetic walk PHASE still uses
// Math.random (it needn't be stable; it de-syncs the crowd).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a stable element of `arr` from the PRNG. `arr` must be non-empty. */
function pick<T>(rng: () => number, arr: readonly T[]): T {
  const i = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
  // noUncheckedIndexedAccess: arr is non-empty and i is clamped in-range.
  return arr[i] as T;
}

// --- Curated stylised toon palettes -------------------------------------------------------------
// Vibrant but cohesive — kept low-poly-toon friendly (saturated mids, no muddy tones).
const SKIN_TONES = [0xffd9b3, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0bd] as const;
const HAIR_COLORS = [0x2b1d10, 0x4a2f1b, 0x6e4626, 0x9a6b3f, 0xd9b26a, 0x1a1a1a, 0xb83b3b, 0x6c6c74] as const;
// Bright garment colours for the main jacket/hoodie/dress/vest top.
const GARMENT_COLORS = [
  0xd94f4f, 0xe07b39, 0xe8c84a, 0x4caf63, 0x3f9ea8, 0x4f6fd9, 0x7a52c4, 0xc44f9e, 0x2f3640, 0xe8e3d8,
] as const;
// Trousers / skirt — slightly more grounded so the top pops.
const LEG_COLORS = [0x2f3640, 0x3a4252, 0x5a4636, 0x4a4a52, 0x2a4a3a, 0x6b5070, 0x8a8f99, 0x1f2530] as const;
const SHOE_COLORS = [0x1a1a1a, 0x3a2a20, 0x4a4a4a, 0x7a3030, 0x2a3a5a] as const;

type Archetype = 'suit' | 'hoodie' | 'dress' | 'vest';
const ARCHETYPES: readonly Archetype[] = ['suit', 'hoodie', 'dress', 'vest'];

type HairStyle = 'short' | 'tall' | 'bun' | 'bald' | 'cap';
const HAIR_STYLES: readonly HairStyle[] = ['short', 'tall', 'bun', 'bald', 'cap'];

type Accessory = 'none' | 'glasses' | 'bag';
const ACCESSORIES: readonly Accessory[] = ['none', 'none', 'glasses', 'bag']; // weight toward none

interface CharacterLook {
  archetype: Archetype;
  garment: number;
  legColor: number;
  shoeColor: number;
  skin: number;
  hairStyle: HairStyle;
  hairColor: number;
  capColor: number;
  accessory: Accessory;
}

/** The sensible DEFAULT character used when no seed is given (the gallery's plain calls). */
const DEFAULT_LOOK: CharacterLook = {
  archetype: 'suit',
  garment: 0x4f6fd9,
  legColor: 0x2f3640,
  shoeColor: 0x1a1a1a,
  skin: 0xf1c27d,
  hairStyle: 'short',
  hairColor: 0x4a2f1b,
  capColor: 0xd94f4f,
  accessory: 'none',
};

/** Deterministically derive a character look from a seed. Same seed → identical look. */
function lookFromSeed(seed: number): CharacterLook {
  const rng = mulberry32(seed);
  return {
    archetype: pick(rng, ARCHETYPES),
    garment: pick(rng, GARMENT_COLORS),
    legColor: pick(rng, LEG_COLORS),
    shoeColor: pick(rng, SHOE_COLORS),
    skin: pick(rng, SKIN_TONES),
    hairStyle: pick(rng, HAIR_STYLES),
    hairColor: pick(rng, HAIR_COLORS),
    capColor: pick(rng, GARMENT_COLORS),
    accessory: pick(rng, ACCESSORIES),
  };
}

/** A material plus its remembered BASE colour so brightness can recompute color = base * mult. */
interface TrackedMat {
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
}

function makeMat(hex: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, roughness, metalness, flatShading: true });
}

/**
 * Build a fresh, rigged varied toon civilian centred on the group origin (feet near -H/2, head
 * near top, within ±AVATAR_RADIUS in x so it still fits doors/props). With `seed` the look is
 * deterministic; without it a sensible default character is built.
 */
export function buildAvatarBody(opts?: { seed?: number }): AvatarBody {
  const look = opts?.seed === undefined ? DEFAULT_LOOK : lookFromSeed(opts.seed);
  const group = new THREE.Group();

  // ---- Materials. A handful per body, each tracked with its base colour for brightness math.
  const tracked: TrackedMat[] = [];
  const track = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    tracked.push({ material: m, base: m.color.clone() });
    return m;
  };

  const garmentMat = track(makeMat(look.garment, 0.7, 0.05)); // jacket / hoodie / dress / vest top
  const legMat = track(makeMat(look.legColor, 0.78, 0.04)); // trousers / skirt
  const shoeMat = track(makeMat(look.shoeColor, 0.55, 0.15));
  const skinMat = track(makeMat(look.skin, 0.66, 0.02)); // head + hands
  const hairMat = track(makeMat(look.hairColor, 0.72, 0.04));
  const accessoryMat = track(makeMat(look.capColor, 0.6, 0.1)); // cap/bag/glasses cosmetic

  // The TIER ACCENT material (armband + sash + visor tint). Kept as `material` for back-compat.
  // Default mid-grey (civilian) until a view calls setTier(). Tracked like the rest.
  const accent = makeMat(0xcfcfcf, 0.5, 0.2);
  const accentTracked: TrackedMat = { material: accent, base: accent.color.clone() };
  tracked.push(accentTracked);

  // ---- Static upper body: torso (varies by archetype), shoulders, collar, neck, head + hair.
  // Group geometries by MATERIAL so each material draws as one merged mesh (modest draw counts).
  const garmentParts: THREE.BufferGeometry[] = [];
  const skinParts: THREE.BufferGeometry[] = [];
  const hairParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];
  const accessoryParts: THREE.BufferGeometry[] = [];

  // Torso silhouette per archetype.
  switch (look.archetype) {
    case 'suit':
      garmentParts.push(taper(0.5, 0.32, 0.36, 0.27, 0.66, 0, 0.3, 0)); // fitted jacket to waist
      garmentParts.push(box(0.5, 0.14, 0.3, 0, 0.35, 0)); // shoulders / yoke
      garmentParts.push(box(0.2, 0.1, 0.26, 0, 0.45, 0.03)); // shirt collar
      break;
    case 'hoodie':
      garmentParts.push(taper(0.52, 0.36, 0.5, 0.34, 0.7, 0, 0.32, 0)); // boxy hoodie
      garmentParts.push(box(0.54, 0.16, 0.34, 0, 0.37, 0)); // bulky shoulders
      garmentParts.push(box(0.26, 0.14, 0.26, 0, 0.46, 0)); // hood collar roll
      break;
    case 'dress':
      garmentParts.push(taper(0.44, 0.28, 0.28, 0.2, 0.4, 0, 0.3, 0)); // fitted bodice
      garmentParts.push(taper(0.28, 0.2, 0.56, 0.4, 0.34, 0, -0.1, 0)); // flared skirt
      garmentParts.push(box(0.42, 0.12, 0.26, 0, 0.34, 0)); // shoulders
      break;
    case 'vest':
      garmentParts.push(taper(0.46, 0.3, 0.4, 0.26, 0.66, 0, 0.3, 0)); // vest over shirt
      garmentParts.push(box(0.48, 0.13, 0.28, 0, 0.35, 0)); // shoulders
      garmentParts.push(box(0.18, 0.1, 0.24, 0, 0.45, 0.03)); // collar
      break;
  }

  // Neck (skin) + head (skin) — head a touch larger for the appealing "hero" toon proportion.
  skinParts.push(box(0.15, 0.12, 0.15, 0, 0.5, 0)); // neck
  skinParts.push(box(0.34, 0.34, 0.32, 0, 0.69, 0)); // head (slightly oversized)

  // Hair per style (sits on/around the head at y≈0.69, head half-height 0.17 → top ≈ 0.86).
  switch (look.hairStyle) {
    case 'short':
      hairParts.push(box(0.36, 0.1, 0.34, 0, 0.85, 0)); // short cap of hair
      hairParts.push(box(0.36, 0.16, 0.08, 0, 0.74, -0.14)); // back of head
      break;
    case 'tall':
      hairParts.push(box(0.34, 0.18, 0.32, 0, 0.9, 0)); // tall quiff
      hairParts.push(box(0.36, 0.2, 0.08, 0, 0.74, -0.14));
      break;
    case 'bun':
      hairParts.push(box(0.36, 0.1, 0.34, 0, 0.85, 0));
      hairParts.push(box(0.16, 0.16, 0.16, 0, 0.96, -0.06)); // top bun
      break;
    case 'bald':
      // no hair geometry; a hint of brow only
      hairParts.push(box(0.34, 0.05, 0.1, 0, 0.82, -0.13));
      break;
    case 'cap':
      // a baseball cap in the accessory colour (crown skin-free) handled below; add hair fringe.
      hairParts.push(box(0.34, 0.06, 0.1, 0, 0.79, 0.13)); // fringe under brim
      hairParts.push(box(0.34, 0.14, 0.08, 0, 0.74, -0.14));
      break;
  }

  if (look.hairStyle === 'cap') {
    accessoryParts.push(box(0.38, 0.1, 0.36, 0, 0.88, 0)); // cap crown
    accessoryParts.push(box(0.34, 0.04, 0.18, 0, 0.85, 0.22)); // cap peak (+Z forward)
  }

  // Accent: a chest SASH band + an armband + a visor tint — the tier-coloured read. A diagonal
  // sash: a tall thin strip across the chest, rotated so it crosses shoulder-to-hip.
  const sash = box(0.1, 0.56, 0.05, 0, 0.28, 0.17);
  sash.rotateZ(-Math.PI / 7); // lean it diagonally across the chest
  accentParts.push(sash);
  accentParts.push(box(0.18, 0.09, 0.2, 0.3, 0.2, 0)); // upper-arm armband (right shoulder)
  // Visor tint band across the brow so the tier reads on the face too.
  accentParts.push(box(0.32, 0.06, 0.05, 0, 0.66, 0.16));

  // Optional accessory: glasses bar across the eyes (skin-coloured frame? use accessory colour).
  if (look.accessory === 'glasses') {
    accessoryParts.push(box(0.3, 0.05, 0.04, 0, 0.71, 0.17));
  }

  const upperGeo = mergeGeometries(garmentParts, false);
  for (const p of garmentParts) p.dispose();
  upperGeo.computeVertexNormals();
  const body = new THREE.Mesh(upperGeo, garmentMat);
  body.castShadow = true;
  group.add(body);

  const skinGeo = mergeGeometries(skinParts, false);
  for (const p of skinParts) p.dispose();
  skinGeo.computeVertexNormals();
  const skinMesh = new THREE.Mesh(skinGeo, skinMat);
  skinMesh.castShadow = true;
  group.add(skinMesh);

  // Hair may be empty for some styles? It always has at least one part above. Merge it.
  const hairGeo = mergeGeometries(hairParts, false);
  for (const p of hairParts) p.dispose();
  hairGeo.computeVertexNormals();
  const hairMesh = new THREE.Mesh(hairGeo, hairMat);
  hairMesh.castShadow = true;
  group.add(hairMesh);

  const accentGeo = mergeGeometries(accentParts, false);
  for (const p of accentParts) p.dispose();
  accentGeo.computeVertexNormals();
  const accentMesh = new THREE.Mesh(accentGeo, accent);
  accentMesh.castShadow = true;
  group.add(accentMesh);

  // Accessory mesh only if there's geometry for it.
  let accessoryMesh: THREE.Mesh | null = null;
  let accessoryGeo: THREE.BufferGeometry | null = null;
  if (accessoryParts.length > 0) {
    accessoryGeo = mergeGeometries(accessoryParts, false);
    for (const p of accessoryParts) p.dispose();
    accessoryGeo.computeVertexNormals();
    accessoryMesh = new THREE.Mesh(accessoryGeo, accessoryMat);
    accessoryMesh.castShadow = true;
    group.add(accessoryMesh);
  }

  // A small shoulder bag (accessory) hangs at the hip — added as its own static mesh on the bag
  // accessory; reuse the accessory material + a tiny geometry parented to the group.
  let bagGeo: THREE.BufferGeometry | null = null;
  if (look.accessory === 'bag') {
    bagGeo = box(0.22, 0.18, 0.1, 0.24, -0.18, 0.12);
    bagGeo.computeVertexNormals();
    const bagMesh = new THREE.Mesh(bagGeo, accessoryMat);
    bagMesh.castShadow = true;
    group.add(bagMesh);
  }

  // ---- Limbs. Legs: trouser (legMat) + shoe cap (shoeMat) — two materials, so build the trouser
  // and shoe as separate meshes parented into one pivot. Reuse geometry across the two legs/arms.
  const trouserGeo = taper(0.2, 0.24, 0.16, 0.2, 0.74, 0, 0, 0);
  trouserGeo.computeVertexNormals();
  const shoeGeo = box(0.18, 0.1, 0.3, 0, -0.79, 0.05);
  shoeGeo.computeVertexNormals();

  // Arm sleeve uses the garment colour; the hand uses skin.
  const sleeveGeo = taper(0.15, 0.2, 0.12, 0.16, 0.5, 0, 0, 0);
  sleeveGeo.computeVertexNormals();
  const handGeo = box(0.14, 0.14, 0.16, 0, -0.56, 0);
  handGeo.computeVertexNormals();

  function makeLeg(x: number): THREE.Group {
    const trouser = new THREE.Mesh(trouserGeo, legMat);
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    trouser.castShadow = true;
    shoe.castShadow = true;
    const pivot = limb(trouser, x, -0.08);
    pivot.add(shoe);
    return pivot;
  }
  function makeArm(x: number): THREE.Group {
    const sleeve = new THREE.Mesh(sleeveGeo, garmentMat);
    const hand = new THREE.Mesh(handGeo, skinMat);
    sleeve.castShadow = true;
    hand.castShadow = true;
    const pivot = limb(sleeve, x, 0.32);
    pivot.add(hand);
    return pivot;
  }

  const leftLeg = makeLeg(-0.12);
  const rightLeg = makeLeg(0.12);
  const leftArm = makeArm(-0.32);
  const rightArm = makeArm(0.32);
  group.add(leftLeg, rightLeg, leftArm, rightArm);

  // ---- Procedural walk/idle animation (UNCHANGED math — preserve the landed walk-cycle fix:
  // framerate-independent smoothed-speed EMA, a continuous gait-weight blend, randomised phase).
  const SPEED_TAU = 0.12; // smoothing time-constant (s) for the speed follow
  const IDLE_FREQ = 2.2; // breathing/idle bob rate (rad/s)
  let smoothedSpeed = 0;
  let phase = Math.random() * Math.PI * 2; // de-sync the crowd (cosmetic render only)
  const animate = (dt: number, speed: number): void => {
    // Framerate-independent exponential follow of the noisy speed signal.
    const a = 1 - Math.exp(-dt / SPEED_TAU);
    smoothedSpeed += (speed - smoothedSpeed) * a;

    // Continuous 0..1 gait weight via a smoothstep over a small speed band — no hard switch.
    const t = Math.min(Math.max((smoothedSpeed - 0.1) / (0.4 - 0.1), 0), 1);
    const gait = t * t * (3 - 2 * t);

    // Walk frequency rises with speed; blend from the idle bob rate up to the stride rate.
    const walkFreq = Math.min(2 + smoothedSpeed * 1.7, 12);
    const freq = IDLE_FREQ + (walkFreq - IDLE_FREQ) * gait;
    phase += dt * freq;

    // Stride amplitude scales with speed, eased in by the gait weight so it never jumps.
    const swing = Math.min(smoothedSpeed * 0.2, 0.75) * gait;
    const s = Math.sin(phase) * swing;
    leftLeg.rotation.x = s;
    rightLeg.rotation.x = -s;
    leftArm.rotation.x = -s * 0.85; // arms counter-swing the legs
    rightArm.rotation.x = s * 0.85;
    // Faint breathing bob, faded out as the stride takes over (gait→1 zeroes it smoothly).
    const bob = Math.sin(phase) * 0.015 * (1 - gait);
    body.position.y = bob;
    skinMesh.position.y = bob;
    hairMesh.position.y = bob;
    accentMesh.position.y = bob;
    if (accessoryMesh) accessoryMesh.position.y = bob;
  };

  // ---- Styling API. Encapsulates effects so they fan out across EVERY material. Order-
  // independent + idempotent: brightness is re-derived from each material's remembered BASE.
  let brightness = 1;
  const tmp = new THREE.Color();

  const applyBrightness = (): void => {
    for (const tm of tracked) {
      tmp.copy(tm.base).multiplyScalar(brightness);
      tm.material.color.copy(tmp);
    }
  };

  const setTier = (hex: number): void => {
    accentTracked.base.set(hex);
    // Re-apply current brightness so the accent respects any active dimming.
    tmp.copy(accentTracked.base).multiplyScalar(brightness);
    accent.color.copy(tmp);
  };

  const setBrightness = (mult: number): void => {
    brightness = mult;
    applyBrightness();
  };

  const setOpacity = (opacity: number): void => {
    const transparent = opacity < 1;
    for (const tm of tracked) {
      tm.material.opacity = opacity;
      tm.material.transparent = transparent;
    }
  };

  const setEmissive = (hex: number, intensity: number): void => {
    for (const tm of tracked) {
      tm.material.emissive.set(hex);
      tm.material.emissiveIntensity = intensity;
    }
  };

  return {
    group,
    body,
    material: accent, // back-compat: the tier-accent material
    animate,
    setTier,
    setBrightness,
    setOpacity,
    setEmissive,
    dispose: () => {
      upperGeo.dispose();
      skinGeo.dispose();
      hairGeo.dispose();
      accentGeo.dispose();
      if (accessoryGeo) accessoryGeo.dispose();
      if (bagGeo) bagGeo.dispose();
      trouserGeo.dispose();
      shoeGeo.dispose();
      sleeveGeo.dispose();
      handGeo.dispose();
      garmentMat.dispose();
      legMat.dispose();
      shoeMat.dispose();
      skinMat.dispose();
      hairMat.dispose();
      accessoryMat.dispose();
      accent.dispose();
    },
  };
}
