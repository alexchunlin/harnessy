import { useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, useReactFlow, useUpdateNodeInternals, type NodeProps, type Node } from "@xyflow/react";
import { movePin, type Side } from "../../core";
import { useDoc } from "../store";
import { HANDLE_ROW, NODE_HEADER, PIN_BAND, pinSlotAt, slotMarker, type ComponentNodeData, type GroupNodeData, type HubNodeData, type NoteNodeData } from "./model";

export function ComponentNode({ id, data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps<Node<ComponentNodeData>>) {
  const { component, connectors, geometry, dimmed, netsAt } = data;
  // Render count, exposed so a browser test can prove a drag repaints only the dragged box.
  const renders = useRef(0);
  renders.current += 1;
  const hovered = useDoc((s) => s.hover.component === component.id);
  // Pins lit by the hovered nets, as "designator=colour" pairs so the selector only changes when the lit set does.
  const litPins = useDoc((s) => (s.hover.nets.length === 0 ? "" : connectors.flatMap((c) => (netsAt[c.designator] ?? []).filter((n) => s.hover.nets.includes(n.net.id)).map((n) => `${c.designator}=${n.domain.color}`)).join(",")));
  const lit = new Map(litPins ? litPins.split(",").map((pair) => pair.split("=") as [string, string]) : []);

  // Handles move when pins are re-seated; React Flow must re-measure them for the edges to follow.
  const updateNodeInternals = useUpdateNodeInternals();
  const pinKey = Object.entries(geometry.pins)
    .map(([d, p]) => `${d}:${p.x},${p.y}`)
    .join(";");
  const seenKey = useRef(pinKey);
  useEffect(() => {
    // Only on a change: React Flow measures the node itself on mount, and an early update would let it fit the view too soon.
    if (seenKey.current === pinKey) return;
    seenKey.current = pinKey;
    updateNodeInternals(id);
  }, [id, pinKey, updateNodeInternals]);

  // Dragging a pin's label re-seats it: the nearest side, the nearest slot.
  const flow = useReactFlow();
  const [slot, setSlot] = useState<{ designator: string; side: Side; index: number } | undefined>();
  const dragging = useRef<string | undefined>(undefined);
  const onLabelDown = (e: React.PointerEvent, designator: string) => {
    if (dimmed) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = designator;
    useDoc.getState().lockHover(true);
  };
  const onLabelMove = (e: React.PointerEvent) => {
    const designator = dragging.current;
    if (!designator) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const at = pinSlotAt(geometry, { x: p.x - positionAbsoluteX, y: p.y - positionAbsoluteY }, designator);
    setSlot((prev) => (prev && prev.side === at.side && prev.index === at.index && prev.designator === designator ? prev : { designator, ...at }));
  };
  const onLabelUp = (e: React.PointerEvent) => {
    const designator = dragging.current;
    dragging.current = undefined;
    useDoc.getState().lockHover(false);
    if (!designator) return;
    e.stopPropagation();
    const target = slot;
    setSlot(undefined);
    if (!target || target.designator !== designator) return;
    const current = geometry.sides[target.side].filter((d) => d !== designator);
    const currentIndex = geometry.sides[target.side].indexOf(designator);
    if (currentIndex !== -1 && current.length + 1 === geometry.sides[target.side].length && currentIndex === target.index) return;
    useDoc.getState().edit((p) => movePin(p, component.id, designator, target.side, target.index));
  };

  const marker = slot ? slotMarker(geometry, slot.side, slot.index) : undefined;
  const byDesignator = new Map(connectors.map((c) => [c.designator, c]));
  return (
    <div className={`cmp-node${dimmed ? " dimmed" : ""}${selected ? " selected" : ""}${hovered && !dimmed ? " hovered" : ""}`} style={{ width: geometry.width, height: geometry.height }} data-renders={renders.current}>
      <div className="cmp-title" style={{ top: geometry.header, height: NODE_HEADER }}>
        <span>{component.name}</span>
        {component.definition === undefined && <span className="cmp-oneoff" title="One-off component with inline connectors">one-off</span>}
      </div>
      {Object.entries(geometry.pins).map(([designator, spot]) => {
        const c = byDesignator.get(designator);
        if (!c) return null;
        const nets = netsAt[designator] ?? [];
        const title = nets.length ? `${designator}: ${nets.map((n) => `${n.net.name ?? n.net.id} (${n.domain.name})`).join(", ")}` : `${designator}: no nets`;
        const glow = lit.get(designator);
        const vertical = spot.side === "top" || spot.side === "bottom";
        const style: React.CSSProperties = vertical
          ? { left: spot.x - HANDLE_ROW / 2, top: spot.side === "top" ? 0 : geometry.height - PIN_BAND, width: HANDLE_ROW, height: PIN_BAND }
          : { top: spot.y - HANDLE_ROW / 2, height: HANDLE_ROW, width: "50%" };
        return (
          <div
            key={designator}
            className={`cmp-connector ${spot.side}${glow ? " lit" : ""}`}
            style={{ ...style, ...(glow ? ({ "--glow": glow } as React.CSSProperties) : {}) }}
            title={title}
            onMouseEnter={() => !dimmed && nets.length && useDoc.getState().setHover({ nets: nets.map((n) => n.net.id) })}
            onMouseLeave={() => useDoc.getState().setHover({ nets: [], component: component.id })}
          >
            <span className="cmp-designator nodrag" onPointerDown={(e) => onLabelDown(e, designator)} onPointerMove={onLabelMove} onPointerUp={onLabelUp} title={`${title}. Drag to move this pin to another side or slot.`}>
              {designator}
            </span>
            {nets.length > 0 && (
              <span className="cmp-dots">
                {nets.map((n) => (
                  <i key={n.net.id} style={{ background: n.domain.color }} />
                ))}
              </span>
            )}
            <Handle id={designator} type="source" position={POSITION[spot.side]} isConnectable={!dimmed} className="cmp-handle" />
          </div>
        );
      })}
      {marker && <div className={`pin-slot${marker.horizontal ? " horizontal" : " vertical"}`} style={{ left: marker.x, top: marker.y }} />}
    </div>
  );
}

const POSITION: Record<Side, Position> = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };

export function HubNode({ data, selected }: NodeProps<Node<HubNodeData>>) {
  const hovered = useDoc((s) => s.hover.nets.includes(data.net.id));
  return (
    <div
      className={`hub-node${selected ? " selected" : ""}${hovered && !data.inactive ? " hovered" : ""}${data.inactive ? " inactive" : ""}`}
      style={{ background: data.inactive ? undefined : data.color, ...({ "--glow": data.color } as React.CSSProperties) }}
      title={`${data.label}: ${data.net.connectors.length} connectors`}
    >
      <Handle id="hub" type="target" position={Position.Top} className="hub-handle" />
    </div>
  );
}

export function GroupNode({ data, selected }: NodeProps<Node<GroupNodeData>>) {
  return (
    <div className={`group-node${selected ? " selected" : ""}`} style={{ width: data.group.rect.w, height: data.group.rect.h }}>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={60} />
      <div className="group-label">{data.group.label}</div>
    </div>
  );
}

export function NoteNode({ data, selected }: NodeProps<Node<NoteNodeData>>) {
  return (
    <div className={`note-node${selected ? " selected" : ""}`}>
      {data.note.text || <span className="muted">empty note</span>}
      <Handle id="anchor" type="source" position={Position.Bottom} className="note-handle" />
    </div>
  );
}
