// TRAIN STATION (train_station) set-dressing — a clean, slightly warm transit-hall kit. Cool
// stone/terrazzo floors and light concrete walls under warm amber + safety-yellow signage. Like
// the facility/neon/beach kits in ./props, both the in-game MapView AND the preview gallery build
// these from THESE functions (never a fork), so a tweak in the preview is exactly what ships.
//
// Shares the SAME accumulator + disposal contract as the rest of the prop kit: each builder spins
// up a new Builder, adds a handful of low-poly boxes/cylinders with glowBox emissive accents, and
// returns b.finish(). All STATIC (MapView has no per-frame tick), deterministic (no Math.random /
// Date.now — any variation is derived from an arg), centered at local origin with its base at y=0
// so MapView can placeProp(prop, [x, 0, z]).
import * as THREE from 'three';
import { Builder, type ArtProp } from './props';

// Station palette — one source of truth for "what the transit hall looks like" so MapView and the
// gallery agree.
export const STATION_FLOOR = 0xd8d2c4; // pale stone / terrazzo
export const STATION_WALL = 0xc4c2bd; // light concrete
export const STATION_PILLAR = 0x8b8e94; // steel / concrete column
export const STATION_ACCENT = 0xffb13c; // departure-board amber signage glow
export const STATION_TRIM = 0xf4d014; // platform safety yellow

const STATION_DARK = 0x1c1d22; // dark board / housing backer
const STATION_METAL = 0x70747c; // brushed steel fittings

/** A waiting BENCH: a slatted seat + a slatted back on steel end legs. `length` stretches it. */
export function buildBench(length = 2.4): ArtProp {
  const b = new Builder();
  const seatY = 0.45;
  const wood = 0x9c6a3c;
  // Three seat slats running the length of the bench.
  for (const dz of [-0.18, 0, 0.18]) {
    b.box(length, 0.05, 0.13, wood, { roughness: 0.7 }).position.set(0, seatY, dz);
  }
  // Two back slats, tilted back slightly.
  for (const [dy, dz] of [[0.35, -0.24], [0.52, -0.27]] as const) {
    const slat = b.box(length, 0.12, 0.05, wood, { roughness: 0.7 });
    slat.position.set(0, seatY + dy, dz);
    slat.rotation.x = -0.18;
  }
  // Steel end legs (an inverted-U frame at each end).
  for (const dx of [-length / 2 + 0.2, length / 2 - 0.2]) {
    b.box(0.06, seatY, 0.5, STATION_METAL, { roughness: 0.5, metalness: 0.5 }).position.set(dx, seatY / 2, 0);
  }
  return b.finish();
}

/**
 * A DEPARTURE BOARD: a dark board on two posts with several emissive amber signage rows. Top of
 * the board sits ~3.4 tall. `width` stretches the board (and its row count).
 */
export function buildDepartureBoard(width = 4): ArtProp {
  const b = new Builder();
  const boardH = 1.6;
  const boardCenterY = 3.4 - boardH / 2; // top ~3.4
  // Two support posts.
  for (const dx of [-width / 2 + 0.25, width / 2 - 0.25]) {
    b.box(0.14, 3.4 - 0.1, 0.14, STATION_METAL, { roughness: 0.5, metalness: 0.5 }).position.set(
      dx,
      (3.4 - 0.1) / 2,
      0,
    );
  }
  // Dark board backer.
  b.box(width, boardH, 0.14, STATION_DARK, { roughness: 0.8 }).position.set(0, boardCenterY, 0);
  // A header bar + several departure rows, all glowing amber.
  b.glowBox(width - 0.2, 0.16, 0.06, STATION_ACCENT, 1.3, { roughness: 0.35 }).position.set(
    0,
    boardCenterY + boardH / 2 - 0.22,
    0.08,
  );
  const rows = Math.max(3, Math.floor(width / 1.2));
  for (let i = 0; i < rows; i += 1) {
    const y = boardCenterY + boardH / 2 - 0.55 - i * 0.32;
    // Each row: a short "time" block + a long "destination" block.
    b.glowBox(0.5, 0.18, 0.05, STATION_ACCENT, 1.0, { roughness: 0.35 }).position.set(
      -width / 2 + 0.55,
      y,
      0.08,
    );
    b.glowBox(width - 1.7, 0.18, 0.05, STATION_ACCENT, 0.85, { roughness: 0.35 }).position.set(
      0.35,
      y,
      0.08,
    );
  }
  return b.finish();
}

/** A TICKET GATE: a pair of barrier pods flanking a walk-through, each with an emissive top light. */
export function buildTicketGate(): ArtProp {
  const b = new Builder();
  const podY = 0.5;
  for (const dx of [-0.7, 0.7]) {
    // Pod body + an angled brushed-steel top deck.
    b.box(0.5, 1.0, 1.4, STATION_PILLAR, { roughness: 0.6, metalness: 0.3 }).position.set(dx, podY, 0);
    b.box(0.52, 0.06, 1.42, STATION_METAL, { roughness: 0.4, metalness: 0.5 }).position.set(dx, 1.02, 0);
    // Small green "open" indicator light on top.
    b.glowBox(0.16, 0.05, 0.16, 0x4fe08a, 1.2, { roughness: 0.3 }).position.set(dx, 1.08, 0.45);
    // A thin amber reader strip on the inner face.
    const inner = dx > 0 ? -0.26 : 0.26;
    b.glowBox(0.04, 0.1, 0.3, STATION_ACCENT, 1.0).position.set(dx + inner, 0.85, 0.45);
  }
  return b.finish();
}

/**
 * A PLATFORM CANOPY / shelter: a shallow peaked roof on two support columns. Roof underside ~3.2
 * high. `width` stretches the roof + column spread.
 */
export function buildPlatformCanopy(width = 8): ArtProp {
  const b = new Builder();
  const roofY = 3.2;
  const depth = 3.0;
  // Two support columns.
  for (const dx of [-width / 2 + 0.6, width / 2 - 0.6]) {
    b.cylinder(0.16, roofY, STATION_PILLAR, { roughness: 0.6, metalness: 0.3 }).position.set(dx, roofY / 2, 0);
    // A small bracket cap under the roof.
    b.box(0.4, 0.1, depth * 0.7, STATION_METAL, { roughness: 0.5, metalness: 0.4 }).position.set(
      dx,
      roofY - 0.05,
      0,
    );
  }
  // Two shallow roof slabs meeting at a low ridge (a gentle peak).
  for (const side of [-1, 1] as const) {
    const slab = b.box(width, 0.12, depth / 2 + 0.1, STATION_WALL, { roughness: 0.7 });
    slab.position.set(0, roofY + 0.18, (side * depth) / 4);
    slab.rotation.x = side * 0.16;
  }
  // Ridge beam along the apex.
  b.box(width, 0.12, 0.14, STATION_METAL, { roughness: 0.5, metalness: 0.4 }).position.set(0, roofY + 0.34, 0);
  // A warm amber underside light strip running the length.
  b.glowBox(width - 1.0, 0.06, 0.1, STATION_ACCENT, 0.9).position.set(0, roofY - 0.08, 0);
  return b.finish();
}

/** A LUGGAGE CART: a wheeled trolley deck with a push handle and a couple of stacked suitcases. */
export function buildLuggageCart(): ArtProp {
  const b = new Builder();
  const deckY = 0.4;
  // Deck + four small wheels.
  b.box(1.3, 0.08, 0.7, STATION_METAL, { roughness: 0.5, metalness: 0.5 }).position.set(0, deckY, 0);
  for (const dx of [-0.5, 0.5]) {
    for (const dz of [-0.28, 0.28]) {
      const wheel = b.cylinder(0.12, 0.06, STATION_DARK, { roughness: 0.7 });
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, 0.12, dz);
    }
  }
  // Push handle (an inverted-U at one end).
  b.box(0.04, 0.85, 0.04, STATION_METAL, { roughness: 0.5, metalness: 0.5 }).position.set(-0.62, deckY + 0.45, -0.28);
  b.box(0.04, 0.85, 0.04, STATION_METAL, { roughness: 0.5, metalness: 0.5 }).position.set(-0.62, deckY + 0.45, 0.28);
  b.box(0.04, 0.04, 0.62, STATION_METAL, { roughness: 0.5, metalness: 0.5 }).position.set(-0.62, deckY + 0.87, 0);
  // Two stacked suitcases (different sizes / warm tones).
  b.box(0.7, 0.5, 0.5, 0x8a4a32, { roughness: 0.7 }).position.set(0.1, deckY + 0.29, 0);
  b.box(0.6, 0.4, 0.42, 0x40566a, { roughness: 0.7 }).position.set(0.05, deckY + 0.74, 0);
  return b.finish();
}

/**
 * A freestanding PILLAR CLOCK: a station column with a round clock face near the top (two faces,
 * back-to-back so it reads from both sides) ringed by a subtle amber glow. `height` sizes it.
 */
export function buildPillarClock(height = 3.6): ArtProp {
  const b = new Builder();
  // Stepped base + the column.
  b.cylinder(0.3, 0.12, STATION_PILLAR, { roughness: 0.7 }).position.set(0, 0.06, 0);
  b.cylinder(0.16, height - 0.5, STATION_PILLAR, { roughness: 0.6, metalness: 0.3 }).position.set(
    0,
    (height - 0.5) / 2 + 0.12,
    0,
  );
  const faceY = height - 0.35;
  // A drum housing for the clock, then two faces back-to-back (front +Z / back -Z).
  const drum = b.cylinder(0.4, 0.18, STATION_DARK, { roughness: 0.6 });
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, faceY, 0);
  for (const dz of [0.1, -0.1] as const) {
    const face = b.glowBox(0.62, 0.62, 0.02, 0xf4efe6, 0.4, { roughness: 0.4 });
    face.position.set(0, faceY, dz);
    // Two hands per face.
    b.box(0.03, 0.22, 0.01, STATION_DARK, { roughness: 0.4 }).position.set(0, faceY + 0.08, dz + Math.sign(dz) * 0.02);
    b.box(0.26, 0.03, 0.01, STATION_DARK, { roughness: 0.4 }).position.set(0.08, faceY, dz + Math.sign(dz) * 0.02);
  }
  // Subtle amber glow ring around the housing.
  const ringGeo = b.ownGeo(new THREE.TorusGeometry(0.42, 0.03, 8, 30));
  const ringMat = b.own(
    new THREE.MeshStandardMaterial({
      color: STATION_ACCENT,
      emissive: STATION_ACCENT,
      emissiveIntensity: 1.1,
      roughness: 0.3,
    }),
  );
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0, faceY, 0);
  b.group.add(ring);
  return b.finish();
}

/**
 * A stylized low-poly TRAIN CAR / carriage at a platform: a long body + an emissive window strip +
 * a roofline cap, sitting low on a hint of bogies. ~2.6 tall, ~2.6 wide. `length` runs it down the
 * platform.
 */
export function buildTrainCar(length = 12): ArtProp {
  const b = new Builder();
  const carW = 2.6;
  const bodyH = 1.9;
  const sillY = 0.5; // floor of the car sits low, like at a platform
  const bodyCenterY = sillY + bodyH / 2;
  const livery = 0x3d6a8c;
  // Main body.
  b.box(length, bodyH, carW, livery, { roughness: 0.5, metalness: 0.3 }).position.set(0, bodyCenterY, 0);
  // A rounded roofline cap (slightly inset, lighter).
  b.box(length - 0.4, 0.35, carW - 0.3, 0x6a8aa6, { roughness: 0.5, metalness: 0.3 }).position.set(
    0,
    sillY + bodyH + 0.1,
    0,
  );
  // A skirt under the body to ~2.6 tall total cap and to hide the gap.
  b.box(length, sillY, carW - 0.2, 0x2a3a48, { roughness: 0.7 }).position.set(0, sillY / 2, 0);
  // Emissive window strips down both sides (warm interior glow).
  for (const dz of [carW / 2 + 0.01, -carW / 2 - 0.01] as const) {
    b.glowBox(length - 1.2, 0.7, 0.04, 0xfff0cf, 0.8, { roughness: 0.3 }).position.set(0, bodyCenterY + 0.2, dz);
  }
  // A small amber destination/headlamp strip at one end.
  b.glowBox(0.06, 0.4, carW - 0.4, STATION_ACCENT, 1.1).position.set(length / 2 + 0.01, bodyCenterY, 0);
  // Two suggested bogies under the skirt.
  for (const dx of [-length / 2 + 1.5, length / 2 - 1.5]) {
    b.box(1.6, 0.4, carW - 0.4, STATION_DARK, { roughness: 0.7 }).position.set(dx, 0.18, 0);
  }
  return b.finish();
}

/** A thin flat PLATFORM STRIPE — a safety-yellow line laid just above the floor, ~0.04 tall. */
export function buildPlatformStripe(length = 10): ArtProp {
  const b = new Builder();
  b.glowBox(length, 0.04, 0.3, STATION_TRIM, 0.5, { roughness: 0.6 }).position.set(0, 0.02, 0);
  return b.finish();
}

/** A fridge-sized VENDING MACHINE: a dark cabinet with a big emissive front display panel. */
export function buildVendingMachine(): ArtProp {
  const b = new Builder();
  const bodyH = 2.0;
  // Cabinet body.
  b.box(1.1, bodyH, 0.8, STATION_DARK, { roughness: 0.7 }).position.set(0, bodyH / 2, 0);
  // Glowing front product window (cyan-amber backlight).
  b.glowBox(0.8, 1.4, 0.04, 0x33d6e6, 0.9, { roughness: 0.3 }).position.set(0, bodyH / 2 + 0.1, 0.41);
  // A few amber "product" slots suggested across the lit window.
  for (let i = 0; i < 3; i += 1) {
    const y = bodyH / 2 + 0.55 - i * 0.45;
    b.glowBox(0.66, 0.06, 0.02, STATION_ACCENT, 0.8).position.set(0, y, 0.44);
  }
  // Side dispense/keypad panel.
  b.box(0.92, 0.5, 0.04, STATION_PILLAR, { roughness: 0.5 }).position.set(0, 0.4, 0.41);
  b.glowBox(0.12, 0.12, 0.03, STATION_TRIM, 1.0).position.set(0.3, 0.4, 0.44);
  return b.finish();
}

/**
 * A NUMBERED PLATFORM PYLON — the hero wayfinding totem for the Shinagawa find-dad map. A tall slim
 * column topped by a glowing drum, carrying `count` stacked emissive bars (so "Platform 3" reads as
 * three bars) all in this platform's distinct `hue`. The whole top section is washed in the hue so a
 * platform is identifiable at a glance from the concourse above AND tells apart on the minimap. The
 * bars + a beacon cap are visible from both sides. ~`height` tall (default 4.2). PURE / static.
 */
export function buildPlatformPylon(count: number, hue: number, height = 4.2): ArtProp {
  const b = new Builder();
  // Stepped base + the column.
  b.cylinder(0.34, 0.14, STATION_PILLAR, { roughness: 0.7 }).position.set(0, 0.07, 0);
  b.cylinder(0.14, height - 0.6, STATION_PILLAR, { roughness: 0.6, metalness: 0.3 }).position.set(
    0,
    (height - 0.6) / 2 + 0.14,
    0,
  );
  // A dark sign blade backer near the top, hue-washed edge trim so the pylon body reads as coloured.
  const bladeY = height - 1.5;
  b.box(0.9, 1.9, 0.16, STATION_DARK, { roughness: 0.8 }).position.set(0, bladeY, 0);
  for (const dz of [0.1, -0.1] as const) {
    // A vertical hue strip framing each face of the blade.
    for (const dx of [-0.4, 0.4]) {
      b.glowBox(0.06, 1.8, 0.02, hue, 1.2, { roughness: 0.3 }).position.set(dx, bladeY, dz);
    }
  }
  // `count` stacked glowing bars down the centre of the blade (the readable platform number), on
  // BOTH faces so it reads from either side. Bars are sized/spaced to fit any 1..6 count.
  const n = Math.max(1, count);
  const slotTop = bladeY + 0.7;
  const slotSpan = 1.4;
  const step = slotSpan / Math.max(1, n);
  for (const dz of [0.11, -0.11] as const) {
    for (let i = 0; i < n; i += 1) {
      b.glowBox(0.5, Math.min(0.16, step * 0.6), 0.03, hue, 1.4, { roughness: 0.3 }).position.set(
        0,
        slotTop - i * step,
        dz,
      );
    }
  }
  // A bright beacon cap on top — a hue-coloured glowing drum, the "you found it" pin from afar.
  const cap = b.cylinder(0.22, 0.34, hue, {
    emissive: hue,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });
  cap.position.set(0, height + 0.05, 0);
  return b.finish();
}

/**
 * A GATE BEACON — a wayfinding marker that gives the two station ends a DISTINCT identity. A short
 * portal frame (two posts + a lintel) washed in the gate's accent `hue` with a wide glowing header
 * blade, so Takanawa (west) and Konan (east) read as different places and you can orient by them.
 * `width` sets the portal span. PURE / static, base at y=0.
 */
export function buildGateBeacon(hue: number, width = 5): ArtProp {
  const b = new Builder();
  const postH = 3.2;
  for (const dx of [-width / 2, width / 2]) {
    b.box(0.3, postH, 0.3, STATION_PILLAR, { roughness: 0.6, metalness: 0.3 }).position.set(dx, postH / 2, 0);
    // A hue accent stripe up each post.
    b.glowBox(0.1, postH - 0.4, 0.06, hue, 1.1).position.set(dx + 0.18, postH / 2, 0);
  }
  // Dark header backer spanning the posts + a wide glowing accent blade across it (both faces).
  b.box(width + 0.4, 0.7, 0.24, STATION_DARK, { roughness: 0.8 }).position.set(0, postH - 0.1, 0);
  for (const dz of [0.14, -0.14] as const) {
    b.glowBox(width - 0.2, 0.4, 0.04, hue, 1.3, { roughness: 0.3 }).position.set(0, postH - 0.1, dz);
  }
  return b.finish();
}

/**
 * An ARRIVALS PILLAR: a slim column carrying a tall vertical emissive sign — a platform marker /
 * wayfinding totem. The sign face glows amber on both sides.
 */
export function buildArrivalsPillar(): ArtProp {
  const b = new Builder();
  const pillarH = 3.0;
  // Slim column + a small base.
  b.box(0.5, 0.12, 0.5, STATION_PILLAR, { roughness: 0.7 }).position.set(0, 0.06, 0);
  b.box(0.18, pillarH, 0.18, STATION_PILLAR, { roughness: 0.6, metalness: 0.3 }).position.set(0, pillarH / 2, 0);
  // Tall vertical sign blade mounted to the upper column, dark backer + amber faces.
  const signY = pillarH - 0.9;
  b.box(0.22, 1.7, 0.14, STATION_DARK, { roughness: 0.8 }).position.set(0.18, signY, 0);
  for (const dx of [0.26, 0.1] as const) {
    b.glowBox(0.02, 1.5, 0.1, STATION_ACCENT, 1.1, { roughness: 0.35 }).position.set(dx, signY, 0);
  }
  // A small wayfinding arrow chip near the top.
  b.glowBox(0.16, 0.16, 0.12, STATION_TRIM, 1.0).position.set(0.18, signY + 0.95, 0);
  return b.finish();
}
