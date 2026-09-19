import { useRef } from "react";
import { Handle, NodeResizer, Position, type NodeProps, type Node } from "@xyflow/react";
import { useDoc } from "../store";
import { HANDLE_ROW, NODE_HEADER, NODE_WIDTH, componentHeight, handleOffset, type ComponentNodeData, type GroupNodeData, type HubNodeData, type NoteNodeData } from "./model";

export function ComponentNode({ data, selected }: NodeProps<Node<ComponentNodeData>>) {
  const { component, connectors, dimmed, netsAt } = data;
  const height = componentHeight(connectors.length);
  // Render count, exposed so a browser test can prove a drag repaints only the dragged box.
  const renders = useRef(0);
  renders.current += 1;
  const hovered = useDoc((s) => s.hover.component === component.id);
  // Pins lit by the hovered nets, as "designator=colour" pairs so the selector only changes when the lit set does.
  const litPins = useDoc((s) => (s.hover.nets.length === 0 ? "" : connectors.flatMap((c) => (netsAt[c.designator] ?? []).filter((n) => s.hover.nets.includes(n.net.id)).map((n) => `${c.designator}=${n.domain.color}`)).join(",")));
  const lit = new Map(litPins ? litPins.split(",").map((pair) => pair.split("=") as [string, string]) : []);
  return (
    <div className={`cmp-node${dimmed ? " dimmed" : ""}${selected ? " selected" : ""}${hovered && !dimmed ? " hovered" : ""}`} style={{ width: NODE_WIDTH, height }} data-renders={renders.current}>
      <div className="cmp-title" style={{ height: NODE_HEADER }}>
        <span>{component.name}</span>
        {component.definition === undefined && <span className="cmp-oneoff" title="One-off component with inline connectors">one-off</span>}
      </div>
      {connectors.map((c, i) => {
        const off = handleOffset(i, connectors.length);
        const side = i % 2 === 0 ? "left" : "right";
        const nets = netsAt[c.designator] ?? [];
        const title = nets.length ? `${c.designator}: ${nets.map((n) => `${n.net.name ?? n.net.id} (${n.domain.name})`).join(", ")}` : `${c.designator}: no nets`;
        const glow = lit.get(c.designator);
        return (
          <div
            key={c.designator}
            className={`cmp-connector ${side}${glow ? " lit" : ""}`}
            style={{ top: off.y - HANDLE_ROW / 2, height: HANDLE_ROW, ...(glow ? ({ "--glow": glow } as React.CSSProperties) : {}) }}
            title={title}
            onMouseEnter={() => !dimmed && nets.length && useDoc.getState().setHover({ nets: nets.map((n) => n.net.id) })}
            onMouseLeave={() => useDoc.getState().setHover({ nets: [], component: component.id })}
          >
            <span className="cmp-designator">{c.designator}</span>
            {nets.length > 0 && (
              <span className="cmp-dots">
                {nets.map((n) => (
                  <i key={n.net.id} style={{ background: n.domain.color }} />
                ))}
              </span>
            )}
            <Handle id={c.designator} type="source" position={side === "left" ? Position.Left : Position.Right} isConnectable={!dimmed} className="cmp-handle" />
          </div>
        );
      })}
    </div>
  );
}

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
