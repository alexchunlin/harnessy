import type { Position } from "../../core";

/**
 * Orthogonal polylines for net edges on the connectivity canvas: pins and
 * hand-placed bends in, a drawn polyline out, plus the steering operations
 * (shift a run, move a corner, insert a corner) and the clean-up that runs
 * on drop. Pure: no React Flow, no store.
 *
 * A line leaves each pin on a short stub perpendicular to its box side.
 * Between the two stub ends run the bends: either stored (hand placed) or
 * computed. Where a stub end and its neighbouring bend are not aligned an
 * extra corner keeps the line orthogonal, so a box can move while the
 * stored bends stay put and only its stub stretches.
 */

export type Side = "left" | "right" | "top" | "bottom";

/** One end of a line. A hub has no side and no stub. */
export interface End extends Position {
  side?: Side;
}

export interface Line {
  a: End;
  b: End;
  /** Hand-placed bends; undefined means route automatically. */
  bends?: Position[];
  /** Sibling offset in canvas units, applied to the automatic route only. */
  offset?: number;
}

/** Snap grid: a quarter of the pin pitch. */
export const GRID = 6;
/** Length of the stub leaving a pin. */
export const STUB = 18;
/** Corner fillet radius. */
export const FILLET = 8;

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

const horizontalSide = (side?: Side) => side === "left" || side === "right";

export function stubEnd(e: End): Position {
  switch (e.side) {
    case "left":
      return { x: e.x - STUB, y: e.y };
    case "right":
      return { x: e.x + STUB, y: e.y };
    case "top":
      return { x: e.x, y: e.y - STUB };
    case "bottom":
      return { x: e.x, y: e.y + STUB };
    default:
      return { x: e.x, y: e.y };
  }
}

/** Bends between two stub ends when nothing is hand placed: at most two in the common case. */
export function autoBends(hs: Position, sideA: Side | undefined, ts: Position, sideB: Side | undefined, offset = 0): Position[] {
  const hA = horizontalSide(sideA);
  const hB = horizontalSide(sideB);
  if (!sideB) return hA ? [{ x: ts.x, y: hs.y }] : [{ x: hs.x, y: ts.y }];
  if (hA && hB) {
    const facing = (sideA === "right" && sideB === "left" && hs.x <= ts.x) || (sideA === "left" && sideB === "right" && hs.x >= ts.x);
    if (facing) {
      const mx = snap((hs.x + ts.x) / 2) + offset;
      return [
        { x: mx, y: hs.y },
        { x: mx, y: ts.y },
      ];
    }
    const my = snap((hs.y + ts.y) / 2) + offset;
    return [
      { x: hs.x, y: my },
      { x: ts.x, y: my },
    ];
  }
  if (!hA && !hB) {
    const facing = (sideA === "bottom" && sideB === "top" && hs.y <= ts.y) || (sideA === "top" && sideB === "bottom" && hs.y >= ts.y);
    if (facing) {
      const my = snap((hs.y + ts.y) / 2) + offset;
      return [
        { x: hs.x, y: my },
        { x: ts.x, y: my },
      ];
    }
    const mx = snap((hs.x + ts.x) / 2) + offset;
    return [
      { x: mx, y: hs.y },
      { x: mx, y: ts.y },
    ];
  }
  return hA ? [{ x: ts.x, y: hs.y }] : [{ x: hs.x, y: ts.y }];
}

/** The corner that carries a line out of a stub end in the stub's direction and on to `to`. */
function cornerAfter(from: Position, side: Side | undefined, to: Position): Position {
  return horizontalSide(side) || !side ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** The corner that brings a line from `from` into a stub end along the stub's direction. */
function cornerBefore(from: Position, to: Position, side: Side | undefined): Position {
  return horizontalSide(side) ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
}

const headLength = (a: End) => (a.side ? 2 : 1);
const tailLength = (b: End) => (b.side ? 2 : 1);

interface Point extends Position {
  /** A stored bend, which survives rendering even when in line with its neighbours, so it can be steered. */
  fixed: boolean;
}

/**
 * The polyline to draw: pin, stub end, corners, stub end, pin. Automatic
 * corners that are in line with their neighbours are dropped; stored bends
 * stay unless they double back or duplicate a neighbour.
 */
export function polyline(line: Line): Position[] {
  const { a, b } = line;
  const hs = stubEnd(a);
  const ts = stubEnd(b);
  const inner = orthogonalise((line.bends ?? autoBends(hs, a.side, ts, b.side, line.offset ?? 0)).map((p) => ({ x: p.x, y: p.y, fixed: line.bends !== undefined })));
  const pts: Point[] = [{ x: a.x, y: a.y, fixed: false }];
  if (a.side) pts.push({ ...hs, fixed: false });
  pts.push({ ...cornerAfter(hs, a.side, inner[0] ?? ts), fixed: false });
  pts.push(...inner);
  if (inner.length) pts.push({ ...cornerBefore(inner[inner.length - 1], ts, b.side), fixed: false });
  if (b.side) pts.push({ ...ts, fixed: false });
  pts.push({ x: b.x, y: b.y, fixed: false });
  return normalise(pts, headLength(a), tailLength(b)).map(({ x, y }) => ({ x, y }));
}

/** Stored bends from a file may be diagonal to each other; insert corners so every run is axis aligned. */
function orthogonalise(bends: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of bends) {
    const prev = out[out.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) out.push({ x: p.x, y: prev.y, fixed: false });
    out.push(p);
  }
  return out;
}

function normalise(pts: Point[], head: number, tail: number): Point[] {
  const out = [...pts];
  for (;;) {
    let removed = false;
    for (let i = head; i < out.length - tail; i++) {
      const p = out[i - 1];
      const c = out[i];
      const n = out[i + 1];
      const samePlace = (o: Point) => o.x === c.x && o.y === c.y;
      if (samePlace(p) || samePlace(n)) {
        // Of two coincident points, the automatic one goes.
        const twin = samePlace(p) ? i - 1 : i + 1;
        const twinInterior = twin >= head && twin < out.length - tail;
        out.splice(c.fixed && twinInterior && !out[twin].fixed ? twin : i, 1);
        removed = true;
        break;
      }
      const vertical = p.x === c.x && c.x === n.x;
      const horizontal = p.y === c.y && c.y === n.y;
      if (!vertical && !horizontal) continue;
      const between = vertical ? (c.y - p.y) * (n.y - c.y) > 0 : (c.x - p.x) * (n.x - c.x) > 0;
      if (c.fixed && between) continue;
      out.splice(i, 1);
      removed = true;
      break;
    }
    if (!removed) return out;
  }
}

/** The polyline with every collinear point dropped: what the line looks like, ignoring steerable split points. */
export function shape(pts: Position[]): Position[] {
  return normalise(pts.map((p) => ({ ...p, fixed: false })), 1, 1).map(({ x, y }) => ({ x, y }));
}

/** The stored bends that reproduce a polyline exactly: its interior points. */
function storedFrom(pts: Position[], line: Line): Position[] {
  return pts.slice(headLength(line.a), pts.length - tailLength(line.b)).map((p) => ({ x: p.x, y: p.y }));
}

/** Runs the user may steer: every run except the stubs. */
export function steerableRuns(line: Line, pts = polyline(line)): { run: number; horizontal: boolean; mid: Position }[] {
  const h = headLength(line.a);
  const t = tailLength(line.b);
  const out: { run: number; horizontal: boolean; mid: Position }[] = [];
  for (let run = h - 1; run <= pts.length - 1 - t; run++) {
    const p = pts[run];
    const q = pts[run + 1];
    out.push({ run, horizontal: p.y === q.y, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } });
  }
  return out;
}

/** Corners the user may drag: interior points that are neither pins nor stub ends. */
export function steerableCorners(line: Line, pts = polyline(line)): number[] {
  const h = headLength(line.a);
  const t = tailLength(line.b);
  const out: number[] = [];
  for (let i = h; i <= pts.length - 1 - t; i++) out.push(i);
  return out;
}

/**
 * Moving a point along one axis needs the run on its far side to lie along
 * that axis; otherwise, or when the point is a pin or stub end, a copy is
 * inserted next to it and the copy moves instead.
 */
function detach(list: Position[], index: number, towardsHigher: boolean, axis: "x" | "y", protectedIndex: boolean): { list: Position[]; index: number } {
  const p = list[index];
  const far = list[towardsHigher ? index - 1 : index + 1];
  const farAligned = far !== undefined && far[axis] === p[axis];
  if (!protectedIndex && farAligned) return { list, index };
  const copy = { x: p.x, y: p.y };
  const at = towardsHigher ? index + 1 : index;
  const next = [...list.slice(0, at), copy, ...list.slice(at)];
  return { list: next, index: at };
}

/** Shift a run along its normal. Returns the new stored bends. */
export function shiftRun(line: Line, run: number, delta: Position): Position[] {
  const pts = polyline(line);
  const h = headLength(line.a);
  const t = tailLength(line.b);
  if (run < h - 1 || run > pts.length - 1 - t) return storedFrom(pts, line);
  const p = pts[run];
  const q = pts[run + 1];
  const horizontal = p.y === q.y;
  const axis = horizontal ? "y" : "x";
  const other = horizontal ? "x" : "y";
  const value = snap(p[axis] + delta[axis]);
  if (value === p[axis]) return storedFrom(pts, line);
  // Far end first so the near end's index stays valid.
  let list = pts;
  let j = run + 1;
  ({ list, index: j } = detach(list, j, false, other, j >= pts.length - t));
  let i = run;
  ({ list, index: i } = detach(list, i, true, other, i <= h - 1));
  if (i >= j) j = i + 1;
  list = list.map((pt, k) => (k === i || k === j ? { ...pt, [axis]: value } : pt));
  return storedFrom(list, line);
}

/** Move a corner; both adjacent runs follow. Returns the new stored bends. */
export function moveCorner(line: Line, index: number, to: Position): Position[] {
  const pts = polyline(line);
  const h = headLength(line.a);
  const t = tailLength(line.b);
  if (index < h || index > pts.length - 1 - t) return storedFrom(pts, line);
  const target = { x: snap(to.x), y: snap(to.y) };
  const c = pts[index];
  const prev = pts[index - 1];
  const next = pts[index + 1];
  const inHorizontal = prev.y === c.y;
  const outHorizontal = c.y === next.y;
  let list = pts;
  // The following point takes the corner's new coordinate on the axis its run does not lie along.
  let j = index + 1;
  const jAxis = outHorizontal ? "y" : "x";
  ({ list, index: j } = detach(list, j, false, outHorizontal ? "x" : "y", j >= pts.length - t));
  list = list.map((pt, k) => (k === j ? { ...pt, [jAxis]: target[jAxis] } : pt));
  let i = index - 1;
  const iAxis = inHorizontal ? "y" : "x";
  ({ list, index: i } = detach(list, i, true, inHorizontal ? "x" : "y", i <= h - 1));
  list = list.map((pt, k) => (k === i ? { ...pt, [iAxis]: target[iAxis] } : pt));
  const ci = i + 1;
  list = list.map((pt, k) => (k === ci ? target : pt));
  return storedFrom(list, line);
}

/** Split a run at a point along it. Returns the new stored bends. */
export function insertCorner(line: Line, run: number, at: Position): Position[] {
  const pts = polyline(line);
  const h = headLength(line.a);
  const t = tailLength(line.b);
  if (run < h - 1 || run > pts.length - 1 - t) return storedFrom(pts, line);
  const p = pts[run];
  const q = pts[run + 1];
  const horizontal = p.y === q.y;
  const point = horizontal
    ? { x: Math.min(Math.max(snap(at.x), Math.min(p.x, q.x)), Math.max(p.x, q.x)), y: p.y }
    : { x: p.x, y: Math.min(Math.max(snap(at.y), Math.min(p.y, q.y)), Math.max(p.y, q.y)) };
  return storedFrom([...pts.slice(0, run + 1), point, ...pts.slice(run + 1)], line);
}

export function samePolyline(a: Position[], b: Position[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

/**
 * Drop every stored bend the drawing does not need: one that is in line
 * with its neighbours, or one the automatic corners would place anyway.
 * Returns undefined when what remains is the automatic route.
 */
export function simplify(line: Line): Position[] | undefined {
  if (!line.bends) return undefined;
  const target = shape(polyline(line));
  let bends = line.bends;
  for (;;) {
    let removed = false;
    for (let k = 0; k < bends.length && bends.length > 1; k++) {
      const without = bends.filter((_, i) => i !== k);
      if (samePolyline(shape(polyline({ ...line, bends: without })), target)) {
        bends = without;
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  if (samePolyline(shape(polyline({ ...line, bends: undefined })), target)) return undefined;
  return bends;
}

/** SVG path with a fillet at each corner, clamped to half the shorter adjacent run. */
export function pathFrom(pts: Position[], fillet = FILLET): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const inLen = Math.hypot(c.x - p.x, c.y - p.y);
    const outLen = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(fillet, inLen / 2, outLen / 2);
    if (r <= 0 || inLen === 0 || outLen === 0) {
      d += ` L ${c.x} ${c.y}`;
      continue;
    }
    const p1 = { x: c.x - ((c.x - p.x) / inLen) * r, y: c.y - ((c.y - p.y) / inLen) * r };
    const p2 = { x: c.x + ((n.x - c.x) / outLen) * r, y: c.y + ((n.y - c.y) / outLen) * r };
    d += ` L ${p1.x} ${p1.y} Q ${c.x} ${c.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Where a label sits: the middle of the longest run. */
export function labelPoint(pts: Position[]): Position {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  return { x: (pts[best].x + pts[best + 1].x) / 2, y: (pts[best].y + pts[best + 1].y) / 2 };
}
