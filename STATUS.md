# Build Status

*Durable status for the Architect–Builder pipeline (write → persist → notify). Lets a
cold context resume. Source of truth for "what's done / running / next".*

**Branch:** `claude/deceive-inc-clone-ov9dbu`
**Last verified gate:** GREEN — `typecheck=0 lint=0 content=0 test=0 build=0 boot=0`,
**71 tests** (10 files). Gate now includes `check:boot` (loads the server room+schema
under the REAL Node loader — catches "compiles but won't boot" that vitest masks).
**Live netcode round-trip VERIFIED**: real colyseus.js client joins the room, sends
input, server authoritatively advances the player +Z over the wire.

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

## Not yet done / next up
- **Preview-harness skeleton** (PREVIEW_HARNESS.md): `preview.html` + `dataSource` seam
  globbing `packages/content`, mounting real client render of a map pack, no server.
- **Phase 2 — signature systems:** tiered NPC crowd, disguise acquisition + tiers,
  zones/clearance/keycards/intel-unlock, two-axis suspicion + social interactions,
  detection/hard-reveal, combat + downed/revive.

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
