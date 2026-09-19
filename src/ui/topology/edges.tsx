import { useEffect, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import type { SegmentEdgeData } from "./model";

export interface SegmentEdgeCallbacks {
  onLength: (segmentId: string, lengthMm: number | undefined) => void;
}

let callbacks: SegmentEdgeCallbacks = { onLength: () => {} };
export function setSegmentEdgeCallbacks(c: SegmentEdgeCallbacks) {
  callbacks = c;
}

export function SegmentEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<Edge<SegmentEdgeData>>) {
  const d = data!;
  const path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const purchased = d.segment.assembly !== undefined;
  const color = d.routeColor ?? (selected ? "#2b6cb0" : "#444");
  const title = d.nets.length ? d.nets.map((n) => `${n.label} (${n.domain}, ${n.conductors} cond.)`).join("\n") : "no nets on this segment";
  return (
    <>
      {d.sheaths.map((s) => (
        <path key={s.id} d={path} stroke={s.color} strokeOpacity={0.3} strokeWidth={14 + (s.count - 1 - s.index) * 6} fill="none" strokeLinecap="round" />
      ))}
      <BaseEdge path={path} style={{ stroke: color, strokeWidth: d.routeColor ? 4 : selected ? 3 : 2, strokeDasharray: purchased ? "6 4" : undefined, opacity: d.faded ? 0.25 : 1 }} interactionWidth={16} />
      <title>{title}</title>
      <EdgeLabelRenderer>
        <div className={`seg-label${d.lengthMm === undefined ? " missing" : ""}${purchased ? " purchased" : ""}${d.faded ? " faded" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` }} title={title}>
          {purchased ? (
            <span>
              {d.assemblyName ?? d.segment.assembly} {d.lengthMm !== undefined ? `${d.lengthMm} mm` : ""}
            </span>
          ) : (
            <LengthInput id={id} value={d.lengthMm} />
          )}
          {d.segment.harness && <span className="seg-harness">{d.segment.harness.name}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function LengthInput({ id, value }: { id: string; value: number | undefined }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const n = text.trim() === "" ? undefined : Math.max(0, Math.round(Number(text)));
    if (n !== undefined && Number.isNaN(n)) return setText(value === undefined ? "" : String(value));
    if (n !== value) callbacks.onLength(id, n);
  };
  return (
    <span className="nodrag nopan seg-length">
      <input
        aria-label="Segment length in mm"
        value={text}
        placeholder="?"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(value === undefined ? "" : String(value));
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: `${Math.max(2, text.length) + 1}ch` }}
      />
      mm
    </span>
  );
}
