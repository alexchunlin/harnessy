import type { Project } from "./project";
import * as THREE from "three";
import type { Placement, Vec3 } from "./schema";

/**
 * What is placed in 3D. An endpoint is placed when the placement holds its
 * position. A segment is placed when both its ends are. A tie point is placed
 * when the placement holds its position and its segment is placed. A rotation
 * without a position counts for nothing.
 */

export const EMPTY_PLACEMENT: Placement = { positions: {}, rotations: {}, ties: {} };

/** A topology's placement, or an empty one when nobody has placed anything. */
export function placementOf(project: Project, topologyId: string): Placement {
  return project.placements.get(topologyId) ?? EMPTY_PLACEMENT;
}

export function isEndpointPlaced(project: Project, topologyId: string, endpointId: string): boolean {
  const t = project.topologies.get(topologyId);
  if (!t?.endpoints.some((e) => e.id === endpointId)) return false;
  return placementOf(project, topologyId).positions[endpointId] !== undefined;
}

export function isSegmentPlaced(project: Project, topologyId: string, segmentId: string): boolean {
  const s = project.topologies.get(topologyId)?.segments.find((x) => x.id === segmentId);
  return !!s && s.ends.every((e) => isEndpointPlaced(project, topologyId, e));
}

export function isTiePointPlaced(project: Project, topologyId: string, tieId: string): boolean {
  const tie = project.topologies.get(topologyId)?.ties.find((x) => x.id === tieId);
  return !!tie && placementOf(project, topologyId).ties[tieId] !== undefined && isSegmentPlaced(project, topologyId, tie.segment);
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
 * Positions, connector rotations in degrees (Euler XYZ) and tie point positions, as drawn. Values need not be whole.
 * A saved placement is a pose. The bundle curve takes one, so the view can pass the placement laid over its sketch.
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
