// Pure helpers for the ambient NPC crowd presentation. Kept Three.js / DOM free so the
// selection + interpolation math is unit-testable in the node-env gate (PROJECT_BRIEF
// §4.6) and shared by NpcView.
//
// Authority note (PROJECT_BRIEF §3/§4.2): NPC positions are the server's word (the live
// authoritative sim fills NetMatchState.npcs at the tick rate; the offline mock leaves it
// empty). These helpers only smooth how that truth is PRESENTED — NPCs are eased toward
// their latest snapshot exactly like remote players so 20Hz ticks read as smooth motion.
import type { NetMatchState, NetNpcState } from '@deceive/shared';
import { lerpAngle, lerpVec3, smoothingFactor, type Vec3 } from './interpolate';

/** The cosmetic transform we actually render an NPC at, eased toward its snapshot. */
export interface NpcRenderState {
  render: Vec3;
  renderYaw: number;
  /** Last tier we coloured to, to skip redundant material updates. */
  tier: string;
}

/** A fresh render state anchored exactly on the NPC's first-seen snapshot pose. */
export function seedNpcRender(n: NetNpcState): NpcRenderState {
  return {
    render: { x: n.x, y: n.y, z: n.z },
    renderYaw: n.yaw,
    tier: '',
  };
}

/**
 * Ease an NPC's cosmetic transform toward its authoritative snapshot, in place. Mirrors
 * the remote-player smoothing in WorldView so players and NPCs move with the same feel
 * (the whole point: players must be indistinguishable from the crowd). `rate` is the
 * fraction of the gap closed per second; `dt` the render-frame delta in seconds.
 */
export function easeNpcToward(
  out: NpcRenderState,
  snapshot: NetNpcState,
  rate: number,
  dt: number,
): void {
  const t = smoothingFactor(rate, dt);
  lerpVec3(out.render, out.render, { x: snapshot.x, y: snapshot.y, z: snapshot.z }, t);
  out.renderYaw = lerpAngle(out.renderYaw, snapshot.yaw, t);
}

/**
 * The set of NPC ids present in a snapshot. A live server fills these; the offline mock
 * leaves npcs empty (so no crowd appears server-less — that's expected). Pure so the
 * spawn/despawn diff NpcView runs can be reasoned about without a scene.
 */
export function npcIds(state: NetMatchState): string[] {
  return Object.keys(state.npcs);
}
