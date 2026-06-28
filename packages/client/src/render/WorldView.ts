// WorldView owns the Three.js representation of the match: one greybox avatar per player,
// keyed by id, synced to the latest NetMatchState each frame.
//
// Authority (PROJECT_BRIEF §3/§4.2): the NetMatchState is the server's word. WorldView
// only smooths how that truth is PRESENTED:
//   - Remote players are INTERPOLATED toward their latest snapshot position/yaw (an
//     exponential ease) so 20Hz server ticks read as smooth motion instead of snapping.
//   - The LOCAL player gets light local PREDICTION: between snapshots its avatar is
//     nudged by the player's own input so movement feels responsive, then re-anchored
//     to the authoritative position as new snapshots arrive. Cosmetic only — never truth.
import * as THREE from 'three';
import {
  AGENTS_BY_ID,
  TIER_COLOR,
  type NetMatchState,
  type NetPlayerState,
  type PlayerInput,
} from '@deceive/shared';
import { integrateMove } from '../net/movement';
import { resolveCircleVsWalls, PLAYER_RADIUS, type WallAABB } from '@deceive/sim-core';
import {
  lerpAngle,
  lerpVec3,
  smoothingFactor,
  type Vec3,
} from './interpolate';
import { AVATAR_HEIGHT, AVATAR_RADIUS, buildAvatarBody } from './avatar';
import {
  abilityAura,
  fragBurst,
  impactFlash,
  miragePoof,
  muzzleFlash,
  scanPulse,
  tracer,
  type AuraKind,
  type FxHandle,
} from './combatFx';
import { revealMarkerStyle } from './revealStyle';
import { downedBodyStyle } from './downedStyle';

// How quickly the cosmetic transform chases the authoritative one (fraction/second).
const REMOTE_SMOOTH = 0.92;
const LOCAL_SMOOTH = 0.6;

// Aim animation: a fresh shot snaps aimAmount to 1; with no new shots it decays toward 0 over
// ~AIM_DECAY seconds so the agent lowers the weapon between bursts. Framerate-independent.
const AIM_DECAY = 0.7;
// A fired shot was PREDICTED locally within this window → skip the fireSeq-driven flash for the
// local player so we don't double-flash (the server echo arrives ~RTT later).
const LOCAL_FIRE_PREDICT_WINDOW = 0.35;

/** Map an agent's signature Expertise to the matching persistent aura kind. */
function auraKindForAbility(ability: (typeof AGENTS_BY_ID)[keyof typeof AGENTS_BY_ID]['ability']): AuraKind {
  return ability === 'adieu' ? 'cloak' : ability === 'hard_boiled' ? 'invuln' : 'eyes';
}

/** A tiny stable string→uint32 hash (FNV-1a) so each player id seeds a stable individual look. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Resolve a tier name to its numeric hex (the accent colour), defaulting to white. */
function tierHex(tier: NetPlayerState['disguiseTier']): number {
  return new THREE.Color(TIER_COLOR[tier] ?? '#ffffff').getHex();
}

// Reveal marker: a glowing ring floating above the capsule's head. Sized a touch wider than
// the body so the "blown" halo reads against the crowd from across the map (PROJECT_BRIEF
// §2.5 — a hard-revealed rival must be unmistakable). Y just above the head.
const MARKER_Y = AVATAR_HEIGHT / 2 + 0.5;
const MARKER_INNER = AVATAR_RADIUS + 0.18;
const MARKER_OUTER = AVATAR_RADIUS + 0.42;

interface Avatar {
  /** STABLE outer group: holds the (swappable) body + the over-head marker; carries the
   * position/yaw/roll. Persists across disguise changes so prediction/marker state survive. */
  group: THREE.Group;
  /** The current body group (from buildAvatarBody). REPLACED when the disguise look changes. */
  bodyGroup: THREE.Group;
  /** The entity id currently seeding the look (disguiseId || playerId); a change triggers a
   * rebuild so the player visibly BECOMES the NPC they copied. */
  seedId: string;
  body: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Encapsulated styling API — fans effects across EVERY material of the varied body.
   * Reassigned on a look rebuild (the methods close over the new body's materials). */
  setTier: (hex: number) => void;
  setBrightness: (mult: number) => void;
  setOpacity: (opacity: number) => void;
  setEmissive: (hex: number, intensity: number) => void;
  /** The over-head "blown"/suspicious halo. Hidden unless phase flags it. */
  marker: THREE.Mesh;
  markerMaterial: THREE.MeshBasicMaterial;
  /** Last phase we styled the marker/body for, to avoid touching it every frame. */
  phase: string;
  /** The smoothed cosmetic position we actually render at. */
  render: Vec3;
  renderYaw: number;
  /** Last tier we colored to, to avoid rebuilding the material color every frame. */
  tier: string;
  /** Last Expertise-visual key we styled (e.g. 'larcin:1'), to avoid per-frame work. */
  abilityKey: string;
  /** Drive the procedural walk/idle rig, blending in the AIM pose by `aim` (0..1). */
  animate: (dt: number, speed: number, aimAmount?: number) => void;
  /** Trigger a recoil kick on the rig. */
  fireRecoil: () => void;
  /** Read the weapon muzzle world pose (reuses scratch vectors — don't retain). */
  getMuzzle: () => { pos: THREE.Vector3; dir: THREE.Vector3 };
  /** Free the rig's geometries + material. */
  disposeBody: () => void;
  /** Render position last frame, to derive planar speed for the walk cycle. */
  animPrev: Vec3;
  /** Last fireSeq we observed; an increment fires the muzzle/tracer VFX + recoil. -1 until the
   * very first observation so we never fire on spawn. */
  lastFireSeq: number;
  /** Current 0..1 aim blend — snapped to 1 on a shot, decays toward 0 between shots. */
  aim: number;
  /** Last gadgetCooldownMs we observed; a rising edge (~0 → large) means a use just happened. */
  lastGadgetCd: number;
  /** Performance.now()/1000 of the last LOCAL predicted fire, to dedupe the fireSeq echo. */
  lastLocalFire: number;
  /** The active persistent Expertise aura (attached to the body group), or null. */
  aura: FxHandle | null;
}

export class WorldView {
  private readonly root = new THREE.Group();
  private readonly avatars = new Map<string, Avatar>();
  private readonly localPlayerId: string;

  /** Live one-shot combat FX (muzzle/tracer/impact/gadget). Reaped in place when `done` — the
   * array is reused frame to frame (no per-frame allocation). */
  private readonly fx: FxHandle[] = [];
  /** Scratch vectors reused by the fire-VFX path so the hot loop never allocates. */
  private readonly scratchFrom = new THREE.Vector3();
  private readonly scratchTo = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchAt = new THREE.Vector3();

  /** Local prediction: where we predict the local player to be between snapshots. */
  private readonly predicted: Vec3 = { x: 0, y: 0, z: 0 };
  private predictedYaw = 0;
  private hasPredicted = false;
  private lastLocal: NetPlayerState | null = null;
  // First-person: hide the LOCAL avatar's body while the camera sits inside its head, so the
  // player doesn't see their own capsule from the inside. Off by default (third-person);
  // main.ts opts in while alive in FP and back off for the downed spectator cam.
  private localBodyHidden = false;
  /** Wall colliders for local-prediction collision (same set the sim uses); empty until setWalls. */
  private walls: WallAABB[] = [];

  constructor(scene: THREE.Scene, localPlayerId: string) {
    this.localPlayerId = localPlayerId;
    scene.add(this.root);
  }

  /**
   * Hide/show the LOCAL player's body mesh (first-person). Applied every sync so it survives the
   * per-phase visibility restyle; honours the phase's own visibility so an eliminated body is
   * never forced visible.
   */
  setLocalBodyHidden(hidden: boolean): void {
    this.localBodyHidden = hidden;
  }

  /** Provide the wall colliders so local prediction slides along walls like the sim does. */
  setWalls(walls: WallAABB[]): void {
    this.walls = walls;
  }

  /** Expose the smoothed local-player position so the camera can follow it. */
  getLocalRenderPosition(): Vec3 | null {
    const a = this.avatars.get(this.localPlayerId);
    return a ? a.render : null;
  }

  getLocalRenderYaw(): number {
    const a = this.avatars.get(this.localPlayerId);
    return a ? a.renderYaw : 0;
  }

  /**
   * Sync to the latest snapshot. `localInput` (if present) drives local prediction;
   * `dt` is the render-frame delta in seconds.
   */
  sync(state: NetMatchState, localInput: PlayerInput | null, dt: number): void {
    // Spawn / update avatars present in the snapshot.
    const seen = new Set<string>();
    for (const id of Object.keys(state.players)) {
      const p = state.players[id];
      if (!p) continue;
      seen.add(id);

      let avatar = this.avatars.get(id);
      if (!avatar) {
        avatar = this.spawn(p);
        this.avatars.set(id, avatar);
      }
      // The look is seeded by the disguise id (the NPC copied) when set, else the player's own
      // id. When it changes — i.e. the player took a new disguise — rebuild the body so they
      // visibly BECOME that specific NPC. Cheap: only on an actual change.
      const seedId = p.disguiseId && p.disguiseId.length > 0 ? p.disguiseId : p.id;
      if (avatar.seedId !== seedId) this.rebuildLook(avatar, seedId);
      this.colorByTier(avatar, p.disguiseTier);
      this.styleByPhase(avatar, p.phase);
      this.styleByAbility(avatar, p);
      this.syncAura(avatar, p);

      if (id === this.localPlayerId) {
        this.syncLocal(avatar, p, localInput, dt);
        // First-person body hide — re-asserted each frame (styleByPhase only fires on a phase
        // CHANGE, so this can't live there). Honour the phase's own visibility so we never force
        // an eliminated/ghosted body back on.
        const phaseVisible = downedBodyStyle(p.phase).visible;
        avatar.group.visible = phaseVisible && !this.localBodyHidden;
      } else {
        this.syncRemote(avatar, p, dt);
      }

      // Combat events from the wire: a fireSeq increment → muzzle/tracer/impact + recoil + aim;
      // a gadget-cooldown rising edge → the kind-appropriate burst. Both run AFTER the transform
      // sync so the VFX spawn at the avatar's freshly-updated position.
      this.syncFire(avatar, p);
      this.syncGadget(avatar, p);

      // Decay the aim blend toward 0 between shots (framerate-independent), then drive the rig.
      avatar.aim = Math.max(0, avatar.aim - dt / AIM_DECAY);

      // Drive the walk/idle rig from the planar speed of the (now-updated) render position.
      // Downed/out bodies don't walk — feed speed 0 so the limbs rest while laid flat.
      const alive = p.phase !== 'downed' && p.phase !== 'out';
      const dx = avatar.render.x - avatar.animPrev.x;
      const dz = avatar.render.z - avatar.animPrev.z;
      const speed = alive && dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      avatar.animPrev.x = avatar.render.x;
      avatar.animPrev.y = avatar.render.y;
      avatar.animPrev.z = avatar.render.z;
      // Downed/out bodies drop the weapon (aim 0); otherwise blend the live aim in.
      avatar.animate(dt, speed, alive ? avatar.aim : 0);
      // Advance the attached aura (if any) — it lives under the avatar group, so it follows.
      avatar.aura?.update(dt);
    }

    // Despawn avatars no longer in the snapshot.
    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      this.disposeAvatar(avatar);
      this.avatars.delete(id);
    }

    // Advance + reap the transient one-shot FX. Reverse iteration so a swap-remove is O(1) and
    // doesn't reallocate the array each frame.
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const h = this.fx[i];
      if (!h) continue;
      h.update(dt);
      if (h.done) {
        h.dispose();
        const last = this.fx[this.fx.length - 1];
        if (last) this.fx[i] = last;
        this.fx.pop();
      }
    }
  }

  /** Add a one-shot FX to the scene root + track it for per-frame update/reap. */
  private pushFx(h: FxHandle): void {
    this.root.add(h.object3d);
    this.fx.push(h);
  }

  // --- Fire VFX: spawn muzzle/tracer/impact + recoil + full aim on each fireSeq increment ---
  private syncFire(avatar: Avatar, p: NetPlayerState): void {
    const seq = p.fireSeq ?? 0;
    if (avatar.lastFireSeq < 0) {
      // First observation — seed without firing (don't blip VFX on spawn / first snapshot).
      avatar.lastFireSeq = seq;
      return;
    }
    if (seq === avatar.lastFireSeq) return; // no new shot
    avatar.lastFireSeq = seq;

    // Always raise + point the weapon on a confirmed shot.
    avatar.aim = 1;

    // For the LOCAL player we may already have flashed via predictLocalFire(); skip the echo to
    // avoid a double-flash, but still keep aim/recoil current (cheap + correct).
    if (p.id === this.localPlayerId) {
      const now = performance.now() / 1000;
      if (now - avatar.lastLocalFire < LOCAL_FIRE_PREDICT_WINDOW) {
        avatar.fireRecoil();
        return;
      }
    }
    this.emitFireFx(avatar, p);
  }

  /** Spawn the muzzle flash + tracer + impact for one shot from `avatar`, and kick its recoil.
   * The tracer runs from the gun muzzle along the avatar's facing for the agent's weapon range
   * (or the muzzle's own aim dir). Reuses scratch vectors — no allocation. */
  private emitFireFx(avatar: Avatar, p: NetPlayerState): void {
    const range = AGENTS_BY_ID[p.agentId].weaponStats.range;
    const m = avatar.getMuzzle(); // world muzzle pos + dir (scratch — don't retain)
    this.scratchFrom.copy(m.pos);
    // Prefer the avatar's yaw facing for the bullet line (stable, matches where they point), but
    // fall back to the muzzle's own forward if needed. Yaw forward = (sin, 0, cos).
    this.scratchDir.set(Math.sin(avatar.renderYaw), 0, Math.cos(avatar.renderYaw));
    if (this.scratchDir.lengthSq() < 1e-6) this.scratchDir.copy(m.dir);
    this.scratchTo.copy(this.scratchFrom).addScaledVector(this.scratchDir, range);
    // Impact a touch before the very end so the spark reads as a hit point.
    this.scratchAt.copy(this.scratchFrom).addScaledVector(this.scratchDir, range * 0.96);

    this.pushFx(muzzleFlash(this.scratchFrom, this.scratchDir));
    this.pushFx(tracer(this.scratchFrom, this.scratchTo));
    this.pushFx(impactFlash(this.scratchAt));
    avatar.fireRecoil();
  }

  // --- Gadget VFX: a rising edge on gadgetCooldownMs (~0 → large) means a use just happened ---
  private syncGadget(avatar: Avatar, p: NetPlayerState): void {
    const cd = p.gadgetCooldownMs ?? 0;
    const prev = avatar.lastGadgetCd;
    avatar.lastGadgetCd = cd;
    // Rising edge: cooldown jumped up from ~ready. Mirrors how the audio diff detects events.
    if (!(prev <= 1 && cd > 1)) return;

    const agent = AGENTS_BY_ID[p.agentId];
    // Centre the gadget FX at the avatar's feet/body. The avatar group origin is at body centre
    // (y + AVATAR_HEIGHT/2 in apply), so use the render ground position for floor-aligned FX.
    this.scratchAt.set(avatar.render.x, avatar.render.y, avatar.render.z);
    if (agent.gadget.kind === 'scan') {
      this.pushFx(scanPulse(this.scratchAt, Math.max(1, agent.gadget.radius)));
    } else if (agent.gadget.kind === 'frag') {
      this.pushFx(fragBurst(this.scratchAt, Math.max(1, agent.gadget.radius)));
    } else {
      this.pushFx(miragePoof(this.scratchAt));
    }
  }

  // --- Expertise aura: attach the matching persistent aura while abilityActive, remove on off ---
  private syncAura(avatar: Avatar, p: NetPlayerState): void {
    const want = p.abilityActive && p.phase !== 'downed' && p.phase !== 'out';
    if (want && !avatar.aura) {
      const kind = auraKindForAbility(AGENTS_BY_ID[p.agentId].ability);
      const aura = abilityAura(kind);
      avatar.bodyGroup.add(aura.object3d);
      avatar.aura = aura;
    } else if (!want && avatar.aura) {
      avatar.aura.dispose();
      avatar.aura = null;
    }
  }

  /**
   * Local fire PREDICTION: trigger the muzzle/recoil immediately on the local trigger pull so it
   * doesn't lag the fireSeq round-trip (~RTT). main.ts calls this from requestFire(). The fireSeq
   * echo for the local player is then suppressed for a short window (see syncFire). No-op if the
   * local avatar hasn't spawned yet.
   */
  predictLocalFire(): void {
    const avatar = this.avatars.get(this.localPlayerId);
    if (!avatar) return;
    const p = this.lastLocal;
    avatar.aim = 1;
    avatar.lastLocalFire = performance.now() / 1000;
    if (!p) {
      // No snapshot yet — at least kick the recoil so it feels alive.
      avatar.fireRecoil();
      return;
    }
    this.emitFireFx(avatar, p);
  }

  // --- remote: ease the cosmetic transform toward the authoritative snapshot ---
  private syncRemote(avatar: Avatar, p: NetPlayerState, dt: number): void {
    const t = smoothingFactor(REMOTE_SMOOTH, dt);
    lerpVec3(avatar.render, avatar.render, { x: p.x, y: p.y, z: p.z }, t);
    avatar.renderYaw = lerpAngle(avatar.renderYaw, p.yaw, t);
    this.apply(avatar);
  }

  // --- local: predict from input, then ease back toward the authoritative anchor ---
  private syncLocal(
    avatar: Avatar,
    p: NetPlayerState,
    input: PlayerInput | null,
    dt: number,
  ): void {
    // Seed prediction the first time, or whenever we don't yet have a predicted pose.
    if (!this.hasPredicted) {
      this.predicted.x = p.x;
      this.predicted.y = p.y;
      this.predicted.z = p.z;
      this.predictedYaw = p.yaw;
      this.hasPredicted = true;
    }

    // 1) Step the prediction forward by the player's own input (responsiveness), then resolve it
    //    against the SAME wall colliders the authoritative sim uses, so the predicted body slides
    //    along walls too (no clipping through + snapping back).
    if (input) {
      const next = integrateMove(this.predicted, input, dt);
      this.predicted.x = next.x;
      this.predicted.y = next.y;
      this.predicted.z = next.z;
      this.predictedYaw = input.yaw;
      if (this.walls.length > 0) {
        const r = resolveCircleVsWalls(this.predicted.x, this.predicted.z, PLAYER_RADIUS, this.walls);
        this.predicted.x = r.x;
        this.predicted.z = r.z;
      }
    }

    // 2) Gently pull the prediction back toward the authoritative position so it never
    //    drifts away from the server's word (cosmetic reconciliation, not rollback).
    //    Detecting that the snapshot moved (a real tick arrived) re-anchors harder.
    const moved =
      !this.lastLocal ||
      this.lastLocal.x !== p.x ||
      this.lastLocal.y !== p.y ||
      this.lastLocal.z !== p.z;
    const pull = smoothingFactor(moved ? LOCAL_SMOOTH : LOCAL_SMOOTH * 0.25, dt);
    lerpVec3(this.predicted, this.predicted, { x: p.x, y: p.y, z: p.z }, pull);
    this.lastLocal = { ...p };

    // The rendered transform IS the predicted one for the local player.
    avatar.render.x = this.predicted.x;
    avatar.render.y = this.predicted.y;
    avatar.render.z = this.predicted.z;
    avatar.renderYaw = this.predictedYaw;
    this.apply(avatar);
  }

  private apply(avatar: Avatar): void {
    avatar.group.position.set(
      avatar.render.x,
      avatar.render.y + AVATAR_HEIGHT / 2,
      avatar.render.z,
    );
    avatar.group.rotation.y = avatar.renderYaw;
  }

  private spawn(p: NetPlayerState): Avatar {
    // The look is seeded by the disguise id (the NPC copied) when set, else the player's own id
    // (players are individuals too — their tier reads via the accent). Deterministic; only the
    // walk phase is random.
    const seedId = p.disguiseId && p.disguiseId.length > 0 ? p.disguiseId : p.id;
    // Players carry a weapon (drawn only when aiming/firing); the crowd/preview do not.
    const built = buildAvatarBody({ seed: hashId(seedId), hasWeapon: true });

    // Stable OUTER group: the body group hangs off it, and so does the over-head marker. The
    // body group is swapped wholesale on a disguise change; the outer group (and its marker)
    // persists, so position/prediction/marker styling survive the swap.
    const outer = new THREE.Group();
    outer.add(built.group);

    // The reveal halo: a flat ring above the head. Unlit (MeshBasic) so it glows the same
    // bright color regardless of scene lighting, making "blown" pop. Hidden until phase
    // flags it. Lying horizontal so it reads from any camera angle / yaw.
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff1a1a,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_INNER, MARKER_OUTER, 24),
      markerMaterial,
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = MARKER_Y;
    marker.renderOrder = 10; // draw over bodies so it isn't occluded by the crowd
    marker.visible = false;
    outer.add(marker);

    this.root.add(outer);

    const avatar: Avatar = {
      group: outer,
      bodyGroup: built.group,
      seedId,
      body: built.body,
      material: built.material,
      setTier: built.setTier,
      setBrightness: built.setBrightness,
      setOpacity: built.setOpacity,
      setEmissive: built.setEmissive,
      marker,
      markerMaterial,
      phase: '',
      render: { x: p.x, y: p.y, z: p.z },
      renderYaw: p.yaw,
      tier: '',
      abilityKey: '',
      animate: built.animate,
      fireRecoil: built.fireRecoil,
      getMuzzle: built.getMuzzle,
      disposeBody: built.dispose,
      animPrev: { x: p.x, y: p.y, z: p.z },
      lastFireSeq: -1, // -1 → seed on first observation; never fire VFX on spawn
      aim: 0,
      lastGadgetCd: p.gadgetCooldownMs ?? 0, // seed so we don't fire a gadget FX on spawn
      lastLocalFire: -Infinity,
      aura: null,
    };
    this.apply(avatar);
    return avatar;
  }

  /**
   * Swap an avatar's body to a new seeded look (the player took a different disguise). Disposes
   * the old body, builds the new one, re-points the styling/animation handles, and resets the
   * style caches so tier/phase/ability re-apply to the fresh materials this same frame. The
   * outer group + marker are untouched, so position/prediction/marker state carry over.
   */
  private rebuildLook(avatar: Avatar, seedId: string): void {
    avatar.group.remove(avatar.bodyGroup);
    // The aura was parented to the OLD body group — dispose it; syncAura re-attaches it to the
    // fresh body this same frame if the Expertise is still active.
    if (avatar.aura) {
      avatar.aura.dispose();
      avatar.aura = null;
    }
    avatar.disposeBody();

    const built = buildAvatarBody({ seed: hashId(seedId), hasWeapon: true });
    avatar.group.add(built.group);
    avatar.bodyGroup = built.group;
    avatar.seedId = seedId;
    avatar.body = built.body;
    avatar.material = built.material;
    avatar.setTier = built.setTier;
    avatar.setBrightness = built.setBrightness;
    avatar.setOpacity = built.setOpacity;
    avatar.setEmissive = built.setEmissive;
    avatar.animate = built.animate;
    avatar.fireRecoil = built.fireRecoil;
    avatar.getMuzzle = built.getMuzzle;
    avatar.disposeBody = built.dispose;
    // The fresh rig starts un-aimed; the aim/recoil state was on the disposed rig. Keep the
    // last-seen wire counters so a stale fireSeq/gadget value doesn't blip a VFX on the swap.
    avatar.aim = 0;

    // Force the cached styling to re-apply to the new materials on this frame's style calls.
    avatar.tier = '';
    avatar.phase = '';
    avatar.abilityKey = '';
  }

  private colorByTier(avatar: Avatar, tier: NetPlayerState['disguiseTier']): void {
    if (avatar.tier === tier) return;
    avatar.tier = tier;
    // Tier now shows as the small ACCENT (armband/sash/visor), not the whole body. setTier
    // remembers it as the accent's base and re-applies the current brightness. Cheap: only on
    // a tier change.
    avatar.setTier(tierHex(tier));
  }

  // Toggle the over-head halo + the downed/out body look from the authoritative phase. A live
  // player: marker per reveal state, body upright + opaque + full tier colour. A 'downed'
  // teammate: dimmed + laid flat so an ally can find them; an 'out' rival: ghosted. Everything
  // reverts the instant the server changes the phase (e.g. on revive). Cheap: only on change.
  private styleByPhase(avatar: Avatar, phase: NetPlayerState['phase']): void {
    if (avatar.phase === phase) return;
    avatar.phase = phase;

    const style = revealMarkerStyle(phase);
    avatar.marker.visible = style.visible;
    if (style.visible) {
      avatar.markerMaterial.color.set(style.color);
      avatar.markerMaterial.opacity = 0.55 + style.intensity * 0.4;
    }

    // Body: dim/ghost + lay flat for downed/out, upright/opaque otherwise. Effects fan across
    // EVERY material of the varied body via the styling API (brightness from the remembered
    // bases, opacity on all). The tier accent already carries its own colour via setTier.
    const body = downedBodyStyle(phase);
    avatar.setBrightness(body.brightness);
    avatar.setOpacity(body.opacity);
    avatar.group.visible = body.visible;
    // Roll the whole group flat (z), independent of the yaw applied on y in apply().
    avatar.group.rotation.z = body.roll;
  }

  // Overlay the signature-Expertise visual on top of the phase styling. Two agents have a
  // body-visible effect while their Expertise is active:
  //   - Larcin "Adieu"       → cloaked: a faint translucent ghost ("unseen").
  //   - Chavez "Hard Boiled" → invulnerable: a gold emissive shell ("can't be touched").
  // Squire's "Eyes on the Prize" is a HUD readout (no body effect). Keyed on agent+active+
  // phase so it re-applies after a phase change (which resets opacity) too. Cheap: only on a
  // key change.
  private styleByAbility(avatar: Avatar, p: NetPlayerState): void {
    const active = p.abilityActive;
    const key = `${p.agentId}:${active ? 1 : 0}:${p.phase}`;
    if (avatar.abilityKey === key) return;
    avatar.abilityKey = key;

    const base = downedBodyStyle(p.phase).opacity;
    // Kind-based so NEW agents sharing these Expertises also cloak/glow (identical for the
    // original three: larcin→adieu, chavez→hard_boiled).
    const ability = AGENTS_BY_ID[p.agentId].ability;
    const cloaked = active && ability === 'adieu';
    const invuln = active && ability === 'hard_boiled';

    // Opacity: cloak ghosts the whole body; otherwise fall back to the phase's base opacity.
    const opacity = cloaked ? Math.min(base, 0.18) : base;
    avatar.setOpacity(opacity);

    // Emissive: a gold shell across EVERY material while invulnerable, off otherwise.
    if (invuln) avatar.setEmissive(0xffcf3f, 0.9);
    else avatar.setEmissive(0x000000, 0);
  }

  private disposeAvatar(avatar: Avatar): void {
    this.root.remove(avatar.group);
    if (avatar.aura) {
      avatar.aura.dispose();
      avatar.aura = null;
    }
    avatar.disposeBody();
    avatar.marker.geometry.dispose();
    avatar.markerMaterial.dispose();
  }

  dispose(): void {
    for (const [, avatar] of this.avatars) this.disposeAvatar(avatar);
    this.avatars.clear();
    // Free any in-flight one-shot FX.
    for (const h of this.fx) h.dispose();
    this.fx.length = 0;
  }
}
