// The shared avatar — a VARIED stylised toon SPY/CIVILIAN with a lightweight PROCEDURAL RIG. Used by
// BOTH WorldView (players) and NpcView (the crowd). The art direction (Deceive Inc. / Fortnite-
// flavoured "soft 3D toon") is "appealing toon spies": each character reads as a distinct individual
// — its own outfit, hair, skin, face and accessory — chosen DETERMINISTICALLY from a per-character
// `seed` so the look is stable across spawns/frames. Clearance TIER is no longer the whole-body
// colour; it shows as a smaller tier-coloured ACCENT (an armband + chest stripe + visor tint) so the
// silhouette stays an individual while the tier is still readable at a glance.
//
// The forms aim for HERO toon proportions: defined shoulders + waist, a slightly oversized head with
// a READABLE FACE (eyes/brow, a sleek visor option), actual HANDS (palm + thumb) and shaped SHOES,
// and crisp, DISTINCT outfit silhouettes per archetype (tailored suit + lapels, hoodie with hood +
// drawstring, flared dress, vest with shoulder yoke + opening). Smooth normals + the scene's
// bloom/ACES tone mapping make the matte forms read soft and rich rather than faceted, while a few
// flat-shaded micro-accents (lapels, visor, glasses) stay crisp.
//
// Rig: the static upper body (torso + collar/hood/skirt + neck + head + hair + face) is merged BY
// MATERIAL so each material draws as one mesh (modest draws); the two legs and two arms (shared
// geometry) hang from pivot groups so `animate(dt, speed)` swings them in a walk cycle (resting at
// idle) and blends into an AIM pose. Multiple materials cover the figure, so the styling API
// encapsulates effects (tier / brightness / opacity / emissive) to fan them across EVERY material —
// nothing breaks when a body has many colours. `body` is the upper-body mesh (a representative for
// the views). `material` stays the TIER-ACCENT material for back-compat. `dispose()` frees every
// geometry + every material (no leaks).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const AVATAR_RADIUS = 0.4;
export const AVATAR_HEIGHT = 1.8;

// Modest segment counts — smooth enough to lose the facets under ACES+bloom, cheap enough for
// ~10+ avatars on screen at once.
const CAP_RADIAL = 10; // capsule radial segments (limbs / torso)
const CAP_CAPSEG = 3; // capsule cap segments
const HEAD_SEG = 18; // head sphere width segments

/** A unit-positioned sphere primitive translated into place. */
function sphere(r: number, x: number, y: number, z: number, wSeg = 14, hSeg = 10): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg);
  g.translate(x, y, z);
  return g;
}

/** A box primitive translated into place (kept for tiny hard accents: lapels / visor / peak). */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * A vertical capsule of total height `h` (rounded ends) and radius `r`, optionally scaled to an
 * ellipse cross-section (sx in X, sz in Z), with its CENTRE at (x, y, z). Capsules give the limbs
 * and torso smooth tubular forms with rounded ends — the single biggest win for the soft toon look.
 */
function capsule(
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sz = 1,
): THREE.BufferGeometry {
  const len = Math.max(0.001, h - 2 * r); // straight section length
  const g = new THREE.CapsuleGeometry(r, len, CAP_CAPSEG, CAP_RADIAL);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  g.translate(x, y, z);
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
// Eye / visor tint — deep cool tones so a sleek visor reads as glass under bloom.
const EYE_COLORS = [0x20242c, 0x1a1f2e, 0x14181f] as const;

type Archetype = 'suit' | 'hoodie' | 'dress' | 'vest';
const ARCHETYPES: readonly Archetype[] = ['suit', 'hoodie', 'dress', 'vest'];

type HairStyle = 'short' | 'tall' | 'bun' | 'bald' | 'cap';
const HAIR_STYLES: readonly HairStyle[] = ['short', 'tall', 'bun', 'bald', 'cap'];

type Accessory = 'none' | 'glasses' | 'bag';
const ACCESSORIES: readonly Accessory[] = ['none', 'none', 'glasses', 'bag']; // weight toward none

// A subset of characters wear a sleek tier-tinted VISOR over the eyes instead of plain eyes — the
// classic spy read. Seeded so it's stable.
type FaceStyle = 'eyes' | 'visor';

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
  eyeColor: number;
  face: FaceStyle;
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
  eyeColor: 0x20242c,
  face: 'eyes',
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
    eyeColor: pick(rng, EYE_COLORS),
    // ~1 in 3 wears a sleek visor (the tier-tinted spy read); the rest have plain toon eyes.
    face: rng() < 0.34 ? 'visor' : 'eyes',
  };
}

/** A material plus its remembered BASE colour so brightness can recompute color = base * mult. */
interface TrackedMat {
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
}

/** Body materials are SMOOTH-shaded by default so the rounded forms read soft, not faceted. */
function makeMat(hex: number, roughness: number, metalness: number, flat = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, roughness, metalness, flatShading: flat });
}

/**
 * Build a fresh, rigged varied toon spy centred on the group origin (feet near -H/2, head near top,
 * within ±AVATAR_RADIUS in x so it still fits doors/props). With `seed` the look is deterministic;
 * without it a sensible default character is built.
 *
 * `hasWeapon` (default FALSE) adds a small stylised pistol parented to the RIGHT arm, hidden until
 * the rig is AIMING. The crowd/preview/gallery omit it (no opts.hasWeapon), so they stay weaponless
 * and visually identical in spirit. Players pass `hasWeapon: true` so they can shoulder + fire.
 */
export function buildAvatarBody(opts?: { seed?: number; hasWeapon?: boolean }): AvatarBody {
  const look = opts?.seed === undefined ? DEFAULT_LOOK : lookFromSeed(opts.seed);
  const group = new THREE.Group();

  // ---- Materials. A handful per body, each tracked with its base colour for brightness math.
  const tracked: TrackedMat[] = [];
  const track = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    tracked.push({ material: m, base: m.color.clone() });
    return m;
  };

  const garmentMat = track(makeMat(look.garment, 0.66, 0.06)); // jacket / hoodie / dress / vest top
  const legMat = track(makeMat(look.legColor, 0.78, 0.04)); // trousers / skirt
  const shoeMat = track(makeMat(look.shoeColor, 0.5, 0.18));
  const skinMat = track(makeMat(look.skin, 0.62, 0.02)); // head + hands
  const hairMat = track(makeMat(look.hairColor, 0.7, 0.05));
  const accessoryMat = track(makeMat(look.capColor, 0.58, 0.12)); // cap/bag/glasses cosmetic
  const eyeMat = track(makeMat(look.eyeColor, 0.32, 0.2)); // toon eyes / brow — glossy dark
  // A bright off-white shirt under the jacket (suit/vest) + dress trim — small but lifts the read.
  const trimMat = track(makeMat(0xf2efe6, 0.6, 0.04));

  // The TIER ACCENT material (armband + chest stripe + visor tint). Kept as `material` for
  // back-compat. Default mid-grey (civilian) until a view calls setTier(). Tracked like the rest.
  // Tiny hard accents keep flatShading so the band/stripe read crisply against the smooth body.
  const accent = makeMat(0xcfcfcf, 0.42, 0.25, true);
  const accentTracked: TrackedMat = { material: accent, base: accent.color.clone() };
  tracked.push(accentTracked);

  // ---- Static upper body, grouped by MATERIAL so each draws as one merged mesh (modest draws).
  const garmentParts: THREE.BufferGeometry[] = [];
  const legParts: THREE.BufferGeometry[] = []; // skirt (dress) goes on the leg material
  const skinParts: THREE.BufferGeometry[] = [];
  const hairParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];
  const accessoryParts: THREE.BufferGeometry[] = [];
  const eyeParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];

  // --- TORSO + shoulders. A shared hero core: tapered torso (broad chest → narrow waist) plus a
  // defined shoulder yoke, then archetype-specific silhouette pieces on top. Centre of mass sits
  // around y≈0.30; shoulders at ~0.46, waist at ~0.06.

  // Tapered torso: chest swell over a tucked waist (two stacked ellipsoids read as a V-taper).
  garmentParts.push(sphere(0.255, 0, 0.40, 0, 14, 10).scale(1.0, 0.82, 0.74)); // chest
  garmentParts.push(sphere(0.205, 0, 0.16, 0, 14, 10).scale(1.0, 0.78, 0.7)); // waist (narrower)
  // Defined shoulder yoke — a wide flattened cap that gives real deltoid read.
  garmentParts.push(capsule(0.12, 0.5, 0, 0.46, 0, 1.0, 0.85)); // shoulder bar (X-wide capsule)

  switch (look.archetype) {
    case 'suit': {
      // Tailored jacket: a crisp open V of lapels in shirt trim + the tier chest stripe, plus a
      // small collar. The taper above already reads as a fitted jacket.
      trimParts.push(triPanel(0.0, 0.34, 0.16, 0.2, 0.34)); // shirt V at the chest
      // Lapels: two thin angled slabs flanking the shirt V (garment colour, crisp).
      const lapelL = box(0.05, 0.32, 0.04, -0.075, 0.34, 0.2);
      lapelL.rotateZ(0.28);
      const lapelR = box(0.05, 0.32, 0.04, 0.075, 0.34, 0.2);
      lapelR.rotateZ(-0.28);
      garmentParts.push(lapelL, lapelR);
      garmentParts.push(capsule(0.135, 0.16, 0, 0.49, 0.0, 1.0, 0.95)); // collar swell
      break;
    }
    case 'hoodie': {
      // Bulkier rounded body + a deep HOOD draped behind the neck + a kangaroo-pocket read and a
      // drawstring (two short skin-free cords on the trim mat for contrast).
      garmentParts.push(sphere(0.26, 0, 0.30, -0.02, 14, 10).scale(1.0, 0.9, 0.82)); // bulk
      garmentParts.push(hoodShell(0.2, 0, 0.5, -0.16)); // open hood draped BEHIND the neck
      garmentParts.push(sphere(0.17, 0, 0.14, 0.16, 12, 8).scale(1.2, 0.6, 0.5)); // belly pocket
      // Drawstrings: two short vertical cords hanging from the collar.
      trimParts.push(capsule(0.018, 0.16, -0.05, 0.40, 0.18));
      trimParts.push(capsule(0.018, 0.16, 0.05, 0.40, 0.18));
      break;
    }
    case 'dress': {
      // Fitted bodice above a smooth flared skirt (on the leg material). A thin trim neckline.
      garmentParts.push(sphere(0.2, 0, 0.30, 0, 14, 10).scale(1.0, 0.95, 0.78)); // bodice
      trimParts.push(capsule(0.105, 0.12, 0, 0.5, 0.02, 1.0, 0.95)); // neckline trim
      legParts.push(flaredSkirt(0.21, 0.36, 0.5, 0.18)); // smooth flared skirt from the waist
      break;
    }
    case 'vest': {
      // A tailored vest: a broad raised shoulder YOKE + a clear front OPENING showing the shirt
      // trim, plus a collar. The opening is a shirt panel set slightly forward, flanked by vest.
      garmentParts.push(capsule(0.26, 0.2, 0, 0.43, 0, 1.05, 0.78)); // broad shoulder yoke
      trimParts.push(triPanel(0.0, 0.32, 0.155, 0.26, 0.34)); // exposed shirt down the front
      garmentParts.push(box(0.07, 0.42, 0.05, -0.12, 0.28, 0.18)); // vest left front edge
      garmentParts.push(box(0.07, 0.42, 0.05, 0.12, 0.28, 0.18)); // vest right front edge
      garmentParts.push(capsule(0.125, 0.16, 0, 0.49, 0.02, 1.0, 0.95)); // collar
      break;
    }
  }

  // --- NECK + HEAD. Slightly oversized head (toon hero) with a softly defined JAW: a head sphere
  // plus a gentle tapered chin push below the front. Neck on skin.
  skinParts.push(capsule(0.07, 0.15, 0, 0.53, 0, 1.0, 1.0)); // neck
  skinParts.push(sphere(0.19, 0, 0.71, 0, HEAD_SEG, 14).scale(1.0, 1.0, 0.96)); // cranium
  skinParts.push(sphere(0.125, 0, 0.62, 0.04, 14, 10).scale(1.0, 0.78, 0.95)); // jaw / chin push

  // --- FACE — kept SIMPLE + clean (no uncanny detail). Two small glossy toon eyes sitting just
  // below the head's mid-line, OR a sleek tier-tinted visor across the eye line. A faint brow line
  // and a tiny nose give just enough character. Head centre y≈0.74, face front at z≈+0.19.
  const eyeY = 0.685; // a touch below the head centre — natural eye line
  const eyeZ = 0.175; // on the front of the face
  const eyeX = 0.07; // eye separation
  if (look.face === 'visor') {
    // Sleek slim visor (tier-tinted): a thin curved band across the eye line, the iconic spy read.
    accentParts.push(visorShell(0.19, eyeY, 0.0));
  } else {
    // Two small glossy toon eyes (dark, glossy). A tiny white catch-light dot sits INSIDE the top
    // of each eye so it sparkles under bloom without looking like a tear.
    eyeParts.push(sphere(0.034, -eyeX, eyeY, eyeZ, 10, 8).scale(0.85, 1.05, 0.55));
    eyeParts.push(sphere(0.034, eyeX, eyeY, eyeZ, 10, 8).scale(0.85, 1.05, 0.55));
    trimParts.push(sphere(0.011, -eyeX + 0.01, eyeY + 0.013, eyeZ + 0.022, 6, 6)); // catch-light L
    trimParts.push(sphere(0.011, eyeX + 0.01, eyeY + 0.013, eyeZ + 0.022, 6, 6)); // catch-light R
    // Faint brow line just above each eye (hair-coloured), hugging the face — subtle, not a bar.
    hairParts.push(sphere(0.03, -eyeX, eyeY + 0.05, eyeZ - 0.005, 8, 6).scale(1.3, 0.4, 0.5));
    hairParts.push(sphere(0.03, eyeX, eyeY + 0.05, eyeZ - 0.005, 8, 6).scale(1.3, 0.4, 0.5));
  }
  // A tiny skin nose bump, just below the eye line.
  skinParts.push(sphere(0.026, 0, eyeY - 0.05, eyeZ + 0.015, 8, 6).scale(0.8, 0.95, 0.9));

  // --- HAIR per style — sculpted smooth caps, fuller + more characterful than before. Head
  // centre y≈0.71, r≈0.19 (top≈0.90). Hair stays under ~0.92 so the figure fits AVATAR_HEIGHT.
  switch (look.hairStyle) {
    case 'short': {
      const cap = hemisphere(0.205, 0, 0.73, -0.01).scale(1.0, 0.72, 1.0); // rounded short crop
      hairParts.push(cap);
      hairParts.push(sphere(0.165, 0, 0.67, -0.11, 12, 8).scale(1.0, 1.0, 0.55)); // back of head
      hairParts.push(box(0.32, 0.05, 0.06, 0, 0.81, 0.155)); // soft side-swept fringe edge
      break;
    }
    case 'tall': {
      const cap = hemisphere(0.195, 0, 0.75, -0.01).scale(0.95, 1.05, 1.0); // tall quiff
      hairParts.push(cap);
      hairParts.push(sphere(0.15, 0, 0.81, 0.07, 10, 8).scale(0.9, 0.75, 0.7)); // forward quiff lift
      hairParts.push(sphere(0.165, 0, 0.67, -0.11, 12, 8).scale(1.0, 1.0, 0.55));
      break;
    }
    case 'bun': {
      const cap = hemisphere(0.205, 0, 0.73, -0.01).scale(1.0, 0.68, 1.0);
      hairParts.push(cap);
      hairParts.push(sphere(0.082, 0, 0.86, -0.06, 12, 8)); // top bun (kept low so top≈0.94)
      hairParts.push(sphere(0.072, 0.0, 0.83, -0.13, 10, 8)); // bun base wrap
      break;
    }
    case 'bald':
      // No crown of hair; just a faint rounded brow-line hint above the eyes (hair-coloured).
      hairParts.push(sphere(0.16, 0, 0.79, -0.04, 12, 6).scale(1.0, 0.26, 0.62));
      break;
    case 'cap': {
      // A baseball cap (accessory) covers the crown; add a rounded fringe under the brim.
      hairParts.push(sphere(0.18, 0, 0.71, 0.06, 12, 8).scale(1.0, 0.42, 0.5)); // fringe
      hairParts.push(sphere(0.165, 0, 0.67, -0.11, 12, 8).scale(1.0, 1.0, 0.55)); // back
      break;
    }
  }

  if (look.hairStyle === 'cap') {
    const crown = hemisphere(0.215, 0, 0.73, -0.01).scale(1.0, 0.8, 1.0); // rounded cap crown
    accessoryParts.push(crown);
    // Curved cap peak (a shallow shell over the brow, +Z forward) instead of a flat slab.
    accessoryParts.push(capPeak(0.2, 0.725, 0.19));
  }

  // --- TIER ACCENT: an armband + a short angled chest SASH stripe + (if no visor) a slim brow
  // band hugging the hairline. The stripe sits on the upper chest, below the collar; the armband
  // wraps the right shoulder. All small so the silhouette stays an individual.
  if (look.face !== 'visor') {
    accentParts.push(browBand(0.19, 0.79)); // slim tier band at the hairline (not over the eyes)
  }
  // Chest sash: a short slim bar angled shoulder-to-chest, set forward so it hugs the garment.
  const sash = box(0.055, 0.28, 0.035, -0.015, 0.27, 0.2);
  sash.rotateZ(0.36);
  accentParts.push(sash);
  accentParts.push(box(0.13, 0.075, 0.14, 0.25, 0.4, 0)); // upper-arm armband (right shoulder)

  // Optional accessory: GLASSES — two round lens rims + a bridge across the eyes (accessory frame).
  if (look.accessory === 'glasses') {
    accessoryParts.push(ringGeo(0.062, 0.016, -eyeX, eyeY, eyeZ + 0.02)); // L rim
    accessoryParts.push(ringGeo(0.062, 0.016, eyeX, eyeY, eyeZ + 0.02)); // R rim
    accessoryParts.push(box(0.08, 0.016, 0.016, 0, eyeY, eyeZ + 0.04)); // bridge
    // Temple arms back toward the ears.
    accessoryParts.push(box(0.016, 0.016, 0.14, -0.135, eyeY, eyeZ - 0.08));
    accessoryParts.push(box(0.016, 0.016, 0.14, 0.135, eyeY, eyeZ - 0.08));
  }

  // ---- Build the per-material merged static meshes. Smooth normals so the rounded forms gradient.
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

  // Hair always has at least one part above. Merge it.
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

  // Eyes mesh — only present when this face uses eyes (visor faces have none). Flat-ish gloss.
  let eyeGeo: THREE.BufferGeometry | null = null;
  let eyeMesh: THREE.Mesh | null = null;
  if (eyeParts.length > 0) {
    eyeGeo = mergeGeometries(eyeParts, false);
    for (const p of eyeParts) p.dispose();
    eyeGeo.computeVertexNormals();
    eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    eyeMesh.castShadow = false; // tiny inset detail; skip its shadow
    group.add(eyeMesh);
  }

  // Trim (shirt V / neckline / catch-lights / drawstrings) — its own merged static mesh.
  let trimGeo: THREE.BufferGeometry | null = null;
  let trimMesh: THREE.Mesh | null = null;
  if (trimParts.length > 0) {
    trimGeo = mergeGeometries(trimParts, false);
    for (const p of trimParts) p.dispose();
    trimGeo.computeVertexNormals();
    trimMesh = new THREE.Mesh(trimGeo, trimMat);
    trimMesh.castShadow = true;
    group.add(trimMesh);
  }

  // The dress skirt is on the LEG material — its own static mesh so the leg colour flares below.
  let skirtGeo: THREE.BufferGeometry | null = null;
  let skirtMesh: THREE.Mesh | null = null;
  if (legParts.length > 0) {
    skirtGeo = mergeGeometries(legParts, false);
    for (const p of legParts) p.dispose();
    skirtGeo.computeVertexNormals();
    skirtMesh = new THREE.Mesh(skirtGeo, legMat);
    skirtMesh.castShadow = true;
    group.add(skirtMesh);
  }

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

  // A small rounded shoulder bag (accessory) at the hip — its own static mesh on the accessory mat.
  let bagGeo: THREE.BufferGeometry | null = null;
  if (look.accessory === 'bag') {
    bagGeo = capsule(0.11, 0.22, 0.27, -0.14, 0.12, 1.1, 0.7);
    bagGeo.computeVertexNormals();
    const bagMesh = new THREE.Mesh(bagGeo, accessoryMat);
    bagMesh.castShadow = true;
    group.add(bagMesh);
  }

  // ---- Limbs. Legs: trouser capsule (legMat) + a shaped SHOE (toe + heel, shoeMat). Arms: sleeve
  // (garmentMat) + a real HAND (palm + thumb, skinMat). Geometry is SHARED across the two legs /
  // two arms; only the meshes + pivots differ. Each limb hangs DOWN from its pivot.
  // Legs span from pivot (~-0.04) down to the foot (~-0.84): capsule centred at y≈-0.42.
  const trouserGeo = capsule(0.105, 0.78, 0, -0.4, 0, 1.0, 1.0); // trouser leg, top at pivot
  trouserGeo.computeVertexNormals();
  // Shaped shoe: a sole + heel + toe lift, built once and shared. Toe points +Z (forward).
  const shoeGeo = makeShoe();
  shoeGeo.computeVertexNormals();

  // Arm sleeve (garment) hangs from the shoulder pivot; the hand is a real shaped hand on skin.
  const sleeveGeo = capsule(0.078, 0.5, 0, -0.25, 0, 1.0, 1.0); // sleeve capsule
  sleeveGeo.computeVertexNormals();
  const handGeo = makeHand(); // palm + thumb, around y≈-0.54 in the pivot frame
  handGeo.computeVertexNormals();

  function makeLeg(x: number): THREE.Group {
    const trouser = new THREE.Mesh(trouserGeo, legMat);
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    trouser.castShadow = true;
    shoe.castShadow = true;
    const pivot = limb(trouser, x, -0.04);
    pivot.add(shoe);
    return pivot;
  }
  function makeArm(x: number, mirror: boolean): THREE.Group {
    const sleeve = new THREE.Mesh(sleeveGeo, garmentMat);
    const hand = new THREE.Mesh(handGeo, skinMat);
    if (mirror) hand.scale.x = -1; // mirror the thumb for the left hand
    sleeve.castShadow = true;
    hand.castShadow = true;
    const pivot = limb(sleeve, x, 0.36);
    pivot.add(hand);
    return pivot;
  }

  const leftLeg = makeLeg(-0.115);
  const rightLeg = makeLeg(0.115);
  const leftArm = makeArm(-0.285, true);
  const rightArm = makeArm(0.285, false);
  group.add(leftLeg, rightLeg, leftArm, rightArm);

  // ---- Optional WEAPON. A blended spy hides their gun: it's parented to the RIGHT arm pivot near
  // the hand and HIDDEN by default, drawn only when the rig aims (animate's aimAmount > 0). A tiny
  // stylised pistol: a dark body capsule + a short barrel + a stubby grip — two cheap materials.
  // A `muzzle` empty Object3D at the barrel tip lets the view read the world muzzle pose. The
  // weapon recoils on fire (a quick decaying jolt) driven from the animate update (framerate-
  // independent), so it reads as a real shot kick.
  let weaponMat: THREE.MeshStandardMaterial | null = null;
  let barrelMat: THREE.MeshStandardMaterial | null = null;
  let weaponGeo: THREE.BufferGeometry | null = null;
  let barrelGeo: THREE.BufferGeometry | null = null;
  let weaponPivot: THREE.Group | null = null; // holds the gun; recoils locally
  const muzzle = new THREE.Object3D(); // empty marker at the barrel tip
  if (opts?.hasWeapon) {
    weaponMat = makeMat(0x2a2d34, 0.5, 0.55); // dark gunmetal
    barrelMat = makeMat(0x16181d, 0.45, 0.6);
    // Build the gun in a small local frame, then place it in the hand. The pistol points +Z
    // (forward) so when the arm levels forward it aims where the avatar faces.
    const bodyG = box(0.07, 0.1, 0.22, 0, 0, 0.04); // slide/body
    const barrelG = box(0.045, 0.05, 0.16, 0, 0.01, 0.2); // barrel forward
    const gripG = box(0.06, 0.14, 0.06, 0, -0.1, -0.02); // grip down
    weaponGeo = mergeGeometries([bodyG, gripG], false);
    bodyG.dispose();
    gripG.dispose();
    barrelG.dispose();
    weaponGeo.computeVertexNormals();
    barrelGeo = box(0.045, 0.05, 0.16, 0, 0.01, 0.2);
    barrelGeo.computeVertexNormals();
    const gunBody = new THREE.Mesh(weaponGeo, weaponMat);
    const gunBarrel = new THREE.Mesh(barrelGeo, barrelMat);
    gunBody.castShadow = true;
    gunBarrel.castShadow = true;
    // The muzzle marker sits at the barrel tip (local +Z) so getMuzzle() reads its world pose.
    muzzle.position.set(0, 0.01, 0.3);
    weaponPivot = new THREE.Group();
    weaponPivot.add(gunBody, gunBarrel, muzzle);
    // Place the gun in the right hand: at the hand position in the arm-pivot frame (y≈-0.54),
    // nudged forward so it reads as held. The arm pose (below) raises it to aim.
    weaponPivot.position.set(0, -0.5, 0.06);
    weaponPivot.visible = false;
    rightArm.add(weaponPivot);
  }

  // ---- Procedural walk/idle animation (UNCHANGED math — preserve the landed walk-cycle fix:
  // framerate-independent smoothed-speed EMA, a continuous gait-weight blend, randomised phase).
  const SPEED_TAU = 0.12; // smoothing time-constant (s) for the speed follow
  const IDLE_FREQ = 2.2; // breathing/idle bob rate (rad/s)
  const RECOIL_TAU = 0.05; // recoil decay time-constant (s) — settles over ~150ms
  // Aim-pose target rotations for the arms (radians) when fully shouldered. The right arm raises
  // forward (negative X swings it up/forward), the left braces in. The torso turns a touch.
  const AIM_RIGHT_X = -1.45;
  const AIM_LEFT_X = -1.15;
  let smoothedSpeed = 0;
  let recoil = 0; // 0..1 recoil energy, decays each frame; jolts the weapon/arm back
  let phase = Math.random() * Math.PI * 2; // de-sync the crowd (cosmetic render only)
  const animate = (dt: number, speed: number, aimAmount = 0): void => {
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

    // Aim blend (0..1). At 0 the arms keep their counter-swing exactly as before (back-compat).
    // As it rises, the arms raise into a level firing pose and the gun is shown + recoils.
    const aim = aimAmount < 0 ? 0 : aimAmount > 1 ? 1 : aimAmount;
    // Recoil decays toward 0 (framerate-independent); jolt added by fireRecoil() below.
    recoil += (0 - recoil) * (1 - Math.exp(-dt / RECOIL_TAU));
    const kick = recoil * aim; // only kicks while aiming
    const walkRight = s * 0.85;
    const walkLeft = -s * 0.85;
    // Blend each arm from its walk swing toward the aim pose; recoil pushes the right arm UP
    // (muzzle-rise) by a small amount that settles as recoil decays.
    rightArm.rotation.x = walkRight + (AIM_RIGHT_X - walkRight) * aim - kick * 0.35;
    leftArm.rotation.x = walkLeft + (AIM_LEFT_X - walkLeft) * aim;
    // A faint torso yaw + the weapon draw while aiming.
    if (weaponPivot) {
      weaponPivot.visible = aim > 0.02;
      // Recoil jolts the gun straight back (local -Z) a touch, then it settles.
      weaponPivot.position.z = 0.06 - kick * 0.06;
    }
    // Faint breathing bob, faded out as the stride takes over (gait→1 zeroes it smoothly).
    const bob = Math.sin(phase) * 0.015 * (1 - gait);
    body.position.y = bob;
    skinMesh.position.y = bob;
    hairMesh.position.y = bob;
    accentMesh.position.y = bob;
    if (eyeMesh) eyeMesh.position.y = bob;
    if (trimMesh) trimMesh.position.y = bob;
    if (skirtMesh) skirtMesh.position.y = bob;
    if (accessoryMesh) accessoryMesh.position.y = bob;
  };

  // Trigger a quick recoil kick. The decay is driven from animate() (framerate-independent),
  // so this just injects energy — allocation-free, safe to spam.
  const fireRecoil = (): void => {
    recoil = 1;
  };

  // Read the muzzle's WORLD position + forward direction (the gun's local +Z in world space).
  // Reuses scratch vectors so there's no per-call allocation. When the avatar has no weapon, the
  // muzzle marker was never parented into the scene graph, so its world transform is the rig
  // origin facing +Z — callers only use this for players (hasWeapon), where it's meaningful.
  const muzzlePos = new THREE.Vector3();
  const muzzleDir = new THREE.Vector3();
  const muzzleOut = { pos: muzzlePos, dir: muzzleDir };
  const getMuzzle = (): { pos: THREE.Vector3; dir: THREE.Vector3 } => {
    muzzle.updateWorldMatrix(true, false);
    muzzlePos.setFromMatrixPosition(muzzle.matrixWorld);
    // Forward = the marker's local +Z transformed to world, minus its world position.
    muzzleDir.set(0, 0, 1).transformDirection(muzzle.matrixWorld).normalize();
    return muzzleOut;
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
    fireRecoil,
    getMuzzle,
    setTier,
    setBrightness,
    setOpacity,
    setEmissive,
    dispose: () => {
      upperGeo.dispose();
      skinGeo.dispose();
      hairGeo.dispose();
      accentGeo.dispose();
      if (eyeGeo) eyeGeo.dispose();
      if (trimGeo) trimGeo.dispose();
      if (skirtGeo) skirtGeo.dispose();
      if (accessoryGeo) accessoryGeo.dispose();
      if (bagGeo) bagGeo.dispose();
      trouserGeo.dispose();
      shoeGeo.dispose();
      sleeveGeo.dispose();
      handGeo.dispose();
      if (weaponGeo) weaponGeo.dispose();
      if (barrelGeo) barrelGeo.dispose();
      garmentMat.dispose();
      legMat.dispose();
      shoeMat.dispose();
      skinMat.dispose();
      hairMat.dispose();
      accessoryMat.dispose();
      eyeMat.dispose();
      trimMat.dispose();
      if (weaponMat) weaponMat.dispose();
      if (barrelMat) barrelMat.dispose();
      accent.dispose();
    },
  };
}

export interface AvatarBody {
  group: THREE.Group;
  /** Representative upper-body mesh (views reference it). */
  body: THREE.Mesh;
  /** BACK-COMPAT: the TIER-ACCENT material (kept so existing references keep working). */
  material: THREE.MeshStandardMaterial;
  /** Drive the procedural walk/idle animation. `dt` seconds, `speed` in m/s (planar). The
   * optional `aimAmount` (0..1, default 0) blends the upper body into an AIM pose and shows the
   * weapon (if built); at 0 the rig behaves EXACTLY as before (back-compat for NpcView/Gallery). */
  animate(dt: number, speed: number, aimAmount?: number): void;
  /** Inject a quick decaying recoil kick (weapon jolts back + muzzle-rise). No-op visually unless
   * the rig is aiming + has a weapon. Allocation-free; the decay runs in animate(). */
  fireRecoil(): void;
  /** Read the weapon muzzle's WORLD position + aim direction (forward). Reuses scratch vectors —
   * do NOT retain the returned object across frames. Meaningful only when built with hasWeapon. */
  getMuzzle(): { pos: THREE.Vector3; dir: THREE.Vector3 };
  /** Set the clearance-tier accent colour (armband/stripe/visor). Remembers it as that material's base. */
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

// --- Rounded helper forms -----------------------------------------------------------------------

/**
 * An upper HEMISPHERE of radius `r` centred at (x, y, z) — open underside removed so it sits as a
 * smooth hair/cap dome on the head. phiLength covers the top half only.
 */
function hemisphere(r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * A thin VISOR/BROW band conforming to the rounded head: a thin partial cylindrical shell wrapping
 * the FRONT of the face at radius `r`, centred at `y`, so it reads as a tier band across the brow.
 * Open-ended and front-arc-only so it hugs the rounded head rather than poking out as a box.
 */
function browBand(r: number, y: number): THREE.BufferGeometry {
  // A short open cylinder, front ~120° arc, thin in height. thetaStart centred on +Z.
  const arc = Math.PI * 0.7;
  const g = new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.05, 12, 1, true, -arc / 2 + Math.PI / 2, arc);
  g.translate(0, y, 0);
  return g;
}

/**
 * A sleek wraparound VISOR shell over the eyes (the spy read) — a front arc of a slightly flattened
 * sphere shell sitting just proud of the face, tilted to wrap the cheeks. Centred on the head at
 * radius `r`, vertical centre `y`. Drawn on the tier-accent material so it tints to the clearance.
 */
function visorShell(r: number, y: number, _z: number): THREE.BufferGeometry {
  // A sleek slim wraparound band across the FRONT eye line. Built as a thin equatorial slice of a
  // sphere shell (front ~140° horizontal arc, a narrow vertical band), centred on the head centre
  // (y≈0.74) then nudged so the band's middle lands at the requested eye height `y`.
  const arc = Math.PI * 0.78; // front horizontal coverage (cheeks to cheeks)
  const headCY = 0.71; // head centre the slice is built around
  const phiMid = Math.PI / 2 + (headCY - y) / r; // latitude that maps to eye height
  const phiHalf = Math.PI * 0.075; // thin vertical band
  const g = new THREE.SphereGeometry(
    r * 1.04,
    16,
    4,
    -arc / 2 + Math.PI / 2,
    arc, // front horizontal arc centred on +Z
    phiMid - phiHalf,
    phiHalf * 2, // a thin vertical band around the eye line
  );
  g.scale(1.0, 1.0, 1.06); // stand proud of the face in Z
  g.translate(0, headCY, 0);
  return g;
}

/**
 * A smooth FLARED SKIRT (open cone) for the dress archetype: radius `rTop` at the waist flaring to
 * `rBot` at the hem, total height `h`, with its TOP rim at `yTop` (so it hangs DOWN from the waist).
 * Low radial count keeps it cheap while reading as a soft bell.
 */
function flaredSkirt(rTop: number, rBot: number, h: number, yTop: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 16, 1, false);
  // Created centred at origin (y in [-h/2, +h/2]); shift so the TOP rim reaches yTop.
  g.translate(0, yTop - h / 2, 0);
  return g;
}

/**
 * An open HOOD shell draped behind/around the neck for the hoodie archetype — a back-and-sides arc
 * of a sphere shell so the neck stays open at the front (reads as a down hood). Centre (x,y,z),
 * radius `r`.
 */
function hoodShell(r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  // A back-of-neck cowl: a wide FRONT opening so it only drapes behind + to the sides (never under
  // the chin). The opening faces +Z; the remaining arc wraps the back. Lower half only.
  const open = Math.PI * 1.0; // big front opening — leaves the front clear
  const g = new THREE.SphereGeometry(r, 16, 10, Math.PI / 2 + open / 2, Math.PI * 2 - open, Math.PI * 0.25, Math.PI * 0.55);
  g.scale(1.1, 0.9, 1.15);
  g.translate(x, y, z);
  return g;
}

/**
 * A small flat-ish TRIANGLE panel (a thin V wedge) for the exposed shirt at the chest. Built from a
 * shallow cone with 3 radial segments, point DOWN, centred near (x, y, z). `w` half-width, `h`
 * height, `zf` forward offset.
 */
function triPanel(x: number, y: number, w: number, h: number, zf: number): THREE.BufferGeometry {
  // A 3-sided shallow cone makes a crisp downward wedge; flatten it onto the chest plane.
  const g = new THREE.ConeGeometry(w, h, 3, 1, false);
  g.rotateY(Math.PI); // point a flat face forward
  g.scale(1.0, 1.0, 0.18); // flatten to a thin panel
  g.rotateX(Math.PI); // point the apex DOWN
  g.translate(x, y, zf);
  return g;
}

/**
 * A curved CAP PEAK (brim) — a shallow front arc of a flattened disc that sweeps forward over the
 * brow. Radius `r`, vertical centre `y`, forward offset `zf`.
 */
function capPeak(r: number, y: number, zf: number): THREE.BufferGeometry {
  const arc = Math.PI * 0.9;
  const g = new THREE.CircleGeometry(r * 0.7, 12, -arc / 2 + Math.PI / 2, arc);
  g.rotateX(-Math.PI / 2 + 0.35); // lay it forward + a slight downward tilt
  g.scale(1.0, 1.0, 0.9);
  g.translate(0, y, zf);
  return g;
}

/**
 * A thin RING (torus) for glasses lens rims. Major radius `r`, tube `t`, centred at (x, y, z),
 * facing +Z.
 */
function ringGeo(r: number, t: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, t, 6, 12);
  g.translate(x, y, z);
  return g;
}

/**
 * A shaped SHOE for a leg pivot: a rounded sole/foot with a raised heel and a lifted toe, pointing
 * +Z (forward). Built once and shared across both legs. Foot sits at the bottom of the leg
 * (y≈-0.8 in the pivot frame). Merged into one geometry.
 */
function makeShoe(): THREE.BufferGeometry {
  const footY = -0.84; // sole height, so the foot sits flat on the floor (~ -0.9)
  const parts: THREE.BufferGeometry[] = [];
  // Main foot body — a low elongated rounded sole, longer forward, flatter than a blob.
  parts.push(roundedFoot(0.105, 0.05, 0.28, 0, footY, 0.05));
  // Toe cap — a small flattened dome at the front for a clean toe read.
  parts.push(sphere(0.062, 0, footY + 0.012, 0.2, 10, 8).scale(1.0, 0.7, 1.2));
  // Heel — a small low block at the back.
  parts.push(box(0.12, 0.045, 0.07, 0, footY - 0.005, -0.05));
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** A rounded foot/sole block: a capsule lying along Z, flattened in Y to a low shoe sole. */
function roundedFoot(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(h, Math.max(0.001, d - 2 * h), 3, 10);
  g.rotateX(Math.PI / 2); // lie along Z
  g.scale(w / h, 0.7, 1.0); // widen across X, flatten in Y → a low sole
  g.translate(x, y, z);
  return g;
}

/**
 * A shaped HAND for an arm pivot: a rounded palm with a stubby thumb, sitting at the sleeve cuff
 * (y≈-0.54 in the pivot frame). Built once and shared; the left arm mirrors it in X. Merged.
 */
function makeHand(): THREE.BufferGeometry {
  const handY = -0.54;
  const parts: THREE.BufferGeometry[] = [];
  // Palm — a slightly flattened ellipsoid.
  parts.push(sphere(0.072, 0, handY, 0, 12, 9).scale(0.82, 1.0, 0.7));
  // Fingers — a small rounded block extending down/forward from the palm.
  parts.push(box(0.095, 0.065, 0.07, 0, handY - 0.055, 0.01));
  // Thumb — a small capsule angled off the +X side. Build at the ORIGIN, tilt, THEN translate to
  // the palm so the tilt doesn't swing it wide (a rotate-after-translate bug widens the bbox).
  const thumb = capsule(0.022, 0.07, 0, 0, 0);
  thumb.rotateZ(0.6); // tilt the thumb out
  thumb.translate(0.05, handY + 0.01, 0.02); // then place it at the side of the palm
  parts.push(thumb);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}
