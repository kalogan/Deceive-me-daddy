// Tuning + format constants shared by server, sim-core, and client.
// Feel values (suspicion rates, windows) are review-queue items — tuned in playtest.

export const TICK_RATE = 20; // server simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;

// Match format (PROJECT_BRIEF §2): 4 teams of 3.
export const MATCH_TEAMS = 4;
export const TEAM_SIZE = 3;
export const MAX_PLAYERS = MATCH_TEAMS * TEAM_SIZE;

// AI players the server spawns to fill a solo/under-filled match. Kept modest so the bots
// don't starve the intel economy (with too many contestants no one accumulates the vault
// threshold) — see matchFlow.test.ts which proves a match completes at this count. Tunable.
export const MATCH_BOT_COUNT = 3;

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

// Agent PASSIVES (PROJECT_BRIEF §2 — per-agent signature passives). Provisional — tune in
// playtest. These drive the always-on passive of each playable agent (the active Expertise
// lives in ability.ts):
//   - Chavez "Tough Luck": a rugged bruiser steadily regenerates health while alive and hurt.
//     Health units healed per second (clamped at MAX_HEALTH). No damage-delay tracking — a
//     flat trickle, so it needs no new PlayerState field.
export const CHAVEZ_REGEN_PER_SEC = 8;
//   - Larcin "Merci beaucoup!": a natural sneak. His suspicion RISE (only the rise, not the
//     decay/social bleed) is scaled by this factor (<1 = accrues suspicion slower).
export const LARCIN_SUSPICION_FACTOR = 0.6;

// Objective interaction ranges (PROJECT_BRIEF §2 heist loop). Provisional.
export const INTEL_COLLECT_RANGE = 2.5; // reach to grab intel from a node
export const PACKAGE_GRAB_RANGE = 2.5; // reach to grab the package in the vault
export const EXTRACT_RANGE = 3.0; // reach of an extraction point

// Vault key (opt-in via objective.requiresVaultKey; used by the tutorial level). The vault
// no longer auto-opens on intel — you forge a physical key at a terminal, then grab it.
export const KEY_FORGE_RANGE = 2.5; // reach of the key-forge terminal to create the key
export const KEY_GRAB_RANGE = 2.5; // reach to pick up the forged vault key

// Channeled interactions: pressing [Q]/[E] starts a TIMED action (a progress ring shows while it
// runs) that completes after this many ms. You must hold still — moving past CAST_MOVE_CANCEL
// metres cancels it. Forging the vault key is the slow one.
export const CAST_MS: Record<'intel' | 'disguise' | 'create_key' | 'grab_key' | 'package' | 'depart', number> = {
  intel: 2000,
  disguise: 3000,
  create_key: 10000,
  grab_key: 1500,
  package: 1500,
  depart: 2500,
};
export const CAST_MOVE_CANCEL = 1.2; // metres of drift from the anchor that cancels a channel

// Jump (provisional). Flat-ground vertical hop — no collision/nav yet.
export const JUMP_SPEED = 5.0; // m/s initial upward velocity
export const GRAVITY = 16.0; // m/s^2 downward acceleration

// Social interactions (PROJECT_BRIEF §2b — tier-specific suspicion bleed). Provisional.
export const SOCIAL_RANGE = 2.5; // reach of a social-interaction spot
export const SOCIAL_BLEED = 30; // extra suspicion bled per second while at a MATCHING spot

// Keycards (PROJECT_BRIEF §2b — access route). Provisional.
export const KEYCARD_PICKUP_RANGE = 2.0; // reach to pick up a keycard

// Movement (provisional).
export const WALK_SPEED = 3.0; // m/s — matches an NPC's pace
export const RUN_SPEED = 6.0; // m/s — running is a suspicious act
