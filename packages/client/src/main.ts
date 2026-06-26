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
import { TIER_COLOR, type ClearanceTier, type NetMatchState } from '@deceive/shared';
import { lerpAngle, type Vec3 } from './render/interpolate';
import { WorldView } from './render/WorldView';
import { NpcView } from './render/NpcView';
import { MapView } from './render/MapView';
import { CrumbView } from './render/CrumbView';
import { PackageView } from './render/PackageView';
import { FireGate } from './render/fireGate';
import { createPostFx } from './render/postFx';
import { loadGameMap } from './content/loadMap';
import { LocalMockSource, type StateSource } from './net/StateSource';
import { ColyseusSource } from './net/ColyseusSource';
import { Input } from './input/Input';
import { TouchControls, isTouchDevice } from './input/TouchControls';
import { Hud } from './hud/Hud';
import {
  deriveHudModel,
  nearestDownedTeammate,
  nearestInteractable,
  nearestTakeableNpc,
} from './hud/hudModel';
import { AudioEngine } from './audio/AudioEngine';
import { deriveAudioEvents } from './audio/audioEvents';
import { Menu, connectOptionsFor, type MenuChoice } from './menu/Menu';
import { ResultsScreen } from './ui/ResultsScreen';

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
async function selectSource(choice: MenuChoice): Promise<StateSource> {
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
      console.warn(`[net] could not connect to ${endpoint}; falling back to LocalMockSource`, err);
    }
  } else {
    console.info('[net] server disabled via ?server=; using LocalMockSource');
  }
  return new LocalMockSource();
}

// Third-person camera framing. Behind + above the local avatar, looking at its head.
// Distances flagged for Director taste (PROJECT_BRIEF review queue — camera/avatar feel).
const CAM_BACK = 5.5; // metres behind the avatar (along its facing)
const CAM_HEIGHT = 3.0; // metres above the ground
const CAM_LOOK_HEIGHT = 1.4; // height of the point the camera aims at (avatar head-ish)
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
  const scene = buildScene();

  // Mount the REAL authored map (zones/doors/objective/markers) under the player via the
  // same MapView the preview harness uses. The server runs this pack, so it MATCHES the
  // authoritative world. With no pack found we still render the bare greybox scene.
  const mapView = new MapView(scene);
  const map = loadGameMap();
  if (map) mapView.setPack(map);
  else console.warn('[game] no content pack found; rendering bare scene without a map');

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

  // The on-screen awareness overlay (plain DOM): disguise tier, zone, "scolded" warning,
  // and the take-disguise prompt. Derived each frame from the latest snapshot + the pack.
  const hud = new Hud();

  // The match-end RESULTS overlay (plain DOM, full-screen): VICTORY/DEFEAT + a Play-Again flow.
  // Shown ONCE when the match transitions into 'ended' (a team extracted → objective.winningTeam
  // leaves -1). The boolean guard below makes that a one-shot so we don't rebuild the overlay
  // every frame. Display-only: the server decides the winner (extraction is automatic server-side).
  const results = new ResultsScreen();
  let resultsShown = false;

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
  // WorldView, so we have the resolved localPlayerId to follow.
  const source: StateSource = await selectSource(choice);
  // Now that the match is live, lift the soundtrack from the menu's slow noir pad to the more
  // up-tempo match groove. The menu already unlocked + started the 'menu' bed on the player's
  // first gesture, so this crossfades; if (impossibly) audio isn't unlocked yet it's a safe
  // no-op and the in-game unlock below brings up the match bed on the first in-game gesture.
  audio.startAmbient('match');
  const worldView = new WorldView(scene, source.localPlayerId);
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
    if (fireGate.tryFire(performance.now())) source.fire();
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

  // Procedural audio (self-contained — all sound is SYNTHESISED, no asset files). The engine is
  // created + (typically already) unlocked by the start menu, which resumes it on the player's
  // first gesture so the ambient bed plays under the menu. We KEEP the same lazy unlock here as
  // a belt-and-braces fallback for any in-game gesture that beats the menu's (e.g. a synthetic
  // first input): resume()/startAmbient() are idempotent, so re-arming them is harmless. SFX are
  // driven from snapshot diffs in the frame loop (deriveAudioEvents), so sound reacts to gameplay.
  const unlockAudio = () => {
    audio.resume();
    audio.startAmbient('match'); // in-game → the up-tempo match bed (not the menu pad).
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
      })
    : null;

  // The current content pack (zones) the HUD looks `currentZoneId` up in. Null → "Open area"
  // labels fall through and no scolded warning fires (no zones to gate against).
  const pack = map ?? null;

  // Smoothed camera target so it eases rather than snapping to the avatar each frame.
  const camYaw = { value: 0 };
  const camTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postFx.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  let prev = performance.now();
  let raf = 0;

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

    // Awareness HUD + the take-disguise target. Both read the latest snapshot; the nearest
    // in-range NPC is what E acts on and what the prompt advertises, so they never disagree.
    const local = state.players[source.localPlayerId];
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
      ? (nearestInteractable(local, state.objective, pack ? pack.intelNodes : [])?.targetId ?? null)
      : null;
    hud.update(deriveHudModel(state, source.localPlayerId, pack, (t: ClearanceTier) => TIER_COLOR[t]));

    // Match end (PROJECT_BRIEF §2): once a carrier extracts, the server sets
    // objective.winningTeam (it leaves -1) and state.phase becomes 'ended'. Show the full-screen
    // RESULTS overlay exactly ONCE — the `resultsShown` guard keeps it a one-shot so we don't
    // rebuild the overlay on every subsequent frame. The local player's team comes straight from
    // the snapshot (default 0 if the local row hasn't arrived, which won't happen at match end).
    if (!resultsShown && state.objective.winningTeam !== -1) {
      resultsShown = true;
      results.show(local ? local.team : 0, state.objective.winningTeam);
    }

    // 3) Third-person follow: sit behind + above the local avatar, look at its head.
    const pos: Vec3 | null = worldView.getLocalRenderPosition();
    if (pos) {
      const yaw = worldView.getLocalRenderYaw();
      camYaw.value = lerpAngle(camYaw.value, yaw, CAM_SMOOTH);

      // The avatar's forward at yaw θ is (sin θ, 0, cos θ) (matching integrateMove);
      // "behind" is the negation, so the camera sits opposite the facing direction.
      const sin = Math.sin(camYaw.value);
      const cos = Math.cos(camYaw.value);
      camTarget.set(
        pos.x - sin * CAM_BACK,
        CAM_HEIGHT,
        pos.z - cos * CAM_BACK,
      );
      camera.position.lerp(camTarget, CAM_SMOOTH);

      lookTarget.set(pos.x, pos.y + CAM_LOOK_HEIGHT, pos.z);
      camera.lookAt(lookTarget);
    }

    postFx.render();
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
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('keydown', onMuteKey);
    audio.dispose();
    touch?.dispose();
    input.dispose();
    worldView.dispose();
    npcView.dispose();
    crumbView.dispose();
    packageView.dispose();
    mapView.dispose();
    hud.dispose();
    results.dispose();
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
  const menu = new Menu(audio, { onInvertStrafe: (v) => (invertStrafe = v) });
  const choice = await menu.choose();
  menu.dispose(); // the overlay hid itself on commit; drop it from the DOM before the game runs.
  await start(choice, audio);
}

void bootstrap();
