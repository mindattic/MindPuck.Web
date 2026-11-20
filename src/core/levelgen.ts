import { DEFAULT_BOT, solveLevel } from './bot.js';
import {
  blobPolygon,
  lPolygon,
  pointPolygonDistance,
  polygonDistance,
  rectPolygon,
  regularPolygon,
  type Polygon,
  type Vec,
} from './geometry.js';
import { ARENA_H, ARENA_W, GOAL_R, PUCK_R, type Level } from './level.js';
import { NavGrid } from './navgrid.js';
import { DEFAULT_PARAMS, type PhysicsParams } from './physics.js';
import { mixSeed, mulberry32, range, type Rng } from './rng.js';

const MAX_ATTEMPTS = 60;
/** Two obstacles either touch or leave at least this much room: the puck plus a margin. */
const MIN_GAP = PUCK_R * 2 + 0.25;
const CUP_INNER = GOAL_R + 0.15;
const CUP_WALL = 0.22;
/** How far the cup's corners reach from the goal's centre. */
const CUP_REACH = (CUP_INNER + CUP_WALL) * Math.SQRT2;

/**
 * Build level number `index` of the run identified by `seed`. Levels get harder as the index
 * grows. Every level returned has been won by the solver bot (see bot.ts), with an unsteady gaze,
 * in every gaze mode, so it is known to be possible; `par`, `parAttract` and `parSteer` are the bot's times.
 */
export function generateLevel(seed: number, index: number, params: PhysicsParams = DEFAULT_PARAMS): Level {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const level = buildCandidate(mulberry32(mixSeed(seed, index, attempt)), seed, index);
    if (verify(level, params, attempt)) return level;
  }
  // Nothing passed (this should not happen): fall back to an open table, which always can be won.
  const open = buildCandidate(mulberry32(mixSeed(seed, index, MAX_ATTEMPTS)), seed, 0);
  open.index = index;
  open.attempts = MAX_ATTEMPTS + 1;
  verify(open, params, MAX_ATTEMPTS);
  return open;
}

/** Route check first (cheap), then the bot actually plays it. Fills in `par` and `attempts`. */
function verify(level: Level, params: PhysicsParams, attempt: number): boolean {
  const grid = new NavGrid(level);
  if (!grid.findPath(level.start, level.goal)) return false;
  // The level has to be winnable every way the game can be played.
  const seed = mixSeed(level.seed, level.index, 1000 + attempt);
  const result = solveLevel(level, params, { ...DEFAULT_BOT, seed, mode: 'repel' }, grid);
  if (!result.solved) return false;
  const pulled = solveLevel(level, params, { ...DEFAULT_BOT, seed, mode: 'attract' }, grid);
  if (!pulled.solved) return false;
  const steered = solveLevel(level, params, { ...DEFAULT_BOT, seed, mode: 'steer' }, grid);
  if (!steered.solved) return false;
  level.par = Math.round(result.time * 10) / 10;
  level.parAttract = Math.round(pulled.time * 10) / 10;
  level.parSteer = Math.round(steered.time * 10) / 10;
  level.attempts = attempt + 1;
  return true;
}

function buildCandidate(rng: Rng, seed: number, index: number): Level {
  const d = index;
  const kind: Level['kind'] = d >= 2 && rng() < 0.5 ? 'cup' : 'zone';
  const flip = rng() < 0.5;
  const goalMargin = kind === 'cup' ? CUP_REACH + 0.15 : GOAL_R + 0.35;
  const start: Vec = { x: range(rng, 1.3, ARENA_W * 0.24), y: range(rng, 1.3, ARENA_H - 1.3) };
  const goalPos: Vec = {
    x: range(rng, ARENA_W * 0.7, ARENA_W - goalMargin),
    y: range(rng, goalMargin, ARENA_H - goalMargin),
  };
  if (flip) {
    start.x = ARENA_W - start.x;
    goalPos.x = ARENA_W - goalPos.x;
  }

  const obstacles: Polygon[] = [];
  let cupAngle = 0;
  if (kind === 'cup') {
    // The opening faces one of eight directions. Early on it faces the puck; later it may not.
    const toward = Math.atan2(start.y - goalPos.y, start.x - goalPos.x);
    const step = Math.PI / 4;
    const turn = d < 4 ? 0 : Math.floor(range(rng, -2, 3));
    cupAngle = (Math.round(toward / step) + turn) * step;
    obstacles.push(...cupWalls(goalPos, cupAngle));
  }

  // Gates: a wall across the table with one gap in it.
  const gates = d < 4 ? 0 : d < 9 ? (rng() < 0.6 ? 1 : 0) : rng() < 0.5 ? 2 : 1;
  for (let i = 0; i < gates; i++) {
    const t = gates === 1 ? range(rng, 0.38, 0.62) : i === 0 ? range(rng, 0.3, 0.4) : range(rng, 0.58, 0.68);
    const x = start.x + (goalPos.x - start.x) * t;
    const half = PUCK_R * Math.max(1.7, 2.6 - d * 0.06);
    const gapY = range(rng, half + 0.6, ARENA_H - half - 0.6);
    const thick = 0.16;
    const top = gapY - half;
    const bottom = gapY + half;
    obstacles.push(rectPolygon(x, top / 2, thick, top / 2));
    obstacles.push(rectPolygon(x, (bottom + ARENA_H) / 2, thick, (ARENA_H - bottom) / 2));
  }

  // Loose obstacles: bars, triangles, polygons, L shapes and rocks.
  const fixed = obstacles.length;
  const wanted = d === 0 ? 0 : Math.min(1 + Math.floor(d * 0.7), 8);
  const goalClear = kind === 'cup' ? CUP_REACH + MIN_GAP : GOAL_R + MIN_GAP;
  const inset = MIN_GAP;
  for (let n = 0; n < wanted; n++) {
    for (let tries = 0; tries < 24; tries++) {
      const shape = randomShape(rng, range(rng, 1.2, ARENA_W - 1.2), range(rng, 1.2, ARENA_H - 1.2));
      if (shape.some((v) => v.x < inset || v.y < inset || v.x > ARENA_W - inset || v.y > ARENA_H - inset)) continue;
      if (pointPolygonDistance(start.x, start.y, shape) < PUCK_R + 1) continue;
      if (pointPolygonDistance(goalPos.x, goalPos.y, shape) < goalClear) continue;
      let fits = true;
      for (let o = 0; fits && o < obstacles.length; o++) {
        const gap = polygonDistance(shape, obstacles[o]);
        // Loose obstacles may overlap each other, but never the cup or a gate.
        if (gap < MIN_GAP && (o < fixed || gap > 0)) fits = false;
      }
      if (!fits) continue;
      obstacles.push(shape);
      break;
    }
  }

  return {
    seed,
    index,
    width: ARENA_W,
    height: ARENA_H,
    puckRadius: PUCK_R,
    start,
    goal: { x: goalPos.x, y: goalPos.y, r: GOAL_R },
    kind,
    cupAngle,
    obstacles,
    par: 0,
    parAttract: 0,
    parSteer: 0,
    attempts: 0,
  };
}

/** Three walls around the goal, leaving the side at `angle` open. */
function cupWalls(goal: Vec, angle: number): Polygon[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const h = CUP_INNER;
  const t = CUP_WALL;
  const wall = (lx: number, ly: number, hw: number, hh: number) =>
    rectPolygon(goal.x + lx * c - ly * s, goal.y + lx * s + ly * c, hw, hh, angle);
  return [
    wall(-(h + t / 2), 0, t / 2, h + t), // back
    wall(-t / 2, -(h + t / 2), h + t / 2, t / 2), // one side
    wall(-t / 2, h + t / 2, h + t / 2, t / 2), // the other side
  ];
}

function randomShape(rng: Rng, x: number, y: number): Polygon {
  const pick = rng();
  const angle = range(rng, 0, Math.PI * 2);
  if (pick < 0.34) return rectPolygon(x, y, range(rng, 0.8, 2.1), range(rng, 0.16, 0.3), angle);
  if (pick < 0.52) return regularPolygon(x, y, range(rng, 0.6, 1.1), 3, angle);
  if (pick < 0.7) return regularPolygon(x, y, range(rng, 0.5, 1), 5 + Math.floor(rng() * 2), angle);
  if (pick < 0.86) return lPolygon(x, y, range(rng, 1, 1.7), range(rng, 0.3, 0.42), angle);
  const radii: number[] = [];
  const base = range(rng, 0.55, 1);
  for (let i = 0; i < 7; i++) radii.push(base * range(rng, 0.75, 1.15));
  return blobPolygon(x, y, radii, angle);
}
