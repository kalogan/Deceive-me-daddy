// Shopping-mall set-dressing builders — a bright, clean modern indoor mall kit. Each returns
// an ArtProp (a self-contained THREE.Group + the materials it owns + dispose()) using the SAME
// Builder accumulator + disposal contract as art/props.ts (imported, never forked) so MapView
// and the preview gallery build the `shopping_mall` theme from ONE source of truth.
//
// Convention (matches the existing prop kit): each builder is centered at local origin with its
// base at y=0, so MapView can placeProp(prop, [x, 0, z]). Static, low-poly, emissive accents via
// glowBox, glass via a transparent MeshStandardMaterial. No external assets, no Math.random/Date.now.
import * as THREE from 'three';
import { Builder, type ArtProp } from './props';

// Mall palette — shared so MapView and the gallery agree on "what the mall looks like": bright,
// clean, lots of glass, white columns and colourful storefront signage.
export const MALL_FLOOR = 0xe6e2d8; // polished light cream/grey tile
export const MALL_WALL = 0xf4f2ec; // white / off-white wall
export const MALL_PILLAR = 0xfbfbf8; // white column
export const MALL_ACCENT = 0x2fd6c0; // friendly storefront sign hue (teal)
export const MALL_GLASS = 0xbfe4ef; // pale glass blue

// Neutral structural tones shared across the mall builders.
const MALL_FRAME = 0x8c9098; // brushed aluminium storefront / handrail frame
const MALL_TRIM_DARK = 0x3a3d44; // dark counter / kiosk body
const MALL_SOIL = 0x2a221c; // planter soil
const PLANT_GREEN = 0x4fae5f; // indoor shrub foliage
const PLANT_DEEP = 0x3a8a4a; // deeper shrub foliage

/**
 * A STOREFRONT facade: an aluminium frame around a big translucent glass window with a glowing
 * sign band across the top. `width` stretches the shop front; `signColor` tints the sign glow.
 * ~3.2 tall.
 */
export function buildStorefront(width = 5, signColor = MALL_ACCENT): ArtProp {
  const b = new Builder();
  const height = 3.2;
  const frameT = 0.16;
  // Side mullions + a sill at the floor.
  b.box(frameT, height, frameT, MALL_FRAME, { roughness: 0.5, metalness: 0.5 }).position.set(-width / 2, height / 2, 0);
  b.box(frameT, height, frameT, MALL_FRAME, { roughness: 0.5, metalness: 0.5 }).position.set(width / 2, height / 2, 0);
  b.box(width, frameT, frameT, MALL_FRAME, { roughness: 0.5, metalness: 0.5 }).position.set(0, frameT / 2, 0);
  // Big translucent glass window filling the opening.
  const glassGeo = b.ownGeo(new THREE.BoxGeometry(width - frameT, height - 1.0, 0.04));
  const glass = b.own(
    new THREE.MeshStandardMaterial({
      color: MALL_GLASS,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.4,
    }),
  );
  const pane = new THREE.Mesh(glassGeo, glass);
  pane.position.set(0, (height - 1.0) / 2 + frameT, 0);
  b.group.add(pane);
  // Glowing sign band across the top.
  b.glowBox(width, 0.6, 0.1, signColor, 1.2, { roughness: 0.35 }).position.set(0, height - 0.3, 0.04);
  return b.finish();
}

/**
 * An ESCALATOR: an inclined ramp box (with a stepped emissive accent strip) running between two
 * newel posts, plus a side handrail. Spans ~4 long, rising ~2.2.
 */
export function buildEscalator(): ArtProp {
  const b = new Builder();
  const span = 4.0;
  const rise = 2.2;
  const angle = Math.atan2(rise, span);
  const rampLen = Math.hypot(span, rise);
  const midX = 0;
  const midY = rise / 2;
  // Two newel posts (low end + high end housing).
  b.box(1.2, 0.6, 1.2, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(-span / 2, 0.3, 0);
  b.box(1.2, rise + 0.6, 1.2, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(
    span / 2,
    (rise + 0.6) / 2,
    0,
  );
  // The inclined step deck.
  const deck = b.box(rampLen, 0.3, 1.0, MALL_TRIM_DARK, { roughness: 0.7 });
  deck.position.set(midX, midY + 0.3, 0);
  deck.rotation.z = angle;
  // Glowing comb / step accent strip along the deck top.
  const strip = b.glowBox(rampLen, 0.04, 0.9, MALL_ACCENT, 0.7, { roughness: 0.4 });
  strip.position.set(midX, midY + 0.46, 0);
  strip.rotation.z = angle;
  // Side handrail (a slim balustrade panel along the incline) + its top rail.
  const railPanel = b.box(rampLen, 0.7, 0.06, MALL_TRIM_DARK, { roughness: 0.7 });
  railPanel.position.set(midX, midY + 0.85, 0.52);
  railPanel.rotation.z = angle;
  const topRail = b.box(rampLen, 0.12, 0.16, MALL_FRAME, { roughness: 0.45, metalness: 0.5 });
  topRail.position.set(midX, midY + 1.24, 0.52);
  topRail.rotation.z = angle;
  return b.finish();
}

/**
 * A FOUNTAIN: a tiered circular fountain — a low basin cylinder + a smaller raised upper tier +
 * a small emissive "water" hint disc. `radius` sizes the basin.
 */
export function buildFountain(radius = 2.2): ArtProp {
  const b = new Builder();
  const basinH = 0.5;
  // Outer basin wall.
  b.cylinder(radius, basinH, MALL_PILLAR, { roughness: 0.5 }).position.set(0, basinH / 2, 0);
  // Water sheet in the basin (low, faintly glowing pale blue).
  b.glowBox(radius * 1.4, 0.04, radius * 1.4, MALL_GLASS, 0.3, { roughness: 0.2 }).position.set(0, basinH - 0.06, 0);
  // Pedestal + smaller upper tier bowl.
  b.cylinder(radius * 0.32, 0.6, MALL_PILLAR, { roughness: 0.5 }).position.set(0, basinH + 0.3, 0);
  b.cylinder(radius * 0.5, 0.18, MALL_PILLAR, { roughness: 0.5 }).position.set(0, basinH + 0.6, 0);
  // Upper water hint + a small central spout glow.
  b.glowBox(radius * 0.7, 0.03, radius * 0.7, MALL_GLASS, 0.35, { roughness: 0.2 }).position.set(0, basinH + 0.7, 0);
  b.glowBox(0.12, 0.5, 0.12, MALL_GLASS, 0.5, { roughness: 0.2 }).position.set(0, basinH + 0.95, 0);
  return b.finish();
}

/**
 * A FOOD-COURT SET: a round cafe table on a stem + two stools, topped with a small tilted
 * umbrella. `umbrellaColor` tints the parasol.
 */
export function buildFoodCourtSet(umbrellaColor = MALL_ACCENT): ArtProp {
  const b = new Builder();
  // Table: stem + round top.
  b.cylinder(0.06, 0.72, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(0, 0.36, 0);
  b.cylinder(0.55, 0.06, MALL_PILLAR, { roughness: 0.4 }).position.set(0, 0.72, 0);
  // Two stools.
  for (const dx of [-0.85, 0.85]) {
    b.cylinder(0.05, 0.46, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(dx, 0.23, 0);
    b.cylinder(0.22, 0.07, MALL_TRIM_DARK, { roughness: 0.6 }).position.set(dx, 0.46, 0);
  }
  // Small umbrella: pole + a shallow cone canopy with a glowing rim.
  b.cylinder(0.035, 1.5, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(0, 1.45, 0);
  const canopyGeo = b.ownGeo(new THREE.ConeGeometry(1.0, 0.4, 14, 1, true));
  const canopyMat = b.own(
    new THREE.MeshStandardMaterial({ color: umbrellaColor, roughness: 0.7, side: THREE.DoubleSide }),
  );
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.0, 0);
  b.group.add(canopy);
  b.glowBox(0.04, 0.04, 0.04, umbrellaColor, 1.0).position.set(0, 2.22, 0);
  return b.finish();
}

/**
 * A long low indoor PLANTER with a couple of rounded shrub blobs. `length` stretches the box.
 */
export function buildMallPlanter(length = 2.6): ArtProp {
  const b = new Builder();
  const boxH = 0.45;
  const depth = 0.6;
  // Planter box + soil cap.
  b.box(length, boxH, depth, MALL_PILLAR, { roughness: 0.7 }).position.set(0, boxH / 2, 0);
  b.box(length - 0.1, 0.06, depth - 0.1, MALL_SOIL, { roughness: 0.95 }).position.set(0, boxH, 0);
  // A few green shrub blobs (spheres) of alternating tone along the run.
  const n = Math.max(2, Math.round(length / 0.9));
  const blobGeo = b.ownGeo(new THREE.SphereGeometry(0.34, 12, 10));
  const greenA = b.own(new THREE.MeshStandardMaterial({ color: PLANT_GREEN, roughness: 0.85 }));
  const greenB = b.own(new THREE.MeshStandardMaterial({ color: PLANT_DEEP, roughness: 0.85 }));
  for (let i = 0; i < n; i += 1) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    const blob = new THREE.Mesh(blobGeo, i % 2 === 0 ? greenA : greenB);
    const s = 0.85 + (i % 3) * 0.14;
    blob.scale.set(s, s * 0.8, s);
    blob.position.set(x, boxH + 0.2, 0);
    blob.castShadow = true;
    b.group.add(blob);
  }
  return b.finish();
}

/**
 * A freestanding "you are here" DIRECTORY kiosk: a slim plinth holding an angled board with an
 * emissive screen panel.
 */
export function buildDirectory(): ArtProp {
  const b = new Builder();
  // Base + upright stalk.
  b.box(0.7, 0.12, 0.5, MALL_TRIM_DARK, { roughness: 0.6 }).position.set(0, 0.06, 0);
  b.box(0.18, 1.2, 0.18, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(0, 0.7, 0);
  // Board housing + a glowing screen panel, tilted toward the viewer.
  const housing = b.box(1.0, 1.2, 0.1, MALL_TRIM_DARK, { roughness: 0.6 });
  housing.position.set(0, 1.5, 0.04);
  housing.rotation.x = -0.18;
  const screen = b.glowBox(0.88, 1.04, 0.06, MALL_ACCENT, 1.0, { roughness: 0.35 });
  screen.position.set(0, 1.5, 0.11);
  screen.rotation.x = -0.18;
  return b.finish();
}

/**
 * A small island retail KIOSK: a counter base + a little canopy roof on corner posts + a glowing
 * trim under the canopy. `accent` tints the trim glow.
 */
export function buildKiosk(accent = MALL_ACCENT): ArtProp {
  const b = new Builder();
  const w = 1.8;
  const d = 1.2;
  // Counter body + worktop.
  b.box(w, 1.0, d, MALL_TRIM_DARK, { roughness: 0.6 }).position.set(0, 0.5, 0);
  b.box(w + 0.16, 0.1, d + 0.16, MALL_PILLAR, { roughness: 0.4 }).position.set(0, 1.05, 0);
  // Four corner posts up to the canopy.
  for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) {
    for (const dz of [-d / 2 + 0.1, d / 2 - 0.1]) {
      b.box(0.08, 1.2, 0.08, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(dx, 1.7, dz);
    }
  }
  // Canopy roof + a glowing trim band under its edge.
  b.box(w + 0.4, 0.12, d + 0.4, MALL_PILLAR, { roughness: 0.5 }).position.set(0, 2.36, 0);
  b.glowBox(w + 0.4, 0.08, d + 0.4, accent, 1.1, { roughness: 0.35 }).position.set(0, 2.26, 0);
  return b.finish();
}

/**
 * An upper-floor glass BALUSTRADE: a translucent glass panel with a top rail and end posts.
 * `length` is the run.
 */
export function buildBalconyRail(length = 4): ArtProp {
  const b = new Builder();
  const railH = 1.05;
  // End posts.
  b.box(0.1, railH, 0.1, MALL_FRAME, { roughness: 0.45, metalness: 0.5 }).position.set(-length / 2, railH / 2, 0);
  b.box(0.1, railH, 0.1, MALL_FRAME, { roughness: 0.45, metalness: 0.5 }).position.set(length / 2, railH / 2, 0);
  // Top rail.
  b.box(length, 0.1, 0.16, MALL_FRAME, { roughness: 0.45, metalness: 0.5 }).position.set(0, railH, 0);
  // The translucent glass infill panel.
  const glassGeo = b.ownGeo(new THREE.BoxGeometry(length - 0.12, railH - 0.18, 0.04));
  const glass = b.own(
    new THREE.MeshStandardMaterial({
      color: MALL_GLASS,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.32,
    }),
  );
  const pane = new THREE.Mesh(glassGeo, glass);
  pane.position.set(0, (railH - 0.18) / 2 + 0.04, 0);
  b.group.add(pane);
  return b.finish();
}

/**
 * A vertical hanging SALE BANNER: an emissive coloured cloth panel suspended on a top bar by two
 * short drop stems. `width` sizes the cloth; `color` tints it.
 */
export function buildHangingBanner(width = 2, color = MALL_ACCENT): ArtProp {
  const b = new Builder();
  const clothH = 3.0;
  // Top bar.
  b.box(width + 0.2, 0.1, 0.1, MALL_FRAME, { roughness: 0.5, metalness: 0.4 }).position.set(0, clothH, 0);
  // Two drop stems from the bar.
  for (const dx of [-width / 2 + 0.1, width / 2 - 0.1]) {
    b.box(0.03, 0.2, 0.03, MALL_FRAME, { roughness: 0.6 }).position.set(dx, clothH - 0.1, 0);
  }
  // The emissive cloth panel hanging below the bar.
  b.glowBox(width, clothH - 0.3, 0.04, color, 0.9, { roughness: 0.5 }).position.set(0, (clothH - 0.3) / 2 + 0.05, 0);
  return b.finish();
}

/**
 * A modern backless mall BENCH: a slatted seat slab on two block plinths.
 */
export function buildBenchSeat(): ArtProp {
  const b = new Builder();
  const len = 1.8;
  const seatY = 0.45;
  // Two plinth supports.
  b.box(0.3, seatY, 0.55, MALL_TRIM_DARK, { roughness: 0.6 }).position.set(-len / 2 + 0.3, seatY / 2, 0);
  b.box(0.3, seatY, 0.55, MALL_TRIM_DARK, { roughness: 0.6 }).position.set(len / 2 - 0.3, seatY / 2, 0);
  // Seat slab + a couple of slat lines suggested by thin lighter strips.
  b.box(len, 0.1, 0.55, MALL_PILLAR, { roughness: 0.5 }).position.set(0, seatY + 0.05, 0);
  for (const dz of [-0.16, 0.16]) {
    b.box(len, 0.04, 0.06, MALL_FRAME, { roughness: 0.5, metalness: 0.3 }).position.set(0, seatY + 0.11, dz);
  }
  return b.finish();
}
