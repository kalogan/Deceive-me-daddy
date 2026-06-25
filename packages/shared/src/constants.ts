// Tuning + format constants shared by server, sim-core, and client.
// Feel values (suspicion rates, windows) are review-queue items — tuned in playtest.

export const TICK_RATE = 20; // server simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;

// Match format (PROJECT_BRIEF §2): 4 teams of 3.
export const MATCH_TEAMS = 4;
export const TEAM_SIZE = 3;
export const MAX_PLAYERS = MATCH_TEAMS * TEAM_SIZE;

// Suspicion / detection (PROJECT_BRIEF §2b). Provisional — tune in harness/playtest.
export const SUSPICION_MAX = 100;
export const REVEAL_WINDOW_MS = 8000;

// Movement (provisional).
export const WALK_SPEED = 3.0; // m/s — matches an NPC's pace
export const RUN_SPEED = 6.0; // m/s — running is a suspicious act
