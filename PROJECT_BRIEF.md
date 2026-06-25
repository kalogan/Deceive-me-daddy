# Project Brief — "Deceive Me Daddy" (working title)

*A browser-based, networked social-stealth spy heist game — a faithful clone of
**Deceive Inc.** built with the Architect–Builder pipeline and a production-truthful
preview harness.*

> **Status:** design locked via grill (2026-06-25). This is the source-of-truth
> brief the Architect plans against and every Builder reads first. Codename is a
> review item (see §9).

---

## 1. The core fantasy

You are a secret agent disguised as a generic civilian among a crowd of identical
NPCs. You move naturally to stay hidden, sneak through a guarded location to steal
intel, crack a vault, and extract with the package — all while three rival teams do
the same. The tension is the **mind-game**: *which body in this crowd is a real
player?* Acting suspicious raises a meter others can read; the moment you draw a
weapon or grab the objective, your cover is **blown** and the spy-fi gunfight erupts.

Everything serves that one feeling: **"anyone could be the spy, including me, and the
moment of reveal is everything."**

---

## 2. Locked design decisions

These are settled. Do not re-litigate them per slice; build on them.

| Area | Decision |
|---|---|
| **Platform / stack** | Web. TypeScript monorepo. **Three.js / WebGL** render. Vite. |
| **Perspective** | **Third-person 3D** (camera behind avatar — you can read your own disguise + the crowd). |
| **Networking** | **Networked PvP from day one.** Server-authoritative; clients optimistic-cosmetic. |
| **Netcode depth (v1)** | **Server-authoritative + interpolation.** Server sims at a fixed tick; remote players interpolated; own movement uses light local prediction. **No** full rollback/reconciliation in v1 (roadmap). |
| **Server tech** | **Colyseus** (room-based authoritative server, schema state-sync, matchmaking). |
| **Match format** | **4 teams of 3 = 12 agents**, one map per match. |
| **Detection model** | **Action-based suspicion meter + hard reveal.** Suspicious acts (run, draw weapon, enter staff-only zones, linger, bump NPCs) raise a meter; shooting / grabbing the objective / being caught = instant hard reveal for a window. |
| **Heist loop** | **Intel → vault → extract (faithful).** Steal intel from NPCs/terminals → unlock vault → secure package → reach an extraction point alive. |
| **Elimination** | **Downed → teammate revive within a window → otherwise out for the round.** |
| **Characters** | **3 playable agents, each with one signature gadget** + a shared base kit (gun + universal disguise-swap). |
| **Map authoring** | **Data-driven JSON content packs** (zones, nav paths, objective spots, NPC routines) through a shared schema + resolver. Procedural generation is a **future roadmap** item, designed-for now. |
| **Visual fidelity (v1)** | **Stylized low-poly** + spy-fi palette + basic animation. (Greybox primitives acceptable as scaffolding en route.) |
| **AI players (bots)** | **Yes — basic bots** that navigate, blend, pursue the objective, and fight when revealed. Fill empty slots so 12-player matches are testable solo. Built incrementally. |
| **NPC crowd** | Ambient civilian NPCs with routines that players blend into (distinct system from AI players). |
| **First milestone (M1)** | **Full heist loop, one human, rough.** End-to-end spawn→intel→vault→extract with combat, one map, networked, stylized-rough art. Integration-first. |

---

## 3. Architecture sketch

Monorepo (pnpm workspaces), engine-agnostic core, server-authoritative.

```
packages/
  shared/        # schemas (Zod), content-pack types, constants, pure types.
                 #   Imported by EVERYONE. No Three.js, no Colyseus, no DOM.
  sim-core/      # deterministic game simulation: movement, suspicion, detection,
                 #   objective state machine, combat resolution, NPC + bot logic.
                 #   Injected clock + RNG. NO rendering, NO network, NO Three.js.
  server/        # Colyseus rooms. Owns authoritative state. Steps sim-core each
                 #   tick. Validates client inputs. Broadcasts schema state.
  client/        # Three.js renderer + input + UI + interpolation + local prediction.
                 #   Renders state from the server. Optimistic-cosmetic only.
  content/       # JSON content packs (maps, NPC routines, agent/gadget defs).
                 #   The source of truth the harness globs.
```

**The seam (for the preview harness):** content packs load via the **same**
`schema.parse` + `resolve…` pipeline in both prod (server fetch) and preview
(`import.meta.glob` over `packages/content`). Never forked.

**Authority rule (the spine of both docs):** the **server is authoritative** for
position, suspicion, detection, objective, combat, and elimination. The client may
*predict* its own movement and show *cosmetic* effects, but the server's word is
final. No client ever reports "I scored a hit" or "I'm hidden" and is believed.

---

## 4. Non-negotiable constraints (handed to every Builder; checked by the gate)

These are the §5 quality bar. Few, explicit, testable. A rule not gated **will** be
violated.

1. **Engine-agnostic core.** `shared` and `sim-core` must NOT import Three.js,
   Colyseus, DOM, or any client/server package. Enforced by an import/arch guard.
2. **Server-authoritative.** Authoritative state (position, suspicion, detection,
   objective, combat, elimination) lives in `server` + `sim-core` only. Clients are
   optimistic-cosmetic. No gameplay decision is made client-side and trusted.
3. **Deterministic core.** `sim-core` takes an **injected clock and RNG**. No
   `Date.now()`, no `Math.random()` inside the sim. Same inputs → same outputs
   (enables replay, testing, and future rollback).
4. **Versioned, validated content.** Every content pack validates against the shared
   schema. Schema changes ship a **golden fixture** and a forward migration.
5. **Production-truthful preview.** The preview harness mounts the **real** client
   components + the **real** schema/resolver. No "preview-only" reimplementations.
6. **Every new system ships with tests.** Especially sim-core logic (suspicion,
   detection, objective state machine, combat) — these are deterministic and must be
   unit-tested with recorded counts.

---

## 5. The balanced hard-gate (§B — Architect re-runs with REAL exit codes)

Run each under a hard `timeout`; capture the real exit code (not a pipe's). ALL must
be 0. Record per-package **test counts** every run so a silent drop is visible.

```bash
set +e
timeout 300 pnpm -r typecheck                 ; tc=$?     # types
timeout 180 pnpm -r lint                       ; ln=$?     # lint + ARCH GUARDS
timeout 180 pnpm lint:content                  ; lc=$?     # content-pack validation
timeout 600 pnpm -r test 2>&1 | tee /tmp/t.log ; tst=${PIPESTATUS[0]}   # unit tests
timeout 300 pnpm -r build                      ; bd=$?     # build (incl. preview build)
echo "typecheck=$tc lint=$ln content=$lc test=$tst build=$bd"
# exit 124 = HUNG (open handle / non-exiting test) — investigate, do NOT treat as pass.
```

Plus, for **visible** slices, the §5b runtime smoke: Architect boots the
**freshly-built preview harness** on an alt port, drives the changed path, screenshots,
and scans the console/network. "Verified in the harness" ≠ "verified in the live
networked game" — the boundary is named in every report.

---

## 6. Safety boundaries (Architect never crosses these unattended)

- Destructive git: `reset --hard` that discards work, force-push, history rewrite.
- External/side-effectful: deploys with real creds, publishing, spending money,
  anything touching a real hosted server/DB.
- Designated risky milestones (flag as we hit them): the **netcode authority/security
  layer** and **matchmaking** get adversarial code review before merge.
- Trust actions: secrets, auth, access controls.

When in doubt: **checkpoint and ask.**

---

## 7. Slice roadmap (disjoint surfaces, dependency-ordered)

Phased. Each slice is shippable + green on its own. M1's *goal* is the full rough
loop; the foundation slices below it are sequenced first because everything depends
on them.

### Phase 0 — Foundation (mostly serial; unblocks all fan-out)
- **0.1 Monorepo scaffold** — pnpm workspaces, the 5 packages, tsconfig, eslint +
  **arch-guard** rule, vitest, the gate scripts, CI session-start hook. *(surface: root configs)*
- **0.2 `shared` schemas** — content-pack schema (map/zones/nav/objective/NPC),
  agent+gadget defs, network message types, constants. Golden fixture. *(surface: `packages/shared`)*
- **0.3 `sim-core` skeleton** — tick loop, injected clock+RNG, entity/state types,
  movement integration, empty hooks for suspicion/detection/objective/combat. Tests. *(surface: `packages/sim-core`)*

### Phase 1 — Netcode spine + greybox movement (the de-risk)
- **1.1 Colyseus room + authoritative movement** — server steps sim-core, schema
  state-sync, input messages. *(surface: `packages/server`)*
- **1.2 Client render + input + interpolation** — Three.js scene, third-person
  camera, greybox avatars, remote interpolation + own local prediction. *(surface: `packages/client`)*
- **1.3 Preview harness skeleton** — `preview.html` + seam over `content/`, mounts
  real client render of a map pack, no server. *(surface: `packages/client/src/preview`)*

### Phase 2 — The signature systems (parallelizable once 1.x is green)
- **2.1 NPC crowd** — civilian routines from content data; nav paths. *(sim-core + content)*
- **2.2 Disguise + suspicion meter** — blend state, suspicious-action detection,
  meter raised/decayed server-side, client UI. *(sim-core + client UI)*
- **2.3 Detection + hard reveal** — reveal windows, who-sees-whom server checks. *(sim-core + client UI)*
- **2.4 Combat + downed/revive/out** — gun, hit resolution (server), elimination
  state machine. *(sim-core + client)*

### Phase 3 — The heist loop + content (M1 close)
- **3.1 Objective state machine** — intel→vault→extract, package carry, extraction. *(sim-core)*
- **3.2 First map content pack** — one full stylized-low-poly map authored as data. *(content + client art)*
- **3.3 3 agents + signature gadgets** — base kit + one gadget each (build ONE, taste-judge, then the others). *(sim-core + client + content)*
- **3.4 Basic bots** — navigate, blend, pursue objective, fight when revealed; fill slots. *(sim-core)*
- **3.5 Match flow / matchmaking** — lobby → 12 slots (bot-filled) → match → win/extract → results. *(server)*

### Roadmap (post-M1, explicitly deferred)
Full client prediction + reconciliation & lag comp · procedural maps · larger roster ·
ranked/progression · audio pass · high-fidelity art.

---

## 8. Preview harness plan (companion doc applied)

- **Second entry:** `packages/client/preview.html` → `src/preview/main.ts` →
  `<PreviewApp>` (or framework equiv). Separate from the game entry.
- **The seam:** `src/preview/dataSource.ts` globs `packages/content/**/*.json`,
  validates with the **shared** schema, resolves with the **shared** resolver — same
  bytes/validate/resolve as the server, different source.
- **Modes (enumerate-from-data):** Map / NPC routines / Agents & gadgets / Suspicion
  states / Animations. New content appears automatically.
- **Determinism:** seed-driven; `seed = 0` = the on-disk artifact untouched.
- **Dual-consumer:** UI controls for Director taste loop; stable selectors for the
  Architect's runtime smoke.
- **Static build:** `vite.preview.config.ts` builds only the preview entry → shareable URL.
- **Boundary (named always):** the harness verifies render/data/layout/feel of
  client components. It CANNOT verify server authority, netcode, multi-client
  interaction, suspicion/detection truth, or scale — those need the live server or a
  server-integration test.

---

## 9. Review queue (needs Director taste / decisions — non-blocking)

- [ ] **Codename / title.** "Deceive Me Daddy" is the repo name; pick a real working title.
- [ ] **Spy-fi visual palette + tone** (sleek/serious vs comedic — Deceive Inc leans playful-stylish). Judge in the harness once first assets land.
- [ ] **The 3 agents' identities + signature gadgets** (propose: e.g. Teleport / Trap-mine / Reveal-pulse). Decide before slice 3.3.
- [ ] **Suspicious-action list + meter tuning** (feel — tune in harness/playtest).
- [ ] **Map theme** for the first location (embassy? casino? lab?).

---

## 10. Open seams I'll resolve as Architect (no grill needed unless you object)

- Bots fill empty human slots by default (you approved basic bots).
- M1 is networked even though "one human" — the loop runs in a real Colyseus room;
  other 11 slots bot-filled or empty.
- I'll pick UI framework for the client shell (likely lightweight — React or plain
  TS + Three.js) at scaffold time; flag if you have a preference.
```
