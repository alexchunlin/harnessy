import type { Project } from "./project";
import type { Placement } from "./schema";

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
