import { useMemo, useState } from "react";
import type { ComponentDefinition, Project } from "../../core";

export const DRAG_TYPE = "application/x-harnessy-definition";

export function LibraryPanel({
  project,
  onBlank,
  onGroup,
  canGroup,
  onArrange,
  onDistribute,
  canDistribute,
}: {
  project: Project;
  onBlank: () => void;
  onGroup: () => void;
  canGroup: boolean;
  onArrange: (how: "row" | "column") => void;
  onDistribute: () => void;
  canDistribute: boolean;
}) {
  const [q, setQ] = useState("");
  const entries = useMemo(() => {
    const all = [...project.library.components.values()].sort((a, b) => a.name.localeCompare(b.name));
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((d) => d.name.toLowerCase().includes(needle) || d.id.includes(needle) || d.part_number?.toLowerCase().includes(needle));
  }, [project.library, q]);
  return (
    <div className="pane">
      <h3>Library</h3>
      <input placeholder="Search components" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search components" />
      <ul className="list lib-list">
        {entries.map((d) => (
          <LibraryEntry key={d.id} def={d} shadowed={project.projectLibrary.components.has(d.id)} />
        ))}
        {entries.length === 0 && <li className="muted">No matches</li>}
      </ul>
      <h3>Actions</h3>
      <button onClick={onBlank}>New blank component</button>
      <button onClick={onGroup} disabled={!canGroup} title="Wrap the selected components in a labelled group">
        Group selection
      </button>
      <div className="row">
        <button onClick={() => onArrange("row")} disabled={!canGroup} title="Line the selected components up left to right, tops aligned, one pin pitch apart">
          Arrange in row
        </button>
        <button onClick={() => onArrange("column")} disabled={!canGroup} title="Stack the selected components top to bottom, left edges aligned, one pin pitch apart">
          Arrange in column
        </button>
      </div>
      <button onClick={onDistribute} disabled={!canDistribute} title="Space the selected components evenly between the two outermost">
        Distribute evenly
      </button>
      <p className="muted">Drag a definition onto the canvas to place a component. Drag from one connector handle to another to draw a net. Double-click empty canvas for a note.</p>
    </div>
  );
}

function LibraryEntry({ def, shadowed }: { def: ComponentDefinition; shadowed: boolean }) {
  return (
    <li
      className="lib-entry"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, `components/${def.id}`);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={`${def.connectors.length} connectors${def.part_number ? `, ${def.part_number}` : ""}`}
    >
      <span>{def.name}</span>
      <span className="muted">
        {def.connectors.length} conn{shadowed ? ", project copy" : ""}
      </span>
    </li>
  );
}
