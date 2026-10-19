import type { Project } from "./project";
import * as THREE from "three";
import type { Placement, Vec3 } from "./schema";

/**
 * What is placed in 3D. An endpoint is placed when the placement holds its
 * position. A segment is placed when both its ends are. A tie point is placed
 * when the placement holds its position and its segment is placed. A rotation
 * without a position counts for nothing. The bundle curve and the lengths
 * read these rules from the placement directly.
 */

export const EMPTY_PLACEMENT: Placement = { positions: {}, rotations: {}, ties: {} };

/** A topology's placement, or an empty one when nobody has placed anything. */
export function placementOf(project: Project, topologyId: string): Placement {
  return project.placements.get(topologyId) ?? EMPTY_PLACEMENT;
}

/** A vector rounded to whole numbers. `|| 0` keeps a -0 from a turn out of the file. */
export const roundVec = (v: Vec3): Vec3 => [Math.round(v[0]) || 0, Math.round(v[1]) || 0, Math.round(v[2]) || 0];

/** True when a placement holds no position, rotation or tie point, so it has no file. */
export function isEmptyPlacement(p: Placement): boolean {
  return Object.values(p).every((r) => Object.keys(r).length === 0);
}

/**
 * A rigid move: a turn about a pivot, then a translation. The turn is a unit
 * quaternion `[x, y, z, w]`, the form three.js hands back from a handle.
 */
export interface RigidMove {
  translate: Vec3;
  turn?: { pivot: Vec3; quaternion: [number, number, number, number] };
}

/**
 * A pose: positions, connector rotations in degrees (Euler XYZ) and tie point positions, as drawn. Values need not be whole.
 * The placement is the saved record; the view draws a pose of it laid over its sketch, and the bundle curve takes that pose.
 */
export interface Pose {
  positions: Record<string, Vec3>;
  rotations: Record<string, Vec3>;
  ties: Record<string, Vec3>;
}

/** Move every part of a pose by one rigid move. Nothing is rounded, so a view can draw from it mid-drag. */
export function moveRigidly(pose: Pose, move: RigidMove): Pose {
  const q = move.turn ? new THREE.Quaternion(...move.turn.quaternion).normalize() : new THREE.Quaternion();
  const pivot = new THREE.Vector3(...(move.turn?.pivot ?? [0, 0, 0]));
  const t = new THREE.Vector3(...move.translate);
  const point = (v: Vec3): Vec3 => {
    const p = new THREE.Vector3(...v).sub(pivot).applyQuaternion(q).add(pivot).add(t);
    return [p.x, p.y, p.z];
  };
  const turn = (deg: Vec3): Vec3 => {
    if (!move.turn) return deg;
    const r = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(deg.map((d) => THREE.MathUtils.degToRad(d)) as Vec3)));
    const e = new THREE.Euler().setFromQuaternion(q.clone().multiply(r));
    return [e.x, e.y, e.z].map((a) => THREE.MathUtils.radToDeg(a)) as Vec3;
  };
  const map = (r: Record<string, Vec3>, f: (v: Vec3) => Vec3) => Object.fromEntries(Object.entries(r).map(([id, v]) => [id, f(v)]));
  return { positions: map(pose.positions, point), rotations: map(pose.rotations, turn), ties: map(pose.ties, point) };
}
