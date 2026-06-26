import {
  EXTRACT_RANGE,
  INTEL_COLLECT_RANGE,
  PACKAGE_GRAB_RANGE,
  type ContentPack,
} from '@deceive/shared';
import { describe, expect, it } from 'vitest';
import { spawnBots, stepBots } from './bots';
import { FixedClock } from './clock';
import { loadObjective } from './objective';
import { createRng } from './rng';
import type { SimDeps, Vec3, WorldState } from './world';
import { createWorld, spawnPlayer, step } from './world';

function makeDeps(seed = 1): SimDeps {
  return { clock: new FixedClock(0), rng: createRng(seed) };
}

// Minimal pack: one far intel node (so a bot has to walk to it), threshold 1 (one node opens
// the vault), package + extraction far apart, one spawn point.
function makePack(): ContentPack {
  return {
    intelNodes: [{ id: 'n1', position: [30, 0, 0], zoneId: 'z', intelValue: 1 }],
    objective: {
      packagePosition: [60, 0, 0],
      intelRequiredToOpenVault: 1,
      extractionPoints: [[100, 0, 0]],
    },
    spawnPoints: [{ position: [0, 0, 0], team: 0 }],
  } as unknown as ContentPack;
}

function loadedWorld(): WorldState {
  const world = createWorld();
  world.pack = makePack();
  loadObjective(world, world.pack);
  return world;
}

function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('stepBots — intel pursuit', () => {
  it('a bot with no intel steers toward the nearest intel node and gets closer', () => {
    const world = loadedWorld();
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 0, y: 0, z: 0 }, true);
    const node: Vec3 = { x: 30, y: 0, z: 0 };

    stepBots(world, makeDeps());
    // Velocity points roughly toward the node (positive X dominant).
    expect(bot.vel.x).toBeGreaterThan(0);

    const startDist = distXZ(bot.pos, node);
    for (let i = 0; i < 30; i += 1) step(world, makeDeps());
    expect(distXZ(bot.pos, node)).toBeLessThan(startDist);
  });

  it('collects the node when in range (intel rises, node consumed, vault opens)', () => {
    const world = loadedWorld();
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 29, y: 0, z: 0 }, true);

    // Within INTEL_COLLECT_RANGE of (30,0,0) already — one step should collect.
    expect(distXZ(bot.pos, { x: 30, y: 0, z: 0 })).toBeLessThanOrEqual(INTEL_COLLECT_RANGE);
    stepBots(world, makeDeps());

    expect(bot.intel).toBe(1);
    expect(world.objective.collectedIntel.has('n1')).toBe(true);
    expect(world.objective.vaultOpen).toBe(true);
  });
});

describe('stepBots — package grab', () => {
  it('once vault is open + package loose, a bot moves toward the package and grabs it', () => {
    const world = loadedWorld();
    world.objective.vaultOpen = true; // pretend intel was gathered
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 0, y: 0, z: 0 }, true);
    const pkg: Vec3 = { x: 60, y: 0, z: 0 };

    stepBots(world, makeDeps());
    expect(bot.vel.x).toBeGreaterThan(0); // heading toward the package

    // Place it in range and step: it should grab.
    bot.pos = { x: 59, y: 0, z: 0 };
    expect(distXZ(bot.pos, pkg)).toBeLessThanOrEqual(PACKAGE_GRAB_RANGE);
    stepBots(world, makeDeps());

    expect(bot.carrying).toBe(true);
    expect(world.objective.packageHolderId).toBe('bot-0');
  });
});

describe('stepBots — carry to extraction', () => {
  it('a carrier moves toward the nearest extraction point', () => {
    const world = loadedWorld();
    world.objective.vaultOpen = true;
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 60, y: 0, z: 0 }, true);
    // Grab the package directly via the step (bot is on it).
    stepBots(world, makeDeps());
    expect(bot.carrying).toBe(true);

    const exit: Vec3 = { x: 100, y: 0, z: 0 };
    const startDist = distXZ(bot.pos, exit);
    for (let i = 0; i < 20; i += 1) step(world, makeDeps());
    expect(distXZ(bot.pos, exit)).toBeLessThan(startDist);
  });

  it('a carrier reaching the extraction point wins for its team', () => {
    const world = loadedWorld();
    world.objective.vaultOpen = true;
    const bot = spawnPlayer(world, 'bot-0', 2, { x: 60, y: 0, z: 0 }, true);
    // Run the full sim until the carrier extracts (or a safe step cap).
    for (let i = 0; i < 200 && world.objective.winningTeam === -1; i += 1) {
      step(world, makeDeps());
    }
    expect(world.objective.winningTeam).toBe(2);
    expect(distXZ(bot.pos, { x: 100, y: 0, z: 0 })).toBeLessThanOrEqual(EXTRACT_RANGE + 1);
  });
});

describe('stepBots — fight', () => {
  it('faces a revealed enemy in range and can fire (damages it over several ticks)', () => {
    const world = loadedWorld();
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 0, y: 0, z: 0 }, true);
    const enemy = spawnPlayer(world, 'enemy', 1, { x: 5, y: 0, z: 0 }, false);
    enemy.phase = 'revealed'; // cover blown → always a target

    const startHealth = enemy.health;
    for (let i = 0; i < 40; i += 1) {
      enemy.phase = 'revealed'; // keep it a valid target each tick
      stepBots(world, makeDeps(7));
    }
    // The bot faced toward +X (sin(yaw) ~ 1) and fired at least once.
    expect(Math.sin(bot.yaw)).toBeGreaterThan(0.9);
    expect(enemy.health).toBeLessThan(startHealth);
  });
});

describe('stepBots — incapacitated bots do nothing', () => {
  it('a downed bot keeps zero velocity', () => {
    const world = loadedWorld();
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 0, y: 0, z: 0 }, true);
    bot.phase = 'downed';
    bot.vel = { x: 0, y: 0, z: 0 };
    stepBots(world, makeDeps());
    expect(bot.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('an out bot is left untouched', () => {
    const world = loadedWorld();
    const bot = spawnPlayer(world, 'bot-0', 0, { x: 0, y: 0, z: 0 }, true);
    bot.phase = 'out';
    const frozen = { x: 1.23, y: 0, z: -4.56 };
    bot.vel = { ...frozen };
    stepBots(world, makeDeps());
    expect(bot.vel).toEqual(frozen);
  });
});

describe('stepBots — non-bots ignored', () => {
  it('does not steer human players', () => {
    const world = loadedWorld();
    const human = spawnPlayer(world, 'human', 0, { x: 0, y: 0, z: 0 }, false);
    stepBots(world, makeDeps());
    expect(human.vel).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('stepBots — determinism + spawnBots', () => {
  it('spawnBots fills slots across teams at the spawn point', () => {
    const world = loadedWorld();
    spawnBots(world, makeDeps(), 4);
    expect(world.players.size).toBe(4);
    const teams = [...world.players.values()].map((p) => p.team).sort();
    expect(teams).toEqual([0, 1, 2, 3]);
    for (const p of world.players.values()) expect(p.isBot).toBe(true);
  });

  it('two worlds with the same seed + steps produce identical bot positions', () => {
    function run(): WorldState {
      const world = loadedWorld();
      spawnBots(world, makeDeps(42), 4);
      const deps = makeDeps(42);
      for (let i = 0; i < 80; i += 1) step(world, deps);
      return world;
    }
    const a = run();
    const b = run();
    for (const id of a.players.keys()) {
      expect(b.players.get(id)?.pos).toEqual(a.players.get(id)?.pos);
      expect(b.players.get(id)?.yaw).toBe(a.players.get(id)?.yaw);
    }
  });
});
