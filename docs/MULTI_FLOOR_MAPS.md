# Multi-floor, larger maps — plan

Bigger, realistic maps with **two floors** connected by **walkable stairs/ramps** (and covert
**vents**), authored as hand-editable JSON. Informed by how *Deceive Inc.* builds its maps.

## What Deceive Inc. does (and what we take)

- Maps are dense "living worlds" — NPC crowds (your camouflage), secret corridors, a VIP, theming.
- **Verticality is purposeful.** Their most vertical map is built around a central multi-story
  atrium (catwalk + balconies). We copy the *idea*, not assets.
- **The map is a clearance gradient:** public → guard-tier → technician-tier → vault. The vault is
  the deepest, most-gated, most-contested space.
- Traversal = stairs + ledges + **vents** (covert shortcuts to bypass guarded routes / reach height).
- Objective spine: Insertion (disable terminals) → Infiltration (tiered disguise rooms) →
  Extraction (grab package, leave via one of **3** scattered exits).

### Design decisions (locked with the user)

- **Floor model:** discrete floors at `floor × FLOOR_HEIGHT`; vertical movement only on *connectors*
  (sloped walkable volumes). Stairs render as steps but collide as a smooth ramp. Stays
  deterministic — no navmesh/heightfield.
- **Scale:** ~2× current footprint, **2 floors**, ~6–8 rooms/floor.
- **Authoring:** hybrid generator that **emits hand-editable ContentPack JSON** (the JSON is the
  source of truth; round-trippable for a future editor).
- **Minimap:** per-floor, auto-switches to your floor, shows an `L1/L2` badge.
- **Vertical play:** the heist **spans floors** (intel both floors, vault/extraction split). Bots
  traverse floors too.
- **First map:** a **new** 2-floor pack first; retrofit Facility Alpha & others later.
- **Floor boundary:** mostly **sealed** floors + one **signature atrium** (the vertical hub).
- **Clearance gradient up the building:** public/low tier on the ground, high security up top, so
  climbing leans on the existing disguise/suspicion systems.

## Architecture (load-bearing)

1. `groundHeightAt(x, z, floor)` replaces the flat `y<0 → 0` clamp. Outside a connector you stand
   on your floor's slab; inside a connector footprint your walkable Y interpolates between floors.
2. **Floor hysteresis** — you change floors *only* by walking a connector (commit at the top/bottom).
3. **Collision + bot nav filter by floor** — `WallAABB` carries a floor; a wall on L2 can't block
   you on L1 at the same XZ. Cross-floor bot goals route to the nearest connector first.
4. **Connectors have a `kind`:** `stair | ramp | vent`. Identical footprint geometry; `kind` drives
   render + feel (vents = covert, faster, an alternate inter-floor route that also keeps bot nav from
   deadlocking on a contested stairwell).
5. **Generator → JSON → load.** Seeded generator takes a hand-authored skeleton (floors, key rooms,
   stair/vent placements, clearance gradient, NPC density) and *writes* a full pack JSON you can then
   hand-tweak.

## Schema additions (Slice 1)

- Pack: `floorHeight?: number` (default 4), `connectors?: Connector[]`.
- Zone: `floor?: number` (default 0).
- `Connector = { id, kind: 'stair'|'ramp'|'vent', fromFloor, toFloor, footprint: {min:[x,z],
  max:[x,z]}, axis: 'x'|'z', ascendToward: 'min'|'max' }`.
- All optional → existing packs and the matchFlow test stay green (no fixture ripple).
- New `shared/floors.ts`: `DEFAULT_FLOOR_HEIGHT`, `floorBaseY`, `floorOfY`, `pointInFootprint`,
  `connectorGroundY` (pure, tested). Walls gain an optional `floor` (stamped from their zone).

## Slices (each gated + committed; push to both branches)

1. **Schema + shared geometry** (this slice) — no behavior change.
2. **Sim movement** — `groundHeightAt`, ramp traversal, floor hysteresis, floor-filtered collision,
   floor-aware zones.
3. **Bot multi-floor nav** — connector routing + a bots-only multi-floor completion test.
4. **Render** — floor slabs, stairs/ramps/vents, atrium, per-floor lights + client-prediction parity.
5. **Minimap** — per-floor + floor badge.
6. **Generator + first new 2-floor map** — JSON committed, objectives split across floors, atrium.
7. *(later)* Retrofit Facility Alpha + others.

Slice 1 is the dependency root (everything imports it); after it lands, Slices 2 / 5 / 6 can proceed
in parallel (mostly disjoint files), with 3 and 4 following 2.
