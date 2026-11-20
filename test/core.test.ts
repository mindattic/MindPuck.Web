import { describe, expect, it } from 'vitest';
import {
  ARENA_H,
  ARENA_W,
  DEFAULT_BOT,
  DEFAULT_PARAMS,
  NavGrid,
  PUCK_R,
  PuckSim,
  closestOnSegment,
  generateLevel,
  lPolygon,
  mixSeed,
  mulberry32,
  pointInPolygon,
  pointPolygonDistance,
  polygonDistance,
  pullAccel,
  rectPolygon,
  repelAccel,
  solveLevel,
  steerAccel,
  winRadius,
  type Level,
  type Polygon,
} from '../src/core/index.js';

function emptyLevel(obstacles: Polygon[] = []): Level {
  return {
    seed: 0,
    index: 0,
    width: ARENA_W,
    height: ARENA_H,
    puckRadius: PUCK_R,
    start: { x: 3, y: 4.5 },
    goal: { x: 13, y: 4.5, r: 1.1 },
    kind: 'zone',
    cupAngle: 0,
    obstacles,
    par: 0,
    parAttract: 0,
    parSteer: 0,
    attempts: 0,
  };
}

function repelSim(): PuckSim {
  const sim = new PuckSim(emptyLevel());
  sim.mode = 'repel';
  return sim;
}

describe('magnetic mode', () => {
  it('is the default', () => {
    expect(new PuckSim(emptyLevel()).mode).toBe('attract');
  });

  it('pulls nothing at the gaze point and no more than pullStrength far away', () => {
    expect(pullAccel(0, DEFAULT_PARAMS)).toBe(0);
    expect(pullAccel(DEFAULT_PARAMS.pullSoftness / 2, DEFAULT_PARAMS)).toBeCloseTo(DEFAULT_PARAMS.pullStrength / 2, 9);
    expect(pullAccel(50, DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.pullStrength);
  });

  it('brings the puck to the point being looked at and holds it there', () => {
    const sim = new PuckSim(emptyLevel());
    const look = { x: 8, y: 2.5 };
    for (let i = 0; i < 120 * 8; i++) sim.step(look);
    expect(Math.hypot(sim.pos.x - look.x, sim.pos.y - look.y)).toBeLessThan(0.05);
    expect(Math.hypot(sim.vel.x, sim.vel.y)).toBeLessThan(0.05);
  });

  it('wins by looking at the pad', () => {
    const level = emptyLevel();
    const sim = new PuckSim(level);
    for (let i = 0; i < 120 * 15 && !sim.won; i++) sim.step(level.goal);
    expect(sim.won).toBe(true);
  });

  it('can be switched to the repulsor', () => {
    const sim = new PuckSim(emptyLevel());
    const look = { x: 2, y: 4.5 };
    sim.step(look);
    expect(sim.vel.x).toBeLessThan(0);
    sim.reset();
    sim.mode = 'repel';
    sim.step(look);
    expect(sim.vel.x).toBeGreaterThan(0);
  });

  it('gives every generated level a magnetic par, and the bot wins that way again', () => {
    for (let index = 0; index < 12; index++) {
      const level = generateLevel(31, index);
      expect(level.parAttract).toBeGreaterThan(0);
      expect(solveLevel(level, DEFAULT_PARAMS, { ...DEFAULT_BOT, mode: 'attract', seed: 70 + index }).solved).toBe(true);
    }
  });
});

describe('steer mode', () => {
  const p = DEFAULT_PARAMS;

  it('does nothing at the centre of the puck or far from it, and is full at its edge', () => {
    expect(steerAccel(0, PUCK_R, p)).toBe(0);
    expect(steerAccel(PUCK_R * p.steerFull, PUCK_R, p)).toBeCloseTo(p.steerStrength, 9);
    expect(steerAccel(PUCK_R * p.steerRange, PUCK_R, p)).toBe(p.steerStrength);
    expect(steerAccel(PUCK_R * p.steerRange * 1.5 + 1e-9, PUCK_R, p)).toBe(0);
    expect(steerAccel(20, PUCK_R, p)).toBe(0);
  });

  it('drives the puck toward the side being looked at', () => {
    const sim = new PuckSim(emptyLevel());
    sim.mode = 'steer';
    for (let i = 0; i < 30; i++) sim.step({ x: sim.pos.x + PUCK_R, y: sim.pos.y });
    expect(sim.vel.x).toBeGreaterThan(0);
    expect(Math.abs(sim.vel.y)).toBeLessThan(1e-9);
    sim.reset();
    for (let i = 0; i < 30; i++) sim.step({ x: sim.pos.x, y: sim.pos.y - PUCK_R });
    expect(sim.vel.y).toBeLessThan(0);
  });

  it('leaves the puck alone when the gaze is on its centre', () => {
    const sim = new PuckSim(emptyLevel());
    sim.mode = 'steer';
    for (let i = 0; i < 120; i++) sim.step({ x: sim.pos.x, y: sim.pos.y });
    expect(Math.hypot(sim.vel.x, sim.vel.y)).toBe(0);
  });

  it('gives every generated level a steer par, and the bot wins that way again', () => {
    for (let index = 0; index < 12; index++) {
      const level = generateLevel(41, index);
      expect(level.parSteer).toBeGreaterThan(0);
      expect(solveLevel(level, DEFAULT_PARAMS, { ...DEFAULT_BOT, mode: 'steer', seed: 90 + index }).solved).toBe(true);
    }
  });
});

describe('rng', () => {
  it('is deterministic and stays in 0..1', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces the reference sequence the C# and C++ ports must match', () => {
    const r = mulberry32(1);
    expect([r(), r(), r()].map((v) => Math.floor(v * 4294967296))).toEqual([2693262067, 11749833, 2265367787]);
    expect(mixSeed(1, 2, 3)).toBe((Math.imul(1, 73856093) ^ Math.imul(2, 19349663) ^ Math.imul(3, 83492791)) >>> 0);
  });
});

describe('geometry', () => {
  it('finds the closest point on a segment, ends included', () => {
    expect(closestOnSegment(1, 5, 0, 0, 4, 0)).toEqual({ x: 1, y: 0 });
    expect(closestOnSegment(-3, 2, 0, 0, 4, 0)).toEqual({ x: 0, y: 0 });
    expect(closestOnSegment(9, 2, 0, 0, 4, 0)).toEqual({ x: 4, y: 0 });
  });

  it('knows the inside of a concave polygon from its notch', () => {
    const l = lPolygon(0, 0, 2, 0.5);
    expect(pointInPolygon(-0.8, -0.8, l)).toBe(true);
    expect(pointInPolygon(0.6, 0.6, l)).toBe(false);
    expect(pointPolygonDistance(-0.8, -0.8, l)).toBe(0);
    expect(pointPolygonDistance(0.6, 0.6, l)).toBeGreaterThan(0);
  });

  it('measures the gap between polygons, and zero when they overlap', () => {
    const a = rectPolygon(0, 0, 1, 1);
    expect(polygonDistance(a, rectPolygon(3, 0, 1, 1))).toBeCloseTo(1, 9);
    expect(polygonDistance(a, rectPolygon(1.5, 0, 1, 1))).toBe(0);
    expect(polygonDistance(a, rectPolygon(0, 0, 0.2, 0.2))).toBe(0);
  });
});

describe('repulsion', () => {
  const p = DEFAULT_PARAMS;

  it('is zero at dead centre and beyond the range', () => {
    expect(repelAccel(0, PUCK_R, p)).toBe(0);
    expect(repelAccel(p.repelRange, PUCK_R, p)).toBe(0);
    expect(repelAccel(p.repelRange + 5, PUCK_R, p)).toBe(0);
  });

  it('gets weaker with distance once outside the dead zone', () => {
    let previous = Infinity;
    for (let d = p.deadZone * PUCK_R; d < p.repelRange; d += 0.1) {
      const a = repelAccel(d, PUCK_R, p);
      expect(a).toBeLessThan(previous);
      previous = a;
    }
  });

  it('pushes the puck directly away from the gaze point', () => {
    const sim = repelSim();
    for (let i = 0; i < 60; i++) sim.step({ x: 2, y: 4.5 });
    expect(sim.vel.x).toBeGreaterThan(0);
    expect(Math.abs(sim.vel.y)).toBeLessThan(1e-9);
    sim.reset();
    for (let i = 0; i < 60; i++) sim.step({ x: 3, y: 6 });
    expect(sim.vel.y).toBeLessThan(0);
  });

  it('pushes harder the closer the gaze is', () => {
    const near = repelSim();
    const far = repelSim();
    near.step({ x: 2.2, y: 4.5 });
    far.step({ x: 0.5, y: 4.5 });
    expect(near.vel.x).toBeGreaterThan(far.vel.x);
  });
});

describe('kinematics', () => {
  it('glides and slows down under drag with no gaze', () => {
    const sim = new PuckSim(emptyLevel());
    sim.vel.x = 4;
    for (let i = 0; i < 120; i++) sim.step(null);
    expect(sim.vel.x).toBeLessThan(4);
    expect(sim.vel.x).toBeGreaterThan(1.5);
    for (let i = 0; i < 120 * 30; i++) sim.step(null);
    expect(Math.hypot(sim.vel.x, sim.vel.y)).toBe(0);
  });

  it('never exceeds the speed limit', () => {
    const sim = repelSim();
    for (let i = 0; i < 2000; i++) {
      sim.step({ x: sim.pos.x - 0.3, y: sim.pos.y });
      expect(Math.hypot(sim.vel.x, sim.vel.y)).toBeLessThanOrEqual(DEFAULT_PARAMS.maxSpeed + 1e-9);
    }
  });

  it('advances in whole fixed steps', () => {
    const sim = new PuckSim(emptyLevel());
    expect(sim.advance(DEFAULT_PARAMS.dt * 3.5, null)).toBe(3);
    expect(sim.advance(DEFAULT_PARAMS.dt * 0.6, null)).toBe(1);
  });
});

describe('collisions', () => {
  it('bounces off the table edge and loses a little speed', () => {
    const sim = new PuckSim(emptyLevel());
    sim.vel.x = -8;
    let bounced = false;
    for (let i = 0; i < 240 && !bounced; i++) {
      sim.step(null);
      bounced = sim.vel.x > 0;
    }
    expect(bounced).toBe(true);
    expect(sim.vel.x).toBeLessThan(8 * DEFAULT_PARAMS.restitution + 1e-9);
    expect(sim.pos.x).toBeGreaterThanOrEqual(PUCK_R - 1e-9);
  });

  it('reflects off a wall face at the mirrored angle', () => {
    const sim = new PuckSim(emptyLevel([rectPolygon(8, 4.5, 0.2, 4)]));
    sim.vel.x = 6;
    sim.vel.y = 2;
    for (let i = 0; i < 240 && sim.vel.x > 0; i++) sim.step(null);
    expect(sim.vel.x).toBeLessThan(0);
    expect(sim.vel.y).toBeGreaterThan(0);
    expect(sim.pos.x).toBeLessThanOrEqual(7.8 - PUCK_R + 1e-6);
  });

  it('deflects off a corner along the line from the corner to the puck', () => {
    // Aim the puck so that its lower edge clips the top-left corner of a block.
    const block = rectPolygon(9, 6, 1, 1);
    const sim = new PuckSim(emptyLevel([block]));
    sim.pos = { x: 5, y: 5 - PUCK_R * 0.6 };
    sim.vel = { x: 6, y: 0 };
    for (let i = 0; i < 240 && sim.vel.y === 0; i++) sim.step(null);
    expect(sim.vel.y).toBeLessThan(0);
    expect(sim.vel.x).toBeGreaterThan(0);
  });

  it('never lets the puck into an obstacle or off the table, however it is driven', () => {
    const level = generateLevel(5, 10);
    const sim = new PuckSim(level);
    sim.mode = 'repel';
    const rng = mulberry32(9);
    let gaze = { x: 8, y: 4.5 };
    for (let i = 0; i < 120 * 60; i++) {
      if (i % 20 === 0) gaze = { x: sim.pos.x + (rng() - 0.5) * 2, y: sim.pos.y + (rng() - 0.5) * 2 };
      sim.step(gaze);
      expect(sim.pos.x).toBeGreaterThanOrEqual(PUCK_R - 1e-6);
      expect(sim.pos.x).toBeLessThanOrEqual(ARENA_W - PUCK_R + 1e-6);
      expect(sim.pos.y).toBeGreaterThanOrEqual(PUCK_R - 1e-6);
      expect(sim.pos.y).toBeLessThanOrEqual(ARENA_H - PUCK_R + 1e-6);
      for (const poly of level.obstacles) {
        expect(pointPolygonDistance(sim.pos.x, sim.pos.y, poly)).toBeGreaterThan(PUCK_R - 0.02);
      }
    }
  });
});

describe('winning', () => {
  it('needs the puck to rest on the pad, not fly across it', () => {
    const level = emptyLevel();
    const sim = new PuckSim(level);
    sim.pos = { x: level.goal.x - 3, y: level.goal.y };
    sim.vel = { x: 13, y: 0 };
    for (let i = 0; i < 40; i++) sim.step(null);
    expect(sim.won).toBe(false);

    sim.reset();
    sim.pos = { x: level.goal.x, y: level.goal.y };
    for (let i = 0; i < Math.ceil(DEFAULT_PARAMS.dwell / DEFAULT_PARAMS.dt) + 2; i++) sim.step(null);
    expect(sim.won).toBe(true);
  });

  it('has a win radius that keeps most of the puck on the pad', () => {
    const level = emptyLevel();
    expect(winRadius(level)).toBeLessThan(level.goal.r);
    expect(winRadius(level)).toBeGreaterThan(level.puckRadius);
  });
});

describe('navgrid', () => {
  it('finds a way round a wall with a gap and none through a sealed one', () => {
    const gap = emptyLevel([rectPolygon(8, 2, 0.2, 2), rectPolygon(8, 7.5, 0.2, 1.5)]);
    const path = new NavGrid(gap).findPath(gap.start, gap.goal);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: gap.goal.x, y: gap.goal.y });

    const sealed = emptyLevel([rectPolygon(8, 4.5, 0.2, 4.5)]);
    expect(new NavGrid(sealed).findPath(sealed.start, sealed.goal)).toBeNull();
  });

  it('refuses a gap narrower than the puck', () => {
    const tight = emptyLevel([rectPolygon(8, 2, 0.2, 2.2), rectPolygon(8, 7, 0.2, 2.2)]);
    expect(new NavGrid(tight).findPath(tight.start, tight.goal)).toBeNull();
  });
});

describe('level generation', () => {
  it('gives the same level for the same seed and index', () => {
    expect(generateLevel(7, 6)).toEqual(generateLevel(7, 6));
  });

  it('gives different levels for different seeds', () => {
    expect(generateLevel(7, 6)).not.toEqual(generateLevel(8, 6));
  });

  it('starts with an open table and adds obstacles as the index grows', () => {
    expect(generateLevel(3, 0).obstacles).toHaveLength(0);
    expect(generateLevel(3, 12).obstacles.length).toBeGreaterThan(3);
  });

  it('keeps the start and the goal clear of every obstacle', () => {
    for (let index = 0; index < 20; index++) {
      const level = generateLevel(11, index);
      for (const poly of level.obstacles) {
        expect(pointPolygonDistance(level.start.x, level.start.y, poly)).toBeGreaterThan(PUCK_R);
        expect(pointPolygonDistance(level.goal.x, level.goal.y, poly)).toBeGreaterThan(PUCK_R);
      }
    }
  });

  it('only returns levels the solver has won, and they stay winnable with other gaze noise', () => {
    for (let index = 0; index < 20; index++) {
      const level = generateLevel(21, index);
      expect(level.par).toBeGreaterThan(0);
      expect(level.attempts).toBeGreaterThan(0);
      expect(level.attempts).toBeLessThanOrEqual(60);
      const again = solveLevel(level, DEFAULT_PARAMS, { ...DEFAULT_BOT, seed: 500 + index });
      expect(again.solved).toBe(true);
    }
  });
});

describe('solver', () => {
  it('fails on a level whose goal is walled in', () => {
    const sealed = emptyLevel([rectPolygon(8, 4.5, 0.2, 4.5)]);
    expect(solveLevel(sealed, DEFAULT_PARAMS, { ...DEFAULT_BOT, timeLimit: 10 }).solved).toBe(false);
  });

  it('still wins with three times the usual gaze error', () => {
    const level = generateLevel(2, 8);
    expect(solveLevel(level, DEFAULT_PARAMS, { ...DEFAULT_BOT, noise: 1.2, seed: 4 }).solved).toBe(true);
  });
});
