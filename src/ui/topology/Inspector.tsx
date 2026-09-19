import { useState } from "react";
import {
  addTiePoint,
  applySheath,
  buildGraph,
  connectorLabel,
  degree,
  findNet,
  netsThrough,
  removeEndpoint,
  removeSegment,
  removeSheath,
  removeTiePoint,
  resolveRef,
  setBreakoutSpec,
  setEndpointKind,
  setHarnessAnchor,
  setSegmentAssembly,
  setSegmentLength,
  setSpliceNets,
  updateSheath,
  updateTiePoint,
  type Project,
  type Route,
  type Topology,
} from "../../core";
import { endpointName, SHEATH_PALETTE } from "./model";

type Edit = (fn: (p: Project) => Project) => void;

interface Props {
  project: Project;
  topology: Topology;
  routes: Route[];
  selected: string[];
  edit: Edit;
  onSelect: (ids: string[]) => void;
}

export function Inspector(props: Props) {
  const { project, topology, selected } = props;
  const segments = selected.filter((id) => topology.segments.some((s) => s.id === id));
  if (selected.length === 0) return <Overview {...props} />;
  if (segments.length > 1 && segments.length === selected.length) return <MultiSegment {...props} segmentIds={segments} />;
  if (selected.length > 1) {
    return (
      <div className="pane pane-right">
        <h3>Inspector</h3>
        <p className="muted">{selected.length} items selected. Press Delete to remove them.</p>
      </div>
    );
  }
  const id = selected[0];
  if (topology.endpoints.some((e) => e.id === id)) return <EndpointInspector {...props} id={id} />;
  if (topology.segments.some((s) => s.id === id)) return <SegmentInspector {...props} id={id} />;
  if (topology.sheaths.some((s) => s.id === id)) return <SheathInspector {...props} id={id} />;
  if (topology.ties.some((t) => t.id === id)) return <TieInspector {...props} id={id} />;
  const net = findNet(project, id);
  if (net) return <NetInspector {...props} id={id} />;
  return <Overview {...props} />;
}

function Overview({ project, topology, onSelect }: Props) {
  return (
    <div className="pane pane-right">
      <h3>Topology</h3>
      <p>
        {topology.name}: {topology.endpoints.length} endpoints, {topology.segments.length} segments.
      </p>
      <p className="muted">Drag a connector from the tray to place it. Drag from an endpoint to another to join them, or into empty space to grow a point. Shift-click segments, then apply a sheath.</p>
      <h3>Sheaths</h3>
      <ul className="list insp-list">
        {topology.sheaths.map((s, i) => (
          <li key={s.id} onClick={() => onSelect([s.id])}>
            <span>
              <span className="dot" style={{ background: SHEATH_PALETTE[i % SHEATH_PALETTE.length], display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 4 }} />
              {resolveRef(project.library, s.spec, "sheaths")?.name ?? s.spec}
            </span>
            <span className="muted">{s.segments.length} seg</span>
          </li>
        ))}
        {topology.sheaths.length === 0 && <li className="muted">None yet.</li>}
      </ul>
    </div>
  );
}

function EndpointInspector({ project, topology, routes, id, edit }: Props & { id: string }) {
  const e = topology.endpoints.find((x) => x.id === id)!;
  const graph = buildGraph(topology);
  const d = degree(graph, id);
  const through = netsThrough(routes, id);
  return (
    <div className="pane pane-right">
      <h3>{e.kind}</h3>
      <div className="field">
        <label>Name</label>
        <span>{endpointName(project, e)}</span>
      </div>
      <div className="field">
        <label>Segments</label>
        <span>{d}</span>
      </div>
      {e.kind !== "connector" && (
        <div className="field">
          <label>Kind</label>
          <select value={e.kind} onChange={(ev) => edit((p) => setEndpointKind(p, topology.id, id, ev.target.value as "point" | "breakout" | "splice"))}>
            <option value="point">point (exactly two segments)</option>
            <option value="breakout">breakout (three or more)</option>
            <option value="splice">splice (joins conductors)</option>
          </select>
        </div>
      )}
      {e.kind === "breakout" && (
        <div className="field">
          <label>Breakout spec</label>
          <select value={e.spec ?? ""} onChange={(ev) => edit((p) => setBreakoutSpec(p, topology.id, id, ev.target.value || undefined))}>
            <option value="">none</option>
            {[...project.library.breakouts.values()].map((b) => (
              <option key={b.id} value={`breakouts/${b.id}`}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {e.kind === "splice" && (
        <>
          <div className="field">
            <label>Nets joined here</label>
            {through.length === 0 && <span className="muted">No net routes through this splice.</span>}
            {through.map((r) => (
              <label key={r.net.id} className="row">
                <input
                  type="checkbox"
                  checked={e.nets.includes(r.net.id)}
                  onChange={(ev) => edit((p) => setSpliceNets(p, topology.id, id, ev.target.checked ? [...e.nets, r.net.id] : e.nets.filter((n) => n !== r.net.id)))}
                />
                {r.net.name ?? r.net.id} <span className="muted">{r.domain}</span>
              </label>
            ))}
            {e.nets.filter((n) => !through.some((r) => r.net.id === n)).map((n) => (
              <label key={n} className="row error">
                <input type="checkbox" checked onChange={() => edit((p) => setSpliceNets(p, topology.id, id, e.nets.filter((x) => x !== n)))} />
                {findNet(project, n)?.net.name ?? n} <span>(not routed through here)</span>
              </label>
            ))}
          </div>
          <div className="field">
            <label>Splice spec</label>
            <select value={e.spec ?? ""} onChange={(ev) => edit((p) => setSpliceNets(p, topology.id, id, e.nets, ev.target.value || ""))}>
              <option value="">none</option>
              {[...project.library.splices.values()].map((s) => (
                <option key={s.id} value={`splices/${s.id}`}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <button onClick={() => edit((p) => removeEndpoint(p, topology.id, id))}>Delete endpoint{d > 0 ? ` and ${d} segment${d === 1 ? "" : "s"}` : ""}</button>
    </div>
  );
}

function SegmentInspector({ project, topology, routes, id, edit, onSelect }: Props & { id: string }) {
  const s = topology.segments.find((x) => x.id === id)!;
  const graph = buildGraph(topology);
  const ends = s.ends.map((e) => graph.endpoints.get(e));
  const bothConnectors = ends.every((e) => e?.kind === "connector");
  const nets = routes.filter((r) => r.segments.has(id));
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const ties = topology.ties.filter((t) => t.segment === id);
  const [tieSpec, setTieSpec] = useState(() => [...project.library.ties.keys()][0] ?? "");
  return (
    <div className="pane pane-right">
      <h3>Segment</h3>
      <div className="field">
        <label>Ends</label>
        <span>
          {endpointName(project, ends[0])} to {endpointName(project, ends[1])}
        </span>
      </div>
      {!s.assembly && (
        <div className="field">
          <label>Length (mm)</label>
          <input
            type="number"
            min={0}
            value={s.length_mm ?? ""}
            placeholder="not measured"
            onChange={(ev) => edit((p) => setSegmentLength(p, topology.id, id, ev.target.value === "" ? undefined : Number(ev.target.value)))}
          />
        </div>
      )}
      {bothConnectors && (
        <div className="field">
          <label>Purchased assembly</label>
          <select value={s.assembly ?? ""} onChange={(ev) => edit((p) => setSegmentAssembly(p, topology.id, id, ev.target.value || undefined))}>
            <option value="">none, built into a harness</option>
            {[...project.library.assemblies.values()].map((a) => (
              <option key={a.id} value={`assemblies/${a.id}`}>
                {a.name} ({a.length_mm} mm)
              </option>
            ))}
          </select>
        </div>
      )}
      {!s.assembly && (
        <>
          <h3>Harness</h3>
          <div className="field">
            <label>Name (anchored on this segment)</label>
            <input
              value={s.harness?.name ?? ""}
              placeholder="unnamed"
              onChange={(ev) => edit((p) => setHarnessAnchor(p, topology.id, id, ev.target.value ? { name: ev.target.value, part_number: s.harness?.part_number } : undefined))}
            />
          </div>
          {s.harness && (
            <div className="field">
              <label>Part number</label>
              <input value={s.harness.part_number ?? ""} onChange={(ev) => edit((p) => setHarnessAnchor(p, topology.id, id, { name: s.harness!.name, part_number: ev.target.value || undefined }))} />
            </div>
          )}
        </>
      )}
      <h3>Nets on this segment</h3>
      <ul className="list insp-list">
        {nets.map((r) => (
          <li key={r.net.id} onClick={() => onSelect([r.net.id])}>
            <span>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: domains.get(r.domain)?.color, marginRight: 4 }} />
              {r.net.name ?? r.net.id}
            </span>
            <span className="muted">{r.net.conductors ?? domains.get(r.domain)?.conductors ?? 1} cond.</span>
          </li>
        ))}
        {nets.length === 0 && <li className="muted">none</li>}
      </ul>
      <h3>Sheaths</h3>
      <div className="row">
        <SheathApply project={project} topology={topology} segmentIds={[id]} edit={edit} onSelect={onSelect} />
      </div>
      <h3>Tie points</h3>
      <ul className="list insp-list">
        {ties.map((t) => (
          <li key={t.id} onClick={() => onSelect([t.id])}>
            <span>{resolveRef(project.library, t.spec, "ties")?.name ?? t.spec}</span>
            <span className="muted">{t.distance_mm} mm</span>
          </li>
        ))}
      </ul>
      <div className="row">
        <select value={tieSpec} onChange={(ev) => setTieSpec(ev.target.value)} aria-label="Tie spec">
          {[...project.library.ties.values()].map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          disabled={!tieSpec}
          onClick={() => {
            let tid = "";
            edit((p) => {
              const r = addTiePoint(p, topology.id, id, `ties/${tieSpec}`);
              tid = r.id;
              return r.project;
            });
            onSelect([tid]);
          }}
        >
          Add tie point
        </button>
      </div>
      <button onClick={() => edit((p) => removeSegment(p, topology.id, id))}>Delete segment</button>
    </div>
  );
}

function MultiSegment({ project, topology, segmentIds, edit, onSelect }: Props & { segmentIds: string[] }) {
  return (
    <div className="pane pane-right">
      <h3>{segmentIds.length} segments</h3>
      <SheathApply project={project} topology={topology} segmentIds={segmentIds} edit={edit} onSelect={onSelect} />
      <p className="muted">A sheath covers a contiguous chain. The design rule check flags gaps.</p>
    </div>
  );
}

function SheathApply({ project, topology, segmentIds, edit, onSelect }: { project: Project; topology: Topology; segmentIds: string[]; edit: Edit; onSelect: (ids: string[]) => void }) {
  const [spec, setSpec] = useState(() => [...project.library.sheaths.keys()][0] ?? "");
  return (
    <div className="row">
      <select value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="Sheath spec">
        {[...project.library.sheaths.values()].map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        disabled={!spec}
        onClick={() => {
          let id = "";
          edit((p) => {
            const r = applySheath(p, topology.id, segmentIds, `sheaths/${spec}`);
            id = r.id;
            return r.project;
          });
          onSelect([id]);
        }}
      >
        Apply sheath
      </button>
    </div>
  );
}

function SheathInspector({ project, topology, id, edit }: Props & { id: string }) {
  const s = topology.sheaths.find((x) => x.id === id)!;
  const graph = buildGraph(topology);
  let total: number | undefined = s.overlap_mm;
  for (const seg of s.segments) {
    const l = graph.segments.get(seg)?.length_mm;
    if (l === undefined) {
      total = undefined;
      break;
    }
    total += l;
  }
  return (
    <div className="pane pane-right">
      <h3>Sheath</h3>
      <div className="field">
        <label>Spec</label>
        <select value={s.spec} onChange={(e) => edit((p) => updateSheath(p, topology.id, id, { spec: e.target.value }))}>
          {[...project.library.sheaths.values()].map((x) => (
            <option key={x.id} value={`sheaths/${x.id}`}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Overlap (mm)</label>
        <input type="number" min={0} value={s.overlap_mm} onChange={(e) => edit((p) => updateSheath(p, topology.id, id, { overlap_mm: Number(e.target.value) || 0 }))} />
      </div>
      <div className="field">
        <label>Covers</label>
        <span>
          {s.segments.length} segment{s.segments.length === 1 ? "" : "s"}, cut length {total === undefined ? "unknown (a segment has no length)" : `${total} mm`}
        </span>
      </div>
      <button onClick={() => edit((p) => removeSheath(p, topology.id, id))}>Remove sheath</button>
    </div>
  );
}

function TieInspector({ project, topology, id, edit }: Props & { id: string }) {
  const t = topology.ties.find((x) => x.id === id)!;
  const graph = buildGraph(topology);
  const seg = graph.segments.get(t.segment);
  return (
    <div className="pane pane-right">
      <h3>Tie point</h3>
      <div className="field">
        <label>Distance (mm)</label>
        <input type="number" min={0} value={t.distance_mm} onChange={(e) => edit((p) => updateTiePoint(p, topology.id, id, { distance_mm: Number(e.target.value) || 0 }))} />
      </div>
      <div className="field">
        <label>Measured from</label>
        <select value={t.from} onChange={(e) => edit((p) => updateTiePoint(p, topology.id, id, { from: e.target.value }))}>
          {(seg?.ends ?? [t.from]).map((e) => (
            <option key={e} value={e}>
              {endpointName(project, graph.endpoints.get(e))}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Tie spec</label>
        <select value={t.spec} onChange={(e) => edit((p) => updateTiePoint(p, topology.id, id, { spec: e.target.value }))}>
          {[...project.library.ties.values()].map((x) => (
            <option key={x.id} value={`ties/${x.id}`}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <button onClick={() => edit((p) => removeTiePoint(p, topology.id, id))}>Remove tie point</button>
    </div>
  );
}

function NetInspector({ project, routes, id, onSelect }: Props & { id: string }) {
  const found = findNet(project, id)!;
  const route = routes.find((r) => r.net.id === id);
  return (
    <div className="pane pane-right">
      <h3>Net</h3>
      <div className="field">
        <label>Name</label>
        <span>{found.net.name ?? id}</span>
      </div>
      <div className="field">
        <label>Domain</label>
        <span>{found.domain}</span>
      </div>
      <div className="field">
        <label>Connectors</label>
        <ul className="list">
          {found.net.connectors.map((a) => (
            <li key={a}>{connectorLabel(project, a)}</li>
          ))}
        </ul>
      </div>
      {route && (
        <div className="field">
          <label>Route</label>
          <span>
            {route.unplaced.length ? `${route.unplaced.length} connector${route.unplaced.length === 1 ? "" : "s"} not placed` : route.split ? "connectors in different pieces" : `${route.segments.size} segments, ${route.missingLength ? "length incomplete" : `${route.lengthMm} mm`}`}
          </span>
        </div>
      )}
      <button onClick={() => onSelect([])}>Clear highlight</button>
    </div>
  );
}
