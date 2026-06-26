// Pure rate-limit gate for the fire control (PROJECT_BRIEF §2.5 — firing = hard reveal).
// A held mouse button / key would otherwise spam StateSource.fire() every frame; this gate
// admits at most one fire per `cooldownMs` so the request stream is sane. Pure + clock-
// injected (no Date.now) so it's deterministically unit-testable (PROJECT_BRIEF §4.6).

/** Minimum gap between admitted fires, in ms. Tuned so a held button isn't a firehose. */
export const FIRE_COOLDOWN_MS = 250;

export class FireGate {
  private lastFireMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly cooldownMs: number = FIRE_COOLDOWN_MS) {}

  /**
   * Ask to fire at time `nowMs`. Returns true (and arms the cooldown) only if enough time
   * has elapsed since the last admitted fire; returns false while still cooling down.
   */
  tryFire(nowMs: number): boolean {
    if (nowMs - this.lastFireMs < this.cooldownMs) return false;
    this.lastFireMs = nowMs;
    return true;
  }
}
