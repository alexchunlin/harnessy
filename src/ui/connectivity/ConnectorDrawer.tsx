import { useMemo, useState } from "react";
import { connectorTypeInventory, drawerRows, ownerKey, setConnectorTypes, type ConnectorTypeUse, type DrawerRow, type Project } from "../../core";

type Edit = (fn: (p: Project) => Project) => void;

const rowKey = (r: DrawerRow) => `${ownerKey(r.owner)}|${r.designator}`;

/**
 * The connector drawer (ADR 0003): every connector whose type can change,
 * grouped by owner, filterable by type, with checkbox rows and one control
 * that sets the type of the selection in one undo step.
 */
export function ConnectorDrawer({ project, edit, onClose }: { project: Project; edit: Edit; onClose: () => void }) {
  const rows = useMemo(() => drawerRows(project), [project]);
  const inventory = useMemo(() => connectorTypeInventory(project), [project]);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState("");

  const visible = filter ? rows.filter((r) => r.type === filter) : rows;
  const selected = visible.filter((r) => picked.has(rowKey(r)));
  const groups: { key: string; rows: DrawerRow[] }[] = [];
  for (const r of visible) {
    const key = ownerKey(r.owner);
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(r);
    else groups.push({ key, rows: [r] });
  }

  const toggle = (r: DrawerRow, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowKey(r));
      else next.delete(rowKey(r));
      return next;
    });

  const setType = (targets: DrawerRow[], type: string) => {
    if (!type || targets.length === 0) return;
    edit((p) => setConnectorTypes(p, targets.map((r) => ({ owner: r.owner, designator: r.designator, type }))));
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog connector-drawer" role="dialog" aria-label="Connector drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Connectors</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <div className="drawer-controls">
          <label>
            Filter by type{" "}
            <select aria-label="Filter by type" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All types ({rows.length} rows)</option>
              {inventory.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.short} ({t.count})
                </option>
              ))}
            </select>
          </label>
          <span className="drawer-bulk">
            <TypePicker label="Type for selected" inventory={inventory} value={bulkType} onChange={setBulkType} placeholder="Choose a type" />
            <button disabled={!bulkType || selected.length === 0} onClick={() => setType(selected, bulkType)}>
              Set type of {selected.length} selected
            </button>
          </span>
        </div>
        <MissingTypeLine />
        <table className="settings-table drawer-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select every row shown"
                  checked={visible.length > 0 && selected.length === visible.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(visible.map(rowKey)) : new Set())}
                />
              </th>
              <th>Designator</th>
              <th>Type</th>
              <th>Mating part</th>
              <th>Pins</th>
            </tr>
          </thead>
          {groups.map(({ key, rows: group }) => {
            const first = group[0];
            return (
              <tbody key={key} aria-label={first.ownerName}>
                <tr className="drawer-owner">
                  <th colSpan={5}>
                    {first.ownerName}{" "}
                    <span className="muted">{first.owner.kind === "definition" ? `definition, ${first.users} ${first.users === 1 ? "component" : "components"}` : "one-off"}</span>
                  </th>
                </tr>
                {group.map((r) => (
                  <tr key={rowKey(r)}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${r.ownerName} ${r.designator}`} checked={picked.has(rowKey(r))} onChange={(e) => toggle(r, e.target.checked)} />
                    </td>
                    <td>
                      <code>{r.designator}</code>
                    </td>
                    <td>
                      <TypePicker label={`Connector type of ${r.ownerName} ${r.designator}`} inventory={inventory} value={r.type} onChange={(t) => setType([r], t)} />
                    </td>
                    <td>{r.mating ?? <span className="muted">not in library</span>}</td>
                    <td>{r.pins ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
        {visible.length === 0 && <p className="muted">No connectors of this type.</p>}
      </div>
    </div>
  );
}

/** Library connector types only. A value the library lacks shows as such and cannot be picked again. */
function TypePicker({ label, inventory, value, onChange, placeholder }: { label: string; inventory: ConnectorTypeUse[]; value: string; onChange: (type: string) => void; placeholder?: string }) {
  const known = inventory.some((t) => t.type === value);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {!known && value && (
        <option value={value} disabled>
          {value.slice(value.indexOf("/") + 1)} (not in library)
        </option>
      )}
      {inventory.map((t) => (
        <option key={t.type} value={t.type}>
          {t.short}
        </option>
      ))}
    </select>
  );
}

/** The picker's closing line. #44 replaces it with a control that copies a prompt for the library skill. */
function MissingTypeLine() {
  return <p className="muted drawer-missing">A type that is not in the list is a job for the library skill.</p>;
}
