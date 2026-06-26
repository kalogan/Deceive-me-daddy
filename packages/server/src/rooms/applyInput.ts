// Pure, server-authoritative input application (slice 1.1). The server NEVER trusts a
// client's reported position — a PlayerInput is a REQUEST. We take the desired move
// direction + yaw and derive an authoritative velocity, clamped to the legal speed
// (WALK_SPEED, or RUN_SPEED when running). Positions are integrated by sim-core's step()
// from this velocity; the client's own x/y/z are ignored entirely.
//
// Kept pure (no Colyseus, no room) so it is unit-testable in isolation (PROJECT_BRIEF
// §4.6) and so the room handler is a thin adapter over it.
import { RUN_SPEED, WALK_SPEED } from '@deceive/shared';
import type { PlayerInput } from '@deceive/shared';
import type { PlayerState } from '@deceive/sim-core';

/**
 * Apply a validated movement input to a player AUTHORITATIVELY.
 *
 * - Move vector is on the XZ plane (ground); Y velocity is left untouched here
 *   (jumping/gravity is a later slice).
 * - The input direction is normalized then scaled to the allowed speed, so a client
 *   can't gain speed by sending e.g. (moveX=1, moveZ=1) — diagonals are clamped too.
 * - `running` selects RUN_SPEED (a suspicious act handled by the suspicion slice).
 *
 * Mutates `player.vel` and `player.yaw` in place.
 */
export function applyMovementInput(player: PlayerState, input: PlayerInput): void {
  const speed = input.running ? RUN_SPEED : WALK_SPEED;

  // Sanitize: a malicious/buggy client could send NaN/Infinity. Treat those as 0.
  const rawX = Number.isFinite(input.moveX) ? input.moveX : 0;
  const rawZ = Number.isFinite(input.moveZ) ? input.moveZ : 0;

  const mag = Math.hypot(rawX, rawZ);
  if (mag > 1e-6) {
    // Clamp magnitude to 1 then scale to speed — never faster than `speed`, even on
    // diagonals or when a client over-reports the stick.
    const scale = (speed * Math.min(mag, 1)) / mag;
    player.vel.x = rawX * scale;
    player.vel.z = rawZ * scale;
  } else {
    player.vel.x = 0;
    player.vel.z = 0;
  }

  if (Number.isFinite(input.yaw)) {
    player.yaw = input.yaw;
  }
}

/** Round-robin team assignment so the next joiner balances teams (PROJECT_BRIEF §2). */
export function assignTeam(joinIndex: number, teams: number): number {
  return ((joinIndex % teams) + teams) % teams;
}
