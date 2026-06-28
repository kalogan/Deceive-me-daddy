// Pure, server-authoritative input application (slice 1.1). The server NEVER trusts a
// client's reported position — a PlayerInput is a REQUEST. We take the desired move
// direction + yaw and derive an authoritative velocity, clamped to the legal speed
// (WALK_SPEED, or RUN_SPEED when running). Positions are integrated by sim-core's step()
// from this velocity; the client's own x/y/z are ignored entirely.
//
// Kept pure (no Colyseus, no room) so it is unit-testable in isolation (PROJECT_BRIEF
// §4.6) and so the room handler is a thin adapter over it.
import type { PlayerInput } from '@deceive/shared';
import { inputSpeed, inputToWorldVelocity, type PlayerState } from '@deceive/sim-core';

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
  // Derive an authoritative world-space velocity via the SHARED movement convention
  // (sim-core) so the server and the client's prediction agree exactly. The helper
  // sanitizes NaN/Infinity, clamps diagonals, and rotates the local input by yaw.
  const vel = inputToWorldVelocity(input.moveX, input.moveZ, input.yaw, inputSpeed(input.running));
  player.vel.x = vel.x;
  player.vel.z = vel.z;

  if (Number.isFinite(input.yaw)) {
    player.yaw = input.yaw;
  }

  // Behavioral tell for the suspicion meter (mapKeysToInput only sets running while moving).
  player.isRunning = input.running === true;

  // Jump intent — consumed by step() to launch a hop when grounded.
  player.wantsJump = input.jumping === true;
}

/** Round-robin team assignment so the next joiner balances teams (PROJECT_BRIEF §2). */
export function assignTeam(joinIndex: number, teams: number): number {
  return ((joinIndex % teams) + teams) % teams;
}
