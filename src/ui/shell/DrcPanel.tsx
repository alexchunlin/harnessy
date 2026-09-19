import { runChecks, silence, unsilence, type Finding } from "../../core";
import { useDoc, useProject } from "../store";
import { parseAddress } from "../../core/refs";

/** KiCad-style design rule panel: check, severity, target, click to select. */
export function DrcPanel() {
  const project = useProject();
  const activeTopology = useDoc((s) => s.activeTopology);
  const edit = useDoc((s) => s.edit);
  const select = useDoc((s) => s.select);
  const setView = useDoc((s) => s.setView);
  const toggleDrc = useDoc((s) => s.toggleDrc);
  const topology = activeTopology ? project.topologies.get(activeTopology) : undefined;
  const findings = runChecks(project, topology);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  function jump(f: Finding) {
    setView(f.view);
    // Connector addresses select their component on the connectivity canvas.
    const id = f.view === "connectivity" && f.target.includes("/") ? parseAddress(f.target).component : f.target;
    select(f.view, [id]);
  }

  const Row = ({ f }: { f: Finding }) => (
    <li className={`drc-row drc-${f.severity}${f.silenced ? " drc-silenced" : ""}`}>
      <button className="drc-jump" onClick={() => jump(f)} title={f.target}>
        <span className="drc-check">{f.check}</span>
        <span className="drc-message">{f.message}</span>
      </button>
      {f.severity === "warning" && (
        <button className="drc-silence" onClick={() => edit((p) => (f.silenced ? unsilence(p, f.check, f.target) : silence(p, f.check, f.target)))} title={f.silenced ? "Show this warning again" : "Silence this warning for this item"}>
          {f.silenced ? "Unsilence" : "Silence"}
        </button>
      )}
    </li>
  );

  return (
    <aside className="drc-panel">
      <header>
        <strong>Design rule checks</strong>
        <span className="muted">{topology ? topology.name : "no topology"}</span>
        <button onClick={() => toggleDrc(false)}>Close</button>
      </header>
      <h3>
        Errors <span className="badge badge-error">{errors.length}</span>
      </h3>
      {errors.length === 0 && <p className="muted">None. Export is allowed.</p>}
      <ul>
        {errors.map((f, i) => (
          <Row key={i} f={f} />
        ))}
      </ul>
      <h3>
        Warnings <span className="badge badge-warning">{warnings.filter((w) => !w.silenced).length}</span>
      </h3>
      <ul>
        {warnings.map((f, i) => (
          <Row key={i} f={f} />
        ))}
      </ul>
    </aside>
  );
}
