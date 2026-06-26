// Reusable combat / ability VFX — the SINGLE SOURCE OF TRUTH for the game's bullet, gadget and
// Expertise visuals. The /preview "Agents" tab drives these now to inspect each kit; the game
// will reuse the very same builders later, so they stay STANDALONE: no sim, no DOM, no external
// assets, no scene-graph assumptions. Each builder returns an FxHandle whose `object3d` you ADD to
// any THREE scene/group, then `update(dt)` each frame; one-shots report `done` when their lifetime
// elapses so the owner can `dispose()` them. Everything is unlit/emissive (the game scene has
// bloom, so these read as glowing energy), and `dispose()` frees EVERY geometry + material it made
// (no leaks — spammable safely).
import * as THREE from 'three';

/**
 * A live VFX instance. ADD `object3d` to a scene/group, call `update(dt)` each frame, then
 * `dispose()`. One-shots flip `done` to true once their lifetime elapses (auras stay `done=false`
 * until removed). `dispose()` is idempotent and frees all owned GPU resources.
 */
export interface FxHandle {
  /** The renderable to add to a scene/group. */
  readonly object3d: THREE.Object3D;
  /** Advance the effect by `dt` seconds. */
  update(dt: number): void;
  /** True once a one-shot has finished its lifetime (always false for persistent auras). */
  readonly done: boolean;
  /** Detach + free every geometry/material this handle created. Safe to call twice. */
  dispose(): void;
}

// --- Pure timing/easing helpers (exported + unit-tested; no THREE/DOM) -------------------------

/** Clamp `x` into [0,1]. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Normalised 0..1 progress of a one-shot of total `lifetime` given elapsed `age` seconds. Clamped,
 * and guards a non-positive lifetime (returns 1 = finished) so a bad caller can't divide by zero.
 */
export function lifeProgress(age: number, lifetime: number): number {
  if (lifetime <= 0) return 1;
  return clamp01(age / lifetime);
}

/** Ease-out cubic — fast then settling. Used for expanding rings/bursts so they "pop" out. */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** A 0→1→0 triangular pulse over progress `t` (peak at t=0.5) — for flash brightness. */
export function pulse01(t: number): number {
  const c = clamp01(t);
  return 1 - Math.abs(c * 2 - 1);
}

/** Fade alpha that starts at 1 and eases to 0 over progress `t` (ease-out so it lingers bright). */
export function fadeOut(t: number): number {
  const u = 1 - clamp01(t);
  return u * u;
}

// --- Shared material/geometry helpers ----------------------------------------------------------

/** An additive, depth-write-off, double-sided emissive material — the look of glowing energy. */
function glowMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false, // stay bright through ACES so the FX pops + blooms
  });
}

/** An additive line material for tracers. */
function glowLineMat(color: number, opacity = 1): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

// --- One-shot builders -------------------------------------------------------------------------

/**
 * A brief bright muzzle flash at `origin` plus a fast tracer streaking a short way along `dir`.
 * The flash is a small additive sprite-billboard-ish quad (a cross of two quads so it reads from
 * any angle); the tracer fades out within the first frames. `dir` need not be normalised.
 */
export function muzzleFlash(origin: THREE.Vector3, dir: THREE.Vector3): FxHandle {
  const LIFETIME = 0.12;
  const group = new THREE.Group();
  group.position.copy(origin);

  // Flash: two crossed quads forming a small star, additive so they glow.
  const flashGeo = new THREE.PlaneGeometry(0.5, 0.5);
  const flashMat = glowMat(0xfff2b0, 1);
  const flashA = new THREE.Mesh(flashGeo, flashMat);
  const flashB = new THREE.Mesh(flashGeo, flashMat);
  flashB.rotation.z = Math.PI / 2;
  group.add(flashA, flashB);

  // Short tracer stub pointing along dir.
  const d = dir.lengthSq() > 1e-9 ? dir.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const tip = origin.clone().add(d.clone().multiplyScalar(1.2));
  const traceGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    tip.clone().sub(origin),
  ]);
  const traceMat = glowLineMat(0xffe070, 1);
  const trace = new THREE.Line(traceGeo, traceMat);
  group.add(trace);

  let age = 0;
  return {
    object3d: group,
    get done() {
      return age >= LIFETIME;
    },
    update(dt) {
      age += dt;
      const t = lifeProgress(age, LIFETIME);
      const p = pulse01(t);
      const s = 0.6 + p * 1.6;
      flashA.scale.setScalar(s);
      flashB.scale.setScalar(s);
      flashMat.opacity = p;
      traceMat.opacity = fadeOut(t);
    },
    dispose() {
      flashGeo.dispose();
      flashMat.dispose();
      traceGeo.dispose();
      traceMat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * A quick bullet-streak line from `from` to `to` that fades out fast (a tracer). World-space
 * endpoints; the handle's object lives at the world origin and holds the two-point line.
 */
export function tracer(from: THREE.Vector3, to: THREE.Vector3): FxHandle {
  const LIFETIME = 0.18;
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const mat = glowLineMat(0xfff0a0, 1);
  const line = new THREE.Line(geo, mat);

  let age = 0;
  return {
    object3d: line,
    get done() {
      return age >= LIFETIME;
    },
    update(dt) {
      age += dt;
      mat.opacity = fadeOut(lifeProgress(age, LIFETIME));
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      line.removeFromParent();
    },
  };
}

/** A small hit spark — a fast additive flash sphere — at `at`. */
export function impactFlash(at: THREE.Vector3): FxHandle {
  const LIFETIME = 0.22;
  const geo = new THREE.SphereGeometry(0.18, 10, 8);
  const mat = glowMat(0xffd060, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(at);

  let age = 0;
  return {
    object3d: mesh,
    get done() {
      return age >= LIFETIME;
    },
    update(dt) {
      age += dt;
      const t = lifeProgress(age, LIFETIME);
      mesh.scale.setScalar(0.6 + easeOutCubic(t) * 1.8);
      mat.opacity = fadeOut(t);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}

/**
 * An expanding GROUND ring centred at `center`, growing out to `radius` then fading — the Scanner
 * Pulse. Lies flat on the floor (rotated to the XZ plane). Cyan recon colour.
 */
export function scanPulse(center: THREE.Vector3, radius: number): FxHandle {
  const LIFETIME = 0.9;
  // A thin ring (torus) we scale outward. Built at unit radius, scaled to `radius`.
  const geo = new THREE.TorusGeometry(1, 0.05, 8, 48);
  const mat = glowMat(0x35e0ff, 0.9);
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2; // lie flat on the ground
  const group = new THREE.Group();
  group.position.copy(center);
  group.add(ring);

  let age = 0;
  return {
    object3d: group,
    get done() {
      return age >= LIFETIME;
    },
    update(dt) {
      age += dt;
      const t = lifeProgress(age, LIFETIME);
      const r = Math.max(0.01, easeOutCubic(t) * radius);
      ring.scale.set(r, r, 1);
      mat.opacity = 0.9 * fadeOut(t);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * An expanding burst SPHERE + shock ring at `center` reaching `radius` then fading — the Frag
 * Charge detonation. Hot orange.
 */
export function fragBurst(center: THREE.Vector3, radius: number): FxHandle {
  const LIFETIME = 0.5;
  const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
  const sphereMat = glowMat(0xff6a1a, 0.9);
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);

  const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 40);
  const ringMat = glowMat(0xffd24a, 0.9);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.position.copy(center);
  group.add(sphere, ring);

  let age = 0;
  return {
    object3d: group,
    get done() {
      return age >= LIFETIME;
    },
    update(dt) {
      age += dt;
      const t = lifeProgress(age, LIFETIME);
      const e = easeOutCubic(t);
      const rs = Math.max(0.01, e * radius * 0.6);
      sphere.scale.setScalar(rs);
      sphereMat.opacity = 0.9 * fadeOut(t);
      const rr = Math.max(0.01, e * radius);
      ring.scale.set(rr, rr, 1);
      ringMat.opacity = 0.9 * fadeOut(t);
    },
    dispose() {
      sphereGeo.dispose();
      sphereMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * A puff of smoke + a quick fading "decoy" silhouette at `at` — the Mirage. The puff is a few
 * additive billboards that scale up and fade; the decoy is a translucent blue upright capsule that
 * lingers a touch then dissolves (the holo left behind). Faces are unlit so they glow softly.
 */
export function miragePoof(at: THREE.Vector3): FxHandle {
  const LIFETIME = 0.7;
  const group = new THREE.Group();
  group.position.copy(at);

  // Puff: a small sphere cloud.
  const puffGeo = new THREE.SphereGeometry(0.4, 10, 8);
  const puffMat = glowMat(0x7fb0ff, 0.8);
  const puff = new THREE.Mesh(puffGeo, puffMat);
  puff.position.y = 0.9;
  group.add(puff);

  // Decoy silhouette: a translucent ghost-blue capsule the height of an avatar.
  const decoyGeo = new THREE.CapsuleGeometry(0.32, 1.1, 4, 12);
  const decoyMat = new THREE.MeshBasicMaterial({
    color: 0x4aa3ff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const decoy = new THREE.Mesh(decoyGeo, decoyMat);
  decoy.position.y = 0.9;
  group.add(decoy);

  let age = 0;
  return {
    object3d: group,
    get done() {
      return age >= LIFETIME;
    },
    update(dt) {
      age += dt;
      const t = lifeProgress(age, LIFETIME);
      puff.scale.setScalar(0.6 + easeOutCubic(t) * 2.2);
      puffMat.opacity = 0.8 * fadeOut(t);
      // Decoy holds bright early then dissolves over the back half.
      decoyMat.opacity = 0.5 * fadeOut(clamp01((t - 0.2) / 0.8));
    },
    dispose() {
      puffGeo.dispose();
      puffMat.dispose();
      decoyGeo.dispose();
      decoyMat.dispose();
      group.removeFromParent();
    },
  };
}

// --- Persistent ability aura -------------------------------------------------------------------

/** The three Expertise aura looks (one per agent's signature ability). */
export type AuraKind = 'eyes' | 'invuln' | 'cloak';

/**
 * A PERSISTENT aura you attach to an avatar while an Expertise is "active":
 *   - eyes   — a cyan recon shimmer: two slowly counter-rotating scan rings + a faint dome.
 *   - invuln — a gold protective shell sphere that softly pulses.
 *   - cloak  — a translucent blue ghost shimmer shell (the agent half-there).
 * Stays `done=false` until the owner removes it. Centre it on the avatar (default sits a metre up
 * so the shells wrap the body); position `object3d` to taste. Drive `update(dt)` for the motion.
 */
export function abilityAura(kind: AuraKind): FxHandle {
  const group = new THREE.Group();
  const owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
    owned.push(x);
    return x;
  };

  let tick: (dt: number) => void;

  if (kind === 'eyes') {
    const ringGeo = track(new THREE.TorusGeometry(0.9, 0.04, 8, 40));
    const matA = track(glowMat(0x35e0ff, 0.85));
    const matB = track(glowMat(0x8af3ff, 0.7));
    const ringA = new THREE.Mesh(ringGeo, matA);
    const ringB = new THREE.Mesh(ringGeo, matB);
    ringA.rotation.x = -Math.PI / 2;
    ringB.rotation.x = -Math.PI / 2;
    ringB.scale.setScalar(0.62);
    ringA.position.y = 1.0;
    ringB.position.y = 1.0;
    const domeGeo = track(new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2));
    const domeMat = track(glowMat(0x35e0ff, 0.12));
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 0.1;
    group.add(ringA, ringB, dome);
    let t = 0;
    tick = (dt) => {
      t += dt;
      ringA.rotation.z = t * 1.4;
      ringB.rotation.z = -t * 2.0;
      domeMat.opacity = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(t * 3));
    };
  } else if (kind === 'invuln') {
    const shellGeo = track(new THREE.SphereGeometry(0.95, 18, 14));
    const shellMat = track(glowMat(0xffcc33, 0.28));
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.y = 1.0;
    group.add(shell);
    let t = 0;
    tick = (dt) => {
      t += dt;
      const p = 0.95 + 0.05 * Math.sin(t * 4);
      shell.scale.setScalar(p);
      shellMat.opacity = 0.24 + 0.1 * (0.5 + 0.5 * Math.sin(t * 4));
    };
  } else {
    // cloak — translucent ghost-blue shell shimmer.
    const shellGeo = track(new THREE.SphereGeometry(0.9, 18, 14));
    const shellMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x4aa3ff,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.position.y = 1.0;
    group.add(shell);
    let t = 0;
    tick = (dt) => {
      t += dt;
      shellMat.opacity = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(t * 5));
      shell.rotation.y = t * 0.6;
    };
  }

  return {
    object3d: group,
    done: false,
    update(dt) {
      tick(dt);
    },
    dispose() {
      for (const o of owned) o.dispose();
      group.removeFromParent();
    },
  };
}
