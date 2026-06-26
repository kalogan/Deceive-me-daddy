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
  TIER_COLOR,
  type NetMatchState,
  type NetPlayerState,
  type PlayerInput,
} from '@deceive/shared';
import { integrateMove } from '../net/movement';
import {
  lerpAngle,
  lerpVec3,
  smoothingFactor,
  type Vec3,
} from './interpolate';
import { AVATAR_HEIGHT, AVATAR_RADIUS, buildAvatarBody } from './avatar';
import { revealMarkerStyle } from './revealStyle';
import { downedBodyStyle } from './downedStyle';

// How quickly the cosmetic transform chases the authoritative one (fraction/second).
const REMOTE_SMOOTH = 0.92;
const LOCAL_SMOOTH = 0.6;

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
  group: THREE.Group;
  body: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Encapsulated styling API — fans effects across EVERY material of the varied body. */
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
  /** Drive the procedural walk/idle rig. */
  animate: (dt: number, speed: number) => void;
  /** Free the rig's geometries + material. */
  disposeBody: () => void;
  /** Render position last frame, to derive planar speed for the walk cycle. */
  animPrev: Vec3;
}

export class WorldView {
  private readonly root = new THREE.Group();
  private readonly avatars = new Map<string, Avatar>();
  private readonly localPlayerId: string;

  /** Local prediction: where we predict the local player to be between snapshots. */
  private readonly predicted: Vec3 = { x: 0, y: 0, z: 0 };
  private predictedYaw = 0;
  private hasPredicted = false;
  private lastLocal: NetPlayerState | null = null;

  constructor(scene: THREE.Scene, localPlayerId: string) {
    this.localPlayerId = localPlayerId;
    scene.add(this.root);
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
      this.colorByTier(avatar, p.disguiseTier);
      this.styleByPhase(avatar, p.phase);
      this.styleByAbility(avatar, p);

      if (id === this.localPlayerId) {
        this.syncLocal(avatar, p, localInput, dt);
      } else {
        this.syncRemote(avatar, p, dt);
      }

      // Drive the walk/idle rig from the planar speed of the (now-updated) render position.
      // Downed/out bodies don't walk — feed speed 0 so the limbs rest while laid flat.
      const alive = p.phase !== 'downed' && p.phase !== 'out';
      const dx = avatar.render.x - avatar.animPrev.x;
      const dz = avatar.render.z - avatar.animPrev.z;
      const speed = alive && dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      avatar.animPrev.x = avatar.render.x;
      avatar.animPrev.y = avatar.render.y;
      avatar.animPrev.z = avatar.render.z;
      avatar.animate(dt, speed);
    }

    // Despawn avatars no longer in the snapshot.
    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      this.disposeAvatar(avatar);
      this.avatars.delete(id);
    }
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

    // 1) Step the prediction forward by the player's own input (responsiveness).
    if (input) {
      const next = integrateMove(this.predicted, input, dt);
      this.predicted.x = next.x;
      this.predicted.y = next.y;
      this.predicted.z = next.z;
      this.predictedYaw = input.yaw;
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
    // Seed a STABLE individual look from the player id (players are individuals too — their
    // tier still reads via the accent). Look is deterministic; only the walk phase is random.
    const { group, body, material, animate, dispose, setTier, setBrightness, setOpacity, setEmissive } =
      buildAvatarBody({ seed: hashId(p.id) });

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
    group.add(marker);

    this.root.add(group);

    const avatar: Avatar = {
      group,
      body,
      material,
      setTier,
      setBrightness,
      setOpacity,
      setEmissive,
      marker,
      markerMaterial,
      phase: '',
      render: { x: p.x, y: p.y, z: p.z },
      renderYaw: p.yaw,
      tier: '',
      abilityKey: '',
      animate,
      disposeBody: dispose,
      animPrev: { x: p.x, y: p.y, z: p.z },
    };
    this.apply(avatar);
    return avatar;
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
    const cloaked = active && p.agentId === 'larcin';
    const invuln = active && p.agentId === 'chavez';

    // Opacity: cloak ghosts the whole body; otherwise fall back to the phase's base opacity.
    const opacity = cloaked ? Math.min(base, 0.18) : base;
    avatar.setOpacity(opacity);

    // Emissive: a gold shell across EVERY material while invulnerable, off otherwise.
    if (invuln) avatar.setEmissive(0xffcf3f, 0.9);
    else avatar.setEmissive(0x000000, 0);
  }

  private disposeAvatar(avatar: Avatar): void {
    this.root.remove(avatar.group);
    avatar.disposeBody();
    avatar.marker.geometry.dispose();
    avatar.markerMaterial.dispose();
  }

  dispose(): void {
    for (const [, avatar] of this.avatars) this.disposeAvatar(avatar);
    this.avatars.clear();
  }
}
