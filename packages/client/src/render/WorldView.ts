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
import { AVATAR_HEIGHT, buildAvatarBody } from './avatar';

// How quickly the cosmetic transform chases the authoritative one (fraction/second).
const REMOTE_SMOOTH = 0.92;
const LOCAL_SMOOTH = 0.6;

interface Avatar {
  group: THREE.Group;
  body: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** The smoothed cosmetic position we actually render at. */
  render: Vec3;
  renderYaw: number;
  /** Last tier we colored to, to avoid rebuilding the material color every frame. */
  tier: string;
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

      if (id === this.localPlayerId) {
        this.syncLocal(avatar, p, localInput, dt);
      } else {
        this.syncRemote(avatar, p, dt);
      }
    }

    // Despawn avatars no longer in the snapshot.
    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      this.root.remove(avatar.group);
      avatar.body.geometry.dispose();
      avatar.material.dispose();
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
    const { group, body, material } = buildAvatarBody();
    this.root.add(group);

    const avatar: Avatar = {
      group,
      body,
      material,
      render: { x: p.x, y: p.y, z: p.z },
      renderYaw: p.yaw,
      tier: '',
    };
    this.apply(avatar);
    return avatar;
  }

  private colorByTier(avatar: Avatar, tier: NetPlayerState['disguiseTier']): void {
    if (avatar.tier === tier) return;
    avatar.material.color.set(TIER_COLOR[tier]);
    avatar.tier = tier;
  }

  dispose(): void {
    for (const [, avatar] of this.avatars) {
      this.root.remove(avatar.group);
      avatar.body.geometry.dispose();
      avatar.material.dispose();
    }
    this.avatars.clear();
  }
}
