/**
 * PROTOTYPE for issue #31: three variants of a topology view whose layout the
 * app owns, switchable with `?variant=A|B|C` on the existing topology view.
 * Throwaway. Edits made here live in memory and are never written to disk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type FinalConnectionState, type NodeChange } from "@xyflow/react";
import { ALL_LAYER_ID, activeDomains, addEndpoint, addSegment, allNets, buildGraph, connectorLabel, findNet, isRouted, netLabeller, parseConductor, pieceOf, pieces, removeEndpoint, removeSegment, removeSheath, removeTiePoint, setSegmentLength, type Position, type Project, type Route } from "../../../core";
import { useDoc, useProject } from "../../store";
import { useTheme } from "../../theme";
import { reconcile } from "../../connectivity/model";
import { usePrefs } from "../../prefs";
import { deriveTopology, type TopoEdge, type TopoNode } from "../model";
import { EndpointNode, HarnessLabelNode, TieNode } from "../nodes";
import { RatsnestEdge, SegmentEdge, setSegmentEdgeCallbacks, useConductorHover, useLengthEditor } from "../edges";
import { Inspector } from "../Inspector";
import { layout, stage, topLeft, VARIANTS, type Variant } from "./layout";
import "./prototype.css";

const nodeTypes = { endpoint: EndpointNode, tie: TieNode, harness: HarnessLabelNode };
const edgeTypes = { segment: SegmentEdge, ratsnest: RatsnestEdge };

export function readVariant(): Variant | undefined {
  const v = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.some((x) => x.key === v) ? (v as Variant) : undefined;
}

function writeVariant(v: Variant) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", v);
  window.history.replaceState(null, "", url);
}

export function PrototypeCanvas({ topologyId, variant }: { topologyId: string; variant: Variant }) {
  return (
    <ReactFlowProvider>
      <Canvas topologyId={topologyId} variant={variant} />
    </ReactFlowProvider>
  );
}

const ease = (f: number) => 1 - Math.pow(1 - f, 3);

function Canvas({ topologyId, variant: initial }: { topologyId: string; variant: Variant }) {
  const real = useProject();
  const selection = useDoc((s) => s.selection);
  const select = useDoc((s) => s.select);
  const activeLayer = useDoc((s) => s.activeLayer);
  const theme = useTheme((s) => s.theme);
  const ratsnest = usePrefs((s) => s.ratsnest);
  const hoverConductor = useConductorHover((s) => s.address);
  const flow = useReactFlow();

  // The project this prototype edits, in memory. Re-staged whenever the real one changes.
  const [local, setLocal] = useState<Project>(() => stage(real, topologyId));
  useEffect(() => setLocal(stage(real, topologyId)), [real, topologyId]);
  const edit = useCallback((fn: (p: Project) => Project) => setLocal((p) => fn(p)), []);
  const project = local;
  const topology = project.topologies.get(topologyId)!;

  const [variant, setVariant] = useState<Variant>(initial);
  const [collapsePoints, setCollapsePoints] = useState(true);
  const [weighted, setWeighted] = useState(false);
  const [stretch, setStretch] = useState(true);
  const [animate, setAnimate] = useState(true);
  const [turns, setTurns] = useState<Map<string, number>>(new Map());
  const [roots, setRoots] = useState<Map<string, string>>(new Map());
  const [log, setLog] = useState<string[]>([]);
  const note = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 6)), []);

  const cycle = useCallback(
    (dir: 1 | -1) =>
      setVariant((v) => {
        const i = VARIANTS.findIndex((x) => x.key === v);
        const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length].key;
        writeVariant(next);
        return next;
      }),
    [],
  );
  useEffect(() => writeVariant(variant), [variant]);

  const selected = useMemo(() => new Set(selection.view === "topology" ? selection.ids : []), [selection]);
  const layerDomains = useMemo(() => (activeLayer === ALL_LAYER_ID ? undefined : activeDomains(project, activeLayer)), [project, activeLayer]);
  const highlight = useMemo(() => {
    const nets = new Set<string>();
    const components = new Set<string>();
    if (selection.view === "connectivity") {
      for (const id of selection.ids) {
        if (project.components.has(id)) components.add(id);
        else if (findNet(project, id)) nets.add(id);
      }
    }
    return { nets, components };
  }, [selection, project]);
  const options = useMemo(() => ({ ratsnest, layerDomains, highlightNets: highlight.nets, highlightComponents: highlight.components, hoverConductor: hoverConductor ?? undefined }), [ratsnest, layerDomains, highlight, hoverConductor]);

  // The derived layout, then a short glide from wherever things were to where they go now.
  const target = useMemo(() => topLeft(topology, layout(project, topology, { variant, turns, roots, collapsePoints, weighted, stretch })), [project, topology, variant, turns, roots, collapsePoints, weighted, stretch]);
  const [shown, setShown] = useState(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!animate) {
      setShown(target);
      return;
    }
    const from = shownRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const f = Math.min(1, (t - start) / 350);
      const e = ease(f);
      const m = new Map<string, Position>();
      for (const [id, p] of target) {
        const q = from.get(id) ?? p;
        m.set(id, { x: q.x + (p.x - q.x) * e, y: q.y + (p.y - q.y) * e });
      }
      setShown(m);
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);

  const model = useMemo(() => {
    const m = deriveTopology(project, topology, selected, shown, options);
    // Nothing is dragged by hand: positions belong to the layout. A connector waiting for its first segment is not an error here.
    return { ...m, nodes: m.nodes.map((n) => (n.type === "endpoint" ? { ...n, draggable: false, data: { ...n.data, waiting: n.data.endpoint.kind === "connector" && n.data.degree === 0 } } : n)) };
  }, [project, topology, selected, shown, options]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const [flow_, setFlow] = useState({ model, nodes: model.nodes, edges: model.edges });
  if (flow_.model !== model) setFlow({ model, nodes: reconcile(flow_.nodes, model.nodes), edges: reconcile(flow_.edges, model.edges) });

  const openLength = useLengthEditor((s) => s.setOpen);
  const setHover = useConductorHover((s) => s.set);
  const selectIds = useCallback((ids: string[]) => select("topology", ids), [select]);

  useEffect(() => {
    setSegmentEdgeCallbacks({
      onConductor: (address) => selectIds([address]),
      onLength: (id, mm) => edit((p) => setSegmentLength(p, topologyId, id, mm)),
      nextWithoutLength: (from) => {
        const edges = modelRef.current.edges;
        const at = edges.findIndex((e) => e.id === from);
        for (let k = 1; k <= edges.length; k++) {
          const e = edges[(at + k) % edges.length];
          if (e.type !== "segment" || e.id === from) continue;
          if (e.data!.lengthMm === undefined && e.data!.segment.assembly === undefined) return e.id;
        }
        return undefined;
      },
    });
  }, [edit, topologyId, selectIds]);
  useEffect(() => () => openLength(null), [openLength, topologyId]);
  useEffect(() => () => setHover(null), [setHover, topologyId]);

  // The whole picture fits when the variant changes; a single edit keeps the viewport still so the move can be followed.
  useEffect(() => {
    const t = setTimeout(() => void flow.fitView({ duration: 300, maxZoom: 1 }), 400);
    return () => clearTimeout(t);
  }, [variant, flow]);

  // A pick from the net list or the inspector zooms to what it names, as the real view does.
  const lastLocal = useRef<string[]>([]);
  useEffect(() => {
    if (selection.view !== "topology" || selection.ids.length === 0) {
      lastLocal.current = [];
      return;
    }
    const same = selection.ids.length === lastLocal.current.length && selection.ids.every((id, i) => id === lastLocal.current[i]);
    if (same) return;
    lastLocal.current = selection.ids;
    const ids = new Set(selection.ids);
    const nodeIds = new Set<string>();
    for (const n of model.nodes) if (ids.has(n.id)) nodeIds.add(n.id);
    for (const s of topology.segments) if (ids.has(s.id)) s.ends.forEach((e) => nodeIds.add(e));
    const nets = new Set([...ids].map((id) => parseConductor(id)?.net ?? id));
    for (const r of model.routes) if (nets.has(r.net.id)) r.endpoints.forEach((e) => nodeIds.add(e));
    if (nodeIds.size && !model.nodes.some((n) => ids.has(n.id))) void flow.fitView({ nodes: [...nodeIds].map((id) => ({ id })), duration: 300, maxZoom: 1.2, padding: 0.4 });
  }, [selection, model, topology, flow]);

  const applySelectChanges = useCallback(
    (changes: { type: string; id: string; selected?: boolean }[]) => {
      const selects = changes.filter((c) => c.type === "select");
      if (selects.length === 0) return;
      const current = useDoc.getState().selection;
      const native = (id: string) => topology.endpoints.some((e) => e.id === id) || topology.segments.some((s) => s.id === id) || topology.ties.some((t) => t.id === id);
      const ids = new Set(current.view === "topology" ? current.ids.filter(native) : []);
      for (const c of selects) {
        if (c.id.startsWith("harness:") || c.id.startsWith("ratsnest:")) continue;
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
      const sizes = new Map<string, { width: number; height: number }>();
      for (const c of changes) if (c.type === "dimensions" && c.dimensions) sizes.set(c.id, c.dimensions);
      if (sizes.size) {
        setFlow((f) => {
          let changed = false;
          const nodes = f.nodes.map((n) => {
            const d = sizes.get(n.id);
            if (!d || (n.measured?.width === d.width && n.measured?.height === d.height)) return n;
            changed = true;
            return { ...n, measured: d };
          });
          return changed ? { ...f, nodes } : f;
        });
      }
      applySelectChanges(changes as { type: string; id: string; selected?: boolean }[]);
    },
    [applySelectChanges],
  );
  const onEdgesChange = useCallback((changes: EdgeChange<TopoEdge>[]) => applySelectChanges(changes as { type: string; id: string; selected?: boolean }[]), [applySelectChanges]);

  // Drawing a segment is the whole act of placing: from one endpoint to another joins them, into empty canvas grows a breakout to build on.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (topology.segments.some((s) => (s.ends[0] === c.source && s.ends[1] === c.target) || (s.ends[0] === c.target && s.ends[1] === c.source))) return;
      let id = "";
      edit((p) => {
        const r = addSegment(p, topologyId, c.source!, c.target!);
        id = r.id;
        return r.project;
      });
      selectIds([id]);
      note("Joined two endpoints with a segment.");
    },
    [edit, topologyId, topology, selectIds, note],
  );
  const onConnectEnd = useCallback(
    (_: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || state.toNode) return;
      const from = state.fromNode.id;
      let seg = "";
      edit((p) => {
        const added = addEndpoint(p, topologyId, "breakout", { x: 0, y: 0 });
        const r = addSegment(added.project, topologyId, from, added.id);
        seg = r.id;
        return r.project;
      });
      selectIds([seg]);
      note("Grew a segment to a new breakout. Drag from another connector onto it to join.");
    },
    [edit, topologyId, selectIds, note],
  );

  const pieceOfSelection = useCallback((): string | undefined => {
    const current = useDoc.getState().selection;
    if (current.view !== "topology") return undefined;
    const all = pieces(buildGraph(topology));
    for (const id of current.ids) {
      const p = pieceOf(all, id);
      if (p) return p.id;
      const t = topology.ties.find((t) => t.id === id);
      if (t) return pieceOf(all, t.segment)?.id;
    }
    return undefined;
  }, [topology]);

  const makeRoot = useCallback(() => {
    const current = useDoc.getState().selection;
    const id = current.view === "topology" ? current.ids.find((x) => topology.endpoints.some((e) => e.id === x)) : undefined;
    const piece = id ? pieceOf(pieces(buildGraph(topology)), id)?.id : undefined;
    if (!id || !piece) return;
    setRoots((r) => new Map(r).set(piece, id));
    note("Re-rooted the harness at the selected endpoint.");
  }, [topology, note]);

  const rotate = useCallback(() => {
    const piece = pieceOfSelection();
    if (!piece) return;
    setTurns((t) => new Map(t).set(piece, (t.get(piece) ?? 0) + 1));
    note("Turned the harness a quarter turn clockwise. The turn is remembered only in this tab.");
  }, [pieceOfSelection, note]);

  const unrouteAll = useCallback(() => {
    edit((p) => {
      let next = p;
      const t = next.topologies.get(topologyId)!;
      for (const s of t.segments) next = removeSegment(next, topologyId, s.id);
      for (const e of t.endpoints) if (e.kind !== "connector") next = removeEndpoint(next, topologyId, e.id);
      return next;
    });
    note("Removed every segment. Every connector with a net is waiting below the harness area.");
  }, [edit, topologyId, note]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        cycle(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.key === "r" || e.key === "R") {
        rotate();
        return;
      }
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
  }, [edit, topologyId, selectIds, cycle, rotate]);

  const selectedNet = selection.view === "topology" ? selection.ids.map((id) => parseConductor(id)?.net ?? id).find((id) => model.routes.some((r) => r.net.id === id)) : undefined;
  const rootable = selection.view === "topology" && variant !== "C" && selection.ids.some((x) => topology.endpoints.some((e) => e.id === x));
  const waiting = topology.endpoints.filter((e) => (buildGraph(topology).incident.get(e.id)?.length ?? 0) === 0).length;

  return (
    <div className="view p31">
      <NetPane project={project} routes={model.routes} selectedNet={selectedNet} onSelectNet={(id) => select("topology", [id])} waiting={waiting} />
      <div className={`canvas${layerDomains ? " in-layer" : ""}`} data-testid="topology-canvas">
        <ReactFlow
          nodes={flow_.nodes}
          edges={flow_.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onEdgeDoubleClick={(_, e) => e.type === "segment" && e.data?.segment.assembly === undefined && openLength(e.id)}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={30}
          deleteKeyCode={null}
          selectionOnDrag
          panOnDrag={[1, 2]}
          zoomOnDoubleClick={false}
          fitView
          minZoom={0.05}
          proOptions={{ hideAttribution: true }}
          colorMode={theme}
          elevateEdgesOnSelect
          nodesDraggable={false}
        >
          <Background gap={20} color="var(--grid)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="p31-bar">
          <button onClick={() => cycle(-1)} title="Previous variant (left arrow)">
            ←
          </button>
          <span className="p31-name">
            {variant} <span className="muted">{VARIANTS.find((v) => v.key === variant)!.name}</span>
          </span>
          <button onClick={() => cycle(1)} title="Next variant (right arrow)">
            →
          </button>
          <span className="p31-sep" />
          <label title="A point of degree two sits inside its segment instead of taking a step of its own">
            <input type="checkbox" checked={collapsePoints} onChange={(e) => setCollapsePoints(e.target.checked)} /> collapse points
          </label>
          <label title="Arcs give each branch a share proportional to the connectors under it">
            <input type="checkbox" checked={weighted} onChange={(e) => setWeighted(e.target.checked)} /> weighted arcs
          </label>
          <label title="A node with many children lengthens its segments until they sit a box apart on the arc">
            <input type="checkbox" checked={stretch} onChange={(e) => setStretch(e.target.checked)} /> stretch crowded arcs
          </label>
          <label title="Glide to the new layout instead of jumping">
            <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> glide
          </label>
          <span className="p31-sep" />
          <button onClick={makeRoot} disabled={!rootable} title="Make the selected endpoint the root of its harness">
            Root here
          </button>
          <button onClick={rotate} title="Turn the selected harness a quarter turn (R)">
            Turn (R)
          </button>
          <button onClick={unrouteAll} title="Remove every segment, in memory, to draw the topology again from nothing">
            Unroute all
          </button>
          <button
            onClick={() => {
              setLocal(stage(real, topologyId));
              setTurns(new Map());
              setRoots(new Map());
              note("Back to the project as saved on disk.");
            }}
            title="Forget every edit made in this prototype"
          >
            Reset
          </button>
        </div>
        {log.length > 0 && (
          <div className="p31-log">
            {log.map((l, i) => (
              <div key={i} className={i === 0 ? "" : "muted"}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
      <Inspector project={project} topology={topology} routes={model.routes} selected={selection.view === "topology" ? selection.ids : []} edit={edit} onSelect={(ids) => select("topology", ids)} />
    </div>
  );
}

/** The left pane without the tray: the nets, and a count of connectors waiting for their first segment. */
function NetPane({ project, routes, selectedNet, onSelectNet, waiting }: { project: Project; routes: Route[]; selectedNet: string | undefined; onSelectNet: (id: string) => void; waiting: number }) {
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const nets = allNets(project);
  const label = netLabeller(project);
  const routed = new Map(routes.map((r) => [r.net.id, isRouted(r)]));
  const routedCount = [...routed.values()].filter(Boolean).length;
  return (
    <div className="pane">
      <h3>
        Waiting for a segment <span className="badge">{waiting}</span>
      </h3>
      <p className="muted">{waiting === 0 ? "Every connector with a net is on a segment." : "They sit below the harnesses. Drag from one to start a segment."}</p>
      <h3>
        Nets <span className="badge">{routedCount}/{nets.length} routed</span>
      </h3>
      <ul className="list netlist">
        {nets.map(({ net, domain }) => {
          const ok = routed.get(net.id) ?? false;
          return (
            <li key={net.id} className={selectedNet === net.id ? "selected" : ""} onClick={() => onSelectNet(net.id)} title={`${domain}: ${net.connectors.map((a) => connectorLabel(project, a)).join(", ")}`}>
              <span className="dot" style={{ background: domains.get(domain)?.color }} />
              <span className={`mark${ok ? "" : " unrouted"}`}>{ok ? "ok" : "--"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(net)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
