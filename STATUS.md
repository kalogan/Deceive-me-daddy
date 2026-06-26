# Build Status

*Durable status for the Architect–Builder pipeline (write → persist → notify). Lets a
cold context resume. Source of truth for "what's done / running / next".*

**Branch:** `claude/deceive-inc-clone-ov9dbu` (now also mirrored to **`main`** — deploys track main).
**Last verified gate:** GREEN — `typecheck=0 lint=0 content=0 test=0 build=0 boot=0`,
**357 tests**. Gate includes `check:boot` (loads the server room+schema under the REAL
Node loader — catches "compiles but won't boot" that vitest masks).
**SHIPPED SINCE PHASE 3:** deploy (Fly single-app + Vercel + CI), mobile touch controls,
spawn-death fix (bots only engage REVEALED enemies; grabbing the package blows cover),
full procedural art engine (low-poly rigged humanoids w/ walk/idle, lighting+bloom,
sleek-HQ environment + set dressing, objective props), procedural audio (ambient + 11 SFX),
an asset-gallery preview (`/preview` → Assets: live tier-colour/glow/scale config + SFX
audition + export JSON), and a DECEIVE splash + start menu (Quick Play / Online Multiplayer /
Agent select / Settings). Account-linked deploy (Fly token + Vercel env) is the user's to do.
**PHASE 3 MECHANICS COMPLETE + VERIFIED live over the wire:** movement; tiered crowd;
disguise theft (+ Holo-Crumb); zones/clearance + RESTRICTED HUD; two-axis suspicion meter;
detection/hard-reveal (fire/max → REVEALED halo); combat + downed/revive; full heist loop
(intel→vault→grab→extract→win); bots autonomously contesting; social-interaction suspicion
bleed; keycard pickup (access route). Preview harness verified (map renders).
**AGENTS SHIPPED + VERIFIED live:** the three default-unlocked Deceive Inc. agents
(Squire/Chavez/Larcin), each with their real signature Expertise (Eyes on the Prize /
Hard Boiled / Adieu), server-authoritative + deterministic.

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

- **Phase 2 Round 2 — zones + disguise.** sim-core `stepZones` (zone membership +
  clearance "scolded"), `takeDisguise`/`stepCrumbs` (disguise theft + Holo-Crumb expiry);
  server routes `take_disguise`; client HUD (zone/tier/RESTRICTED + [E] to take) +
  `CrumbView`. Verified live. NOTE: keycards/intel-door access deferred to the objective sub-round.

- **Phase 2 Round 3a — suspicion meter.** sim-core `stepSuspicion` (two-axis: forbidden
  zone + running, ×TIER_SCRUTINY, decay, hysteresis); HUD meter (green→amber→red + phase
  label). Fixed the HUD tier-name repaint bug. Verified live (meter → SUSPICIOUS).
- **Phase 2 Round 3b — detection + hard-reveal.** sim-core `stepDetection`/`hardReveal`
  (suspicion-max blow + REVEAL_WINDOW expiry); server routes `fire`→hardReveal;
  `StateSource.fire()`; client renders a red over-head halo on revealed players (drawn over
  occlusion) + fire on click/F with a debounce gate. Verified live (fire → REVEALED + halo).

- **Phase 2 Round 3c — combat + downed/revive.** sim-core `resolveFire` (hitscan + forward
  cone, friendly-fire-safe), `reviveTeammate`, `stepCombat` (downed→out timeout); health on
  the wire; server `fire`→damage, `revive`→revive; client health bar + downed render (flat
  roll) + `[R]` revive. Verified live (A shot B down) + unit-tested revive.

- **Phase 3.1 — objective loop (THE GAME IS WINNABLE).** sim-core `collectIntel`/
  `grabPackage`/`stepObjective` (intel→vault→grab→extract→win, drop-on-down); server routes
  `interact`; objective on the wire (nested ObjectiveSchema); client objective HUD (intel/
  vault/carrying), `[Q]` interact, gold `PackageView`, win banner. Verified live end-to-end
  (intel→vault→grab→extract→winningTeam). Gate GREEN, 258 tests.

- **Phase 3.2 — bots + match flow.** sim-core `stepBots` (goal-driven AI: fight→carry→grab→
  collect→idle, deterministic); server spawns 5 bots; match phase 'active'→'ended' on a win.
  Verified live: bots autonomously contest the objective. Gate GREEN, 269 tests.
- **Phase 3.3 — social interactions.** sim-core `stepSocial` (suspicion bleed at a social
  spot whose tier matches your disguise — SOCIAL_BLEED 30/s within SOCIAL_RANGE); client HUD
  "Blending in" cue. Verified. Gate GREEN, 289 tests.
- **Phase 3.4 — keycards (access route).** sim-core `stepKeycardPickup` (walk over a card →
  hold it; `zones.ts` treats a held keycard like a disguise tier for access); `heldKeycard`
  on the wire; server schema/sync + client mapping. Verified live over the wire (a bot
  grabbed card_staff → `heldKeycard='staff'`). Gate GREEN, 298 tests.

- **Phase 3.5 — agents (faithful Deceive Inc. roster).** `sim-core/ability.ts` (Expertise
  timing/cooldown framework + per-agent effect predicates isCloaked/isInvulnerable); combat
  skips cloaked/invulnerable; detection's hard-reveal breaks Adieu. Squire "Eyes on the
  Prize" (HUD sensed-loot readout), Chavez "Hard Boiled" (invuln, gold shell), Larcin "Adieu"
  (cloak, ghost). agentId+abilityActive+abilityCooldownMs on the wire; HUD agent/Expertise
  row; G triggers. Bots get round-robin identities + trigger under pressure. **Verified live:
  agents assigned over the wire, Expertise abilityActive/cooldown propagate to other clients.**
  Gate GREEN, 313 tests (+15 ability tests).

- **Deploy — single Fly app (client + websocket) + Vercel/CI.** Server serves the built
  client (sirv) + the match websocket on one port; configurable `wss://` endpoint
  (`VITE_SERVER_URL` / same-origin); `Dockerfile`, `fly.toml` (scale-to-zero), `vercel.json`,
  GitHub Action auto-deploy, `DEPLOY.md`. **Verified live:** production server serves the
  client + same-origin ws connects + agents render. (Account-linked deploy is the user's to do.)
- **Vault-never-opens fix (targeted tuning).** Intel economy widened (3 → 7 nodes, 3 of them
  in the open atrium) + `MATCH_BOT_COUNT` 5 → 3 so contestants aren't starved of intel.
  `matchFlow.test.ts` deterministically proves a solo match completes (vault opens ≤90s,
  winner ≤180s, two seeds). Gate GREEN, 316 tests.

## Not yet done / next up
- **Agent passives** (deferred to tuning): Squire Sixth Sense, Chavez Tough Luck (grey
  health), Larcin Merci beaucoup! (item-steal melee) — catalogued, effects not yet built.
- **Squire world-highlight** (polish): currently a HUD readout; a through-wall mesh glow on
  intel/keycards/package is a render follow-up.
- **Pre-match agent pick UI** (deferred): agents are round-robin by join order for now.
- **Intel-unlock doors** (deferred): the third access route needs hard-door collision/
  blocking — a bigger separate lift than keycards. Flagged, not started.
- **Tuning/balance pass** (review queue): intel scarcity vs bots (5 bots grab keycards/intel
  at spawn, spreading intel thin so the vault rarely opens), suspicion/health/crumb rates,
  tier+prompt colors, camera feel, win→results/reset flow, map theme, codename.

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
