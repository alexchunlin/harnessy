import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type Edge,
  type EdgeChange,
  type Position as FlowPosition,
} from "@xyflow/react";
import { ALL_LAYER_ID, addConnectorToNet, createGroup, createNet, createNote, moveComponent, moveHub, netsOnlyOn, placeBlankComponent, placeComponent, removeComponent, removeGroup, removeNet, removeNote, updateGroup, type Position, type Project } from "../../core";
import { useDoc, useProject } from "../store";
import { useTheme } from "../theme";
import { activeDomains, componentHeight, deriveFlow, NODE_WIDTH, reconcile, type FlowNode, type NetEdgeData } from "./model";
import { ComponentNode, GroupNode, HubNode, NoteNode } from "./nodes";
import { NetEdge, NoteLinkEdge } from "./edges";
import { DRAG_TYPE, LibraryPanel } from "./LibraryPanel";
import { DomainPicker } from "./DomainPicker";
import { Inspector } from "./Inspector";
import "./connectivity.css";

const nodeTypes = { component: ComponentNode, hub: HubNode, group: GroupNode, note: NoteNode };
const edgeTypes = { net: NetEdge, notelink: NoteLinkEdge };
const LAST_DOMAIN_KEY = "harnessy.lastDomain";

export function ConnectivityView() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

interface PendingNet {
  a: string;
  b: string;
  at: { x: number; y: number };
}

/** Selection ids: component ids, net ids, group ids, note ids. Hub node ids map back to their net. */
function toModelId(nodeId: string): string {
  return nodeId.startsWith("hub:") ? nodeId.slice(4) : nodeId;
}

function Canvas() {
  const project = useProject();
  const edit = useDoc((s) => s.edit);
  const activeLayer = useDoc((s) => s.activeLayer);
  const selection = useDoc((s) => s.selection);
  const select = useDoc((s) => s.select);
  const theme = useTheme((s) => s.theme);
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingNet | undefined>();
  const lastLocalSelection = useRef<string[]>([]);

  const selected = useMemo(() => new Set(selection.view === "connectivity" ? selection.ids : []), [selection]);
  const derived = useMemo(() => deriveFlow(project, activeLayer, selected), [project, activeLayer, selected]);

  // React Flow owns the nodes and edges it draws, so a drag in flight lives
  // there and never touches the project. When the derivation changes, the
  // new items are merged in and anything unchanged keeps its identity.
  const [nodes, setNodes] = useState<FlowNode[]>(derived.nodes);
  const [edges, setEdges] = useState<Edge<NetEdgeData>[]>(derived.edges);
  const [lastDerived, setLastDerived] = useState(derived);
  if (lastDerived !== derived) {
    setLastDerived(derived);
    setNodes(reconcile(nodes, derived.nodes));
    setEdges(reconcile(edges, derived.edges));
  }

  // Selection arriving from outside (the design rule panel) gets revealed.
  useEffect(() => {
    if (selection.view !== "connectivity") return;
    const same = selection.ids.length === lastLocalSelection.current.length && selection.ids.every((id, i) => id === lastLocalSelection.current[i]);
    if (same || selection.ids.length === 0) return;
    lastLocalSelection.current = selection.ids;
    const ids = new Set(selection.ids);
    const targets = nodes.filter((n) => ids.has(toModelId(n.id)));
    const viaEdges = edges.filter((e) => ids.has(e.data?.netId ?? "")).flatMap((e) => [e.source, e.target]);
    const all = [...new Set([...targets.map((n) => n.id), ...viaEdges])].map((id) => ({ id }));
    if (all.length) void flow.fitView({ nodes: all, duration: 300, maxZoom: 1.2, padding: 0.4 });
  }, [selection, nodes, edges, flow]);

  /** Selection follows React Flow's explicit `select` changes; the selection-change callback echoes stale state. */
  const applySelectChanges = useCallback(
    (changes: { type: string; id: string; selected?: boolean }[]) => {
      const selects = changes.filter((c) => c.type === "select");
      if (selects.length === 0) return;
      const current = useDoc.getState().selection;
      const ids = new Set(current.view === "connectivity" ? current.ids : []);
      for (const c of selects) {
        if (c.id.startsWith("note:")) continue;
        const id = c.id.startsWith("hub:") ? c.id.slice(4) : c.id.includes(":") ? c.id.split(":")[0] : c.id;
        if (c.selected) ids.add(id);
        else ids.delete(id);
      }
      const next = [...ids];
      const same = current.view === "connectivity" && current.ids.length === next.length && current.ids.every((id) => ids.has(id));
      if (same) return;
      lastLocalSelection.current = next;
      select("connectivity", next);
    },
    [select],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge<NetEdgeData>>[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      applySelectChanges(changes as { type: string; id: string; selected?: boolean }[]);
    },
    [applySelectChanges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      applySelectChanges(changes as { type: string; id: string; selected?: boolean }[]);
      for (const c of changes) {
        if (c.type === "dimensions" && c.resizing === false && c.dimensions) {
          const g = project.connectivityCanvas.groups.find((g) => g.id === c.id);
          if (g && (g.rect.w !== Math.round(c.dimensions.width) || g.rect.h !== Math.round(c.dimensions.height))) {
            edit((p) => updateGroup(p, c.id, { rect: { ...g.rect, w: Math.round(c.dimensions!.width), h: Math.round(c.dimensions!.height) } }));
          }
        }
      }
    },
    [edit, project, applySelectChanges],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node, dragged: Node[]) => {
      const moved = dragged.length ? dragged : [node];
      edit((p) => {
        let next = p;
        for (const n of moved) {
          const pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
          if (n.type === "component") {
            next = moveComponent(next, n.id, pos);
            next = updateMembership(next, n.id, pos);
          } else if (n.type === "hub") {
            next = moveHub(next, toModelId(n.id), pos);
          } else if (n.type === "group") {
            const g = next.connectivityCanvas.groups.find((g) => g.id === n.id);
            if (g) {
              const dx = pos.x - g.rect.x;
              const dy = pos.y - g.rect.y;
              next = updateGroup(next, n.id, { rect: { ...g.rect, x: pos.x, y: pos.y } });
              if (dx || dy) {
                for (const m of g.members) {
                  if (moved.some((o) => o.id === m)) continue;
                  const c = next.connectivityCanvas.components[m];
                  if (c) next = moveComponent(next, m, { x: c.x + dx, y: c.y + dy });
                }
              }
            }
          } else if (n.type === "note") {
            const note = next.connectivityCanvas.notes.find((x) => x.id === n.id);
            if (note) next = { ...next, connectivityCanvas: { ...next.connectivityCanvas, notes: next.connectivityCanvas.notes.map((x) => (x.id === n.id ? { ...x, ...pos } : x)) } };
          }
        }
        return next;
      });
    },
    [edit],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      if (c.target.startsWith("hub:")) {
        const netId = toModelId(c.target);
        edit((p) => addConnectorToNet(p, netId, `${c.source}/${c.sourceHandle}`));
        return;
      }
      if (c.source.startsWith("hub:") || !c.sourceHandle || !c.targetHandle) return;
      if (c.source === c.target && c.sourceHandle === c.targetHandle) return;
      const a = `${c.source}/${c.sourceHandle}`;
      const b = `${c.target}/${c.targetHandle}`;
      const rect = wrapper.current?.getBoundingClientRect();
      const tp = flow.getNode(c.target)?.position ?? { x: 0, y: 0 };
      const screen = flow.flowToScreenPosition({ x: tp.x + NODE_WIDTH / 2, y: tp.y });
      setPending({ a, b, at: { x: screen.x - (rect?.left ?? 0), y: screen.y - (rect?.top ?? 0) } });
    },
    [edit, flow],
  );

  const pickDomain = useCallback(
    (domain: string) => {
      if (!pending) return;
      localStorage.setItem(LAST_DOMAIN_KEY, domain);
      let id = "";
      edit((p) => {
        const r = createNet(p, domain, [pending.a, pending.b]);
        id = r.id;
        return r.project;
      });
      setPending(undefined);
      lastLocalSelection.current = [id];
      select("connectivity", [id]);
    },
    [pending, edit, select],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const ref = e.dataTransfer.getData(DRAG_TYPE);
      if (!ref) return;
      e.preventDefault();
      const pos = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let id = "";
      edit((p) => {
        const r = placeComponent(p, ref, { x: pos.x - NODE_WIDTH / 2, y: pos.y - 14 });
        id = r.id;
        return r.project;
      });
      lastLocalSelection.current = [id];
      select("connectivity", [id]);
    },
    [flow, edit, select],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
      const pos = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let id = "";
      edit((p) => {
        const r = createNote(p, "", pos);
        id = r.id;
        return r.project;
      });
      lastLocalSelection.current = [id];
      select("connectivity", [id]);
    },
    [flow, edit, select],
  );

  const viewportCentre = useCallback((): Position => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const p = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: p.x - NODE_WIDTH / 2, y: p.y - 20 };
  }, [flow]);

  const newBlank = useCallback(() => {
    const name = window.prompt("Component name", "New component");
    if (!name) return;
    let id = "";
    edit((p) => {
      const r = placeBlankComponent(p, name, viewportCentre());
      id = r.id;
      return r.project;
    });
    lastLocalSelection.current = [id];
    select("connectivity", [id]);
  }, [edit, select, viewportCentre]);

  const selectedComponents = useMemo(() => [...selected].filter((id) => project.components.has(id)), [selected, project]);

  const groupSelection = useCallback(() => {
    if (selectedComponents.length < 2) return;
    const label = window.prompt("Group label", "Group");
    if (label === null) return;
    const boxes = selectedComponents.map((id) => {
      const pos = project.connectivityCanvas.components[id] ?? { x: 0, y: 0 };
      const h = componentHeight((flow.getNode(id)?.data as { connectors?: unknown[] } | undefined)?.connectors?.length ?? 1);
      return { x1: pos.x, y1: pos.y, x2: pos.x + NODE_WIDTH, y2: pos.y + h };
    });
    const pad = 24;
    const x = Math.min(...boxes.map((b) => b.x1)) - pad;
    const y = Math.min(...boxes.map((b) => b.y1)) - pad - 10;
    const w = Math.max(...boxes.map((b) => b.x2)) + pad - x;
    const h = Math.max(...boxes.map((b) => b.y2)) + pad - y;
    let id = "";
    edit((p) => {
      const r = createGroup(p, label || "Group", { x, y, w, h }, selectedComponents);
      id = r.id;
      return r.project;
    });
    lastLocalSelection.current = [id];
    select("connectivity", [id]);
  }, [selectedComponents, project, flow, edit, select]);

  // Delete and Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const current = useDoc.getState().selection;
      if (current.view !== "connectivity") return;
      if (e.key === "Escape") {
        setPending(undefined);
        if (current.ids.length) select("connectivity", []);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (current.ids.length === 0) return;
        e.preventDefault();
        const p0 = useDoc.getState().project!;
        const components = current.ids.filter((id) => p0.components.has(id));
        const lost = components.flatMap((id) => netsOnlyOn(p0, id));
        if (lost.length && !window.confirm(`Delete ${components.length} component${components.length === 1 ? "" : "s"}? ${lost.length} net${lost.length === 1 ? "" : "s"} would go with them.`)) return;
        edit((p) => {
          let next = p;
          for (const id of current.ids) {
            if (next.components.has(id)) next = removeComponent(next, id);
            else if (next.connectivityCanvas.groups.some((g) => g.id === id)) next = removeGroup(next, id);
            else if (next.connectivityCanvas.notes.some((n) => n.id === id)) next = removeNote(next, id);
            else next = removeNet(next, id);
          }
          return next;
        });
        select("connectivity", []);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit, select]);

  const onNodeClick: NodeMouseHandler = useCallback(() => setPending(undefined), []);
  const onEdgeClick: EdgeMouseHandler = useCallback(() => setPending(undefined), []);

  const firstDomains = activeDomains(project, activeLayer);
  const lastUsed = localStorage.getItem(LAST_DOMAIN_KEY) ?? undefined;

  return (
    <div className="view">
      <LibraryPanel project={project} onBlank={newBlank} onGroup={groupSelection} canGroup={selectedComponents.length >= 2} />
      <div className={`canvas${activeLayer === ALL_LAYER_ID ? "" : " in-layer"}`} ref={wrapper} onDrop={onDrop} onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()} onDoubleClick={onDoubleClick} data-testid="connectivity-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={24}
          deleteKeyCode={null}
          selectionOnDrag
          panOnDrag={[1, 2]}
          selectionMode={SelectionMode.Partial}
          zoomOnDoubleClick={false}
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          colorMode={theme}
          elevateEdgesOnSelect
        >
          <Background gap={20} color="var(--grid)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {pending && <DomainPicker domains={project.file.domains} first={firstDomains} lastUsed={lastUsed} at={pending.at} onPick={pickDomain} onCancel={() => setPending(undefined)} />}
      </div>
      <Inspector project={project} selected={selection.view === "connectivity" ? selection.ids : []} edit={edit} />
    </div>
  );
}

/** After a component drag, the group whose rectangle holds its centre owns it. */
function updateMembership(project: Project, componentId: string, pos: Position): Project {
  const cx = pos.x + NODE_WIDTH / 2;
  const cy = pos.y + 20;
  let next = project;
  for (const g of project.connectivityCanvas.groups) {
    const inside = cx >= g.rect.x && cx <= g.rect.x + g.rect.w && cy >= g.rect.y && cy <= g.rect.y + g.rect.h;
    const member = g.members.includes(componentId);
    if (inside && !member) next = updateGroup(next, g.id, { members: [...g.members, componentId] });
    if (!inside && member) next = updateGroup(next, g.id, { members: g.members.filter((m) => m !== componentId) });
  }
  return next;
}

export type { FlowPosition };
