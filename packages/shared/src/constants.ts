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

// Disguise acquisition (PROJECT_BRIEF §2b). Provisional — tune in playtest.
export const DISGUISE_TAKE_RANGE = 2.0; // metres you must be within an NPC to take its look
export const HOLO_CRUMB_MS = 6000; // how long a disguise-theft tell lingers

// Suspicion tuning (PROJECT_BRIEF §2b, two-axis meter). Provisional — tune in playtest.
// Rates are meter-units per second; the per-tier TIER_SCRUTINY multiplier scales rises.
export const SUSPICION_RISE_FORBIDDEN = 25; // in a zone above your clearance ("scolded")
export const SUSPICION_RISE_RUNNING = 8; // running is a suspicious act
export const SUSPICION_DECAY = 12; // bleeds off when acting normal
export const SUSPICION_SUSPICIOUS_AT = 50; // meter >= this -> phase becomes 'suspicious'
export const SUSPICION_BLENDED_AT = 15; // meter <= this -> phase returns to 'blended'

// Combat + downed/revive (PROJECT_BRIEF §2b). Provisional — tune in playtest.
export const MAX_HEALTH = 100;
export const FIRE_DAMAGE = 55; // ~two shots to down
export const FIRE_RANGE = 30; // metres a shot reaches
export const FIRE_CONE_DOT = 0.97; // cos(half-angle) the target must be within (~14°)
export const REVIVE_WINDOW_MS = 12000; // downed -> 'out' if not revived in time
export const REVIVE_RANGE = 2.5; // metres a teammate must be within to revive

// Movement (provisional).
export const WALK_SPEED = 3.0; // m/s — matches an NPC's pace
export const RUN_SPEED = 6.0; // m/s — running is a suspicious act
