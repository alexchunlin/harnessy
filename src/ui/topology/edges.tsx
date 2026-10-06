import { useRef, useState } from "react";
import { create } from "zustand";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import type { RatsnestEdgeData, SegmentEdgeData } from "./model";

export interface SegmentEdgeCallbacks {
  onLength: (segmentId: string, lengthMm: number | undefined) => void;
  /** The next segment after `from` in topology order that has no length, wrapping once. Purchased assemblies never qualify. */
  nextWithoutLength: (from: string) => string | undefined;
}

let callbacks: SegmentEdgeCallbacks = { onLength: () => {}, nextWithoutLength: () => undefined };
export function setSegmentEdgeCallbacks(c: SegmentEdgeCallbacks) {
  callbacks = c;
}

/**
 * Which segment has its length field open. This is transient editing state,
 * not a selection, so it lives beside the document rather than in it.
 */
export const useLengthEditor = create<{ open: string | null; setOpen: (id: string | null) => void }>((set) => ({ open: null, setOpen: (open) => set({ open }) }));

export function SegmentEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<Edge<SegmentEdgeData>>) {
  const d = data!;
  const open = useLengthEditor((s) => s.open === id);
  const setOpen = useLengthEditor((s) => s.setOpen);
  const path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const mx = (sourceX + targetX) / 2;
  const my = (sourceY + targetY) / 2;
  const purchased = d.segment.assembly !== undefined;
  const color = d.routeColor ?? (selected ? "#2b6cb0" : "#444");
  const nets = d.nets.length ? d.nets.map((n) => `${n.label} (${n.domain}, ${n.conductors} cond.)`).join("\n") : "no nets on this segment";
  const title = purchased ? nets : `${nets}\nDouble-click to set the length`;
  if (d.outOfLayer) {
    // Outside the active layer: a grey line and a plain label, nothing to click.
    return (
      <>
        <BaseEdge path={path} className="seg-out-of-layer" style={{ strokeDasharray: purchased ? "6 4" : undefined }} interactionWidth={0} />
        <EdgeLabelRenderer>
          <div className="seg-label out-of-layer" style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` }}>
            <span>{d.lengthMm !== undefined ? `${d.lengthMm} mm` : "?"}</span>
            {d.segment.harness && <span className="seg-harness">{d.segment.harness.name}</span>}
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }
  return (
    <>
      {d.sheaths.map((s) => (
        <path key={s.id} d={path} stroke={s.color} strokeOpacity={0.3} strokeWidth={14 + (s.count - 1 - s.index) * 6} fill="none" strokeLinecap="round" />
      ))}
      <BaseEdge path={path} style={{ stroke: color, strokeWidth: d.routeColor ? 4 : selected ? 3 : 2, strokeDasharray: purchased ? "6 4" : undefined, opacity: d.faded ? 0.25 : 1 }} interactionWidth={16} />
      <title>{title}</title>
      <EdgeLabelRenderer>
        <div
          className={`seg-label${d.lengthMm === undefined ? " missing" : ""}${purchased ? " purchased" : ""}${d.faded ? " faded" : ""}${open ? " editing" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` }}
          title={title}
          data-segment={id}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!purchased) setOpen(id);
          }}
        >
          {purchased ? (
            <span>
              {d.assemblyName ?? d.segment.assembly} {d.lengthMm !== undefined ? `${d.lengthMm} mm` : ""}
            </span>
          ) : open ? (
            <LengthField id={id} value={d.lengthMm} />
          ) : (
            <span className="seg-length">{d.lengthMm !== undefined ? `${d.lengthMm} mm` : "?"}</span>
          )}
          {d.segment.harness && <span className="seg-harness">{d.segment.harness.name}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * The open length field. Enter and blur commit, Escape reverts, Tab commits
 * and opens the next segment that has no length. Each closes the field, and
 * the `done` guard keeps the blur that follows from committing twice.
 */
function LengthField({ id, value }: { id: string; value: number | undefined }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const setOpen = useLengthEditor((s) => s.setOpen);
  const done = useRef(false);
  const commit = () => {
    const t = text.trim();
    const n = t === "" ? undefined : Math.max(0, Math.round(Number(t)));
    if (n !== undefined && Number.isNaN(n)) return;
    if (n !== value) callbacks.onLength(id, n);
  };
  const finish = (save: boolean, next = false) => {
    if (done.current) return;
    done.current = true;
    if (save) commit();
    setOpen(next ? (callbacks.nextWithoutLength(id) ?? null) : null);
  };
  return (
    <span className="nodrag nopan seg-length">
      <input
        aria-label="Segment length in mm"
        autoFocus
        value={text}
        placeholder="?"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
          else if (e.key === "Tab") {
            e.preventDefault();
            finish(true, true);
          }
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: `${Math.max(8, text.length + 1)}ch` }}
      />
      mm
    </span>
  );
}

/** One line of the ratsnest: 1 px, dashed, faint, in the net's domain colour. Hover for the net and its two ends. */
export function RatsnestEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<RatsnestEdgeData>>) {
  const d = data!;
  const path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  return (
    <>
      <BaseEdge path={path} className="ratsnest-line" style={{ stroke: d.color, strokeWidth: 1, strokeDasharray: "4 3", opacity: 0.45 }} interactionWidth={8} />
      <title>{d.title}</title>
    </>
  );
}
