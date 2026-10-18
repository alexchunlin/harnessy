import { allNets, connectorLabel, isRouted, netLabeller, type Project, type Route } from "../../core";

/** Left pane: the net list. Connectors with no segment wait in a grid on the canvas. */
export function LeftPane({ project, routes, selectedNet, onSelectNet }: { project: Project; routes: Route[]; selectedNet: string | undefined; onSelectNet: (id: string) => void }) {
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const nets = allNets(project);
  const label = netLabeller(project);
  const routed = new Map(routes.map((r) => [r.net.id, isRouted(r)]));
  const routedCount = [...routed.values()].filter(Boolean).length;
  return (
    <div className="pane">
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
