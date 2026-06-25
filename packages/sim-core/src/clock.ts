// Injected clock (PROJECT_BRIEF §4.3). The sim NEVER calls Date.now(); time is advanced
// explicitly so the simulation is deterministic and replayable.

export interface Clock {
  /** Current simulation time in milliseconds. */
  now(): number;
}

export class FixedClock implements Clock {
  private t: number;
  constructor(startMs = 0) {
    this.t = startMs;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
