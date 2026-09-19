import { allNets, connectorLabel, isRouted, unplacedConnectors, type Project, type Route } from "../../core";

export const TRAY_DRAG_TYPE = "application/x-harnessy-connector";

/** Left pane: the tray of unplaced connectors and the net list. */
export function LeftPane({ project, topologyId, routes, selectedNet, onSelectNet }: { project: Project; topologyId: string; routes: Route[]; selectedNet: string | undefined; onSelectNet: (id: string) => void }) {
  const unplaced = unplacedConnectors(project, topologyId);
  const byComponent = new Map<string, string[]>();
  for (const a of unplaced) {
    const c = a.split("/")[0];
    if (!byComponent.has(c)) byComponent.set(c, []);
    byComponent.get(c)!.push(a);
  }
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const nets = allNets(project);
  const routed = new Map(routes.map((r) => [r.net.id, isRouted(r)]));
  const routedCount = [...routed.values()].filter(Boolean).length;
  return (
    <div className="pane">
      <h3>
        Unplaced connectors <span className="badge">{unplaced.length}</span>
      </h3>
      {unplaced.length === 0 && <p className="muted">Every connector is placed.</p>}
      <ul className="list tray">
        {[...byComponent].map(([cmp, addresses]) => (
          <li key={cmp} style={{ cursor: "default" }}>
            <div className="tray-cmp">{project.components.get(cmp)?.name ?? cmp}</div>
            <ul className="list">
              {addresses.map((a) => (
                <li
                  key={a}
                  className="tray-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TRAY_DRAG_TYPE, a);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  title="Drag onto the canvas to place"
                >
                  {a.split("/")[1]}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
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
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{net.name ?? net.id}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
