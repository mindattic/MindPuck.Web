import { closestOnSegment, pointInPolygon, type Vec } from './geometry.js';
import type { Level } from './level.js';

const CELL = 0.25;
const SQRT2 = Math.SQRT2;

/**
 * The table as a grid of cells the puck's centre may occupy: a cell is free when the whole puck
 * fits there. Answers "is there a route from here to there" and gives the route.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cell = CELL;
  private readonly blocked: Uint8Array;

  /** `clearance` is how far the puck's centre must stay from every wall: its radius plus a margin. */
  constructor(level: Level, clearance: number = level.puckRadius + 0.06) {
    this.cols = Math.round(level.width / CELL);
    this.rows = Math.round(level.height / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    const c2 = clearance * clearance;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = (col + 0.5) * CELL;
        const y = (row + 0.5) * CELL;
        let hit = x < clearance || y < clearance || x > level.width - clearance || y > level.height - clearance;
        for (let o = 0; !hit && o < level.obstacles.length; o++) {
          const poly = level.obstacles[o];
          if (pointInPolygon(x, y, poly)) hit = true;
          for (let i = 0, j = poly.length - 1; !hit && i < poly.length; j = i++) {
            const q = closestOnSegment(x, y, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
            if ((x - q.x) * (x - q.x) + (y - q.y) * (y - q.y) < c2) hit = true;
          }
        }
        if (hit) this.blocked[row * this.cols + col] = 1;
      }
    }
  }

  private index(x: number, y: number): number {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
    return row * this.cols + col;
  }

  private centre(i: number): Vec {
    return { x: ((i % this.cols) + 0.5) * CELL, y: (Math.floor(i / this.cols) + 0.5) * CELL };
  }

  isFree(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols * CELL && y < this.rows * CELL && !this.blocked[this.index(x, y)];
  }

  /** The free cell nearest to a point: the point's own cell, or the closest one if that is blocked. */
  private nearestFree(x: number, y: number): number {
    const start = this.index(x, y);
    if (!this.blocked[start]) return start;
    const seen = new Uint8Array(this.blocked.length);
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      if (!this.blocked[i]) return i;
      const col = i % this.cols;
      const row = (i - col) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const n = r * this.cols + c;
          if (!seen[n]) {
            seen[n] = 1;
            queue.push(n);
          }
        }
      }
    }
    return -1;
  }

  /** True when the puck can travel in a straight line between the two points. */
  lineClear(a: Vec, b: Vec): boolean {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  /**
   * A* over the free cells, eight directions, never cutting a corner. Returns the route as points
   * from `from` to `to`, or null when the goal cannot be reached.
   */
  findPath(from: Vec, to: Vec): Vec[] | null {
    const start = this.nearestFree(from.x, from.y);
    const goal = this.nearestFree(to.x, to.y);
    if (start < 0 || goal < 0) return null;
    const n = this.blocked.length;
    const cols = this.cols;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const goalCol = goal % cols;
    const goalRow = (goal - goalCol) / cols;
    const heuristic = (i: number) => {
      const dc = Math.abs((i % cols) - goalCol);
      const dr = Math.abs(Math.floor(i / cols) - goalRow);
      return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
    };

    // A binary heap of [cell, priority] pairs.
    const heapCell: number[] = [];
    const heapKey: number[] = [];
    const push = (cell: number, key: number) => {
      let i = heapCell.length;
      heapCell.push(cell);
      heapKey.push(key);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heapKey[parent] <= key) break;
        heapCell[i] = heapCell[parent];
        heapKey[i] = heapKey[parent];
        i = parent;
      }
      heapCell[i] = cell;
      heapKey[i] = key;
    };
    const pop = (): number => {
      const top = heapCell[0];
      const cell = heapCell.pop()!;
      const key = heapKey.pop()!;
      const size = heapCell.length;
      if (size > 0) {
        let i = 0;
        for (;;) {
          let child = 2 * i + 1;
          if (child >= size) break;
          if (child + 1 < size && heapKey[child + 1] < heapKey[child]) child++;
          if (heapKey[child] >= key) break;
          heapCell[i] = heapCell[child];
          heapKey[i] = heapKey[child];
          i = child;
        }
        heapCell[i] = cell;
        heapKey[i] = key;
      }
      return top;
    };

    g[start] = 0;
    push(start, heuristic(start));
    while (heapCell.length > 0) {
      const current = pop();
      if (closed[current]) continue;
      closed[current] = 1;
      if (current === goal) break;
      const col = current % cols;
      const row = (current - col) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= this.rows) continue;
          const next = r * cols + c;
          if (this.blocked[next] || closed[next]) continue;
          if (dr !== 0 && dc !== 0 && (this.blocked[row * cols + c] || this.blocked[r * cols + col])) continue;
          const cost = g[current] + (dr !== 0 && dc !== 0 ? SQRT2 : 1);
          if (cost < g[next]) {
            g[next] = cost;
            came[next] = current;
            push(next, cost + heuristic(next));
          }
        }
      }
    }
    if (!closed[goal]) return null;

    const path: Vec[] = [];
    for (let i = goal; i !== -1; i = came[i]) path.push(this.centre(i));
    path.reverse();
    // The route ends exactly on the target when its own cell is free.
    if (this.isFree(to.x, to.y)) path[path.length - 1] = { x: to.x, y: to.y };
    return path;
  }
}
