import type { Topology } from "./schema";
import { bundleCurves, type SegmentCurve } from "./curve";
import { resolveRef } from "./library";
import { placementOf } from "./placement";
import type { Project } from "./project";

/**
 * The one length function. Every routed length and tie point distance in
 * core comes from here: routes, legs, the BOM, the checks, and the slack and
 * build sheet work that reads them. Nothing else reads `length_mm` or
 * `distance_mm`.
 *
 * A placed built segment measures its bundle curve. An unplaced one keeps its
 * typed length, which may be missing. A purchased assembly keeps its library
 * length, placed or not, and reports its drawn path beside it. A placed tie
 * point measures the curve from its named end; an unplaced one keeps its
 * typed distance. Values from 3D round to whole millimetres. Nothing here
 * writes the stored numbers.
 */

/** Where a number came from: the 3D placement, the topology file, or the purchased assembly's library entry. */
export type LengthSource = "3d" | "typed" | "library";

export interface SegmentLength {
  /** The routed length in millimetres, or undefined when an unplaced segment has none typed. */
  mm: number | undefined;
  source: LengthSource;
  /** A placed purchased assembly's drawn path length, beside its library length. */
  pathMm?: number;
}

export interface TieDistance {
  /** Millimetres from the tie point's named end. */
  mm: number;
  source: "3d" | "typed";
}

export interface Lengths {
  /** Every segment of the topology, by id. */
  segments: Map<string, SegmentLength>;
  /** Every tie point of the topology, by id. */
  ties: Map<string, TieDistance>;
}

/** No lengths at all, for a route read only for the segments it runs over. */
export const NO_LENGTHS: Lengths = { segments: new Map(), ties: new Map() };

const cache = new WeakMap<Project, WeakMap<Topology, Lengths>>();

/**
 * Each segment's routed length and each tie point's distance in one topology,
 * with their sources. A caller that already has the bundle curves over the
 * saved placement passes them, so they are not built twice.
 */
export function lengthsOf(project: Project, topology: Topology, measured?: Map<string, SegmentCurve>): Lengths {
  let byTopology = cache.get(project);
  if (!byTopology) cache.set(project, (byTopology = new WeakMap()));
  const hit = byTopology.get(topology);
  if (hit) return hit;
  const curves = measured ?? bundleCurves(project, topology, placementOf(project, topology.id));
  const segments = new Map<string, SegmentLength>();
  for (const s of topology.segments) {
    const curve = curves.get(s.id);
    if (s.assembly) {
      const mm = resolveRef(project.library, s.assembly, "assemblies")?.length_mm;
      segments.set(s.id, curve ? { mm, source: "library", pathMm: Math.round(curve.lengthMm) } : { mm, source: "library" });
    } else if (curve) segments.set(s.id, { mm: Math.round(curve.lengthMm), source: "3d" });
    else segments.set(s.id, { mm: s.length_mm, source: "typed" });
  }
  const ties = new Map<string, TieDistance>();
  for (const t of topology.ties) {
    const curve = curves.get(t.segment);
    const fromStart = curve?.ties[t.id];
    const seg = topology.segments.find((s) => s.id === t.segment);
    if (curve && seg && fromStart !== undefined) {
      // Measured from the far end, the distance is the complement of the rounded numbers, so the two always sum to the length.
      const d = Math.round(fromStart);
      ties.set(t.id, { mm: t.from === seg.ends[0] ? d : Math.round(curve.lengthMm) - d, source: "3d" });
    } else ties.set(t.id, { mm: t.distance_mm, source: "typed" });
  }
  const out = { segments, ties };
  byTopology.set(topology, out);
  return out;
}

/** A tie point's distance from its named end, or undefined when the topology has no such tie point. */
export function tieDistance(lengths: Lengths, tieId: string): number | undefined {
  return lengths.ties.get(tieId)?.mm;
}
