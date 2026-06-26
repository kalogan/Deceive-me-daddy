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
import { lerpAngle, type Vec3 } from './render/interpolate';
import { WorldView } from './render/WorldView';
import { NpcView } from './render/NpcView';
import { MapView } from './render/MapView';
import { loadGameMap } from './content/loadMap';
import { LocalMockSource, type StateSource } from './net/StateSource';
import { ColyseusSource } from './net/ColyseusSource';
import { Input } from './input/Input';

/** The default authoritative-server port (packages/server `PORT` env, default 2567). */
const SERVER_PORT = 2567;

/**
 * Pick the Colyseus endpoint. Defaults to the page host on the server port; overridable
 * via `?server=ws://host:port` for pointing the client at a remote/alt server. Returns
 * null only if explicitly disabled via `?server=off|none|mock`, which forces the mock.
 */
function resolveEndpoint(): string | null {
  const override = new URLSearchParams(location.search).get('server');
  if (override) {
    if (['off', 'none', 'mock', 'local'].includes(override.toLowerCase())) return null;
    return override;
  }
  const host = location.hostname || 'localhost';
  return `ws://${host}:${SERVER_PORT}`;
}

/**
 * Select the live source if a server answers; otherwise fall back to the offline mock so
 * the scene still runs (PROJECT_BRIEF §3 — the StateSource seam is the swap point). The
 * returned source has a resolved localPlayerId, ready for WorldView.
 */
async function selectSource(): Promise<StateSource> {
  const endpoint = resolveEndpoint();
  if (endpoint) {
    try {
      const net = new ColyseusSource(endpoint);
      await net.connect();
      console.info(`[net] connected to ${endpoint} as ${net.localPlayerId} (server-authoritative)`);
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

  // Lighting: soft ambient fill + a key directional that casts shadows.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  const s = 30;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  scene.add(sun);

  return scene;
}

async function start(): Promise<void> {
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

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, CAM_HEIGHT, CAM_BACK);

  // Pick the live (ColyseusSource) or offline (LocalMockSource) source BEFORE building the
  // WorldView, so we have the resolved localPlayerId to follow.
  const source: StateSource = await selectSource();
  const worldView = new WorldView(scene, source.localPlayerId);
  const input = new Input(app);

  // Smoothed camera target so it eases rather than snapping to the avatar each frame.
  const camYaw = { value: 0 };
  const camTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  let prev = performance.now();
  let raf = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);

    // Clamp dt so a backgrounded tab doesn't teleport everything on return.
    const dt = Math.min((now - prev) / 1000, 0.1);
    prev = now;

    // 1) Sample input -> request a tick from the (mock) authority.
    const playerInput = input.sample();
    source.sendInput(playerInput);

    // 2) Advance the source's clock, then render its latest snapshot with prediction.
    source.update(dt * 1000);
    const state = source.getState();
    worldView.sync(state, playerInput, dt);
    npcView.sync(state, dt);

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

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  // Best-effort teardown if the module is hot-reloaded in dev.
  const hot = (import.meta as ImportMeta & { hot?: { dispose(cb: () => void): void } }).hot;
  hot?.dispose(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    input.dispose();
    worldView.dispose();
    npcView.dispose();
    mapView.dispose();
    renderer.dispose();
    // Best-effort: a net source holds a socket; close it so the reload doesn't leak it.
    (source as StateSource & { dispose?: () => void }).dispose?.();
  });
}

void start();
