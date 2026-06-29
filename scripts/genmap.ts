// Seeded multi-floor map generator (PROJECT_BRIEF §5 / docs/MULTI_FLOOR_MAPS.md slice 6).
//
// DETERMINISTIC: every value is derived from a hand-authored skeleton + a SEEDED PRNG (mulberry32,
// the same algorithm the sim uses in packages/sim-core/src/rng.ts). No Math.random / Date.now, so
// re-running with the same seed reproduces byte-identical JSON. The emitted JSON is the SOURCE OF
// TRUTH — hand-editable later; this script just bootstraps it.
//
// It writes a complete, schema-valid ContentPack to packages/content/packs/<id>.json and validates
// with the REAL ContentPackSchema (the same bytes the server + preview harness load) BEFORE writing,
// failing loudly if the skeleton ever drifts out of spec.
//
// Run:  npx tsx --tsconfig packages/server/tsconfig.json scripts/genmap.ts
//
// EDGE-STAIR CONSTRAINT (see docs/MULTI_FLOOR_MAPS.md): a connector footprint is a HOLE in the upper
// floor. Each connector here is placed so (a) its LOW mouth is reachable from the approach side and
// (b) its HIGH mouth opens toward the building interior, so the upstairs landing leads to objectives
// WITHOUT re-crossing the footprint. Slopes are gentle (run >= 2x rise; rise = floorHeight = 4, so
// every footprint runs >= 12 m along its axis). The atlasFlow bots-only test is the proof.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ContentPackSchema, type ContentPack } from '../packages/shared/src/schema/contentPack';

// --- Seeded PRNG: mulberry32 (mirrors packages/sim-core/src/rng.ts so it is the project's RNG). ---
function createRng(seed: number): { next(): number } {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Round to 1 dp so the JSON stays human-readable and stable. */
const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Build the Atlas Tower content pack from a fixed skeleton + a seed. The skeleton (floor extents,
 * zone tiers, connector placements) is hand-authored for correctness; the seed only jitters cosmetic
 * detail (NPC waypoints, intel/keycard/prop placement WITHIN their zones) so the layout stays a
 * valid, completable heist while two seeds still differ. All jitter is clamped inside the owning
 * zone, so geometry correctness never depends on the seed.
 */
function buildAtlasTower(seed: number): ContentPack {
  const rng = createRng(seed);
  const FLOOR_HEIGHT = 4;

  // Z extent shared by every zone (a deep, two-bay building, ~2x vertex_spire's z-span).
  const ZMIN = -30;
  const ZMAX = 30;

  // A point jittered inside [min+pad, max-pad] on each axis — keeps placed entities off the walls.
  const inZone = (
    xMin: number,
    xMax: number,
    y: number,
    pad = 3,
  ): [number, number, number] => {
    const x = r1(xMin + pad + rng.next() * (xMax - xMin - 2 * pad));
    const z = r1(ZMIN + pad + rng.next() * (ZMAX - ZMIN - 2 * pad));
    return [x, y, z];
  };

  // ----- Zones: a clearance gradient. GROUND (floor 0) = public; UPPER (floor 1) = restricted. -----
  // Ground tiles civilian -> staff -> security west->east; upper mirrors it security -> scientist.
  const G = 0; // ground base Y
  const U = FLOOR_HEIGHT; // upper base Y
  const zones: ContentPack['zones'] = [
    // Ground floor
    { id: 'atrium', name: 'Grand Atrium', requiredClearance: 'civilian', bounds: { min: [-45, G, ZMIN], max: [-15, G + FLOOR_HEIGHT, ZMAX] }, floor: 0 },
    { id: 'gallery', name: 'Exhibit Gallery', requiredClearance: 'civilian', bounds: { min: [-15, G, ZMIN], max: [10, G + FLOOR_HEIGHT, ZMAX] }, floor: 0 },
    { id: 'checkpoint', name: 'Staff Checkpoint', requiredClearance: 'staff', bounds: { min: [10, G, ZMIN], max: [30, G + FLOOR_HEIGHT, ZMAX] }, floor: 0 },
    { id: 'loading', name: 'Loading Bay', requiredClearance: 'security', bounds: { min: [30, G, ZMIN], max: [50, G + FLOOR_HEIGHT, ZMAX] }, floor: 0 },
    // Upper floor (stacked over the ground zones)
    { id: 'offices', name: 'Security Offices', requiredClearance: 'security', bounds: { min: [-45, U, ZMIN], max: [-15, U + FLOOR_HEIGHT, ZMAX] }, floor: 1 },
    { id: 'vault', name: 'Research Vault', requiredClearance: 'scientist', bounds: { min: [-15, U, ZMIN], max: [10, U + FLOOR_HEIGHT, ZMAX] }, floor: 1 },
    { id: 'labs', name: 'Bio Labs', requiredClearance: 'scientist', bounds: { min: [10, U, ZMIN], max: [30, U + FLOOR_HEIGHT, ZMAX] }, floor: 1 },
    { id: 'serverroom', name: 'Server Room', requiredClearance: 'security', bounds: { min: [30, U, ZMIN], max: [50, U + FLOOR_HEIGHT, ZMAX] }, floor: 1 },
  ];

  // ----- Doors: openings on the shared zone edges, at z=0 (mid-edge), one per floor. -----
  const doors: ContentPack['doors'] = [
    // Ground: civilian -> civilian (free) -> staff (carded) -> security (carded)
    { id: 'd_atrium_gallery', position: [-15, G, 0], connects: ['atrium', 'gallery'], requiredClearance: 'civilian', intelToUnlock: 0, floor: 0 },
    { id: 'd_gallery_checkpoint', position: [10, G, 0], connects: ['gallery', 'checkpoint'], requiredClearance: 'staff', keycardColor: 'staff', intelToUnlock: 1, floor: 0 },
    { id: 'd_checkpoint_loading', position: [30, G, 0], connects: ['checkpoint', 'loading'], requiredClearance: 'security', keycardColor: 'security', intelToUnlock: 1, floor: 0 },
    // Upper: security <-> scientist vault <-> scientist labs <-> security server room
    { id: 'd_offices_vault', position: [-15, U, 0], connects: ['offices', 'vault'], requiredClearance: 'scientist', keycardColor: 'scientist', intelToUnlock: 2, floor: 1 },
    { id: 'd_vault_labs', position: [10, U, 0], connects: ['vault', 'labs'], requiredClearance: 'scientist', keycardColor: 'scientist', intelToUnlock: 2, floor: 1 },
    { id: 'd_labs_serverroom', position: [30, U, 0], connects: ['labs', 'serverroom'], requiredClearance: 'security', keycardColor: 'security', intelToUnlock: 1, floor: 1 },
  ];

  // ----- Connectors (the load-bearing geometry). -----
  // main_stair: footprint x[30..42] in the Loading Bay / Server Room stack, axis x, ascendToward MIN
  //   => HIGH mouth at x=30 (the interior edge of the Server Room landing). The upstairs landing at
  //   x=30 leads WEST into labs -> vault (the objective) without re-crossing the x[30..42] hole. Its
  //   LOW mouth at x=42 sits in the ground Loading Bay, reachable from the staff/security route. Run
  //   = 12 m for a 4 m rise (gentle: run = 3x rise).
  // service_vent: footprint x[-48..-36] at the far WEST edge (Atrium / Security Offices stack), axis
  //   x, ascendToward MAX => HIGH mouth at x=-36 opening EAST into the Security Offices interior (a
  //   covert bypass straight to the upper floor near the vault). LOW mouth at x=-48 in the Atrium,
  //   right by the spawns. Run = 12 m.
  const connectors: ContentPack['connectors'] = [
    { id: 'main_stair', kind: 'stair', fromFloor: 0, toFloor: 1, footprint: { min: [30, -4], max: [42, 4] }, axis: 'x', ascendToward: 'min' },
    { id: 'service_vent', kind: 'vent', fromFloor: 0, toFloor: 1, footprint: { min: [-48, -4], max: [-36, 4] }, axis: 'x', ascendToward: 'max' },
  ];

  // ----- NPCs: >=1 per zone, tier matching the zone, for blending. -----
  const wp = (xMin: number, xMax: number, y: number, n: number): [number, number, number][] =>
    Array.from({ length: n }, () => inZone(xMin, xMax, y));
  const npcs: ContentPack['npcs'] = [
    { id: 'civ_atrium_1', tier: 'civilian', homeZone: 'atrium', routine: { kind: 'wander', waypoints: wp(-45, -15, G, 3) } },
    { id: 'civ_atrium_2', tier: 'civilian', homeZone: 'atrium', routine: { kind: 'wander', waypoints: wp(-45, -15, G, 2) } },
    { id: 'civ_gallery_1', tier: 'civilian', homeZone: 'gallery', routine: { kind: 'wander', waypoints: wp(-15, 10, G, 3) } },
    { id: 'staff_checkpoint_1', tier: 'staff', homeZone: 'checkpoint', routine: { kind: 'work', waypoints: wp(10, 30, G, 2) } },
    { id: 'sec_loading_1', tier: 'security', homeZone: 'loading', routine: { kind: 'patrol', waypoints: wp(30, 50, G, 3) } },
    { id: 'sec_offices_1', tier: 'security', homeZone: 'offices', routine: { kind: 'patrol', waypoints: wp(-45, -15, U, 3) } },
    { id: 'sci_vault_1', tier: 'scientist', homeZone: 'vault', routine: { kind: 'idle', waypoints: wp(-15, 10, U, 1) } },
    { id: 'sci_labs_1', tier: 'scientist', homeZone: 'labs', routine: { kind: 'work', waypoints: wp(10, 30, U, 2) } },
    { id: 'sec_serverroom_1', tier: 'security', homeZone: 'serverroom', routine: { kind: 'patrol', waypoints: wp(30, 50, U, 3) } },
  ];

  // ----- Keycards: each carded door's tier is grabbable on the GROUND floor (so the path up the
  //       clearance ladder is walkable from spawn). -----
  const keycards: ContentPack['keycards'] = [
    { id: 'card_staff', color: 'staff', position: inZone(-45, -15, G) },
    { id: 'card_security', color: 'security', position: inZone(-15, 10, G) },
    { id: 'card_scientist', color: 'scientist', position: inZone(10, 30, G) },
  ];

  // ----- Social spots: one per a few tiers for suspicion bleed. -----
  const socialSpots: ContentPack['socialSpots'] = [
    { id: 'bar_atrium', tier: 'civilian', action: 'drink', position: inZone(-45, -15, G) },
    { id: 'plants_gallery', tier: 'civilian', action: 'water_plants', position: inZone(-15, 10, G) },
    { id: 'post_checkpoint', tier: 'staff', action: 'patrol_post', position: inZone(10, 30, G) },
    { id: 'console_labs', tier: 'scientist', action: 'inspect', position: inZone(10, 30, U) },
  ];

  // ----- Intel: spread across BOTH floors. The GROUND floor alone holds 5 (value summing to >= the
  //       vault threshold of 4) so the match can open before anyone climbs — mirrors vertex_spire. -----
  const intelNodes: ContentPack['intelNodes'] = [
    // Ground (5 nodes, total value 5 >= threshold 4) — opens the vault without climbing.
    { id: 'intel_atrium_desk', position: inZone(-45, -15, G), zoneId: 'atrium', intelValue: 1 },
    { id: 'intel_atrium_kiosk', position: inZone(-45, -15, G), zoneId: 'atrium', intelValue: 1 },
    { id: 'intel_gallery_pc', position: inZone(-15, 10, G), zoneId: 'gallery', intelValue: 1 },
    { id: 'intel_checkpoint_term', position: inZone(10, 30, G), zoneId: 'checkpoint', intelValue: 1 },
    { id: 'intel_loading_crate', position: inZone(30, 50, G), zoneId: 'loading', intelValue: 1 },
    // Upper (extra value for the deep route).
    { id: 'intel_offices_safe', position: inZone(-45, -15, U), zoneId: 'offices', intelValue: 2 },
    { id: 'intel_labs_console', position: inZone(10, 30, U), zoneId: 'labs', intelValue: 2 },
    { id: 'intel_server_rack', position: inZone(30, 50, U), zoneId: 'serverroom', intelValue: 2 },
  ];

  // ----- Objective: vault is UPSTAIRS (scientist tier). 3 extraction points across both floors. -----
  const objective: ContentPack['objective'] = {
    vaultZoneId: 'vault',
    packagePosition: [r1(-5 + rng.next() * 5), U, r1(-5 + rng.next() * 10)],
    intelRequiredToOpenVault: 4,
    extractionPoints: [
      [-42, G, -26], // ground, far west by the atrium spawns
      [46, G, 26], // ground, far east loading bay
      [-40, U, 24], // upper, security offices (reached via the vent)
    ],
  };

  // ----- Spawns: >=4 on the GROUND floor in the public atrium. -----
  const spawnPoints: ContentPack['spawnPoints'] = [
    { position: [-42, G, -24], team: 0 },
    { position: [-42, G, 24], team: 1 },
    { position: [-38, G, 0], team: 2 },
    { position: [-34, G, -20], team: 3 },
  ];

  // ----- Cosmetic props (client-only set dressing; seed-jittered inside zones). -----
  const props: ContentPack['props'] = [
    { id: 'prop_atrium_plant', prop: 'plant', position: inZone(-45, -15, G), rotationY: r1(rng.next() * 6.2), scale: 1 },
    { id: 'prop_gallery_plant', prop: 'plant', position: inZone(-15, 10, G), rotationY: r1(rng.next() * 6.2), scale: 1 },
  ];

  return {
    schemaVersion: 1,
    id: 'atlas_tower',
    name: 'Atlas Tower',
    theme: 'research_facility',
    floorHeight: FLOOR_HEIGHT,
    zones,
    doors,
    connectors,
    npcs,
    keycards,
    socialSpots,
    intelNodes,
    objective,
    spawnPoints,
    props,
    walls: [],
  } as ContentPack;
}

function main(): void {
  // Fixed seed => deterministic, byte-identical output. Bump only to intentionally re-roll the map.
  const SEED = 0xa71a5; // "atlas"
  const pack = buildAtlasTower(SEED);

  // Validate with the SAME schema the server + preview harness load. Fail loudly if invalid.
  const parsed = ContentPackSchema.parse(pack);

  const outPath = fileURLToPath(new URL('../packages/content/packs/atlas_tower.json', import.meta.url));
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[genmap] wrote ${outPath} (id=${parsed.id}, ${parsed.zones.length} zones, ${parsed.connectors?.length ?? 0} connectors)`);
}

main();
