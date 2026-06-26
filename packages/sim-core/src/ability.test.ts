// Tests for the signature-Expertise framework (PROJECT_BRIEF §2 — the agents). Covers the
// timing/cooldown core + the per-agent effect predicates, plus their integration with combat
// (untargetable while protected) and detection (a hard reveal breaks Adieu's cloak).
import { AGENTS_BY_ID, type AgentId } from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import {
  abilityCooldownRemaining,
  endAbility,
  isAbilityActive,
  isAbilityReady,
  isCloaked,
  isInvulnerable,
  stepAbility,
  triggerAbility,
} from './ability';
import { FixedClock } from './clock';
import { resolveFire } from './combat';
import { hardReveal } from './detection';
import type { SimDeps } from './world';
import { createWorld, spawnPlayer } from './world';
import type { Rng } from './rng';

function makeDeps(clock: FixedClock): SimDeps {
  return { clock, rng: { next: () => 0 } as unknown as Rng };
}

function setup(agentId: AgentId = 'larcin') {
  const clock = new FixedClock(0);
  const deps = makeDeps(clock);
  const world = createWorld();
  const p = spawnPlayer(world, 'p1', 0, { x: 0, y: 0, z: 0 }, false, agentId);
  return { world, deps, clock, p };
}

describe('triggerAbility', () => {
  it('arms the active window + cooldown from the agent catalog', () => {
    const { world, deps, clock, p } = setup('larcin');
    clock.advance(1000);
    const agent = AGENTS_BY_ID.larcin;
    expect(triggerAbility(world, 'p1', deps)).toBe(true);
    expect(p.abilityActiveUntilMs).toBe(1000 + agent.abilityDurationMs);
    expect(p.abilityReadyAtMs).toBe(1000 + agent.abilityCooldownMs);
    expect(isAbilityActive(p, clock.now())).toBe(true);
  });

  it('refuses to re-trigger while on cooldown', () => {
    const { world, deps, clock, p } = setup('chavez');
    expect(triggerAbility(world, 'p1', deps)).toBe(true);
    // Past the active window but still inside the (longer) cooldown.
    clock.advance(AGENTS_BY_ID.chavez.abilityDurationMs + 100);
    stepAbility(world, deps);
    expect(isAbilityActive(p, clock.now())).toBe(false);
    expect(isAbilityReady(p, clock.now())).toBe(false);
    expect(triggerAbility(world, 'p1', deps)).toBe(false);
  });

  it('is ready again once the cooldown elapses', () => {
    const { world, deps, clock } = setup('chavez');
    expect(triggerAbility(world, 'p1', deps)).toBe(true);
    clock.advance(AGENTS_BY_ID.chavez.abilityCooldownMs);
    expect(triggerAbility(world, 'p1', deps)).toBe(true);
  });

  it('no-ops for a missing or downed player', () => {
    const { world, deps, p } = setup('larcin');
    expect(triggerAbility(world, 'ghost', deps)).toBe(false);
    p.phase = 'downed';
    expect(triggerAbility(world, 'p1', deps)).toBe(false);
  });

  it('reports cooldown remaining, ticking down to zero', () => {
    const { world, deps, clock, p } = setup('larcin');
    triggerAbility(world, 'p1', deps);
    const cd = AGENTS_BY_ID.larcin.abilityCooldownMs;
    expect(abilityCooldownRemaining(p, clock.now())).toBe(cd);
    clock.advance(cd);
    expect(abilityCooldownRemaining(p, clock.now())).toBe(0);
  });
});

describe('stepAbility', () => {
  it('expires the active window once it lapses, leaving cooldown intact', () => {
    const { world, deps, clock, p } = setup('larcin');
    triggerAbility(world, 'p1', deps);
    clock.advance(AGENTS_BY_ID.larcin.abilityDurationMs);
    stepAbility(world, deps);
    expect(p.abilityActiveUntilMs).toBe(0);
    expect(p.abilityReadyAtMs).toBeGreaterThan(0); // still cooling down
  });

  it('leaves a still-active window untouched', () => {
    const { world, deps, clock, p } = setup('larcin');
    triggerAbility(world, 'p1', deps);
    clock.advance(AGENTS_BY_ID.larcin.abilityDurationMs - 1);
    stepAbility(world, deps);
    expect(isAbilityActive(p, clock.now())).toBe(true);
  });
});

describe('effect predicates', () => {
  it('isCloaked is true only for an active Larcin', () => {
    const { world, deps, clock, p } = setup('larcin');
    expect(isCloaked(p, clock.now())).toBe(false);
    triggerAbility(world, 'p1', deps);
    expect(isCloaked(p, clock.now())).toBe(true);
    expect(isInvulnerable(p, clock.now())).toBe(false);
  });

  it('isInvulnerable is true only for an active Chavez', () => {
    const { world, deps, clock, p } = setup('chavez');
    triggerAbility(world, 'p1', deps);
    expect(isInvulnerable(p, clock.now())).toBe(true);
    expect(isCloaked(p, clock.now())).toBe(false);
  });

  it("Squire's Expertise grants neither cloak nor invulnerability (it's a recon read)", () => {
    const { world, deps, clock, p } = setup('squire');
    triggerAbility(world, 'p1', deps);
    expect(isCloaked(p, clock.now())).toBe(false);
    expect(isInvulnerable(p, clock.now())).toBe(false);
  });

  it('endAbility ends the active window but keeps the cooldown', () => {
    const { world, deps, clock, p } = setup('larcin');
    triggerAbility(world, 'p1', deps);
    endAbility(p);
    expect(isAbilityActive(p, clock.now())).toBe(false);
    expect(isAbilityReady(p, clock.now())).toBe(false);
  });
});

describe('integration with combat + detection', () => {
  /** Put `target` directly in front of `shooter` (shooter faces +Z toward +Z target). */
  function duel(targetAgent: AgentId) {
    const clock = new FixedClock(0);
    const deps = makeDeps(clock);
    const world = createWorld();
    const shooter = spawnPlayer(world, 'a', 0, { x: 0, y: 0, z: 0 }, false, 'squire');
    shooter.yaw = 0; // forward = +Z
    const target = spawnPlayer(world, 'b', 1, { x: 0, y: 0, z: 5 }, false, targetAgent);
    return { world, deps, clock, shooter, target };
  }

  it('a cloaked Larcin cannot be shot', () => {
    const { world, deps, target } = duel('larcin');
    triggerAbility(world, 'b', deps);
    resolveFire(world, 'a', deps);
    expect(target.health).toBe(100);
  });

  it('an invulnerable Chavez takes no damage', () => {
    const { world, deps, target } = duel('chavez');
    triggerAbility(world, 'b', deps);
    resolveFire(world, 'a', deps);
    expect(target.health).toBe(100);
  });

  it('an unprotected target is hit normally', () => {
    const { world, deps, target } = duel('squire');
    resolveFire(world, 'a', deps);
    expect(target.health).toBeLessThan(100);
  });

  it('firing breaks the shooter’s own Adieu cloak (hard reveal ends it)', () => {
    const { world, deps, clock, shooter } = duel('larcin');
    // Make the shooter the Larcin for this check.
    shooter.agentId = 'larcin';
    triggerAbility(world, 'a', deps);
    expect(isCloaked(shooter, clock.now())).toBe(true);
    hardReveal(world, 'a', deps);
    expect(isCloaked(shooter, clock.now())).toBe(false);
    expect(shooter.phase).toBe('revealed');
  });
});
