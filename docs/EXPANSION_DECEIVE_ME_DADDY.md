# Expansion — "Deceive Me Daddy"

A social-deduction game mode that **inverts** the core loop. In the base game you are the disguised
infiltrator hiding inside a crowd. Here you are an **abandoned kid searching a crowd for one specific
person — your dad — before he leaves.** Same crowd / social-map / appearance-variety tech, re-pointed
at deduction + a countdown.

> Status: **design + first preview content** (this doc + the "Daddy Hunt" preview tab). Not yet a
> playable networked mode — preview-only so we can iterate on feel before wiring the sim/server.

## The pitch

You're a lost kid in a busy public place. You have **1–2 starting clues** about your dad. The clock is
real and thematic — *"the train departs in 2:00", "he's finishing his groceries", "the library closes
in 5 minutes"*. You scan the crowd, gather more clues from the environment and by **interrogating
NPCs**, narrow the suspects, and **confirm** the right person before time runs out. If the timer hits
zero, **dad physically leaves** (boards the train / walks out) and you lose the round.

## Locked design (from the design grill)

| Decision | Choice |
| --- | --- |
| **Find/confirm mechanic** | **Combo:** match clues + walk up to confirm, AND interrogate NPCs for hint fragments. |
| **Clue types** | **Mix:** appearance attributes (red coat, briefcase, glasses) **and** behavior/location (buying milk, platform 3). |
| **Stakes / fail** | **Countdown — the target physically leaves at 0:00** = round lost. One target per round. |
| **First setting** | **Train Station** (flagship — the departure timer is baked into the fiction). |
| **Interrogation** | **Pick-a-question** — walk up, choose what to ask (what's he wearing? / where waiting? / what's he carrying?) → that specific dad attribute is revealed as a clue. |
| **Wrong confirm** | **Time penalty, keep playing** (~15 s off the countdown, tunable). No hard guess limit. |
| **Tutorial** | **Live coached checklist** (mirrors the production tutorial): read your clue → interrogate (ask a question) → watch suspects narrow → confirm dad before the train leaves. Ticks each beat off the live round state. |
| **First build** | **Extend the "Daddy Hunt" preview** into an interactive round + the tutorial overlay (preview-first; no sim/server yet). |

### Tutorial beats (the coached checklist)

1. **Read the case file** — you start with 1–2 clues; the panel shows them.
2. **Interrogate a bystander** — open the question menu, pick a question, get a new clue.
3. **Narrow the crowd** — clues dim non-matching suspects; get down to a short list.
4. **Confirm dad** — make the call before the countdown; wrong = a time penalty, right = round won.

### Build slices (preview-first, each gated)

- **D1 — Pick-a-question interrogation:** question categories + `clueForCategory` (pure, tested); the
  Daddy panel's interrogate becomes a 3-question menu revealing the chosen attribute.
- **D2 — Daddy tutorial coach:** pure `daddyTutorial` step model + a checklist overlay, toggled by a
  "Tutorial" button in the Daddy tab; beats tick off the live round.
- **D3 — Polish + gate + live-verify**, then later P1 (Train Station map) onward.

### Settings (map rotation for the expansion)

Train Station (first) → Shopping Mall → Grocery Store → Library → (stretch: airport, theme park, zoo).
Each reframes the same countdown: train departs / store closing / book due / last call.

## Core loop (one round)

1. **Spawn** in a themed map full of crowd NPCs with **varied, readable appearances** (we already have
   per-NPC outfit/skin variety). One NPC is the **target ("dad")**.
2. **Start with 1–2 clues** — a mix of an appearance attribute and a behavior/location hint.
3. **Gather more clues:**
   - **Environment:** find items in the map (a photo, a dropped wallet, a flyer) → each adds an attribute.
   - **Interrogate NPCs:** walk up + ask → they give a fragment ("saw a man with a briefcase by platform 3")
     or point toward/away.
4. **Narrow** the suspects — each known clue rules OUT non-matching NPCs (UI dims them).
5. **Confirm** by approaching the candidate. Right = win the round; wrong = a time penalty (tunable).
6. **Countdown:** when it expires, dad walks to the exit/platform and leaves → round lost.

## What systems we reuse vs. build

**Reuse (already built):** crowd NPCs + routines, per-NPC appearance variety (outfits/skin/hair), the
social maps + zones, the avatar styling API (dim/highlight), the audio engine, the preview harness.

**Build (new):**
- **Clue model** — attributes per target (appearance + behavior tags) + a clue-reveal/narrowing system.
- **Identification mechanic** — approach-to-confirm + an interrogate/hint interaction.
- **Round timer** that drives the target's "leave" behavior (pathing to the exit at 0:00).
- **Themed maps** — Train Station first (departure boards, platforms, benches, a big clock).
- **Mode-specific HUD** — the "Case File": clue dossier, suspect filter, countdown.

## Roadmap (incremental, preview-first)

- **P0 — Concept preview (this turn):** the **"Daddy Hunt" preview tab** — a crowd of distinguishable
  NPCs, a Case File panel (live countdown + clues that dim non-matching suspects), and a confirm/reveal
  interaction. Proves the *feel* of the deduction loop with zero sim/server risk.
- **P1 — Train Station map:** a themed content pack (concourse + platforms + departure board) — the
  flagship setting, previewable in the Map tab.
- **P2 — Clue + target model:** formalize target attributes + the clue-reveal/narrowing rules as shared,
  testable data (the way content packs are).
- **P3 — Interrogate + confirm interactions** wired to a single-player round.
- **P4 — The countdown & "dad leaves" pathing**, then round win/lose.
- **P5 — Networked / multiple settings** (Mall, Grocery, Library) + polish.

This file is the living design doc; update it as the mode firms up.
