import { closestOnSegment, pointInPolygon, type Vec } from './geometry.js';
import type { Level } from './level.js';

/** Every number that shapes how the table feels. docs/DESIGN.md explains each one. */
export interface PhysicsParams {
  /** Peak push from the gaze point, in units per second squared. */
  repelStrength: number;
  /** Distance at which the push has fallen to roughly half. Larger means a softer, wider field. */
  repelSoftness: number;
  /** Beyond this distance the gaze does not push at all, so looking away lets the puck coast. */
  repelRange: number;
  /** Looking at the very centre of the puck pushes nowhere; the push fades in over this fraction of its radius. */
  deadZone: number;
  /** Air drag: the fraction of speed lost per second while gliding. */
  drag: number;
  /** Drag on the goal pad, which is what lets the puck come to rest there. */
  padDrag: number;
  /** A small constant deceleration, so a slow puck actually stops. */
  friction: number;
  /** Fraction of speed kept, along the wall's normal, after a bounce. */
  restitution: number;
  /** Fraction of sliding speed lost along the wall in a bounce. */
  wallFriction: number;
  maxSpeed: number;
  /** Fixed simulation step, in seconds. */
  dt: number;
  /** How long the puck must sit on the pad to win. */
  dwell: number;
  /** The puck counts as resting on the pad below this speed. */
  restSpeed: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  repelStrength: 40,
  repelSoftness: 2,
  repelRange: 6,
  deadZone: 0.3,
  drag: 0.55,
  padDrag: 3.5,
  friction: 0.06,
  restitution: 0.82,
  wallFriction: 0.03,
  maxSpeed: 14,
  dt: 1 / 120,
  dwell: 0.5,
  restSpeed: 1.5,
};

/**
 * How hard the gaze pushes the puck from distance d: strongest close in, fading with distance,
 * nothing past the range, and nothing at dead centre (where there is no direction to push in).
 */
export function repelAccel(d: number, puckRadius: number, p: PhysicsParams): number {
  if (d >= p.repelRange) return 0;
  const reach = 1 - d / p.repelRange;
  const core = p.repelStrength / (1 + (d / p.repelSoftness) * (d / p.repelSoftness));
  const edge = p.deadZone * puckRadius;
  let centre = 1;
  if (d < edge) {
    const u = d / edge;
    centre = u * u * (3 - 2 * u);
  }
  return core * reach * reach * centre;
}

/** The win radius: how close the puck's centre must be to the goal's centre. */
export function winRadius(level: Level): number {
  return level.goal.r - level.puckRadius * 0.6;
}

/**
 * The puck on the table. A fixed-step simulation: gaze repulsion, drag, and circle-against-polygon
 * collisions with every wall segment, so the puck bounces correctly off faces and corners alike.
 */
export class PuckSim {
  pos: Vec;
  vel: Vec = { x: 0, y: 0 };
  /** Seconds simulated since the last reset. */
  time = 0;
  /** Seconds the puck has been resting on the pad. */
  dwell = 0;
  won = false;
  /** The hardest hit during the last `advance`, as speed into the wall. For sound and effects. */
  impact = 0;
  /** The push applied in the last step, for drawing. */
  push: Vec = { x: 0, y: 0 };

  private readonly segments: Float64Array;
  private accumulator = 0;

  constructor(
    public readonly level: Level,
    public readonly params: PhysicsParams = DEFAULT_PARAMS,
  ) {
    this.pos = { x: level.start.x, y: level.start.y };
    const flat: number[] = [];
    for (const poly of level.obstacles) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        flat.push(poly[j].x, poly[j].y, poly[i].x, poly[i].y);
      }
    }
    this.segments = new Float64Array(flat);
  }

  reset(): void {
    this.pos = { x: this.level.start.x, y: this.level.start.y };
    this.vel = { x: 0, y: 0 };
    this.time = 0;
    this.dwell = 0;
    this.won = false;
    this.impact = 0;
    this.accumulator = 0;
  }

  /** Advance by real elapsed time, in whole fixed steps. `gaze` is null when the eyes are not tracked. */
  advance(seconds: number, gaze: Vec | null): number {
    this.impact = 0;
    this.accumulator += Math.min(seconds, 0.1);
    let steps = 0;
    while (this.accumulator >= this.params.dt) {
      this.accumulator -= this.params.dt;
      this.step(gaze);
      steps++;
    }
    return steps;
  }

  /** One fixed step. */
  step(gaze: Vec | null): void {
    const p = this.params;
    const lv = this.level;
    const r = lv.puckRadius;
    const dt = p.dt;
    const pos = this.pos;
    const vel = this.vel;

    let ax = 0;
    let ay = 0;
    if (gaze) {
      const dx = pos.x - gaze.x;
      const dy = pos.y - gaze.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) {
        const a = repelAccel(d, r, p);
        ax = (dx / d) * a;
        ay = (dy / d) * a;
      }
    }
    this.push.x = ax;
    this.push.y = ay;
    vel.x += ax * dt;
    vel.y += ay * dt;

    const gx = pos.x - lv.goal.x;
    const gy = pos.y - lv.goal.y;
    const goalDist = Math.hypot(gx, gy);
    const damp = Math.exp(-(goalDist < lv.goal.r ? p.padDrag : p.drag) * dt);
    vel.x *= damp;
    vel.y *= damp;
    let speed = Math.hypot(vel.x, vel.y);
    if (speed > 0) {
      const slowed = Math.min(Math.max(speed - p.friction * dt, 0), p.maxSpeed);
      vel.x *= slowed / speed;
      vel.y *= slowed / speed;
      speed = slowed;
    }

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;

    this.collideObstacles();
    this.collideArena();

    this.time += dt;
    const resting = Math.hypot(pos.x - lv.goal.x, pos.y - lv.goal.y) <= winRadius(lv) && speed < p.restSpeed;
    this.dwell = resting ? this.dwell + dt : 0;
    if (this.dwell >= p.dwell) this.won = true;
  }

  private bounce(nx: number, ny: number): void {
    const vel = this.vel;
    const vn = vel.x * nx + vel.y * ny;
    if (vn >= 0) return;
    const p = this.params;
    // Split the velocity into the part going into the wall, which bounces, and the part sliding
    // along it, which loses a little to friction.
    const tx = vel.x - vn * nx;
    const ty = vel.y - vn * ny;
    const keep = 1 - p.wallFriction;
    vel.x = tx * keep - vn * p.restitution * nx;
    vel.y = ty * keep - vn * p.restitution * ny;
    if (-vn > this.impact) this.impact = -vn;
  }

  private collideArena(): void {
    const lv = this.level;
    const r = lv.puckRadius;
    const pos = this.pos;
    if (pos.x < r) {
      pos.x = r;
      this.bounce(1, 0);
    } else if (pos.x > lv.width - r) {
      pos.x = lv.width - r;
      this.bounce(-1, 0);
    }
    if (pos.y < r) {
      pos.y = r;
      this.bounce(0, 1);
    } else if (pos.y > lv.height - r) {
      pos.y = lv.height - r;
      this.bounce(0, -1);
    }
  }

  private collideObstacles(): void {
    const r = this.level.puckRadius;
    const pos = this.pos;
    const seg = this.segments;

    // The step is far smaller than the puck, so its centre cannot cross a wall in one step. If it
    // ever ends up inside a shape anyway (pinched in a corner), put it back on the nearest face.
    for (const poly of this.level.obstacles) {
      if (!pointInPolygon(pos.x, pos.y, poly)) continue;
      let best = Infinity;
      let qx = pos.x;
      let qy = pos.y;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const q = closestOnSegment(pos.x, pos.y, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
        const d = Math.hypot(pos.x - q.x, pos.y - q.y);
        if (d < best) {
          best = d;
          qx = q.x;
          qy = q.y;
        }
      }
      if (best > 1e-9) {
        const nx = (qx - pos.x) / best;
        const ny = (qy - pos.y) / best;
        pos.x = qx + nx * r;
        pos.y = qy + ny * r;
        this.bounce(nx, ny);
      }
    }

    // Resolve against every segment the puck overlaps. A corner is just the end of a segment, so
    // the same closest-point test handles faces and corners. A few passes settle the puck when it
    // touches two walls at once.
    for (let pass = 0; pass < 4; pass++) {
      let touched = false;
      for (let i = 0; i < seg.length; i += 4) {
        const q = closestOnSegment(pos.x, pos.y, seg[i], seg[i + 1], seg[i + 2], seg[i + 3]);
        const dx = pos.x - q.x;
        const dy = pos.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r || d2 < 1e-18) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        pos.x += nx * (r - d);
        pos.y += ny * (r - d);
        this.bounce(nx, ny);
        touched = true;
      }
      if (!touched) break;
    }
  }
}
