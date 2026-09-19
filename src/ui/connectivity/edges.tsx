import { BaseEdge, EdgeLabelRenderer, getStraightPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { NetEdgeData } from "./model";

/**
 * A net edge. Siblings between the same handle pair fan apart: each gets a
 * quadratic bezier whose control point is offset perpendicular to the line.
 */
export function NetEdge({ sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<Edge<NetEdgeData>>) {
  const d = data!;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const spread = 28;
  const offset = d.siblingCount > 1 ? (d.siblingIndex - (d.siblingCount - 1) / 2) * spread : 0;
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const cx = mx + (-dy / len) * offset * 2;
  const cy = my + (dx / len) * offset * 2;
  const path = offset === 0 ? `M ${sourceX} ${sourceY} L ${targetX} ${targetY}` : `M ${sourceX} ${sourceY} Q ${cx} ${cy} ${targetX} ${targetY}`;
  const labelX = offset === 0 ? mx : (sourceX + 2 * cx + targetX) / 4;
  const labelY = offset === 0 ? my : (sourceY + 2 * cy + targetY) / 4;
  if (d.inactive) return <BaseEdge path={path} className="net-edge inactive" interactionWidth={0} />;
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className="net-edge" style={{ stroke: d.color, strokeWidth: selected ? 4 : 2, opacity: selected ? 1 : 0.85 }} interactionWidth={14} />
      {selected && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: d.color }}>
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export function NoteLinkEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge path={path} style={{ stroke: "#999", strokeDasharray: "4 4", strokeWidth: 1 }} interactionWidth={0} />;
}
