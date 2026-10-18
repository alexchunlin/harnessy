import { CatmullRomCurve3, Euler, MathUtils, Vector3 } from "three";
import type { Segment, Topology, Vec3 } from "./schema";
import { buildGraph, otherEnd, type Graph } from "./derive";
import { resolveRef } from "./library";
import { resolveConnector, type Project } from "./project";

/**
 * The bundle curve: the one shape a placed bundle has, which the 3D view
 * draws and the lengths, the BOM and the checks measure.
 *
 * A chain is a maximal run of segments joined at point endpoints. It ends at
 * a connector, a breakout or a splice. Each chain is one curve: a straight
 * stub out of each connector end, as long as its type's strain relief, then
 * a centripetal Catmull-Rom spline through the stub ends, each segment's tie
 * points and each point endpoint, in chain order. A phantom point a little
 * way back along each stub keeps the tangent smooth where the stub meets the
 * spline. A connector type with no strain relief has no stub, and its bundle
 * still leaves along the exit.
 */


/**
 * Where things are, by id: endpoint positions and tie point positions in
 * millimetres, connector rotations in degrees, Euler order XYZ. A saved
 * placement is a pose. The 3D view passes the placement laid over its sketch.
 */
export interface Pose {
  positions: Record<string, Vec3>;
  rotations: Record<string, Vec3>;
  ties: Record<string, Vec3>;
}

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
}

/** How far behind a stub end the phantom point sits. */
const PHANTOM_MM = 10;
/** Samples per span between two control points. */
const SAMPLES = 32;

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
 */
export function bundleCurves(project: Project, topology: Topology, pose: Pose): Map<string, SegmentCurve> {
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
    for (const c of chainCurve(project, topology, graph, pose, segments, endpoints)) out.set(c.segment, c);
  }
  return out;
}

/** One chain's curve, cut into its segments. `endpoints` runs one longer than `segments`, in the same order. */
function chainCurve(project: Project, topology: Topology, graph: Graph, pose: Pose, segments: Segment[], endpoints: string[]): SegmentCurve[] {
  const v = (p: Vec3) => new Vector3(...p);
  const ctrl: Vector3[] = [];
  // A connector end: its position, its stub length and the stub end, with the phantom point behind it.
  const stub = (end: string, next: string) => {
    const p = v(pose.positions[end]);
    if (graph.endpoints.get(end)?.kind !== "connector") return undefined;
    const rotation = pose.rotations[end];
    const toward = v(pose.positions[next]).sub(p);
    const dir = rotation ? v(exitDirection(rotation)) : toward.lengthSq() > 1e-9 ? toward.normalize() : new Vector3(0, -1, 0);
    const length = strainReliefOf(project, topology, end);
    const tip = p.clone().addScaledVector(dir, length);
    return { from: p, length, tip, phantom: tip.clone().addScaledVector(dir, -PHANTOM_MM) };
  };
  const last = endpoints.length - 1;
  const head = stub(endpoints[0], endpoints[1]);
  const tail = stub(endpoints[last], endpoints[last - 1]);

  if (head) ctrl.push(head.phantom, head.tip);
  else ctrl.push(v(pose.positions[endpoints[0]]));
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
    if (i === segments.length - 1 && tail) ctrl.push(tail.tip, tail.phantom);
    else ctrl.push(v(pose.positions[endpoints[i + 1]]));
    ends.push(tail && i === segments.length - 1 ? ctrl.length - 2 : ctrl.length - 1);
  });

  // Arc length at each control point, and the samples of each span, measured along the spline.
  const spline = new CatmullRomCurve3(ctrl, false, "centripetal");
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
    return { segment: s.id, lengthMm, points: (forward ? points : points.reverse()).map(vec), ties, chain };
  });
}
