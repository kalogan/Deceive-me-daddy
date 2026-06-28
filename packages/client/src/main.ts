// The game client entry (index.html points here). Wires the seam together:
//
//   Input (DOM) -> PlayerInput -> StateSource.sendInput -> StateSource.update ->
//   WorldView.sync(state) -> third-person camera follow -> renderer.render
//
// Authority (PROJECT_BRIEF §3/§4.2): the renderer only PRESENTS a NetMatchState and emits
// input REQUESTS. We use LocalMockSource for now so the scene runs server-less; the live
// ColyseusSource (a later slice) implements the same StateSource interface and drops in
// here with no other change — the StateSource seam is the swap point.
import * as THREE from 'three';
import { TIER_COLOR, type ClearanceTier, type ContentPack, type NetMatchState } from '@deceive/shared';
import { lerpAngle, type Vec3 } from './render/interpolate';
import { applyFirstPersonCamera, headingDeg } from './render/firstPersonCamera';
import { ViewModel } from './render/viewModel';
import { WorldView } from './render/WorldView';
import { NpcView } from './render/NpcView';
import { MapView } from './render/MapView';
import { CrumbView } from './render/CrumbView';
import { PackageView } from './render/PackageView';
import { KeyView } from './render/KeyView';
import { VehicleView } from './render/VehicleView';
import { PortraitView } from './render/PortraitView';
import { FireGate } from './render/fireGate';
import { createPostFx } from './render/postFx';
import {
  GAME_MAP_ID,
  TUTORIAL_MAP_ID,
  loadGameMaps,
  playablePacks,
  selectGameMap,
} from './content/loadMap';
import { LocalMockSource, type StateSource } from './net/StateSource';
import { LocalSimSource } from './net/LocalSimSource';
import { ColyseusSource } from './net/ColyseusSource';
import { Input } from './input/Input';
import { TouchControls, isTouchDevice } from './input/TouchControls';
import { Hud } from './hud/Hud';
import { DuelHud } from './hud/DuelHud';
import { TutorialCoach } from './ui/TutorialCoach';
import {
  deriveHudModel,
  nearestDownedTeammate,
  nearestInteractable,
  nearestTakeableNpc,
} from './hud/hudModel';
import { AudioEngine, ambientForTheme } from './audio/AudioEngine';
import { deriveAudioEvents } from './audio/audioEvents';
import { Minimap } from './hud/Minimap';
import { MatchTimer } from './hud/MatchTimer';
import { Waypoint } from './hud/Waypoint';
import { EventFeed } from './hud/EventFeed';
import { deriveMatchEvents } from './hud/matchEvents';
import { footstepDue } from './hud/footstepCadence';
import { Menu, connectOptionsFor, type MenuChoice } from './menu/Menu';
import { ResultsScreen } from './ui/ResultsScreen';
import { LoadingScreen } from './ui/LoadingScreen';

/** The authoritative-server port used in LOCAL DEV only (vite dev serves the client on a
 * different port than the server; packages/server `PORT` env, default 2567). */
const SERVER_PORT = 2567;

/** Session control: when true, the local strafe axis is inverted (Settings → Invert strafe). */
let invertStrafe = false;

/**
 * Pick the Colyseus endpoint. Resolution order:
 *  1. `?server=ws://host:port` query override (`off|none|mock|local` forces the offline mock).
 *  2. `VITE_SERVER_URL` build-time env — set on the static host (e.g. Vercel) to point the
 *     client at the deployed Fly websocket server (`wss://your-app.fly.dev`).
 *  3. Vite DEV: client (:5173) and server (:2567) run separately → `ws://<host>:2567`.
 *  4. PRODUCTION default: the page is served BY the game server (the Fly app serves both the
 *     static client AND the websocket), so connect to the SAME origin — `wss://` when the page
 *     is https (Fly terminates TLS), else `ws://`. Same host+port as the page.
 */
function resolveEndpoint(): string | null {
  const override = new URLSearchParams(location.search).get('server');
  if (override) {
    if (['off', 'none', 'mock', 'local'].includes(override.toLowerCase())) return null;
    return override;
  }
  const fromEnv = import.meta.env.VITE_SERVER_URL;
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return `ws://${location.hostname || 'localhost'}:${SERVER_PORT}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

/**
 * Select the live source if a server answers; otherwise fall back to the offline mock so
 * the scene still runs (PROJECT_BRIEF §3 — the StateSource seam is the swap point). The
 * returned source has a resolved localPlayerId, ready for WorldView.
 *
 * `choice` is the player's start-menu pick (mode + agent): it picks the room create-vs-join
 * strategy and the requested agent, threaded straight into ColyseusSource.connect via the
 * pure `connectOptionsFor` mapping. The `?server=mock`/offline fallback is preserved — a
 * failed connect (or a disabled server) still drops to LocalMockSource as before.
 */
async function selectSource(choice: MenuChoice, packs: ContentPack[]): Promise<StateSource> {
  // Pick the offline pack: tutorial → the tutorial level; a pinned level → that; else random playable.
  const offlinePack = (): ContentPack | null => {
    if (choice.tutorial) {
      return packs.find((p) => p.id === TUTORIAL_MAP_ID) ?? playablePacks(packs)[0] ?? packs[0] ?? null;
    }
    if (choice.mapId) return packs.find((p) => p.id === choice.mapId) ?? null;
    const pool = playablePacks(packs);
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  };
  const offline = (): StateSource => {
    const pack = offlinePack();
    // Fully-simulated offline source (real sim-core). The TUTORIAL spawns NO bots: bots pursue the
    // objective and would grab the (one-time, shared) intel nodes before the player, soft-locking
    // the guided flow. The "Take a shot" beat only needs the player to FIRE (no target), and
    // disguises come from NPCs, so a bot-free tutorial loses nothing. Movement-only LocalMockSource
    // is the last resort if no pack is available at all.
    if (pack) return new LocalSimSource(pack, choice.agent, choice.tutorial ? 0 : undefined);
    return new LocalMockSource(packs.map((p) => p.id), choice.mapId);
  };

  // SOLO + TUTORIAL run fully offline on the real deterministic sim — no server needed (works on a
  // static deploy). Online team modes use the authoritative server, falling back to offline sim.
  if (choice.mode === 'solo' || choice.tutorial) return offline();

  const endpoint = resolveEndpoint();
  if (endpoint) {
    try {
      const net = new ColyseusSource(endpoint);
      await net.connect(connectOptionsFor(choice));
      console.info(
        `[net] connected to ${endpoint} as ${net.localPlayerId} ` +
          `(${choice.mode}, agent=${choice.agent}, server-authoritative)`,
      );
      return net;
    } catch (err) {
      console.warn(`[net] could not connect to ${endpoint}; falling back to offline sim`, err);
    }
  } else {
    console.info('[net] server disabled via ?server=; using the offline sim');
  }
  return offline();
}

/**
 * Resolve which level the match is actually on. The server broadcasts the authoritative `mapId`
 * in its state, but it lands a tick or two after connect() resolves — so we poll briefly for it
 * (the loading screen is up meanwhile). Falls back to the player's requested `mapId` (then the
 * caller's default) if the server never reports one. The offline mock sets mapId synchronously,
 * so this returns on the first check there.
 */
async function resolveMatchMapId(source: StateSource, requestedMapId: string): Promise<string> {
  const deadlineMs = performance.now() + 2500;
  let id = source.getState().mapId;
  while (!id && performance.now() < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    id = source.getState().mapId;
  }
  return id || requestedMapId;
}

// Gameplay is FIRST-PERSON (see the follow block below). These third-person numbers now drive
// ONLY the downed/out SPECTATOR cam — when you're downed the view pulls back + up so you can
// watch the match while waiting for a revive. Distances flagged for Director taste.
const CAM_BACK = 5.5; // metres behind the avatar (spectator only)
const CAM_HEIGHT = 3.0; // metres above the ground (spectator only)
const CAM_LOOK_HEIGHT = 1.4; // height of the point the spectator cam aims at (avatar head-ish)
const CAM_SMOOTH = 0.15; // fraction of the gap the camera closes per frame (eased)

function mount(): { renderer: THREE.WebGLRenderer; app: HTMLElement } {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app mount point missing from index.html');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Cinematic tone mapping (applied by the post chain's OutputPass) so the stylised palette
  // reads richer than a raw linear render.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  app.appendChild(renderer.domElement);
  return { renderer, app };
}

function buildScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d12);
  scene.fog = new THREE.Fog(0x0c0d12, 30, 80);

  // Greybox ground plane.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x20232c, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A faint grid so motion across the plane reads at a glance.
  const grid = new THREE.GridHelper(200, 100, 0x33384a, 0x282c38);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.4;
  scene.add(grid);

  // Lighting rig (art engine, slice 2): a gentle, lightly-desaturated hemisphere fill (kept
  // weak so it never overwhelms the tier ALBEDO — disguise colour must stay readable), a warm
  // DOMINANT key that casts shadows, and a dim cool rim from behind to pop figures off the
  // dark background.
  scene.add(new THREE.HemisphereLight(0xaeb6c6, 0x16151a, 0.42));

  const sun = new THREE.DirectionalLight(0xfff0d8, 1.45);
  sun.position.set(14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0004;
  const s = 34;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  scene.add(sun);

  const rim = new THREE.DirectionalLight(0x8a97c0, 0.32);
  rim.position.set(-12, 8, -14);
  scene.add(rim);

  return scene;
}

/**
 * Run the actual game once the player has committed a start-menu `choice`. The AudioEngine is
 * created and (on the menu's first gesture) already unlocked by the bootstrap below, then
 * handed in here so the in-game SFX/ambient share the same context the menu warmed up.
 *
 * Everything from the original auto-connect entry point is preserved: touch controls, audio
 * wiring, HUD, post-processing, the frame loop, and the hot-reload teardown — only the SOURCE
 * of the start signal changed (the menu instead of an immediate auto-connect).
 */
async function start(choice: MenuChoice, audio: AudioEngine): Promise<void> {
  const { renderer, app } = mount();

  // Cover the connect + first-frame gap with the LOADING screen (the menu just hid itself, so
  // without this the player would stare at a bare canvas while we connect). It shows immediately,
  // narrates the connect below, and is dismissed on the first rendered frame (scene visible).
  const loading = new LoadingScreen();
  loading.show();
  loading.setStatus('Connecting…');

  const scene = buildScene();

  // The REAL authored map (zones/doors/objective/markers), drawn via the same MapView the
  // preview harness uses. We mount it AFTER the source connects — the AUTHORITY chooses the
  // level (the server broadcasts state.mapId; the offline mock picks one), so we render exactly
  // the map being simulated. All maps the client can mount are loaded up front here.
  const mapView = new MapView(scene);
  const maps = loadGameMaps();

  // The ambient NPC crowd the player blends among. Driven from NetMatchState.npcs (the
  // live server fills it; the offline mock leaves it empty → map + you, no crowd).
  const npcView = new NpcView(scene);

  // Holo-Crumb tells: spinning shards at recent disguise-theft sites (PROJECT_BRIEF §2b).
  // Driven from NetMatchState.crumbs; the server drops + expires them authoritatively.
  const crumbView = new CrumbView(scene);

  // The LIVE objective package (PROJECT_BRIEF §2): a glowing briefcase that follows the
  // authoritative objective.packageX/Y/Z — riding the carrier when held, sitting loose
  // otherwise. MapView draws the static vault marker; this is the one that actually moves.
  const packageView = new PackageView(scene);
  const keyView = new KeyView(scene);
  const vehicleView = new VehicleView(scene);

  // The on-screen awareness overlay (plain DOM): disguise tier, zone, "scolded" warning,
  // and the take-disguise prompt. Derived each frame from the latest snapshot + the pack.
  const hud = new Hud();
  // Live mugshot in the HUD hex — shows the face of whoever the player currently looks like, so a
  // stolen disguise is readable at a glance. Driven from the local snapshot each frame (no-op unless
  // the look changes).
  const portraitView = new PortraitView();
  hud.mountPortrait(portraitView.canvas);

  // The "match feel" HUD layer (PROJECT_BRIEF UX pass) — SEPARATE compact overlays composed
  // alongside the awareness HUD, each phone-first in a non-colliding corner (above the canvas,
  // below the menu/results). The minimap (top-right) + waypoint (center-left) get the authored
  // pack once it resolves below; the timer (top-center) + event feed (bottom-left) are
  // snapshot-driven. All are display-only — they read the server's snapshot.
  const minimap = new Minimap();
  const matchTimer = new MatchTimer();
  const waypoint = new Waypoint();
  const eventFeed = new EventFeed();

  // The match-end RESULTS overlay (plain DOM, full-screen): VICTORY/DEFEAT + a Play-Again flow.
  // Shown ONCE when the match transitions into 'ended' (a team extracted → objective.winningTeam
  // leaves -1). The boolean guard below makes that a one-shot so we don't rebuild the overlay
  // every frame. Display-only: the server decides the winner (extraction is automatic server-side).
  const results = new ResultsScreen();
  let resultsShown = false;

  // The 1v1 DUEL overlay (opponent lobby + round scoreboard + countdown / round / match banners).
  // Driven each frame from `state.duel`; it self-hides when the snapshot isn't a duel (mode !==
  // 'duel' → state.duel is absent), so it costs nothing in the heist. The duel reuses the same
  // world render + awareness HUD + minimap; this just adds the duel-specific overlay on top.
  const duelHud = new DuelHud();

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, CAM_HEIGHT, CAM_BACK);

  // Post-processing chain (bloom + tone-map). Rendered instead of renderer.render each frame.
  const postFx = createPostFx(renderer, scene, camera, window.innerWidth, window.innerHeight);

  // Pick the live (ColyseusSource) or offline (LocalMockSource) source BEFORE building the
  // WorldView, so we have the resolved localPlayerId to follow. The offline mock is handed the
  // available map ids so it can pick one at random (online, the server's choice wins).
  loading.setStatus('Joining match…');
  const source: StateSource = await selectSource(choice, maps);
  loading.setStatus('Entering the field…');

  // Mount the map the AUTHORITY is running. The server sets state.mapId at room creation but it
  // arrives a tick or two AFTER connect() resolves — so we WAIT briefly for it (rather than
  // racing and defaulting to facility every time, which is why random/chosen levels never showed).
  // The offline mock sets mapId synchronously, so the wait returns immediately there.
  const authoritativeMapId = await resolveMatchMapId(source, choice.mapId);
  const map = selectGameMap(maps, authoritativeMapId || GAME_MAP_ID);
  if (map) mapView.setPack(map);
  else console.warn('[game] no content pack found; rendering bare scene without a map');
  // Show the vault-key forge + loose key only on a key pack (inert otherwise).
  keyView.setForge(map?.objective.requiresVaultKey ? map.objective.keyForgePosition : null);
  // The get-away vehicle waits at the (first) extraction point; theme picks car/boat/train.
  vehicleView.setRoute(map?.theme ?? '', map?.objective.extractionPoints[0]);

  // The interactive tutorial coach — only on a Tutorial run. It ticks the six heist beats off the
  // live snapshot as the player does them (intelRequired drives the "gather intel" beat).
  const tutorialCoach =
    choice.tutorial && map ? new TutorialCoach(map.objective.intelRequiredToOpenVault) : null;

  // Pick the in-match soundtrack from the chosen level's theme via the single-source-of-truth
  // mapping (nightclub→club, beach→beach, facility/other→match). Used for the crossfade now and
  // the in-game audio-unlock fallback below. The menu already unlocked + started the 'menu' bed on
  // the player's first gesture, so this crossfades; if (impossibly) audio isn't unlocked yet it's
  // a safe no-op and the in-game unlock brings up the bed on the first gesture.
  const matchBed = ambientForTheme(map?.theme ?? '');
  audio.startAmbient(matchBed);
  const worldView = new WorldView(scene, source.localPlayerId);
  // First-person held-gadget viewmodel — locked in front of the camera each frame. Hidden while
  // the local player is downed (the spectator cam pulls back to third-person then).
  const viewModel = new ViewModel();
  scene.add(viewModel.group);
  const input = new Input(app);

  // Take-disguise interaction (PROJECT_BRIEF §2b): pressing E REQUESTS the disguise of the
  // nearest in-range NPC. The frame loop keeps `takeTargetId` pointed at that NPC (the same
  // selection the HUD prompt shows); the keydown only fires the request. Authority is the
  // server's: it validates range + applies the swap + drops the crumb, and our avatar's
  // disguiseTier recolors on the next snapshot. A local listener (not Input/net — those are
  // frozen for this slice) so the interaction stays in this file surface.
  let takeTargetId: string | null = null;
  const onTakeKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || e.repeat) return;
    if (takeTargetId) source.takeDisguise(takeTargetId);
    // [E] also DEPARTS at the extraction point (no NPC to disguise from there) — "press E to leave".
    else if (interactTargetId === 'depart') source.interact('depart');
  };
  window.addEventListener('keydown', onTakeKey);

  // Revive interaction (PROJECT_BRIEF §2b/§2.6): pressing R REQUESTS a revive of the nearest
  // DOWNED teammate within REVIVE_RANGE. The frame loop keeps `reviveTargetId` pointed at that
  // ally (the same selection the HUD "[R] Revive teammate" prompt shows), so the key and the
  // prompt never disagree. Authority is the server's: it validates team + range + downed and
  // applies the revive; our ally comes back upright on the next snapshot. e.repeat guards a
  // held key so we don't spam the request every frame (the server also validates).
  let reviveTargetId: string | null = null;
  const onReviveKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyR' || e.repeat) return;
    if (reviveTargetId) source.revive(reviveTargetId);
  };
  window.addEventListener('keydown', onReviveKey);

  // Objective interact (PROJECT_BRIEF §2 — the heist loop): pressing Q REQUESTS the nearest
  // interactable — collect intel from an in-range node, or grab the loose package once the
  // vault is open. The frame loop keeps `interactTargetId` pointed at that target (the same
  // selection the HUD "[Q] …" prompt shows), so the key and the prompt never disagree. The id
  // is an intel-node id or the literal 'package' (the StateSource.interact contract). Q is
  // free: E=take-disguise, F/click=fire, R=revive. Authority is the server's — it validates
  // proximity/state + applies the collect/grab; extraction is AUTOMATIC server-side.
  let interactTargetId: string | null = null;
  const onInteractKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyQ' || e.repeat) return;
    if (interactTargetId) source.interact(interactTargetId);
  };
  window.addEventListener('keydown', onInteractKey);

  // Fire (PROJECT_BRIEF §2.5): left mouse button (or F) REQUESTS a shot. Firing instantly
  // blows the local player's cover — the server applies the hard reveal and our avatar comes
  // back 'revealed' on the next snapshot, so we see our own red halo (good for verifying).
  // A FireGate rate-limits to one request per ~250ms so a held button isn't a firehose; the
  // gate is clocked off performance.now() (cosmetic input timing, not sim authority).
  const fireGate = new FireGate();
  const requestFire = () => {
    if (fireGate.tryFire(performance.now())) {
      source.fire();
      // Local prediction: flash + recoil the local avatar immediately so the muzzle doesn't lag
      // the fireSeq round-trip (~RTT). The fireSeq echo for the local player is then suppressed
      // for a short window inside WorldView so we don't double-flash.
      worldView.predictLocalFire();
    }
  };
  const onFireMouse = (e: MouseEvent) => {
    if (e.button === 0) requestFire(); // left button only
  };
  const onFireKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyF' && !e.repeat) requestFire();
  };
  app.addEventListener('mousedown', onFireMouse);
  window.addEventListener('keydown', onFireKey);

  // Signature Expertise (PROJECT_BRIEF §2 — the agents): pressing G REQUESTS the local
  // player's Expertise. The server knows which agent we are and validates the cooldown; our
  // ability state (active window + cooldown) comes back on the next snapshot, driving the HUD
  // status + the cloak/invulnerable body visual. G is free (E/F/click/R/Q are taken).
  const onAbilityKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyG' && !e.repeat) source.useAbility();
  };
  window.addEventListener('keydown', onAbilityKey);

  // Deployable Gadget (PROJECT_BRIEF §2 — the second active slot): pressing H REQUESTS the
  // local player's gadget. The server knows which agent we are, validates its own cooldown,
  // and applies the kind-specific effect (scan reveal / frag burst / mirage escape); the
  // resulting state comes back on the next snapshot, driving the HUD gadget readout. H is free
  // (E/F/click/R/Q/G/M are taken). e.repeat guards a held key from spamming the request.
  const onGadgetKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyH' && !e.repeat) source.useGadget();
  };
  window.addEventListener('keydown', onGadgetKey);

  // Procedural audio (self-contained — all sound is SYNTHESISED, no asset files). The engine is
  // created + (typically already) unlocked by the start menu, which resumes it on the player's
  // first gesture so the ambient bed plays under the menu. We KEEP the same lazy unlock here as
  // a belt-and-braces fallback for any in-game gesture that beats the menu's (e.g. a synthetic
  // first input): resume()/startAmbient() are idempotent, so re-arming them is harmless. SFX are
  // driven from snapshot diffs in the frame loop (deriveAudioEvents), so sound reacts to gameplay.
  const unlockAudio = () => {
    audio.resume();
    audio.startAmbient(matchBed); // in-game → the level's bed (synthwave club for neon).
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('touchstart', unlockAudio);

  // 'M' toggles mute for the whole mix (master gain). A simple local listener, like the others.
  let audioMuted = false;
  const onMuteKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyM' && !e.repeat) {
      audioMuted = !audioMuted;
      audio.setMuted(audioMuted);
    }
  };
  window.addEventListener('keydown', onMuteKey);

  // Previous snapshot for the audio diff. `getState()` returns the SAME mutated object each frame
  // (the mock source), so we can't hold a live reference — we must snapshot the fields the diff
  // reads. We store a shallow clone (the few diffed player/objective fields) each frame.
  let prevAudioState: NetMatchState | null = null;
  const snapshotForAudio = (s: NetMatchState): NetMatchState => ({
    ...s,
    players: Object.fromEntries(
      Object.entries(s.players).map(([id, p]) => [id, { ...p }]),
    ),
    objective: { ...s.objective },
  });

  // Mobile touch controls (PROJECT_BRIEF §3): on touch devices, an on-screen stick + look
  // drag + button cluster drive the SAME StateSource requests as the desktop keys. The action
  // buttons reuse the per-frame target selections (take/revive/interact) so a tap acts on the
  // same thing the desktop prompt would. Null on desktop — keyboard/mouse path is unchanged.
  const touch = isTouchDevice()
    ? new TouchControls(app, {
        onFire: requestFire,
        onTakeDisguise: () => {
          if (takeTargetId) source.takeDisguise(takeTargetId);
        },
        onInteract: () => {
          if (interactTargetId) source.interact(interactTargetId);
        },
        onRevive: () => {
          if (reviveTargetId) source.revive(reviveTargetId);
        },
        onAbility: () => source.useAbility(),
        onGadget: () => source.useGadget(),
      })
    : null;

  // The current content pack (zones) the HUD looks `currentZoneId` up in. Null → "Open area"
  // labels fall through and no scolded warning fires (no zones to gate against).
  const pack = map ?? null;

  // Hand the authored pack to the pack-driven overlays: the minimap scales to its world bounds +
  // draws its static markers; the waypoint targets its intel nodes / extraction points.
  minimap.setPack(pack);
  waypoint.setPack(pack);

  // Previous snapshot for the BANNER/FEED diff (own clone — like the audio diff, getState()
  // mutates in place). We clone only the few fields deriveMatchEvents reads.
  let prevMatchState: NetMatchState | null = null;
  const snapshotForMatch = (s: NetMatchState): NetMatchState => ({
    ...s,
    players: Object.fromEntries(
      Object.entries(s.players).map(([id, p]) => [id, { ...p }]),
    ),
    objective: { ...s.objective },
  });

  // Footstep cadence state: planar speed is derived from the local render position delta each
  // frame; `stepAccum` accumulates time and resets when a step fires (footstepCadence.ts).
  let stepAccum = 0;
  const lastStepPos = { x: 0, z: 0 };
  let hasStepPos = false;

  // Smoothed camera target so it eases rather than snapping to the avatar each frame.
  const camYaw = { value: 0 };
  const camTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  // The reticle's vertical screen position. First-person aims straight down the camera's forward
  // axis, so the crosshair sits at true screen centre.
  const RETICLE_TOP = '50%';

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postFx.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Centre crosshair — a small reticle so AIMING + firing read clearly (the chief reason a shot was
  // hard to "feel"). Hidden until the avatar spawns + whenever the local player is downed (spectator).
  const crosshair = document.createElement('div');
  Object.assign(crosshair.style, {
    position: 'fixed',
    left: '50%',
    top: RETICLE_TOP,
    transform: 'translate(-50%, -50%)',
    width: '22px',
    height: '22px',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '5',
    filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.9))',
  } satisfies Partial<CSSStyleDeclaration>);
  crosshair.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="11" cy="11" r="1.5" fill="#eafcff"/>' +
    '<g stroke="#eafcff" stroke-width="1.5" opacity="0.85" stroke-linecap="round">' +
    '<line x1="11" y1="2.5" x2="11" y2="6.5"/><line x1="11" y1="15.5" x2="11" y2="19.5"/>' +
    '<line x1="2.5" y1="11" x2="6.5" y2="11"/><line x1="15.5" y1="11" x2="19.5" y2="11"/>' +
    '</g></svg>';
  document.body.appendChild(crosshair);

  // HITMARKER — four corner ticks that flash + expand at screen centre when YOUR shot lands (white)
  // or downs someone (red). Driven by the authoritative hitSeq/downSeq counters the server bumps in
  // resolveFire, diffed for the local player below. This is the "your shot connected" feedback.
  const hitmarker = document.createElement('div');
  Object.assign(hitmarker.style, {
    position: 'fixed',
    left: '50%',
    top: RETICLE_TOP,
    transform: 'translate(-50%, -50%)',
    width: '30px',
    height: '30px',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '6',
    filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.9))',
  } satisfies Partial<CSSStyleDeclaration>);
  hitmarker.innerHTML =
    '<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">' +
    '<g stroke="#ffffff" stroke-width="2.4" stroke-linecap="round">' +
    '<line x1="6" y1="6" x2="11" y2="11"/><line x1="24" y1="6" x2="19" y2="11"/>' +
    '<line x1="6" y1="24" x2="11" y2="19"/><line x1="24" y1="24" x2="19" y2="19"/>' +
    '</g></svg>';
  document.body.appendChild(hitmarker);
  const hitmarkerInk = hitmarker.querySelector('g')!;
  const HITMARK_DURATION = 0.26; // seconds
  let hitFlashT = 0;
  let hitFlashDown = false;
  // Track the local player's last-seen hit/down counters so we only flash on a NEW landed hit (and
  // not on join). `hitInit` seeds them from the first snapshot we see the local player in.
  let prevHitSeq = 0;
  let prevDownSeq = 0;
  let hitInit = false;
  const triggerHitmarker = (isDown: boolean): void => {
    hitFlashT = HITMARK_DURATION;
    hitFlashDown = isDown;
    hitmarkerInk.setAttribute('stroke', isDown ? '#ff5a5a' : '#ffffff');
  };

  let prev = performance.now();
  let raf = 0;
  let loadingHidden = false;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);

    // Clamp dt so a backgrounded tab doesn't teleport everything on return.
    const dt = Math.min((now - prev) / 1000, 0.1);
    prev = now;

    // 1) Sample input -> request a tick from the authority. On touch devices the on-screen
    //    stick/look drive it (analog move + accumulated yaw); else the keyboard/mouse Input.
    const keyboardInput = input.sample();
    const playerInput = touch ? touch.getInput(keyboardInput.seq) : keyboardInput;
    // Optional strafe inversion (Settings → Invert strafe). Flip the local strafe axis before
    // sending; the server applies the same authoritative conversion either way.
    if (invertStrafe) playerInput.moveX = -playerInput.moveX;
    // DEAD/DOWNED: don't drive the character. Zero the movement axes so the local PREDICTION can't
    // slide the body across the ground (the server already rejects downed movement). The yaw is
    // KEPT so the player can still orbit the spectator camera around their body (see the follow
    // block below). `running` is cleared so no footstep/SFX cadence fires while down.
    const localPhaseNow = source.getState().players[source.localPlayerId]?.phase;
    const localDownedNow = localPhaseNow === 'downed' || localPhaseNow === 'out';
    if (localDownedNow) {
      playerInput.moveX = 0;
      playerInput.moveZ = 0;
      playerInput.running = false;
    }
    source.sendInput(playerInput);

    // 2) Advance the source's clock, then render its latest snapshot with prediction.
    source.update(dt * 1000);
    const state = source.getState();

    // Procedural SFX: diff this snapshot against the previous one and play whatever the local
    // player's changes warrant (reveal, hit, intel, …). prevAudioState is null on the first frame
    // → deriveAudioEvents returns [], so spawn values never blip. We snapshot AFTER the diff so a
    // mutated getState() object can't corrupt next frame's comparison.
    for (const kind of deriveAudioEvents(prevAudioState, state, source.localPlayerId)) {
      audio.playSfx(kind);
    }
    prevAudioState = snapshotForAudio(state);

    worldView.sync(state, playerInput, dt);
    npcView.sync(state, dt);
    crumbView.sync(state, dt);
    packageView.sync(state, dt);
    keyView.sync(state, dt);
    vehicleView.sync(state, dt);
    mapView.update(dt); // pump any imported-GLB map props (animated set-dressing)

    // Awareness HUD + the take-disguise target. Both read the latest snapshot; the nearest
    // in-range NPC is what E acts on and what the prompt advertises, so they never disagree.
    const local = state.players[source.localPlayerId];

    // Hitmarker: diff the local player's authoritative hit/down counters. A down also bumps hitSeq,
    // so we prefer the (stronger) down marker. `hitInit` seeds the counters from the first snapshot
    // so we never flash on join; cleared when the local row is absent (so a rejoin re-seeds).
    if (local) {
      const hs = local.hitSeq ?? 0;
      const ds = local.downSeq ?? 0;
      if (!hitInit) {
        prevHitSeq = hs;
        prevDownSeq = ds;
        hitInit = true;
      } else if (ds !== prevDownSeq) {
        triggerHitmarker(true);
      } else if (hs !== prevHitSeq) {
        triggerHitmarker(false);
      }
      prevHitSeq = hs;
      prevDownSeq = ds;
    } else {
      hitInit = false;
    }

    takeTargetId = local
      ? (nearestTakeableNpc(local, state.npcs)?.id ?? null)
      : null;
    // Nearest downed teammate in revive reach — what R acts on + what the prompt advertises.
    reviveTargetId = local
      ? (nearestDownedTeammate(local, state.players)?.id ?? null)
      : null;
    // Nearest objective interactable (intel node / loose package) — what Q acts on + what the
    // "[Q] …" prompt advertises. Same selector the HUD model uses, so key and prompt agree.
    interactTargetId = local
      ? (nearestInteractable(
          local,
          state.objective,
          pack ? pack.intelNodes : [],
          pack
            ? {
                requiresVaultKey: pack.objective.requiresVaultKey,
                keyForgePosition: pack.objective.keyForgePosition,
                intelRequiredToOpenVault: pack.objective.intelRequiredToOpenVault,
                extractionPoints: pack.objective.extractionPoints,
              }
            : undefined,
        )?.targetId ?? null)
      : null;
    hud.update(deriveHudModel(state, source.localPlayerId, pack, (t: ClearanceTier) => TIER_COLOR[t]));
    tutorialCoach?.update(state, source.localPlayerId);
    // Refresh the corner mugshot to whoever the local player currently looks like (their disguise's
    // entity id, else their own). setLook no-ops unless the look actually changed.
    if (local) {
      const lookId = local.disguiseId && local.disguiseId.length > 0 ? local.disguiseId : local.id;
      portraitView.setLook(lookId, local.disguiseTier);
    }

    // Is this a 1v1 DUEL? The duel room sets state.mode === 'duel'; the heist room/older fixtures
    // leave it absent. We gate the HEIST-only overlays on this — the duel has no objective / vault
    // / intel / package / extraction, so the objective Waypoint + the heist ResultsScreen would be
    // meaningless. The awareness HUD + minimap stay (they're relevant to the stealth hunt).
    const isDuel = state.mode === 'duel';

    // "Match feel" overlays, driven AFTER the awareness HUD with the same snapshot. The timer
    // reads the authoritative clock; the minimap/waypoint read positions; the feed expires lines.
    matchTimer.update(state.timeMs);
    minimap.update(state, source.localPlayerId);
    // The objective Waypoint is heist-only (it targets intel/extraction) — skip it in a duel so it
    // stays hidden (it only shows when it has an objective target; a duel has none). The duel has
    // its own scoreboard/banners instead.
    if (!isDuel) waypoint.update(state, source.localPlayerId);
    eventFeed.update();

    // The duel overlay: opponent lobby / round scoreboard / countdown + round + match banners.
    // GATE on isDuel: the heist MatchState ALSO carries a `duel` sub-object (it defaults to phase
    // 'waiting'), so we must pass `undefined` outside a duel or the heist/solo Quick Play match would
    // wrongly show the "WAITING FOR OPPONENT…" lobby. `state.timeMs` is the authoritative sim clock
    // the countdown math reads (matches duel.phaseEndsAtMs).
    duelHud.update(isDuel ? state.duel : undefined, source.localPlayerId, state.timeMs);

    // Transient banners + feed lines from the pure snapshot diff (null prev on frame 1 → no
    // spurious spawn events). We clone AFTER the diff so a mutated getState() can't corrupt it.
    const matchEvents = deriveMatchEvents(prevMatchState, state, source.localPlayerId);
    for (const banner of matchEvents.banners) matchTimer.showBanner(banner);
    for (const line of matchEvents.feed) eventFeed.push(line);
    prevMatchState = snapshotForMatch(state);

    // Match end (PROJECT_BRIEF §2): once a carrier extracts, the server sets
    // objective.winningTeam (it leaves -1) and state.phase becomes 'ended'. Show the full-screen
    // RESULTS overlay exactly ONCE — the `resultsShown` guard keeps it a one-shot so we don't
    // rebuild the overlay on every subsequent frame. The local player's team comes straight from
    // the snapshot (default 0 if the local row hasn't arrived, which won't happen at match end).
    // The HEIST results screen is heist-only — a duel ends via its own DuelHud VICTORY/DEFEAT
    // overlay (driven by state.duel.phase === 'match_over'), so guard this on the mode so the
    // heist end-screen never fires mid-duel (a duel's objective.winningTeam stays -1 anyway, but
    // the explicit guard keeps the two result paths cleanly separated).
    if (!isDuel && !resultsShown && state.objective.winningTeam !== -1) {
      resultsShown = true;
      results.show(local ? local.team : 0, state.objective.winningTeam);
    }

    // 3) Third-person follow: sit behind + above the local avatar, look at its head.
    const pos: Vec3 | null = worldView.getLocalRenderPosition();

    // Footsteps: derive the local planar speed from the render-position delta, then fire a soft
    // tick at a speed-proportional cadence (faster when running), gated so it never spams per
    // frame. dt is clamped above, so the speed estimate is robust to a backgrounded tab.
    if (pos) {
      if (hasStepPos && dt > 0) {
        const dx = pos.x - lastStepPos.x;
        const dz = pos.z - lastStepPos.z;
        const speed = Math.hypot(dx, dz) / dt; // m/s on the XZ plane
        stepAccum += dt;
        if (footstepDue(stepAccum, speed)) {
          stepAccum = 0;
          audio.playFootstep();
        }
      }
      lastStepPos.x = pos.x;
      lastStepPos.z = pos.z;
      hasStepPos = true;
    }

    if (pos) {
      // Local look yaw drives both the FP view (alive) and the spectator orbit (downed). The
      // touch look-yaw / mouse yaw is sampled into playerInput; getLocalRenderYaw mirrors the
      // server-confirmed facing. Use the live input yaw so the FP view turns with zero latency.
      const lookYaw = localDownedNow ? playerInput.yaw : input.getYaw();
      // Cosmetic pitch (mouse Y) for the FP view; touch has no pitch yet → level.
      const pitch = touch ? 0 : input.getPitch();

      if (localDownedNow) {
        // SPECTATOR CAM when downed/out: the server freezes the avatar's facing, so orbit by the
        // player's own look yaw and pull the cam back + up for a clear death-cam (third-person).
        camYaw.value = lerpAngle(camYaw.value, lookYaw, CAM_SMOOTH);
        const back = CAM_BACK * 1.6;
        const sin = Math.sin(camYaw.value);
        const cos = Math.cos(camYaw.value);
        camTarget.set(pos.x - sin * back, CAM_HEIGHT + 1.6, pos.z - cos * back);
        camera.position.lerp(camTarget, CAM_SMOOTH);
        lookTarget.set(pos.x, pos.y + CAM_LOOK_HEIGHT, pos.z);
        camera.lookAt(lookTarget);
        worldView.setLocalBodyHidden(false); // show the body so you can see yourself laid out
        viewModel.setVisible(false);
      } else {
        // FIRST-PERSON: camera at eye height, looking along the live yaw+pitch. The shared rig
        // (firstPersonCamera.ts) is the same math the preview mounts. Pitch is cosmetic — aim
        // stays planar from yaw server-side (PROJECT_BRIEF §4.2), so this never touches the sim.
        applyFirstPersonCamera(camera, pos, lookYaw, pitch);
        worldView.setLocalBodyHidden(true); // hide our own capsule from inside the head
        viewModel.setVisible(true);
      }
      // Compass reads the look bearing; viewmodel locks to the camera + idle-bobs.
      hud.setHeading(headingDeg(lookYaw));
      viewModel.update(camera, dt);
    }

    // Crosshair: visible only when alive + spawned (hidden in menu / loading / when downed). Its
    // fixed position (RETICLE_TOP, set on the element) sits it ahead of + above the avatar where
    // shots go — not on the player's back at dead screen-centre.
    crosshair.style.display = pos && !localDownedNow ? 'block' : 'none';

    // Hitmarker animation: fade out + expand over its short lifetime (a kill marker punches bigger).
    if (hitFlashT > 0) {
      hitFlashT -= dt;
      const k = Math.max(0, hitFlashT / HITMARK_DURATION); // 1 → 0 over the lifetime
      hitmarker.style.opacity = String(k);
      const grow = hitFlashDown ? 0.9 : 0.45;
      hitmarker.style.transform = `translate(-50%, -50%) scale(${1 + (1 - k) * grow})`;
    } else if (hitmarker.style.opacity !== '0') {
      hitmarker.style.opacity = '0';
    }

    postFx.render();

    // The scene is now on screen — drop the loading overlay (once). Done AFTER the first render
    // so there's never a flash of bare canvas between hiding the loader and the first frame.
    if (!loadingHidden) {
      loadingHidden = true;
      loading.hide();
    }
  };
  raf = requestAnimationFrame(frame);

  // Best-effort teardown if the module is hot-reloaded in dev.
  const hot = (import.meta as ImportMeta & { hot?: { dispose(cb: () => void): void } }).hot;
  hot?.dispose(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onTakeKey);
    window.removeEventListener('keydown', onReviveKey);
    window.removeEventListener('keydown', onInteractKey);
    app.removeEventListener('mousedown', onFireMouse);
    window.removeEventListener('keydown', onFireKey);
    window.removeEventListener('keydown', onAbilityKey);
    window.removeEventListener('keydown', onGadgetKey);
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('keydown', onMuteKey);
    audio.dispose();
    touch?.dispose();
    input.dispose();
    worldView.dispose();
    viewModel.dispose();
    npcView.dispose();
    crumbView.dispose();
    packageView.dispose();
    keyView.dispose();
    vehicleView.dispose();
    mapView.dispose();
    hud.dispose();
    portraitView.dispose();
    tutorialCoach?.dispose();
    duelHud.dispose();
    minimap.dispose();
    matchTimer.dispose();
    waypoint.dispose();
    eventFeed.dispose();
    results.dispose();
    loading.dispose();
    postFx.dispose();
    renderer.dispose();
    // Best-effort: a net source holds a socket; close it so the reload doesn't leak it.
    (source as StateSource & { dispose?: () => void }).dispose?.();
  });
}

/**
 * Boot into the START MENU, not the match. We create the shared AudioEngine up front and hand
 * it to the menu so its Settings sliders ride the live buses and its first gesture unlocks the
 * context (browsers suspend audio until then). When the player picks Quick Play / Online
 * Multiplayer, the menu resolves with their { mode, agent }; only THEN do we run the game.
 *
 * Out of scope (per the slice): we don't return to the menu after a match ends — the menu's
 * job is purely to get the player INTO a match with their chosen mode + agent.
 */
async function bootstrap(): Promise<void> {
  const audio = new AudioEngine();
  // The levels the player can pick on the menu's LEVEL screen (or leave on Random).
  const levels = playablePacks(loadGameMaps()).map((m) => ({ id: m.id, name: m.name }));
  const menu = new Menu(audio, { onInvertStrafe: (v) => (invertStrafe = v) }, levels);
  const choice = await menu.choose();
  menu.dispose(); // the overlay hid itself on commit; drop it from the DOM before the game runs.
  await start(choice, audio);
}

void bootstrap();
