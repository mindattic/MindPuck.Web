import type { Vec } from './geometry.js';
import type { Level } from './level.js';
import { NavGrid } from './navgrid.js';
import { DEFAULT_PARAMS, PuckSim, repelAccel, winRadius, type GazeMode, type PhysicsParams } from './physics.js';

/** Steer mode: how far from the centre of the puck the bot looks, in puck radii. Far enough that its unsteady gaze still points the right way. */
const STEER_STANDOFF = 2.6;
import { gaussian, mulberry32, type Rng } from './rng.js';

export interface BotOptions {
  /** Gaze error, as a standard deviation in table units. A calibrated webcam is around 0.3 to 0.6. */
  noise: number;
  /** How slowly the gaze error wanders, in seconds. */
  noiseTime: number;
  /** How long the eyes take to reach a new point, in seconds. */
  lag: number;
  /** The bot gives up after this many simulated seconds. */
  timeLimit: number;
  /** The speed the bot tries to travel at. */
  cruise: number;
  seed: number;
  /** Which way the gaze acts in the game the bot is playing. */
  mode: GazeMode;
}

export const DEFAULT_BOT: BotOptions = { noise: 0.4, noiseTime: 0.3, lag: 0.12, timeLimit: 75, cruise: 3.2, seed: 1, mode: 'repel' };

const DECIDE_EVERY = 4; // simulation steps between decisions: 30 a second at 120 steps a second
const REPLAN_EVERY = 60; // simulation steps between route searches: twice a second
const MIN_STANDOFF = 0.8;

/**
 * A stand-in player. It finds a route, then steers the puck along it using nothing but a gaze
 * point, with the unsteadiness and delay of a real eye tracker. If it can win a level, a person can.
 */
export class SolverBot {
  /** Where the bot is looking, noise included: what the simulation is given. */
  readonly gaze: Vec;
  /** The route it is following, for drawing. */
  path: Vec[] = [];

  private readonly grid: NavGrid;
  private readonly rng: Rng;
  private readonly aim: Vec;
  private readonly eye: Vec;
  private readonly wobble: Vec = { x: 0, y: 0 };
  private target: Vec;
  private tick = 0;

  constructor(
    private readonly level: Level,
    private readonly params: PhysicsParams = DEFAULT_PARAMS,
    private readonly options: BotOptions = DEFAULT_BOT,
    grid?: NavGrid,
  ) {
    this.grid = grid ?? new NavGrid(level);
    this.rng = mulberry32(options.seed);
    this.target = { x: level.goal.x, y: level.goal.y };
    this.aim = this.farCorner(level.start);
    this.eye = { x: this.aim.x, y: this.aim.y };
    this.gaze = { x: this.aim.x, y: this.aim.y };
  }

  /** The corner of the table farthest from a point: where to look to stop pushing. */
  private farCorner(from: Vec): Vec {
    return {
      x: from.x < this.level.width / 2 ? this.level.width - 0.2 : 0.2,
      y: from.y < this.level.height / 2 ? this.level.height - 0.2 : 0.2,
    };
  }

  /** Call once per simulation step, before stepping. Returns the gaze point to apply. */
  update(sim: PuckSim): Vec {
    const dt = this.params.dt;
    if (this.tick % REPLAN_EVERY === 0) this.replan(sim.pos);
    if (this.tick % DECIDE_EVERY === 0) this.decide(sim);
    this.tick++;

    // The eye travels toward where the bot wants to look, and the tracker's error wanders around it.
    const follow = 1 - Math.exp(-dt / this.options.lag);
    this.eye.x += (this.aim.x - this.eye.x) * follow;
    this.eye.y += (this.aim.y - this.eye.y) * follow;
    const tau = this.options.noiseTime;
    const kick = this.options.noise * Math.sqrt((2 * dt) / tau);
    this.wobble.x += (-this.wobble.x / tau) * dt + kick * gaussian(this.rng);
    this.wobble.y += (-this.wobble.y / tau) * dt + kick * gaussian(this.rng);
    this.gaze.x = this.eye.x + this.wobble.x;
    this.gaze.y = this.eye.y + this.wobble.y;
    return this.gaze;
  }

  private replan(from: Vec): void {
    const path = this.grid.findPath(from, this.level.goal);
    if (!path || path.length === 0) return;
    this.path = path;
    // Head for the farthest point on the route that can be reached in a straight line.
    let pick = path[Math.min(1, path.length - 1)];
    for (let i = path.length - 1; i >= 1; i--) {
      if (this.grid.lineClear(from, path[i])) {
        pick = path[i];
        break;
      }
    }
    this.target = pick;
  }

  private decide(sim: PuckSim): void {
    const lv = this.level;
    const p = this.params;
    const pos = sim.pos;
    const vel = sim.vel;
    const toGoal = Math.hypot(lv.goal.x - pos.x, lv.goal.y - pos.y);
    const speed = Math.hypot(vel.x, vel.y);

    // Magnetic: simply look where the puck should go next. The pull does the rest.
    if (this.options.mode === 'attract') {
      this.aim.x = this.target.x;
      this.aim.y = this.target.y;
      return;
    }

    // Sitting on the pad: look away and let it settle.
    if (toGoal < winRadius(lv) * 0.7 && speed < p.restSpeed * 0.8) {
      const corner = this.farCorner(pos);
      this.aim.x = corner.x;
      this.aim.y = corner.y;
      return;
    }

    let tx = this.target.x - pos.x;
    let ty = this.target.y - pos.y;
    const td = Math.hypot(tx, ty);
    if (td > 1e-6) {
      tx /= td;
      ty /= td;
    }
    const finalLeg = Math.hypot(this.target.x - lv.goal.x, this.target.y - lv.goal.y) < 0.3;
    // Cruise along the route; on the last leg, slow down so as to arrive rather than fly through.
    const wanted = finalLeg ? Math.min(this.options.cruise, 1.3 * td) : this.options.cruise;
    let ax = (tx * wanted - vel.x) * 3;
    let ay = (ty * wanted - vel.y) * 3;
    let a = Math.hypot(ax, ay);

    // Steer: look at the side of the puck it should accelerate toward, or straight at it to let it be.
    if (this.options.mode === 'steer') {
      if (a < 0.6) {
        this.aim.x = pos.x;
        this.aim.y = pos.y;
      } else {
        const reach = lv.puckRadius * STEER_STANDOFF;
        this.aim.x = pos.x + (ax / a) * reach;
        this.aim.y = pos.y + (ay / a) * reach;
      }
      return;
    }
    if (a < 0.08) {
      const corner = this.farCorner(pos);
      this.aim.x = corner.x;
      this.aim.y = corner.y;
      return;
    }
    ax /= a;
    ay /= a;
    a = Math.min(a, 18);

    // Find the standoff distance whose push matches the acceleration wanted. The push falls with
    // distance, so a bisection finds it.
    let lo = MIN_STANDOFF;
    let hi = p.repelRange;
    if (repelAccel(lo, lv.puckRadius, p) <= a) {
      hi = lo;
    } else {
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (repelAccel(mid, lv.puckRadius, p) > a) lo = mid;
        else hi = mid;
      }
    }
    let d = hi;

    // The gaze point sits behind the puck, opposite the way it should accelerate. It has to be on
    // the table: if the wall is closer than that, look at the wall's edge (a harder push than
    // wanted, which the next decision corrects).
    const edge = 0.1;
    let room = Infinity;
    if (ax > 1e-6) room = Math.min(room, (pos.x - edge) / ax);
    if (ax < -1e-6) room = Math.min(room, (pos.x - (lv.width - edge)) / ax);
    if (ay > 1e-6) room = Math.min(room, (pos.y - edge) / ay);
    if (ay < -1e-6) room = Math.min(room, (pos.y - (lv.height - edge)) / ay);
    if (room < d) d = Math.max(room, 0.05);
    this.aim.x = pos.x - ax * d;
    this.aim.y = pos.y - ay * d;
  }
}

export interface SolveResult {
  solved: boolean;
  /** Seconds the bot took, or the time limit if it failed. */
  time: number;
}

/** Play a level with the bot. This is the proof that the level can be won. */
export function solveLevel(
  level: Level,
  params: PhysicsParams = DEFAULT_PARAMS,
  options: BotOptions = DEFAULT_BOT,
  grid?: NavGrid,
): SolveResult {
  const sim = new PuckSim(level, params);
  sim.mode = options.mode;
  const bot = new SolverBot(level, params, options, grid);
  const maxSteps = Math.ceil(options.timeLimit / params.dt);
  for (let i = 0; i < maxSteps; i++) {
    sim.step(bot.update(sim));
    if (sim.won) return { solved: true, time: sim.time };
  }
  return { solved: false, time: options.timeLimit };
}
