import { useCallback, useMemo, useRef, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useReactFlow, useStore, type Edge, type EdgeProps } from "@xyflow/react";
import { setBends, type Position } from "../../core";
import type { NetEdgeData } from "./model";
import { useDoc } from "../store";
import { GRID, insertCorner, labelPoint, moveCorner, pathFrom, polyline, shiftRun, simplify, steerableCorners, steerableRuns, type End, type Line, type Side } from "./orthogonal";

/**
 * A net edge: an orthogonal polyline with filleted corners. When selected
 * it shows grips: one on each run (drag to shift it along its normal) and
 * one on each corner (drag to move it, both runs follow). Double-click a
 * run to split it. Bends in flight live here; the drop writes them to the
 * project after clean-up.
 */
export function NetEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<NetEdgeData>>) {
  const d = data!;
  const hovered = useDoc((s) => s.hover.nets.includes(d.netId));
  const flow = useReactFlow();
  // Grips keep a constant screen size; only a selected edge follows the zoom.
  const zoom = useStore((s) => (selected ? s.transform[2] : 1));
  const grip = 10 / zoom;
  const [draft, setDraft] = useState<Position[] | undefined>();
  const a: End = { x: Math.round(sourceX), y: Math.round(sourceY), side: sourcePosition as Side };
  const b: End = { x: Math.round(targetX), y: Math.round(targetY), side: d.hub ? undefined : (targetPosition as Side) };
  const offset = d.siblingCount > 1 ? (d.siblingIndex - (d.siblingCount - 1) / 2) * GRID : 0;
  const bends = draft ?? d.bends;
  const line = useMemo<Line>(() => ({ a, b, bends, offset }), [a.x, a.y, a.side, b.x, b.y, b.side, bends, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const pts = useMemo(() => polyline(line), [line]);
  const path = useMemo(() => pathFrom(pts), [pts]);

  const drag = useRef<{ base: Line; startX: number; startY: number; run?: number; corner?: number } | undefined>(undefined);

  const commit = useCallback(
    (base: Line, next: Position[]) => {
      const cleaned = simplify({ ...base, bends: next });
      useDoc.getState().edit((p) => setBends(p, d.key, cleaned));
    },
    [d.key],
  );

  const onGripDown = useCallback(
    (e: React.PointerEvent, grip: { run?: number; corner?: number }) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { base: { a, b, bends: d.bends, offset }, startX: e.clientX, startY: e.clientY, ...grip };
    },
    [a, b, d.bends, offset],
  );

  const onGripMove = useCallback(
    (e: React.PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      const zoom = flow.getZoom();
      if (g.run !== undefined) {
        setDraft(shiftRun(g.base, g.run, { x: (e.clientX - g.startX) / zoom, y: (e.clientY - g.startY) / zoom }));
      } else if (g.corner !== undefined) {
        setDraft(moveCorner(g.base, g.corner, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })));
      }
    },
    [flow],
  );

  const onGripUp = useCallback(
    (e: React.PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      e.stopPropagation();
      const zoom = flow.getZoom();
      const next =
        g.run !== undefined
          ? shiftRun(g.base, g.run, { x: (e.clientX - g.startX) / zoom, y: (e.clientY - g.startY) / zoom })
          : moveCorner(g.base, g.corner!, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      drag.current = undefined;
      setDraft(undefined);
      commit(g.base, next);
    },
    [flow, commit],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (d.inactive) return;
      e.stopPropagation();
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const runs = steerableRuns(line, pts);
      if (runs.length === 0) return;
      const nearest = runs.reduce((best, r) => (distanceToRun(at, pts[r.run], pts[r.run + 1]) < distanceToRun(at, pts[best.run], pts[best.run + 1]) ? r : best));
      const next = insertCorner(line, nearest.run, at);
      useDoc.getState().edit((p) => setBends(p, d.key, next));
    },
    [d.inactive, d.key, flow, line, pts],
  );

  if (d.inactive) return <BaseEdge path={path} className="net-edge inactive" interactionWidth={0} />;
  const glow = hovered || selected;
  const label = labelPoint(pts);
  return (
    <g onDoubleClick={onDoubleClick}>
      {glow && <path d={path} className="net-halo" style={{ stroke: d.color }} />}
      <BaseEdge path={path} className="net-edge" style={{ stroke: d.color, strokeWidth: glow ? 3 : 2, opacity: glow ? 1 : 0.85 }} interactionWidth={14} />
      {selected && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y - 14}px)`, borderColor: d.color }}>
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {selected &&
        steerableRuns(line, pts).map((r) => (
          <rect
            key={`run-${r.run}`}
            className={`edge-grip run ${r.horizontal ? "ns" : "ew"}`}
            x={r.mid.x - grip / 2}
            y={r.mid.y - grip / 2}
            width={grip}
            height={grip}
            rx={grip / 5}
            style={{ stroke: d.color, strokeWidth: 1.5 / zoom }}
            onPointerDown={(e) => onGripDown(e, { run: r.run })}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
          >
            <title>Drag to shift this run; double-click the line to add a corner</title>
          </rect>
        ))}
      {selected &&
        steerableCorners(line, pts).map((i) => (
          <circle
            key={`corner-${i}`}
            className="edge-grip corner"
            cx={pts[i].x}
            cy={pts[i].y}
            r={grip / 2}
            style={{ stroke: d.color, strokeWidth: 1.5 / zoom }}
            onPointerDown={(e) => onGripDown(e, { corner: i })}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
          >
            <title>Drag to move this corner</title>
          </circle>
        ))}
    </g>
  );
}

function distanceToRun(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function NoteLinkEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge path={path} style={{ stroke: "#999", strokeDasharray: "4 4", strokeWidth: 1 }} interactionWidth={0} />;
}
