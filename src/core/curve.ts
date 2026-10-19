import { Euler, MathUtils, Vector3 } from "three";
import type { Segment, Topology, Vec3 } from "./schema";
import { buildGraph, otherEnd, type Graph } from "./derive";
import { resolveRef } from "./library";
import type { Pose } from "./placement";
import { resolveConnector, type Project } from "./project";

/**
 * The bundle curve: the one shape a placed bundle has, which the 3D view
 * draws and the lengths, the BOM and the checks measure.
 *
 * A chain is a maximal run of segments joined at point endpoints. It ends at
 * a connector, a breakout or a splice. Each chain is one curve: a straight
 * stub out of each connector end, as long as its type's strain relief, then
 * a centripetal Catmull-Rom spline through the stub ends, each segment's tie
 * points and each point endpoint, in chain order. At a stub end the spline
 * leaves along the stub, with a tangent as long as the span to the next
 * control point, so the bundle carries on smoothly and turns over the whole
 * span rather than right at the stub. A connector type with no strain relief
 * has no stub, and its bundle still leaves along the exit.
 */

export interface SegmentCurve {
  segment: string;
  /** Arc length in millimetres, stubs included. Not rounded. */
  lengthMm: number;
  /** Points along the curve from the segment's ends[0] to its ends[1], for drawing. */
  points: Vec3[];
  /** Arc distance of each tie point on the curve from the segment's ends[0]. Not rounded. */
  ties: Record<string, number>;
  /** The segments of the chain this segment is part of, in chain order. */
  chain: string[];
  /** The tightest radius measured on the segment outside the stubs, when a minimum was given for it. Not rounded. */
  minRadiusMm?: number;
  /** Arc ranges from the segment's ends[0] where the radius is under its minimum, in order. Empty with no minimum. */
  tight: [number, number][];
}

/** Samples per span between two control points. */
const SAMPLES = 32;
/** Curvature samples sit at most this far apart, so the measured radius settles. */
const RADIUS_SPACING_MM = 1;
/** Curvature samples sit this many to the smallest minimum radius in play, when that is closer still. */
const PER_RADIUS = 10;
/** The most curvature samples one chain takes, so a tiny minimum on a long run stays cheap. */
const MAX_RADIUS_SAMPLES = 20000;

/** The straight run a connector endpoint's type asks for, or zero. */
export function strainReliefOf(project: Project, topology: Topology, endpointId: string): number {
  const e = topology.endpoints.find((x) => x.id === endpointId);
  if (e?.kind !== "connector") return 0;
  const r = resolveConnector(project, e.connector);
  if ("error" in r) return 0;
  return resolveRef(project.library, r.connector.connector, "connectors")?.strain_relief_mm ?? 0;
}

/** A connector's wires leave along its local -Y, turned by its rotation in degrees. */
export function exitDirection(rotationDeg: Vec3): Vec3 {
  const v = new Vector3(0, -1, 0).applyEuler(new Euler(MathUtils.degToRad(rotationDeg[0]), MathUtils.degToRad(rotationDeg[1]), MathUtils.degToRad(rotationDeg[2]), "XYZ"));
  return [v.x, v.y, v.z];
}

/**
 * The curve of every segment whose two ends the pose holds. Segments with an
 * end missing from the pose have no curve. Tie points enter the curve when
 * the pose holds their position.
 *
 * `minimums` gives a bundle's minimum bend radius by segment id. A segment
 * with one gets its measured radius and the stretches under it. The stubs are
 * straight and are not measured.
 */
export function bundleCurves(project: Project, topology: Topology, pose: Pose, minimums: ReadonlyMap<string, number> = new Map()): Map<string, SegmentCurve> {
  const graph = buildGraph(topology);
  const at = (id: string) => pose.positions[id];
  const posed = (s: Segment) => s.ends.every((e) => graph.endpoints.has(e) && at(e) !== undefined);
  const joint = (e: string) => {
    const incident = graph.incident.get(e) ?? [];
    return graph.endpoints.get(e)?.kind === "point" && incident.length === 2 && incident.every(posed);
  };
  const out = new Map<string, SegmentCurve>();
  const seen = new Set<string>();
  for (const s of topology.segments) {
    if (seen.has(s.id) || !posed(s)) continue;
    seen.add(s.id);
    const walk = (at: string): [Segment, string][] => {
      const steps: [Segment, string][] = [];
      let prev = s;
      let cur = at;
      while (joint(cur)) {
        const n = graph.incident.get(cur)!.find((x) => x !== prev)!;
        if (seen.has(n.id)) break;
        seen.add(n.id);
        cur = otherEnd(n, cur);
        steps.push([n, cur]);
        prev = n;
      }
      return steps;
    };
    const back = walk(s.ends[0]).reverse();
    const ahead = walk(s.ends[1]);
    const segments = [...back.map(([x]) => x), s, ...ahead.map(([x]) => x)];
    const endpoints = [...back.map(([, e]) => e), s.ends[0], s.ends[1], ...ahead.map(([, e]) => e)];
    for (const c of chainCurve(project, topology, graph, pose, segments, endpoints, minimums))out.set(c.segment, c);
  }
  return out;
}

/** One chain's curve, cut into its segments. `endpoints` runs one longer than `segments`, in the same order. */
function chainCurve(project: Project, topology: Topology, graph: Graph, pose: Pose, segments: Segment[], endpoints: string[], minimums: ReadonlyMap<string, number>): SegmentCurve[] {
  const v = (p: Vec3) => new Vector3(...p);
  const ctrl: Vector3[] = [];
  // A connector end: its position, its stub length, the stub end and the exit direction.
  const stub = (end: string, next: string) => {
    const p = v(pose.positions[end]);
    if (graph.endpoints.get(end)?.kind !== "connector") return undefined;
    const rotation = pose.rotations[end];
    const toward = v(pose.positions[next]).sub(p);
    const dir = rotation ? v(exitDirection(rotation)) : toward.lengthSq() > 1e-9 ? toward.normalize() : new Vector3(0, -1, 0);
    const length = strainReliefOf(project, topology, end);
    const tip = p.clone().addScaledVector(dir, length);
    return { from: p, length, tip, dir };
  };
  const last = endpoints.length - 1;
  const head = stub(endpoints[0], endpoints[1]);
  const tail = stub(endpoints[last], endpoints[last - 1]);

  ctrl.push(head ? head.tip : v(pose.positions[endpoints[0]]));
  const starts: number[] = [];
  const ends: number[] = [];
  const tieAt = new Map<string, { segment: number; index: number }>();
  segments.forEach((s, i) => {
    starts.push(ctrl.length - 1);
    const forward = s.ends[0] === endpoints[i];
    const a = v(pose.positions[s.ends[0]]);
    const line = v(pose.positions[s.ends[1]]).sub(a);
    const along = (id: string) => v(pose.ties[id]).sub(a).dot(line);
    const ties = topology.ties
      .filter((t) => t.segment === s.id && pose.ties[t.id] !== undefined)
      .map((t) => t.id)
      .sort((x, y) => along(x) - along(y) || (x < y ? -1 : 1));
    if (!forward) ties.reverse();
    for (const id of ties) {
      tieAt.set(id, { segment: i, index: ctrl.length });
      ctrl.push(v(pose.ties[id]));
    }
    ctrl.push(i === segments.length - 1 && tail ? tail.tip : v(pose.positions[endpoints[i + 1]]));
    ends.push(ctrl.length - 1);
  });

  // Arc length at each control point, and the samples of each span, measured along the spline.
  // The tail stub's exit points into the chain, so the spline arrives against it.
  const spline = chainSpline(ctrl, head?.dir, tail?.dir.clone().negate());
  const n = ctrl.length;
  const arc: number[] = [0];
  const samples: Vector3[][] = [];
  for (let j = 0; j < n - 1; j++) {
    const pts: Vector3[] = [];
    for (let k = 0; k <= SAMPLES; k++) pts.push(spline.getPoint((j + k / SAMPLES) / (n - 1)));
    let d = 0;
    for (let k = 1; k < pts.length; k++) d += pts[k].distanceTo(pts[k - 1]);
    samples.push(pts);
    arc.push(arc[j] + d);
  }

  const bends = bendsOf(spline, n, segments.map((s, i) => ({ from: starts[i], to: ends[i], min: minimums.get(s.id) })));

  const vec = (p: Vector3): Vec3 => [p.x, p.y, p.z];
  const chain = segments.map((s) => s.id);
  return segments.map((s, i) => {
    const lead = i === 0 && head ? head.length : 0;
    const trail = i === segments.length - 1 && tail ? tail.length : 0;
    const lengthMm = lead + arc[ends[i]] - arc[starts[i]] + trail;
    const points: Vector3[] = [];
    if (lead > 0) points.push(head!.from);
    for (let j = starts[i]; j < ends[i]; j++) points.push(...(j === starts[i] ? samples[j] : samples[j].slice(1)));
    if (points.length === 0) points.push(ctrl[starts[i]]);
    if (trail > 0) points.push(tail!.from);
    const forward = s.ends[0] === endpoints[i];
    const ties: Record<string, number> = {};
    for (const [id, t] of tieAt) {
      if (t.segment !== i) continue;
      const d = lead + arc[t.index] - arc[starts[i]];
      ties[id] = forward ? d : lengthMm - d;
    }
    // Bend ranges run from the start of this segment's part of the spline: shift them past the lead stub, and flip them if the segment runs the other way.
    const bend = bends[i];
    const tight = bend.tight.map(([a, b]): [number, number] => (forward ? [lead + a, lead + b] : [lengthMm - lead - b, lengthMm - lead - a]));
    if (!forward) tight.reverse();
    const out: SegmentCurve = { segment: s.id, lengthMm, points: (forward ? points : points.reverse()).map(vec), ties, chain, tight };
    if (bend.minRadiusMm !== undefined) out.minRadiusMm = bend.minRadiusMm;
    return out;
  });
}

interface Bend {
  minRadiusMm?: number;
  /** Arc ranges from the start of the segment's part of the spline. */
  tight: [number, number][];
}

/**
 * Measure the radius along one chain's spline. Each part runs between two
 * control point indices and carries its segment's minimum, if any. The spline
 * is resampled at an even arc spacing well under the smallest minimum, and
 * the radius at each sample is the circumradius of it and its two neighbours.
 */
function bendsOf(spline: Spline, n: number, parts: { from: number; to: number; min: number | undefined }[]): Bend[] {
  const out: Bend[] = parts.map(() => ({ tight: [] }));
  const mins = parts.map((p) => p.min).filter((m): m is number => m !== undefined && m > 0);
  if (mins.length === 0 || n < 2) return out;

  // A fine table of spline parameter against arc length, from the first part's start to the last part's end.
  const t0 = parts[0].from / (n - 1);
  const t1 = parts[parts.length - 1].to / (n - 1);
  const steps = Math.max(1, Math.ceil((t1 - t0) * (n - 1) * 256));
  const ts: number[] = [t0];
  const arcs: number[] = [0];
  let prev = spline.getPoint(t0);
  for (let k = 1; k <= steps; k++) {
    const t = t0 + ((t1 - t0) * k) / steps;
    const p = spline.getPoint(t);
    arcs.push(arcs[k - 1] + p.distanceTo(prev));
    ts.push(t);
    prev = p;
  }
  const total = arcs[steps];
  if (total <= 0) return out;
  // The table entry at or before an arc length, by bisection.
  const below = (s: number, of: number[]) => {
    let lo = 0;
    let hi = of.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (of[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const tAt = (s: number) => {
    const lo = below(s, arcs);
    const span = arcs[lo + 1] - arcs[lo];
    return lo + 1 < arcs.length && span > 0 ? ts[lo] + ((ts[lo + 1] - ts[lo]) * (s - arcs[lo])) / span : ts[lo];
  };
  const bounds = parts.map((p) => [arcs[below(p.from / (n - 1), ts)], arcs[below(p.to / (n - 1), ts)]]);

  const count = Math.min(MAX_RADIUS_SAMPLES, Math.max(2, Math.ceil(total / Math.min(RADIUS_SPACING_MM, Math.min(...mins) / PER_RADIUS))));
  const h = total / count;
  const samples: Vector3[] = [];
  for (let k = 0; k <= count; k++) samples.push(spline.getPoint(tAt(k * h)));

  for (let k = 1; k < count; k++) {
    const s = k * h;
    const i = bounds.findIndex(([a, b]) => s >= a && s <= b);
    const min = parts[i]?.min;
    if (min === undefined) continue;
    const r = circumradius(samples[k - 1], samples[k], samples[k + 1]);
    const bend = out[i];
    if (bend.minRadiusMm === undefined || r < bend.minRadiusMm) bend.minRadiusMm = r;
    if (r >= min) continue;
    const from = Math.max(bounds[i][0], s - h) - bounds[i][0];
    const to = Math.min(bounds[i][1], s + h) - bounds[i][0];
    const last = bend.tight[bend.tight.length - 1];
    if (last && from <= last[1]) last[1] = to;
    else bend.tight.push([from, to]);
  }
  return out;
}

interface Spline {
  /** The point at `t` from 0 to 1; control point `j` of `n` sits at `j / (n - 1)`. */
  getPoint(t: number): Vector3;
}

/**
 * A centripetal Catmull-Rom spline through `ctrl`, as three.js builds one, as
 * cubic Hermite spans. A given start or end direction replaces the end
 * tangent, scaled to the length of the end span.
 */
function chainSpline(ctrl: Vector3[], start: Vector3 | undefined, end: Vector3 | undefined): Spline {
  const n = ctrl.length;
  // Beyond an end with no direction, three.js mirrors the neighbour through the end point.
  const at = (i: number) => (i < 0 ? ctrl[0].clone().multiplyScalar(2).sub(ctrl[Math.min(1, n - 1)]) : i >= n ? ctrl[n - 1].clone().multiplyScalar(2).sub(ctrl[Math.max(n - 2, 0)]) : ctrl[i]);
  const spans: [Vector3, Vector3, Vector3, Vector3][] = [];
  for (let j = 0; j < n - 1; j++) {
    const [x0, x1, x2, x3] = [at(j - 1), at(j), at(j + 1), at(j + 2)];
    let dt0 = Math.pow(x0.distanceToSquared(x1), 0.25);
    let dt1 = Math.pow(x1.distanceToSquared(x2), 0.25);
    let dt2 = Math.pow(x2.distanceToSquared(x3), 0.25);
    if (dt1 < 1e-4) dt1 = 1;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const tangent = (a: Vector3, b: Vector3, c: Vector3, da: number, db: number) =>
      new Vector3().addScaledVector(b.clone().sub(a), 1 / da).addScaledVector(c.clone().sub(a), -1 / (da + db)).addScaledVector(c.clone().sub(b), 1 / db).multiplyScalar(dt1);
    const chord = x1.distanceTo(x2);
    const m1 = j === 0 && start ? start.clone().setLength(chord) : tangent(x0, x1, x2, dt0, dt1);
    const m2 = j === n - 2 && end ? end.clone().setLength(chord) : tangent(x1, x2, x3, dt1, dt2);
    spans.push([x1, x2, m1, m2]);
  }
  return {
    getPoint(t: number) {
      if (n === 1) return ctrl[0].clone();
      const p = (n - 1) * Math.min(1, Math.max(0, t));
      const j = Math.min(n - 2, Math.floor(p));
      const s = p - j;
      const [a, b, ma, mb] = spans[j];
      const s2 = s * s;
      const s3 = s2 * s;
      return new Vector3()
        .addScaledVector(a, 2 * s3 - 3 * s2 + 1)
        .addScaledVector(ma, s3 - 2 * s2 + s)
        .addScaledVector(b, -2 * s3 + 3 * s2)
        .addScaledVector(mb, s3 - s2);
    },
  };
}

/** The radius of the circle through three points, infinite when they line up. */
function circumradius(a: Vector3, b: Vector3, c: Vector3): number {
  const cross = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length();
  return cross < 1e-12 ? Infinity : (a.distanceTo(b) * b.distanceTo(c) * a.distanceTo(c)) / (2 * cross);
}
