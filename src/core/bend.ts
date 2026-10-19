import type { Topology } from "./schema";
import { allRoutes, buildGraph, type Route } from "./derive";
import { resolveRef, resolveSpec } from "./library";
import { netConductors, type Project } from "./project";

/**
 * The bundle's minimum bend radius on each segment that has one: the largest
 * `min_bend_radius_mm` among the specs of every conductor routed over it and
 * every sheath covering it, since a bundle bends no tighter than its
 * stiffest member. Specs with no radius are skipped, and a segment where
 * none declares one is left out.
 */
export function bundleMinimums(project: Project, topology: Topology, routes: Route[] = allRoutes(project, buildGraph(topology))): Map<string, number> {
  const out = new Map<string, number>();
  const raise = (segment: string, mm: number | undefined) => {
    if (mm !== undefined && mm > (out.get(segment) ?? 0)) out.set(segment, mm);
  };
  for (const r of routes) {
    const radii = netConductors(project, r.net, r.domain).map((ref) => (ref ? resolveSpec(project.library, ref)?.spec.min_bend_radius_mm : undefined));
    for (const seg of r.segments) for (const mm of radii) raise(seg, mm);
  }
  for (const sh of topology.sheaths) {
    const mm = resolveRef(project.library, sh.spec, "sheaths")?.min_bend_radius_mm;
    for (const seg of sh.segments) raise(seg, mm);
  }
  return out;
}
