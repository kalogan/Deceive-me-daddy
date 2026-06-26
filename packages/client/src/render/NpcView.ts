// NpcView owns the Three.js representation of the ambient NPC CROWD — one greybox capsule
// per NPC from NetMatchState.npcs, tier-coloured, keyed by id, eased toward the latest
// authoritative snapshot each frame.
//
// It is a sibling of WorldView (which renders PLAYERS): kept separate so main.ts can drive
// each independently, but deliberately VISUALLY IDENTICAL — same capsule + nose, same
// AVATAR_RADIUS/HEIGHT, same TIER_COLOR — because the core fantasy is that players hide
// AMONG the crowd and must be indistinguishable from it at a glance (PROJECT_BRIEF §1).
//
// Authority (PROJECT_BRIEF §3/§4.2): NPC positions are the server's word. NpcView only
// smooths how that truth is PRESENTED — eased toward each snapshot like remote players.
import * as THREE from 'three';
import { TIER_COLOR, type NetMatchState, type NetNpcState } from '@deceive/shared';
import { AVATAR_HEIGHT, buildAvatarBody } from './avatar';
import {
  easeNpcToward,
  seedNpcRender,
  type NpcRenderState,
} from './npcCrowd';

// How quickly the cosmetic transform chases the authoritative one (fraction/second).
// Matches WorldView's REMOTE_SMOOTH so NPCs and remote players move with the same feel.
const NPC_SMOOTH = 0.92;

interface NpcAvatar {
  group: THREE.Group;
  body: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  state: NpcRenderState;
  animate: (dt: number, speed: number) => void;
  disposeBody: () => void;
  animPrev: { x: number; y: number; z: number };
}

export class NpcView {
  private readonly root = new THREE.Group();
  private readonly avatars = new Map<string, NpcAvatar>();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** Sync to the latest snapshot's npcs. `dt` is the render-frame delta in seconds. */
  sync(state: NetMatchState, dt: number): void {
    const seen = new Set<string>();
    for (const id of Object.keys(state.npcs)) {
      const n = state.npcs[id];
      if (!n) continue;
      seen.add(id);

      let avatar = this.avatars.get(id);
      if (!avatar) {
        avatar = this.spawn(n);
        this.avatars.set(id, avatar);
      }
      this.colorByTier(avatar, n.tier);
      easeNpcToward(avatar.state, n, NPC_SMOOTH, dt);
      this.apply(avatar);

      // Drive the walk/idle rig from the NPC's planar render speed.
      const r = avatar.state.render;
      const speed = dt > 0 ? Math.hypot(r.x - avatar.animPrev.x, r.z - avatar.animPrev.z) / dt : 0;
      avatar.animPrev.x = r.x;
      avatar.animPrev.y = r.y;
      avatar.animPrev.z = r.z;
      avatar.animate(dt, speed);
    }

    // Despawn NPCs no longer in the snapshot.
    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      this.disposeAvatar(avatar);
      this.avatars.delete(id);
    }
  }

  private apply(avatar: NpcAvatar): void {
    avatar.group.position.set(
      avatar.state.render.x,
      avatar.state.render.y + AVATAR_HEIGHT / 2,
      avatar.state.render.z,
    );
    avatar.group.rotation.y = avatar.state.renderYaw;
  }

  private spawn(n: NetNpcState): NpcAvatar {
    const { group, body, material, animate, dispose } = buildAvatarBody();
    this.root.add(group);
    const state = seedNpcRender(n);
    const avatar: NpcAvatar = {
      group,
      body,
      material,
      state,
      animate,
      disposeBody: dispose,
      animPrev: { x: state.render.x, y: state.render.y, z: state.render.z },
    };
    this.apply(avatar);
    return avatar;
  }

  private colorByTier(avatar: NpcAvatar, tier: NetNpcState['tier']): void {
    if (avatar.state.tier === tier) return;
    avatar.material.color.set(TIER_COLOR[tier]);
    avatar.state.tier = tier;
  }

  private disposeAvatar(avatar: NpcAvatar): void {
    this.root.remove(avatar.group);
    avatar.disposeBody();
  }

  dispose(): void {
    for (const [, avatar] of this.avatars) this.disposeAvatar(avatar);
    this.avatars.clear();
    this.root.removeFromParent();
  }
}
