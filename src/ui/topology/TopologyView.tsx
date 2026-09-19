import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow, type Connection, type FinalConnectionState, type Node, type EdgeChange, type NodeChange } from "@xyflow/react";
import { addSegment, growSegment, moveEndpoint, placeConnector, removeEndpoint, removeSegment, removeSheath, removeTiePoint, setSegmentLength, updateTiePoint, type Position } from "../../core";
import { useDoc, useProject } from "../store";
import { useTheme } from "../theme";
import { deriveTopology, endpointCentre, type TopoEdge, type TopoNode } from "./model";
import { EndpointNode, HarnessLabelNode, TieNode } from "./nodes";
import { SegmentEdge, setSegmentEdgeCallbacks } from "./edges";
import { LeftPane, TRAY_DRAG_TYPE } from "./Panels";
import { Inspector } from "./Inspector";
import "./topology.css";

const nodeTypes = { endpoint: EndpointNode, tie: TieNode, harness: HarnessLabelNode };
const edgeTypes = { segment: SegmentEdge };

export function TopologyView() {
  const activeTopology = useDoc((s) => s.activeTopology);
  const project = useProject();
  if (!activeTopology || !project.topologies.has(activeTopology)) {
    return <div className="placeholder">No topology yet. Create one with "New topology" in the toolbar.</div>;
  }
  return (
    <ReactFlowProvider>
      <Canvas topologyId={activeTopology} />
    </ReactFlowProvider>
  );
}

function Canvas({ topologyId }: { topologyId: string }) {
  const project = useProject();
  const topology = project.topologies.get(topologyId)!;
  const edit = useDoc((s) => s.edit);
  const selection = useDoc((s) => s.selection);
  const select = useDoc((s) => s.select);
  const theme = useTheme((s) => s.theme);
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<Map<string, Position>>(new Map());
  const lastLocal = useRef<string[]>([]);

  const selected = useMemo(() => new Set(selection.view === "topology" ? selection.ids : []), [selection]);
  const model = useMemo(() => deriveTopology(project, topology, selected, drafts), [project, topology, selected, drafts]);

  useEffect(() => {
    setSegmentEdgeCallbacks({ onLength: (id, mm) => edit((p) => setSegmentLength(p, topologyId, id, mm)) });
  }, [edit, topologyId]);

  const selectIds = useCallback(
    (ids: string[]) => {
      lastLocal.current = ids;
      select("topology", ids);
    },
    [select],
  );

  // Reveal selection coming from outside (design rule panel, net list).
  useEffect(() => {
    if (selection.view !== "topology" || selection.ids.length === 0) return;
    const same = selection.ids.length === lastLocal.current.length && selection.ids.every((id, i) => id === lastLocal.current[i]);
    if (same) return;
    lastLocal.current = selection.ids;
    const ids = new Set(selection.ids);
    const nodeIds = new Set<string>();
    for (const n of model.nodes) if (ids.has(n.id)) nodeIds.add(n.id);
    for (const s of topology.segments) if (ids.has(s.id)) s.ends.forEach((e) => nodeIds.add(e));
    for (const sh of topology.sheaths) if (ids.has(sh.id)) for (const seg of sh.segments) topology.segments.find((s) => s.id === seg)?.ends.forEach((e) => nodeIds.add(e));
    for (const r of model.routes) if (ids.has(r.net.id)) r.endpoints.forEach((e) => nodeIds.add(e));
    for (const t of topology.ties) if (ids.has(t.id)) nodeIds.add(t.id);
    if (nodeIds.size) void flow.fitView({ nodes: [...nodeIds].map((id) => ({ id })), duration: 300, maxZoom: 1.2, padding: 0.4 });
  }, [selection, model, topology, flow]);

  /**
   * Selection follows React Flow's explicit `select` changes, which are user
   * gestures. The selection-change callback echoes the previous render's
   * selection and would ping-pong with the store.
   */
  const applySelectChanges = useCallback(
    (changes: { type: string; id: string; selected?: boolean }[]) => {
      const selects = changes.filter((c) => c.type === "select");
      if (selects.length === 0) return;
      const current = useDoc.getState().selection;
      const native = (id: string) => topology.endpoints.some((e) => e.id === id) || topology.segments.some((s) => s.id === id) || topology.ties.some((t) => t.id === id);
      const ids = new Set(current.view === "topology" ? current.ids.filter(native) : []);
      for (const c of selects) {
        if (c.id.startsWith("harness:")) continue;
        if (c.selected) ids.add(c.id);
        else ids.delete(c.id);
      }
      const next = [...ids];
      const same = current.view === "topology" && current.ids.length === next.length && current.ids.every((id) => ids.has(id));
      if (!same) selectIds(next);
    },
    [topology, selectIds],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<TopoNode>[]) => {
      setDrafts((prev) => {
        let next: Map<string, Position> | undefined;
        for (const c of changes) {
          if (c.type === "position" && c.position && c.dragging) {
            next ??= new Map(prev);
            next.set(c.id, c.position);
          }
        }
        return next ?? prev;
      });
      applySelectChanges(changes as { type: string; id: string; selected?: boolean }[]);
    },
    [applySelectChanges],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<TopoEdge>[]) => applySelectChanges(changes as { type: string; id: string; selected?: boolean }[]), [applySelectChanges]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node, dragged: Node[]) => {
      const moved = dragged.length ? dragged : [node];
      edit((p) => {
        let next = p;
        for (const n of moved) {
          if (n.type === "endpoint") next = moveEndpoint(next, topologyId, n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
          if (n.type === "tie") {
            const t = topology.ties.find((t) => t.id === n.id);
            const seg = topology.segments.find((s) => s.id === t?.segment);
            if (!t || !seg) continue;
            const other = seg.ends[0] === t.from ? seg.ends[1] : seg.ends[0];
            const fromE = topology.endpoints.find((e) => e.id === t.from);
            const toE = topology.endpoints.find((e) => e.id === other);
            const a = endpointCentre(fromE!.kind, model.positions.get(t.from)!);
            const b = endpointCentre(toE!.kind, model.positions.get(other)!);
            const px = n.position.x + 6;
            const py = n.position.y + 6;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy || 1;
            const f = Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2));
            const length = seg.length_mm ?? (seg.assembly ? (next.library.assemblies.get(seg.assembly.split("/")[1])?.length_mm ?? 0) : 0);
            next = updateTiePoint(next, topologyId, t.id, { distance_mm: Math.round(f * length) });
          }
        }
        return next;
      });
      setDrafts(new Map());
    },
    [edit, topologyId, topology, model],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (!topology.endpoints.some((e) => e.id === c.source) || !topology.endpoints.some((e) => e.id === c.target)) return;
      if (topology.segments.some((s) => (s.ends[0] === c.source && s.ends[1] === c.target) || (s.ends[0] === c.target && s.ends[1] === c.source))) return;
      let id = "";
      edit((p) => {
        const r = addSegment(p, topologyId, c.source, c.target);
        id = r.id;
        return r.project;
      });
      selectIds([id]);
    },
    [edit, topologyId, topology, selectIds],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      if (state.toNode) return;
      const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
      const pos = flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      const from = state.fromNode.id;
      let seg = "";
      edit((p) => {
        const r = growSegment(p, topologyId, from, { x: pos.x - 6, y: pos.y - 6 });
        seg = r.segment;
        return r.project;
      });
      selectIds([seg]);
    },
    [flow, edit, topologyId, selectIds],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const address = e.dataTransfer.getData(TRAY_DRAG_TYPE);
      if (!address) return;
      e.preventDefault();
      const pos = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let id = "";
      edit((p) => {
        const r = placeConnector(p, topologyId, address, { x: pos.x - 75, y: pos.y - 13 });
        id = r.id;
        return r.project;
      });
      selectIds([id]);
    },
    [flow, edit, topologyId, selectIds],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const current = useDoc.getState().selection;
      if (current.view !== "topology") return;
      if (e.key === "Escape" && current.ids.length) selectIds([]);
      if ((e.key === "Delete" || e.key === "Backspace") && current.ids.length) {
        e.preventDefault();
        edit((p) => {
          let next = p;
          const top = next.topologies.get(topologyId)!;
          for (const id of current.ids) {
            if (top.endpoints.some((x) => x.id === id)) next = removeEndpoint(next, topologyId, id);
            else if (top.segments.some((x) => x.id === id)) next = removeSegment(next, topologyId, id);
            else if (top.sheaths.some((x) => x.id === id)) next = removeSheath(next, topologyId, id);
            else if (top.ties.some((x) => x.id === id)) next = removeTiePoint(next, topologyId, id);
          }
          return next;
        });
        selectIds([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit, topologyId, selectIds]);

  const selectedNet = selection.view === "topology" ? selection.ids.find((id) => model.routes.some((r) => r.net.id === id)) : undefined;

  return (
    <div className="view">
      <LeftPane project={project} topologyId={topologyId} routes={model.routes} selectedNet={selectedNet} onSelectNet={(id) => select("topology", [id])} />
      <div className="canvas" ref={wrapper} onDrop={onDrop} onDragOver={(e) => e.dataTransfer.types.includes(TRAY_DRAG_TYPE) && e.preventDefault()} data-testid="topology-canvas">
        <ReactFlow
          nodes={model.nodes}
          edges={model.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={30}
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
      </div>
      <Inspector project={project} topology={topology} routes={model.routes} selected={selection.view === "topology" ? selection.ids : []} edit={edit} onSelect={(ids) => select("topology", ids)} />
    </div>
  );
}
