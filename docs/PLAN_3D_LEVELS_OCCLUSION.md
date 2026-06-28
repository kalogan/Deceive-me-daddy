# Plan — 3D levels with real walls + occlusion

*Goal: levels that read as solid 3D rooms, where walls actually block your view (and your
movement) — you only see into a room once you're at its doorway, instead of seeing across the
whole map through where walls should be.*

## Where we are today (the root cause)

Maps render as an **open plan**: each zone is a tinted **floor slab** ringed by a glowing tier
**curb** (the neon edge lines you see), plus one **outer perimeter wall** + corner pillars and
decorative **door frames** (posts + a lintel — not an opening in a wall). There are **no interior
walls between zones**, so nothing occludes the first-person camera and you see the entire map at
once. (`MapView.ts` builds floors/curbs/pillars/door-frames; `mapGeometry.ts` just converts zone
bounds → boxes.)

**Key insight:** occlusion is *free*. Three.js depth-tests opaque meshes, so a tall solid wall
already hides everything behind it. We don't need a visibility/portal system to stop see-through —
we need **actual interior wall geometry with door-sized gaps**. The "real" work is (1) where the
walls come from (authoring) and (2) making walls also block *movement* (collision), which is a
bigger, separate lift.

## The two things "blocking" means — keep them separate

| Concern | What it needs | Size |
|---|---|---|
| **Visual occlusion** (can't *see* through walls) | Opaque wall meshes with height. Free occlusion via depth test. | **Medium** — the headline ask, do first. |
| **Physical collision** (can't *walk* through walls) | Wall colliders in sim-core movement (today movement is a placeholder with no collision). | **Large** — its own slice; flag, don't bundle. |

Do visual occlusion first (it's the user-visible win and self-contained in the client renderer).
Collision is a deterministic-core change (server-authoritative) and lands as a follow-up.

## Where do the walls come from? (authoring — pick one)

- **A. Derive walls from zone bounds + door gaps (recommended first).** Each zone is an
  axis-aligned box; generate its **perimeter walls** (4 sides, to a fixed `WALL_HEIGHT`) and cut a
  **door-width opening** wherever a `door.position` sits on that edge. Zero new content authoring —
  every existing pack gets rooms for free from data we already have (`zones[].bounds`, `doors[]`).
  Shared interior edges between two adjacent zones render once (dedupe like the corner pillars
  already do). Risk: boxy rooms only; door openings must line up with edges (a content-lint check).
- **B. Explicit wall segments in the content pack.** Add a `walls: [{ a:[x,z], b:[x,z], height? }]`
  array (+ optional `openings`) to the schema (golden fixture + migration, per the pipeline). Full
  authorial control (angled walls, half-walls, windows), but every map must be re-authored.
- **C. Hybrid (end state).** Auto-walls from bounds as the baseline, plus an optional `walls[]`
  override for hand-shaped spaces. Best long-term; start at **A**, grow into **C**.

Recommendation: ship **A** to kill see-through everywhere cheaply, then add **B/C** for the maps
that deserve bespoke shapes.

## Rendering plan (visual occlusion slice)

1. **Wall builder** in `mapGeometry.ts` (pure, unit-tested): `zonesToWalls(zones, doors) → WallSeg[]`
   — perimeter segments per zone, deduped on shared edges, with door-width gaps punched where a
   door lies on the segment. Pure data-in/data-out so it tests with no Three.
2. **MapView**: extrude each `WallSeg` to a solid `BoxGeometry` of `WALL_HEIGHT` (~3–3.5 m), **merge
   by material** (one draw per theme wall material, like the existing merged dressing) so a roomy
   map stays a handful of draws. Keep the glowing tier **curb** at the floor as the accent; the wall
   gets the theme `wall` colour + a thin tier accent strip (the palette already has `wall`/`accent`).
3. **Door openings** become real gaps; keep the existing door *frame* prop around the gap so doors
   still read as doors. Optionally add a simple **lintel/header** above the opening.
4. **Ceilings (optional, per theme).** Indoor themes (facility/club/station/mall) get a low opaque
   ceiling so you can't see over walls from a jump or a high camera; outdoor (beach) stays open to
   the sky (it already swaps to a boardwalk rim + sky/ocean env — leave that path).
5. **Keep the intentional through-wall reads.** Revealed-rival halos and the minimap are *designed*
   to show through geometry (awareness). Those draw over occlusion on purpose — don't "fix" them.
   Only the ordinary world view should be occluded.
6. **"Until you enter the room" polish (optional follow-up).** With solid walls + a doorway, you
   already only see in through the door. To sell it further: keep unentered rooms a touch darker /
   lightly fogged and lift it when the local player's zone changes (we already track
   `currentZoneId`), or fade in a room's set-dressing on entry. Pure cosmetic, no sim change.

## Collision plan (physical blocking — separate follow-up slice)

- Movement integration lives in sim-core `step()` and is a placeholder (`pos += vel*dt`, no
  collision). Add **AABB wall colliders** derived from the SAME `zonesToWalls` data so server +
  client agree, and resolve the local player (and bots) against them each tick (slide along walls).
- Must stay **deterministic + server-authoritative** (PROJECT_BRIEF): the collider set is built
  from the content pack on load; resolution is pure math (no wall-clock/RNG). The client's local
  prediction runs the identical resolver so it doesn't rubber-band.
- Doors: walk-through openings need no special collision (the gap is just absent wall); locked/keyed
  doors that should physically block until unlocked are a further step (a toggled collider).
- This is the bigger lift (touches the frozen movement path + bot navigation around walls). Land it
  after visual occlusion, with its own tests (move into a wall → stopped; through a doorway → passes).

## Production-truthful preview (per `PREVIEW_HARNESS.md`)

The preview's Map tab + the First-Person tab mount the **real** `MapView`, so walls + occlusion
appear there automatically with no extra wiring — that's the harness to iterate the look in (orbit
to check rooms read solid; walk the FP tab to confirm you can't see through). Add a content-lint
check that every `door` sits on a zone edge so auto-generated openings always line up.

## Suggested slice order

1. **`zonesToWalls` pure builder + tests** (mapGeometry) — the data, no rendering yet.
2. **Render merged opaque walls + door gaps** (MapView) — kills see-through; verify in the preview.
3. **Optional ceilings + unentered-room dimming** — polish the "enter to see" feel.
4. **(Bigger, separate) wall collision** in sim-core movement + bot nav — physical blocking, gated.
5. **`walls[]` schema override** (option B/C) for bespoke, non-boxy spaces, where worth it.

## Risks / watch-outs

- **Draw calls / perf:** merge walls by material (don't spawn a mesh per segment). Target the same
  handful-of-draws budget the current dressing keeps.
- **Door alignment:** auto-openings assume a door sits on a zone edge — lint it, or openings won't
  cut.
- **Don't regress the awareness reads:** halos + minimap must still show through walls (by design).
- **Collision is the deep one:** it's a frozen-movement-path + bot-nav change — scope it on its own,
  with deterministic tests, not folded into the visual slice.
