# Build Status

*Durable status for the Architect–Builder pipeline (write → persist → notify). Lets a
cold context resume. Source of truth for "what's done / running / next".*

**Branch:** `claude/deceive-inc-clone-ov9dbu`
**Last verified gate:** GREEN — `typecheck=0 lint=0 content=0 test=0 build=0 boot=0`,
**107 tests** (15 files). Gate includes `check:boot` (loads the server room+schema under
the REAL Node loader — catches "compiles but won't boot" that vitest masks).
**Live netcode round-trip VERIFIED** (input → server moves player over the wire).
**Preview harness VERIFIED** (Chromium: facility_alpha map renders).
**Phase 2 Round 1 VERIFIED** (live game smoke: server spawns the tiered crowd → wire →
client renders map + walking NPCs + player in the real game client).

## Done (verified by the Architect, not self-reports)

- **Phase 0 — Foundation.** pnpm monorepo (shared/sim-core/server/client/content),
  TS strict, ESLint **arch-guard** (engine-agnostic + deterministic core; verified to
  bite), vitest, `scripts/gate.sh` (real exit codes under timeouts), `lint:content`.
- **shared.** Content-pack schema (zones/doors/npcs/keycards/social/intel/objective by
  clearance tier), clearance ladder (4 tiers), agents/gadgets, net messages, **frozen
  wire-state contract** (NetMatchState/NetPlayerState/AgentPhase/MatchPhase).
- **sim-core.** Deterministic tick loop, injected Clock + seeded RNG, **canonical
  movement** (`inputToWorldVelocity`) reused by server + client.
- **Slice 1.1 — server.** Colyseus `MatchRoom` (authoritative; sim stepped via injected
  clock/dt), `@colyseus/schema` state mirroring the contract, clamped/sanitized input,
  round-robin teams, side-effect-free barrel + separate socket-binding `main.ts`. No
  socket opened in tests.
- **Slice 1.2 — client.** Three.js third-person renderer, greybox avatars colored by
  tier, remote interpolation + local prediction, WASD/mouse-look input, `StateSource`
  seam (LocalMockSource now; ColyseusSource later), Vite build.
- **Integration fix (Architect).** Caught server↔client movement-frame divergence
  (would rubber-band on wiring); unified in sim-core + added the missing yaw tests.
- **Runtime smoke (Architect).** Booted the freshly-built client in real Chromium
  (software GL): renders, GL context healthy, no page errors. Screenshot captured.
- **Slice 1.3 — live wiring.** `ColyseusSource` (client `colyseus.js` → `MatchRoom`),
  endpoint selection + mock fallback, pure `toNetMatchState` mapping (7 tests).
- **Server boot fixes (Architect).** Live verification found the server couldn't boot:
  (1) colyseus CJS/ESM named-export interop → load via createRequire; (2) `@type`
  decorators dropped by tsx → decorator flags moved to tsconfig.base. Added `check:boot`
  gate guard. Verified the live authoritative round-trip end-to-end.
- **Preview harness.** `preview.html` + `dataSource` seam (globs `content/`, validates
  with the real schema), real reusable `MapView`, `PreviewApp` shell (picker + orbit +
  tier legend, zero-wiring), static `build:preview`. Verified rendering facility_alpha.

- **Phase 2 Round 1.** Tiered NPC crowd: sim-core `stepNpcs` (deterministic patrol/
  wander/idle/work, NPC_SPEED 1.4), server loads facility_alpha + spawns crowd, client
  renders the live map (`MapView`) + crowd (`NpcView`, shared `avatar.ts` so players and
  NPCs are identical capsules). Verified live in Chromium.

## Not yet done / next up
- **Phase 2 Round 2 — the stealth mechanics:** zones/clearance + access (keycards/intel-
  unlock), disguise acquisition + tiers (Holo-Crumb), two-axis suspicion meter + social
  interactions, detection/hard-reveal, combat + downed/revive. (Builds on the Round-1
  crowd; each is a sim-core module behind the world.step seam + client HUD.)

## Open decisions / housekeeping

- **Commit signing:** all commits show Unverified — environment lacks the SSH signing
  key for this shell's user (`commit.gpgsign=true` but key path absent). Re-signing
  needs a history rewrite + **force-push** (a §8 stop-and-ask boundary) — awaiting
  Director go-ahead; deferred to finalization.
- **Wire-contract note (from server builder):** `disguiseTier` is sent as a string; if
  we want it compact later it becomes a numeric index (a `shared` change).
- **colyseus schema version:** server + client both resolve `@colyseus/schema@2.0.37`
  (aligned — verified). A future dep bump could split server (v2) vs client (v3), whose
  wire formats are INCOMPATIBLE (empty client state, no error). If we bump, pin both via
  a pnpm override and re-run the live round-trip.

## Active constraints (handed to every builder; gated)

Engine-agnostic core · server-authoritative · deterministic core (injected clock/RNG) ·
versioned+validated content (golden fixture) · production-truthful preview · tests with
every system. (PROJECT_BRIEF §4.)

## Review queue (Director taste — non-blocking)

Codename/title · the 3 agents' identities+gadgets · first map theme + zone layout ·
tier color readability in third-person · suspicion tuning knobs · camera distance/feel
(CAM_BACK 5.5 / height 3.0 / ease 0.15) · mouse sensitivity · scene palette (greybox).
