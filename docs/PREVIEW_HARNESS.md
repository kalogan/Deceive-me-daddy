# The Preview Harness

*A client-only, production-truthful workbench that renders your real components
against your real data with no backend — so both a human and an agent can see the
actual thing in seconds, deterministically, and share it as a URL.*

> **Audience:** this document is written for **both humans and machines.** Humans
> read the prose to understand *why* a preview harness pays for itself and *when*
> to build one. An agent (e.g. an "Architect" verifying a visual/content slice, or
> a "Builder" iterating on one) can follow the **recipes, templates, and
> checklists** in [Part II](#part-ii--for-the-machine) directly.
>
> It is deliberately **project-agnostic.** A concrete worked example (the
> *Wayfinders* MMORPG content-preview it was developed on) lives in the
> [Appendix](#appendix--worked-example-wayfinders-content-preview).
>
> It is the companion to **`ARCHITECT_BUILDER_PIPELINE.md`**: that doc's "§5b
> lightweight runtime smoke" layer and the environment pipeline's "human eyeball
> pass" are *both* this harness. Where the Architect-Builder doc is about
> *orchestrating work*, this one is about *seeing the result* — cheaply, truthfully,
> and often.

---

## TL;DR

Your automated gate (types, lint, unit tests) verifies the bottom of the stack. It
**cannot** see the assembled, running, *visible* thing — the rendered screen, the
laid-out component, the felt interaction. Normally the only way to see that is to
boot the whole product (server + DB + auth + realtime + GPU), which is slow,
stateful, and often impossible for an agent or a static host.

A **preview harness** is a second, tiny entry point into your app that mounts your
**real** render/logic code against your **real** data with the **backend stubbed at
one seam** — so the actual thing renders in seconds, with no server. Build it once
and it serves two callers forever: the **human** judges look/feel (the taste the
gate can't), and the **agent** boots it for **runtime smoke** (drive the screen,
screenshot, scan the console) to catch "green-but-broken" before the human ever
sees it. Because it's backend-free it also **builds to a static URL** you can share
for async review.

The one rule that makes it trustworthy: **it must reuse the real code and the real
data. The moment you fork a "preview version" of a component, the harness lies.**

---

## Part I — For humans

### 1. The problem it solves

Two gaps, one tool.

**Gap A — the gate is blind above the logic layer.** Types/lint/unit tests are
strongest at deterministic core logic and thin out toward the *running, assembled*
app. Rendering, layout, component composition, visual correctness, "does it feel
right" — none of that is in the gate. (See the four-dimensions table in
`ARCHITECT_BUILDER_PIPELINE.md` §5b.) So **a human becomes the test harness for the
top three-quarters of the stack** — every check the gate can't do is a manual boot.

**Gap B — the real app is expensive to see.** Modern apps hide their visible
surface behind a backend: a server, a database, auth, realtime sockets, seeded
state, sometimes a GPU. To look at *one screen* you boot *all of it*, log in,
navigate to the right state, and hope nothing else is broken. That's too slow to do
on every change, impossible on a static host, and painful for an agent to automate.

A preview harness collapses both: it renders the **real** visible surface with the
backend removed, so seeing the actual thing costs seconds, not a full-stack boot.

### 2. The one rule: production-truthful

> **The harness mounts the SAME components, the SAME schemas, and the SAME
> resolvers the product ships. Data comes from the SAME source of truth. Nothing is
> reimplemented "for preview."**

This is the whole game. A harness that *reimplements* rendering or logic to "make it
easier to preview" will drift from production and give you **false confidence** —
the worst outcome, because you stop checking the thing that's actually broken. Reuse
is not a nicety here; it is the property that makes the tool worth trusting.

The corollary is the boundary you must keep honest (see §6): the harness can only
tell you the truth about the code paths it **actually mounts**. What it stubs out,
it cannot verify.

### 3. The six properties

A good preview harness has all six. Drop one and it gets slow, stale, or lying.

1. **Production-truthful** (§2) — real components, real schemas, real resolvers,
   real data. What you see is what ships.
2. **Backend-free** — it loads data from the source of truth *directly* (files in
   the repo, a static fixture) and **stubs the network/transport at one seam**. No
   server, DB, auth, or realtime needed to boot. This is what makes it fast, static-
   hostable, and agent-bootable.
3. **Data-driven / zero-wiring** — new artifacts (a new screen, asset, content pack,
   entity) appear in the harness **automatically**, by enumerating the data — not by
   a hand-maintained per-artifact registration. The tool never rots behind the
   content.
4. **Deterministic + parameterized** — every view is reproducible (a seed, an
   explicit input), and the *identity* parameter reproduces the exact on-disk/
   production artifact. Knobs let you explore variations without editing source.
5. **Dual-consumer** — the *same* tool serves the human taste-loop **and** the
   agent's runtime smoke. Design it to be driven by a person (UI controls) and by a
   machine (stable selectors / a scriptable surface).
6. **Shareable as a static artifact** — because it's backend-free, it builds to a
   plain static bundle you can deploy to any host and hand someone a URL for async
   review. Feedback without a screen-share.

### 4. The architecture: one seam, one extra entry

There are only three moving parts. Keeping them minimal is what keeps the harness
honest.

| Part | What it is | The discipline |
|------|-----------|----------------|
| **The entry** | A second app entry (`preview.html` / a route / a story file) that mounts your real component tree | Thin. It wires data→components and adds *inspection* controls only — never reimplements behavior. |
| **The data-source seam** | The single swap point between "data from backend" (prod) and "data from files" (preview) | ONE module. Prod fetches; preview reads the same files directly. Both feed the *same* validate+resolve pipeline. |
| **The harness shell** | Mode/artifact picker, camera/viewport controls, seed + knobs, gallery | Inspection scaffolding around the real render. Cosmetic to the product; never in the product bundle. |

```
        PRODUCTION                         PREVIEW HARNESS
   ┌──────────────────┐               ┌──────────────────────┐
   │  backend / DB    │               │  data files (Git)    │   ← same source of truth
   └────────┬─────────┘               └──────────┬───────────┘
            │ fetch                              │ glob / direct read
            ▼                                    ▼
   ┌─────────────────────────  THE SEAM  ─────────────────────────┐
   │      validate (same schema)  →  resolve (same resolver)       │
   └────────────────────────────┬─────────────────────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │  THE SAME render/logic        │   ← reused, never forked
                 │  components the product ships  │
                 └──────────────────────────────┘
            ▲                                    ▲
       product shell                        harness shell
   (real routing/state)             (picker + knobs + camera + gallery)
```

The **additive rule**: adding a new previewable artifact touches only its own data +
its own real component, plus (at most) the enumerate-from-data list. It must not
require editing the harness shell per-artifact. If adding artifact N forces a manual
edit to the harness, your harness isn't data-driven yet (§3.3).

### 5. The two consumers

The same harness is called by a human and by an agent, for different jobs. Design
for both.

**The human — the taste loop.** This is the "eyeball pass" the gate cannot replace:
*is it readable? does it feel right? does the anchor orient me? is the motion
pleasing?* The workflow is **reference-first → judge → iterate the data → replicate**
(most fixes are data edits, hot-reloaded; no code change). Build ONE thing, get a
human "yes," *then* mass-produce — never mass-produce before the first is judged
good. The harness is what makes that loop take seconds.

**The agent — runtime smoke.** After a *visible* slice clears the logic gate, the
agent boots the **freshly-built** harness on an alt port, drives the relevant
screen, screenshots, and scans the console/network for errors. This is the
**single highest-value verification above the logic gate**: it catches the
"green-but-broken" and "stale-build" classes before the human is involved. It's
cheap precisely because the harness is backend-free — no DB to seed, no auth, no
full stack. (Recipe in [Part II §C](#c-agent-runtime-smoke-recipe).)

Mapped to the four dimensions (`ARCHITECT_BUILDER_PIPELINE.md` §5b): the harness
claws back **Functional** (the assembled view actually renders/behaves) and
**Contextual** (real components, real data, real resolver) for the visual/content
slice of the stack that the logic gate can't reach. It does **not** touch **PMF**
(still a human call) and only partially touches server-**Contextual** (see §6).

### 6. What it can and cannot verify (keep this boundary honest)

The harness is a sharp tool with a **precise blind spot**, and the fastest way to
get burned is to forget where the edge is.

**It CAN verify:** that a component renders; that real data flows through the real
validate→resolve→render pipeline without throwing; visual correctness, layout,
legibility, motion/feel; that a given artifact (screen/asset/content) is well-formed
in the actual renderer.

**It CANNOT verify** (by construction — the backend is stubbed): server-authoritative
logic, persistence, auth, netcode/latency/reconciliation, multi-client interaction,
real-scale performance. Those need the full stack or a server-integration test.
**Name this boundary out loud** whenever you report a harness "pass" — a green
harness is not a green system.

**The trap that bites hardest — "it only verifies what it actually mounts."** A
harness mode may stub or omit the exact component/path where a bug lives. If the
failing code path isn't in the mounted tree, the harness *cannot* catch it, and a
hasty "verified in the preview" is simply **false**. Before claiming a fix verified,
confirm the harness actually **exercises the failing path** — not merely a
neighbouring one. (This is the harness-specific form of the gate's "tests pass while
the visible thing is wrong." See the Appendix for the live example that taught us
this the hard way.)

### 7. Pitfalls (written in blood)

- **The fork trap.** A "preview-only" reimplementation of a component drifts from
  production and gives confident, wrong answers. *Reuse the real code; if it's hard
  to mount, fix the seam, don't fork the component.*
- **The stub-too-much trap.** Stub the *transport*, not the *behavior*. If you stub
  so much that the real code path no longer runs, the harness verifies a hollow
  shell. Stub the narrowest possible seam (the network boundary), nothing inside it.
- **"Verified" for a path the harness doesn't mount.** (§6.) The most expensive
  false-positive. Know your harness's mounted tree per mode.
- **Determinism leaks.** If the harness (or the code under it) calls wall-clock or
  unsystemd randomness, "reproduce this exact view" breaks and screenshot diffs
  drift. Seed everything; identity-seed = the production artifact.
- **Stale build / stale HMR.** A harness serving an old bundle masquerades as a code
  bug (or hides a real one). Boot the *freshly-built* artifact for verification;
  hard-reload when HMR state gets weird. (Same stale-server lesson as the main doc.)
- **Harness code leaking into the product bundle.** The inspection shell, dev CSS,
  and fixtures must live behind the *separate* entry and never ship in the product.
  Enforce with a separate build config / entry, not discipline alone.
- **Letting it rot behind the content.** If a new artifact needs a manual harness
  edit to show up, the harness will silently fall behind reality. Make it
  enumerate-from-data (§3.3) so coverage is automatic.

---

## Part II — For the machine

This part is written so an agent can build a harness, add an artifact to it, and run
runtime smoke against it. Commands assume a JS/TS + Vite project; keep the structure,
swap the specifics.

### A. Build manifest — add a preview harness to a project

```yaml
add_preview_harness:
  preconditions:
    - the product has a visible/component/content surface worth iterating on
    - that surface is gated behind a backend that is slow/stateful to boot
  create:
    - path: <app>/preview.html            # second HTML/entry, NOT the product index
      role: "static entry; loads the harness main"
    - path: <app>/src/preview/main.<ext>  # mounts <PreviewApp> only
    - path: <app>/src/preview/PreviewApp.<ext>
      role: "harness shell: artifact picker + viewport/camera + seed/knobs + gallery"
      imports: "the REAL product components — never reimplementations"
    - path: <app>/src/preview/dataSource.<ext>   # THE SEAM (see §B)
      role: "load artifacts from FILES (glob/import), validate with the SAME schema,
              resolve with the SAME resolver the product uses"
    - path: <app>/<preview-build-config>   # static, server-less build of preview ONLY
      role: "emits the harness as a static bundle (index.html) for any static host"
  forbidden:
    - reimplementing any product render/logic 'for preview'
    - importing the server / DB / transport client into the harness
    - per-artifact manual registration in the shell (must enumerate from data)
    - shipping harness shell / dev CSS / fixtures in the PRODUCT bundle
  package_scripts:
    dev_preview:   "<vite> --open /preview.html"          # hot-reloading dev loop
    build_preview: "<vite> build --config <preview-build-config>"  # static artifact
  gates_unchanged:
    - the harness is dev-only; it does not relax the product's logic gate
```

### B. The data-source seam (the swap that removes the backend)

The single most important module. Production fetches; preview reads the same files.
Both feed the *same* validate + resolve pipeline — so the only difference is *where
bytes come from*, never *how they're interpreted*.

```ts
// PRODUCTION path (the product uses this):
//   async function loadArtifact(id): Promise<Resolved> {
//     const raw = await fetch(`/api/artifact/${id}`).then(r => r.json());
//     return resolve(schema.parse(raw));          // validate + resolve (SHARED)
//   }

// PREVIEW path (the harness uses this) — same validate+resolve, different source:
const FILES = import.meta.glob('../../../content/**/*.json', {  // bundler-native
  eager: true, import: 'default',
}) as Record<string, unknown>;

export function loadAllArtifacts(): Resolved[] {
  const out: Resolved[] = [];
  for (const [path, raw] of Object.entries(FILES)) {
    try {
      out.push(resolve(schema.parse(raw)));        // ← SAME schema + SAME resolver
    } catch (err) {
      console.error(`[preview] artifact failed validation (${path}):`, err);
      // skip one bad artifact; never blank the whole harness
    }
  }
  return out;
}
```

Rules:
- **Validate with the product schema, resolve with the product resolver.** If the
  harness parses data differently from production, it isn't truthful.
- **Stub the transport, not the logic.** Replace the *fetch*, keep everything after
  it identical.
- **Fail soft per artifact.** One malformed item logs and is skipped; it never takes
  down the gallery.
- **Bundler-native enumeration** (`import.meta.glob`, `require.context`, a generated
  manifest) gives you §3.3 zero-wiring + HMR for free.

### C. Agent runtime-smoke recipe

The verification loop the Architect runs after a visible slice clears the logic gate.
Boot the **freshly-built** harness on an **alt port** (never disturb the human's
running instances), drive it, and read **real** signals.

```
1. BUILD fresh, then START on an alt port (or use a preview/dev-server tool).
2. NAVIGATE to the harness entry (/preview.html) and SELECT the target artifact/mode.
3. DRIVE the failing/target path explicitly — switch to the exact mode, trigger the
   exact interaction (click/fill/keypress) that the slice changed. Driving a
   NEIGHBOURING path does not count (§6).
4. READ real signals, in priority order:
     a. console errors / warnings   ← the cheapest, highest-signal check
     b. an accessibility/DOM snapshot (assert text/structure/state)
     c. a screenshot (layout/visual)
     d. for content/visual: confirm the live GL/canvas/render context is not lost
5. VERDICT:
     - clean console + correct snapshot/screenshot + path exercised → PASS (report it)
     - any thrown error / context loss / wrong state → FAIL (read source, fix, re-run)
     - path NOT actually mounted by this harness mode → INCONCLUSIVE, say so plainly
6. REPORT: what you drove, what you observed (errors verbatim), and the BOUNDARY —
   "verified in the harness" ≠ "verified in the full system" (§6).
```

Anti-patterns to refuse:
- Claiming a pass from a **stale** bundle. Rebuild first.
- Claiming a pass when the harness **didn't mount** the changed component. Inconclusive.
- Reading a screenshot as proof of *console* health — scan the console too; a render
  can look fine for the frame before an uncaught error tears it down.

### D. Add a new previewable artifact (zero-wiring checklist)

```
[ ] Author the artifact as DATA in the source-of-truth location the seam globs.
[ ] Implement/extend its behavior in the REAL product component (not a preview copy).
[ ] Confirm it appears in the harness automatically (glob + enumerate-from-data).
    └ If it does NOT appear without editing the shell, your enumeration is manual —
      fix that, don't hand-register.
[ ] Drive it in the harness: it renders, real data flows, no console errors.
[ ] Human taste pass (if visual/feel) → iterate the DATA, hot-reloaded.
```

### E. Determinism + shareable static build

```
DETERMINISM:
  - Every generated/parameterized view is a pure function of an injected seed/input.
  - The IDENTITY seed (e.g. 0) reproduces the exact production artifact, untouched.
  - Derive variations by mixing the seed (reproducible), never by wall-clock/random.
  - "Bake" = materialize the current seed/knobs back into the artifact for export.

SHAREABLE BUILD:
  - A SEPARATE build config builds ONLY the preview entry (no product/server bundle).
  - Emit the preview entry as index.html with relative asset URLs → served at "/" by
    any static host (no rewrite rules), deployable to Vercel/Netlify/Pages/etc.
  - This is possible ONLY because the harness is backend-free (property §3.2).
```

---

## When to build one (and when not)

**Build it when:** the product has a substantial **visible / component / content**
surface you iterate on, AND that surface sits behind a **backend that's slow or
stateful to boot** (server, DB, auth, realtime, GPU), AND you want a **human and/or
an agent** to see the real thing fast and often. The payoff compounds with the
number of artifacts and the cost of a full boot.

**Don't bother when:** the product is a pure backend/service with no visible surface
(use integration tests); the app boots instantly with no backend anyway (just run
it); or the surface is one trivial screen (not worth a second entry).

## Adapting to another project

1. Find your **data source of truth** and write the **seam** (§B): files in, same
   validate+resolve as production, transport stubbed.
2. Add the **second entry** that mounts your **real** component tree with an
   inspection shell around it (§A).
3. Make it **enumerate from data** so new artifacts appear for free (§3.3 / §D).
4. Add **determinism + knobs** (§E) so views are reproducible and explorable.
5. Wire the **dual-consumer** surface: human controls *and* stable selectors /
   scriptable hooks for the agent (§C).
6. Add the **static build** (§E) for shareable async review.
7. In every harness report, state the **boundary** (§6): what it verified and what
   it structurally cannot.

## Glossary

- **Preview harness** — a backend-free second entry that mounts the product's real
  components against real data for fast human + agent inspection.
- **Production-truthful** — reuses the real render/logic/schemas/resolvers; never a
  fork "for preview." The property that makes the harness trustworthy.
- **The seam** — the single swap point between backend-fetch (prod) and file-read
  (preview), feeding the same validate+resolve pipeline.
- **Zero-wiring / data-driven** — new artifacts appear by enumerating data, with no
  per-artifact harness edit.
- **Runtime smoke** — the agent's boot-drive-screenshot-scan verification of a
  visible slice, above the logic gate.
- **Taste loop** — the human's reference-first → judge → iterate-data → replicate
  cycle the gate can't perform.
- **The boundary** — what a harness structurally cannot verify (server/persistence/
  netcode/scale) and the "only-what-it-mounts" trap.
- **Bake** — materialize the active seed/knobs into the artifact for export.

---

## Appendix — worked example (*Wayfinders* content preview)

*Wayfinders* is a browser persistent-shard MMORPG. The live game needs a Colyseus
server + Postgres + Redis, so seeing *any* biome/character/route normally means
booting the whole stack, authenticating, and travelling there. The **content
preview** (`packages/client/src/preview/`) is the harness that makes content
iteration cost seconds instead. Concrete mappings to Part I/II:

- **The second entry (§A).** `preview.html` → `src/preview/main.tsx` →
  `<PreviewApp>`, a mount entirely separate from the game's `index.html` →
  `src/main.tsx`. Dev-only CSS (`preview.css`) is imported only by the preview entry.
- **Production-truthful (§2).** The harness renders the **same** components the game
  ships: `FrostpeaksZone` (biomes), `TunnelZone`, `SkyIslesZone`, `SkyTransitZone`
  (skyboat flight), the real art-kit mesh generators, the real procedural humanoid +
  animator. "REUSE, never duplicate" is written at the top of `PreviewApp.tsx`.
- **The seam (§B).** `previewPacks.ts` loads every ContentPack straight from Git via
  `import.meta.glob('content/packs/*.json')`, validates with the **same**
  `ContentPackSchema` (`@wayfinders/shared`), and resolves with the **same**
  `resolveZoneLayout` (`@wayfinders/sim-core`) the server uses. The game's own
  `art/packLoader.ts` fetches the identical packs from the server — same bytes, same
  validate+resolve, different source. No forked logic.
- **Data-driven / zero-wiring (§3.3).** `collectArtKitIds` (and the tunnel/sky-isle
  variants) enumerate every art-kit id a pack references straight from the resolved
  data, so a newly-authored prop/mob/route shows up in the gallery automatically —
  no manifest to maintain.
- **Deterministic + knobs (§E).** `mixSeed` / `deriveRerolledPack` derive a whole
  reproducible "look" (terrain height/roughness/octaves + per-field density) from a
  preview seed; `previewSeed = 0` is the identity (the on-disk pack untouched);
  `bakeSeedIntoPack` materializes a rolled variant for export. Determinism mirrors
  the engine's own injected-seed rule.
- **Dual-consumer (§5).** Kevin (Director) uses the mode tabs (Biome / Gallery /
  Themes / Props / Editor / Delve / Audio / Characters / Creatures / Settlement /
  Travel) and Orbit/Fly/Walk cameras for the taste loop. The Architect agent boots
  the same tool for runtime smoke — exactly the "client-only preview tool for
  content/visual slices" layer named in `ARCHITECT_BUILDER_PIPELINE.md` §5b.
- **Shareable static build (§E).** `vite.preview.config.ts` builds **only** the
  client-only preview entry and renames it to `index.html` with relative asset URLs,
  so it deploys to any static host (the game itself can't — it needs the server).
  `build:preview` + the `share` script produce that artifact.

**The lesson that taught us §6 (the boundary), the hard way.** A live crash — boarding
a skyboat route (Skyhold → Aurora) threw `THREE.Sprite: "Raycaster.camera" needs to
be set` → uncaught → `WebGLRenderer: Context Lost`. The Architect first "verified a
fix in the preview" and reported it resolved. **It hadn't reproduced the bug at all.**
The crash lives in `CameraController` — the live orbit camera, mounted unconditionally
in `World.tsx`, which keeps raycasting the scene while the flight fills it with
`Sprite`s. But the preview's Sky-Routes mode uses its *own* camera rig and **never
mounts `CameraController`**, so the harness *structurally could not* exercise the
failing path. The "preview pass" was a false positive of exactly the §6 kind:
*verified for a path the harness doesn't mount.* The real diagnosis came from reading
the live mount tree (`<CameraController />` unconditional + flight `Sprite`s), and the
fix had to be confirmed in the **live** client, not the harness. Two durable rules
came out of it: **(1)** before claiming a harness pass, confirm the harness actually
mounts the changed path; **(2)** name the boundary in the report — "verified in the
preview" is never "verified in the live game."

This is the harness's value *and* its edge in one story: it makes 95% of content
iteration cost seconds — and the 5% it can't see, it must say so about, loudly.
