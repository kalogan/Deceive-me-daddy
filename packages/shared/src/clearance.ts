// The clearance ladder (PROJECT_BRIEF §2b). Higher tier = more zone access but more
// scrutiny + rarer. VIP/Owner is reserved for the roadmap (kept out of v1 tiers).

export const CLEARANCE_TIERS = ['civilian', 'staff', 'security', 'scientist'] as const;
export type ClearanceTier = (typeof CLEARANCE_TIERS)[number];

/** Numeric rank used for access comparisons. Higher = more access. */
export const CLEARANCE_LEVEL: Record<ClearanceTier, number> = {
  civilian: 0,
  staff: 1,
  security: 2,
  scientist: 3,
};

/** Visual language for tiers (PROJECT_BRIEF review queue — confirm in harness). */
export const TIER_COLOR: Record<ClearanceTier, string> = {
  civilian: '#cfcfcf',
  staff: '#3fae62',
  security: '#3f72ae',
  scientist: '#8a3fae',
};

/**
 * Baseline scrutiny multiplier per tier: rarer/higher disguises draw more eyes, so
 * suspicion accrues faster while wearing them (PROJECT_BRIEF §2b).
 */
export const TIER_SCRUTINY: Record<ClearanceTier, number> = {
  civilian: 1.0,
  staff: 1.2,
  security: 1.6,
  scientist: 2.2,
};

/** Can a disguise of `worn` tier legitimately be in a zone requiring `required`? */
export function canAccess(worn: ClearanceTier, required: ClearanceTier): boolean {
  return CLEARANCE_LEVEL[worn] >= CLEARANCE_LEVEL[required];
}
