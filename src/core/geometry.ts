export interface Vec {
  x: number;
  y: number;
}

/** A closed loop of vertices, in either winding. It may be concave. */
export type Polygon = Vec[];

/** The point on segment a-b closest to p. */
export function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Vec {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * t, y: ay + dy * t };
}

export function pointInPolygon(px: number, py: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's outline. Zero if the point is inside it. */
export function pointPolygonDistance(px: number, py: number, poly: Polygon): number {
  if (pointInPolygon(px, py, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const q = closestOnSegment(px, py, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
    const d = Math.hypot(px - q.x, py - q.y);
    if (d < best) best = d;
  }
  return best;
}

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = cross(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = cross(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = cross(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Smallest gap between two polygons. Zero if they touch, cross or one contains the other. */
export function polygonDistance(p: Polygon, q: Polygon): number {
  if (pointInPolygon(p[0].x, p[0].y, q) || pointInPolygon(q[0].x, q[0].y, p)) return 0;
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    for (let k = 0, l = q.length - 1; k < q.length; l = k++) {
      if (segmentsIntersect(p[j], p[i], q[l], q[k])) return 0;
      const d = Math.min(
        dist(p[i], closestOnSegment(p[i].x, p[i].y, q[l].x, q[l].y, q[k].x, q[k].y)),
        dist(q[k], closestOnSegment(q[k].x, q[k].y, p[j].x, p[j].y, p[i].x, p[i].y)),
      );
      if (d < best) best = d;
    }
  }
  return best;
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

function place(points: Vec[], cx: number, cy: number, angle: number): Polygon {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
}

/** A rectangle with half-width hw and half-height hh, turned by `angle` radians about its centre. */
export function rectPolygon(cx: number, cy: number, hw: number, hh: number, angle = 0): Polygon {
  return place(
    [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ],
    cx,
    cy,
    angle,
  );
}

export function regularPolygon(cx: number, cy: number, radius: number, sides: number, angle = 0): Polygon {
  const points: Vec[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    points.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return place(points, cx, cy, angle);
}

/** An L: two arms of the given length and thickness, meeting at a corner near the centre. Concave. */
export function lPolygon(cx: number, cy: number, arm: number, thick: number, angle = 0): Polygon {
  const o = arm / 2;
  return place(
    [
      { x: -o, y: -o },
      { x: arm - o, y: -o },
      { x: arm - o, y: thick - o },
      { x: thick - o, y: thick - o },
      { x: thick - o, y: arm - o },
      { x: -o, y: arm - o },
    ],
    cx,
    cy,
    angle,
  );
}

/** An irregular convex-ish rock: `radii` are the distances of evenly spaced vertices from the centre. */
export function blobPolygon(cx: number, cy: number, radii: number[], angle = 0): Polygon {
  const points: Vec[] = radii.map((r, i) => {
    const a = (i / radii.length) * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  return place(points, cx, cy, angle);
}
