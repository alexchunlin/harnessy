import { useRef, useState } from "react";
import { create } from "zustand";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import type { RatsnestEdgeData, SegmentEdgeData, Strand } from "./model";

export interface SegmentEdgeCallbacks {
  onLength: (segmentId: string, lengthMm: number | undefined) => void;
  /** The next segment after `from` in topology order that has no length, wrapping once. Purchased assemblies never qualify. */
  nextWithoutLength: (from: string) => string | undefined;
  /** A strand was clicked: select that conductor. */
  onConductor: (address: string) => void;
}

let callbacks: SegmentEdgeCallbacks = { onLength: () => {}, nextWithoutLength: () => undefined, onConductor: () => {} };
export function setSegmentEdgeCallbacks(c: SegmentEdgeCallbacks) {
  callbacks = c;
}

/**
 * Which segment has its length field open. This is transient editing state,
 * not a selection, so it lives beside the document rather than in it.
 */
export const useLengthEditor = create<{ open: string | null; setOpen: (id: string | null) => void }>((set) => ({ open: null, setOpen: (open) => set({ open }) }));

/** The strand under the pointer, as a conductor address. Previews the conductor's highlight without touching the selection. */
export const useConductorHover = create<{ address: string | null; set: (address: string | null) => void }>((set) => ({ address: null, set: (address) => set({ address }) }));

/** How far past the box edge the strands run parallel before they converge, and how long the convergence takes. */
const FAN_PARALLEL = 24;
const FAN_CONVERGE = 16;
/** The connect ring around an endpoint, matching RING in nodes.tsx: a segment attaches at the ring's top centre. */
const RING = 7;
/** The fan starts this far past the ring, so a strand is clickable along its whole length. */
const RING_CLEAR = 4;
/** Strand pitch and width in pixels. */
const PITCH = 3;
const STRAND = 2;
/** How far the length label sits off the line, perpendicular to it. */
const LABEL_OFFSET = 13;

/** Whether the browser can paint a colour name; a wire colour like "white/orange" cannot be drawn and falls back. */
const paintable = new Map<string, boolean>();
function cssColor(color: string, fallback: string): string {
  let ok = paintable.get(color);
  if (ok === undefined) {
    ok = typeof CSS !== "undefined" && typeof CSS.supports === "function" ? CSS.supports("color", color) : true;
    paintable.set(color, ok);
  }
  return ok ? color : fallback;
}

export function SegmentEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<Edge<SegmentEdgeData>>) {
  const d = data!;
  const open = useLengthEditor((s) => s.open === id);
  const setOpen = useLengthEditor((s) => s.setOpen);
  const path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  // The label sits beside the line rather than on it, so the strands at a short segment's ends stay visible and clickable.
  const len = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
  const mx = (sourceX + targetX) / 2 - ((targetY - sourceY) / len) * LABEL_OFFSET;
  const my = (sourceY + targetY) / 2 + ((targetX - sourceX) / len) * LABEL_OFFSET;
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
  const fans = fanGeometry({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, d);
  return (
    <>
      {d.sheaths.map((s) => (
        <path key={s.id} d={path} stroke={s.color} strokeOpacity={0.3} strokeWidth={14 + (s.count - 1 - s.index) * 6} fill="none" strokeLinecap="round" />
      ))}
      <BaseEdge path={path} style={{ stroke: color, strokeWidth: d.routeColor ? 4 : selected ? 3 : 2, strokeDasharray: purchased ? "6 4" : undefined, opacity: d.faded ? 0.25 : 1 }} interactionWidth={16} />
      <title>{title}</title>
      {fans.map((fan, end) => (
        <Fan key={end} fan={fan} strands={d.strands} anyLit={d.anyLit} faded={d.faded} />
      ))}
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
          {d.badge !== undefined && (
            <span className="seg-badge" title={`${d.badge} conductors, too many to fan`}>
              {d.badge} cond.
            </span>
          )}
          {d.segment.harness && <span className="seg-harness">{d.segment.harness.name}</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** One end's fan: where it starts past the endpoint's box, which way it runs, and how long its two parts are. */
interface FanGeometry {
  /** the point on the centreline at the box edge */
  x: number;
  y: number;
  /** unit vector from the box into the segment */
  ux: number;
  uy: number;
  parallel: number;
  converge: number;
}

/**
 * Fans at the ends of a segment that carries strands. A segment attaches at
 * the top centre of an endpoint's connect ring, so each fan starts where the
 * line leaves that ring and the strands are apart by the time they are
 * clickable. On a short segment both fans shrink to fit, and a point
 * endpoint gets none, since the bundle only turns a corner there.
 */
function fanGeometry(a: { x: number; y: number }, b: { x: number; y: number }, d: SegmentEdgeData): FanGeometry[] {
  if (d.strands.length === 0) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len;
  const uy = dy / len;
  // Distance along (vx, vy) from the ring's top centre to where the line leaves the ring's box; zero when it heads upward.
  const exit = (size: { w: number; h: number }, vx: number, vy: number) => {
    if (vy < -1e-6) return 0;
    const tx = Math.abs(vx) > 1e-6 ? (size.w / 2 + RING) / Math.abs(vx) : Infinity;
    const ty = vy > 1e-6 ? (size.h + 2 * RING) / vy : Infinity;
    return Math.min(tx, ty);
  };
  const out = [exit(d.endSizes[0], ux, uy) + RING_CLEAR, exit(d.endSizes[1], -ux, -uy) + RING_CLEAR];
  const room = Math.max(0, len - out[0] - out[1]);
  const scale = Math.min(1, room / (2 * (FAN_PARALLEL + FAN_CONVERGE) + 12));
  if (scale < 0.25) return [];
  const fans: FanGeometry[] = [];
  if (d.fanAt[0]) fans.push({ x: a.x + ux * out[0], y: a.y + uy * out[0], ux, uy, parallel: FAN_PARALLEL * scale, converge: FAN_CONVERGE * scale });
  if (d.fanAt[1]) fans.push({ x: b.x - ux * out[1], y: b.y - uy * out[1], ux: -ux, uy: -uy, parallel: FAN_PARALLEL * scale, converge: FAN_CONVERGE * scale });
  return fans;
}

function strandPath(f: FanGeometry, offset: number): string {
  const nx = -f.uy;
  const ny = f.ux;
  const x0 = f.x + nx * offset;
  const y0 = f.y + ny * offset;
  const x1 = x0 + f.ux * f.parallel;
  const y1 = y0 + f.uy * f.parallel;
  const x2 = f.x + f.ux * (f.parallel + f.converge);
  const y2 = f.y + f.uy * (f.parallel + f.converge);
  const cx = f.ux * (f.converge / 2);
  const cy = f.uy * (f.converge / 2);
  return `M ${x0} ${y0} L ${x1} ${y1} C ${x1 + cx} ${y1 + cy} ${x2 - cx} ${y2 - cy} ${x2} ${y2}`;
}

/**
 * The strands of one fan. Each is its own hit target: a click selects the
 * conductor and the pointer over it previews the highlight. A lit strand
 * draws last and at full width while the rest fall to a quarter.
 */
function Fan({ fan, strands, anyLit, faded }: { fan: FanGeometry; strands: Strand[]; anyLit: boolean; faded: boolean }) {
  const setHover = useConductorHover((s) => s.set);
  const n = strands.length;
  const ordered = [...strands.map((s, i) => ({ s, offset: (i - (n - 1) / 2) * PITCH }))].sort((a, b) => Number(a.s.lit) - Number(b.s.lit));
  return (
    <g className="fan" opacity={faded && !anyLit ? 0.25 : 1}>
      {ordered.map(({ s, offset }) => {
        const p = strandPath(fan, offset);
        const dim = anyLit && !s.lit;
        return (
          <g key={s.address} className={`strand${s.lit ? " lit" : ""}${dim ? " dim" : ""}`} data-conductor={s.address}>
            <path d={p} className="strand-outline" fill="none" strokeWidth={(s.lit ? STRAND + 1 : STRAND) + 1.5} />
            <path d={p} className="strand-line" fill="none" stroke={cssColor(s.color, s.domainColor)} strokeWidth={s.lit ? STRAND + 1 : STRAND} />
            <path
              d={p}
              className="strand-hit"
              fill="none"
              stroke="transparent"
              strokeWidth={6}
              onMouseEnter={() => setHover(s.address)}
              onMouseLeave={() => setHover(null)}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                callbacks.onConductor(s.address);
              }}
            >
              <title>{s.title}</title>
            </path>
          </g>
        );
      })}
    </g>
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
