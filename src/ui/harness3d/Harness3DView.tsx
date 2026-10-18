/**
 * The 3D harness view: the harnesses of the active topology placed in space
 * against a CAD model of the machine. It draws the saved placement, places
 * a part when it is dragged, and writes segment lengths and tie points back
 * when asked.
 */
import { useMemo, useState } from "react";
import { useDoc, useProject } from "../store";
import { ALL, extractAll } from "./model";
import { Workspace3D } from "./Workspace3D";
import { useReferenceModel } from "./ReferenceModel";
import "./harness3d.css";

export function Harness3DView() {
  const project = useProject();
  const activeTopology = useDoc((s) => s.activeTopology);
  const topology = activeTopology ? project.topologies.get(activeTopology) : [...project.topologies.values()][0];
  const world = useMemo(() => (topology ? extractAll(project, topology) : undefined), [project, topology]);
  const [picked, setPicked] = useState(ALL);
  // Read once for the view, so switching topology does not read the CAD file again.
  const referenceModel = useReferenceModel();
  // A harness that was renamed or removed falls back to showing them all.
  const show = world && world.names.includes(picked) ? picked : ALL;

  if (!topology || !world || world.names.length === 0) return <div className="placeholder">Open a topology with a built harness to see it in 3D.</div>;

  const shown = show === ALL ? { nodes: world.all.nodes.length, segments: world.all.segments.length } : { nodes: world.members[show].nodes.size, segments: world.members[show].segments.size };

  return (
    <div className="h3d">
      <div className="h3d-bar">
        <label>
          Harness{" "}
          <select value={show} onChange={(e) => setPicked(e.target.value)}>
            <option>{ALL}</option>
            {world.names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="muted">
          {shown.nodes} endpoints, {shown.segments} segments. Drag empty space to orbit. The cube snaps to standard views.
        </span>
      </div>
      {/* One workspace per topology. The harness filter only changes what is drawn. */}
      <Workspace3D key={topology.id} world={world} show={show} topologyId={topology.id} referenceModel={referenceModel} />
    </div>
  );
}
