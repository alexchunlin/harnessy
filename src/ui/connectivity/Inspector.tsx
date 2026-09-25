import { addConnectorToNet, allConnectorAddresses, componentConnectors, connectorLabel, findNet, flipComponent, moveNetToDomain, movePin, netsOnlyOn, pinLayout, removeComponent, removeConnectorFromNet, removeGroup, removeNet, removeNote, renameComponent, renameNet, resetBends, setInlineConnectors, setNetSpec, SIDES, updateGroup, updateNote, type Project, type Side } from "../../core";
import { allNets } from "../../core";
import { NO_HOVER, useDoc, type Hover } from "../store";

const hover = (h: Hover) => useDoc.getState().setHover(h);
const unhover = () => hover(NO_HOVER);

type Edit = (fn: (p: Project) => Project) => void;

export function Inspector({ project, selected, edit }: { project: Project; selected: string[]; edit: Edit }) {
  if (selected.length === 0) {
    return (
      <div className="pane pane-right">
        <h3>Inspector</h3>
        <p className="muted">Select a component, net, group, or note.</p>
        <h3>Nets</h3>
        <p className="muted">{allNets(project).length} nets across {project.file.domains.length} domains.</p>
      </div>
    );
  }
  if (selected.length > 1) {
    return (
      <div className="pane pane-right">
        <h3>Inspector</h3>
        <p className="muted">{selected.length} items selected. Group them from the library panel, or press Delete.</p>
      </div>
    );
  }
  const id = selected[0];
  const component = project.components.get(id);
  if (component) return <ComponentInspector project={project} id={id} edit={edit} />;
  const net = findNet(project, id);
  if (net) return <NetInspector project={project} id={id} edit={edit} />;
  const group = project.connectivityCanvas.groups.find((g) => g.id === id);
  if (group) {
    return (
      <div className="pane pane-right">
        <h3>Group</h3>
        <div className="field">
          <label>Label</label>
          <input value={group.label} onChange={(e) => edit((p) => updateGroup(p, id, { label: e.target.value }))} />
        </div>
        <div className="field">
          <label>Members</label>
          <ul className="list">
            {group.members.map((m) => (
              <li key={m}>{project.components.get(m)?.name ?? m}</li>
            ))}
            {group.members.length === 0 && <li className="muted">Drag components into the rectangle.</li>}
          </ul>
        </div>
        <button onClick={() => edit((p) => removeGroup(p, id))}>Delete group</button>
      </div>
    );
  }
  const note = project.connectivityCanvas.notes.find((n) => n.id === id);
  if (note) {
    const nets = allNets(project);
    return (
      <div className="pane pane-right">
        <h3>Note</h3>
        <div className="field">
          <label>Text</label>
          <textarea rows={5} value={note.text} onChange={(e) => edit((p) => updateNote(p, id, { text: e.target.value }))} autoFocus />
        </div>
        <div className="field">
          <label>Attached to</label>
          <select
            value={note.component ? `c:${note.component}` : note.net ? `n:${note.net}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              edit((p) => updateNote(p, id, { component: v.startsWith("c:") ? v.slice(2) : undefined, net: v.startsWith("n:") ? v.slice(2) : undefined }));
            }}
          >
            <option value="">nothing</option>
            <optgroup label="Components">
              {[...project.components.values()].map((c) => (
                <option key={c.id} value={`c:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Nets">
              {nets.map(({ net }) => (
                <option key={net.id} value={`n:${net.id}`}>
                  {net.name ?? net.id}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <button onClick={() => edit((p) => removeNote(p, id))}>Delete note</button>
      </div>
    );
  }
  return (
    <div className="pane pane-right">
      <p className="muted">Nothing to show for {id}.</p>
    </div>
  );
}

function ComponentInspector({ project, id, edit }: { project: Project; id: string; edit: Edit }) {
  const c = project.components.get(id)!;
  const connectors = componentConnectors(project, c);
  const nets = allNets(project);
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const connectorTypes = [...project.library.connectors.keys()].sort();
  return (
    <div className="pane pane-right">
      <h3>Component</h3>
      <div className="field">
        <label>Name</label>
        <input value={c.name} onChange={(e) => edit((p) => renameComponent(p, id, e.target.value))} />
      </div>
      <div className="field">
        <label>Definition</label>
        <span>{c.definition ?? <span className="muted">one-off, connectors declared inline</span>}</span>
      </div>
      <div className="field">
        <label>Id</label>
        <code>{c.id}</code>
      </div>
      <div className="row">
        <button onClick={() => edit((p) => flipComponent(p, id, "horizontal"))} title="Swap the left and right pins">
          Flip horizontal
        </button>
        <button onClick={() => edit((p) => flipComponent(p, id, "vertical"))} title="Swap the top and bottom pins">
          Flip vertical
        </button>
      </div>
      <h3>Pins</h3>
      <PinList project={project} id={id} edit={edit} />
      <h3>Connectors</h3>
      {connectors === undefined && <p className="error">Definition {c.definition} is missing from the library.</p>}
      <ul className="list">
        {(connectors ?? []).map((con, i) => {
          const address = `${id}/${con.designator}`;
          const attached = nets.filter((n) => n.net.connectors.includes(address));
          return (
            <li key={con.designator} className="insp-connector" onMouseEnter={() => hover({ nets: attached.map((n) => n.net.id) })} onMouseLeave={unhover}>
              {c.connectors ? (
                <div className="row">
                  <input className="short" value={con.designator} aria-label="Designator" onChange={(e) => edit((p) => setInlineConnectors(p, id, c.connectors!.map((x, j) => (j === i ? { ...x, designator: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") } : x))))} />
                  <select value={con.connector} onChange={(e) => edit((p) => setInlineConnectors(p, id, c.connectors!.map((x, j) => (j === i ? { ...x, connector: e.target.value } : x))))}>
                    {connectorTypes.map((t) => (
                      <option key={t} value={`connectors/${t}`}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => edit((p) => setInlineConnectors(p, id, c.connectors!.filter((_, j) => j !== i)))} title="Remove connector">
                    x
                  </button>
                </div>
              ) : (
                <div className="row">
                  <strong>{con.designator}</strong> <span className="muted">{con.connector.split("/")[1]}</span>
                </div>
              )}
              <div className="insp-nets">
                {attached.length === 0 && <span className="muted">no nets</span>}
                {attached.map(({ net, domain }) => (
                  <span key={net.id} className="chip on" style={{ borderColor: domains.get(domain)?.color }} onMouseEnter={() => hover({ nets: [net.id] })} onMouseLeave={() => hover({ nets: attached.map((n) => n.net.id) })}>
                    {net.name ?? net.id}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {c.connectors && (
        <button
          onClick={() => {
            const first = connectorTypes[0];
            if (!first) return window.alert("The library has no connector types.");
            const n = c.connectors!.length + 1;
            edit((p) => setInlineConnectors(p, id, [...c.connectors!, { designator: `J${n}`, connector: `connectors/${first}` }]));
          }}
        >
          Add connector
        </button>
      )}
      <button
        onClick={() => {
          const lost = netsOnlyOn(project, id);
          if (lost.length && !window.confirm(`Delete ${c.name}? ${lost.length} net${lost.length === 1 ? "" : "s"} would go with it.`)) return;
          edit((p) => removeComponent(p, id));
        }}
      >
        Delete component
      </button>
    </div>
  );
}

/** Pins per side, in drawn order, with move controls for when dragging is fiddly. */
function PinList({ project, id, edit }: { project: Project; id: string; edit: Edit }) {
  const layout = pinLayout(project, project.components.get(id)!);
  return (
    <div className="pin-list">
      {SIDES.map((side) => (
        <div key={side} className="pin-side">
          <div className="pin-side-name">{side}</div>
          {layout[side].length === 0 && <span className="muted">none</span>}
          <ul className="list">
            {layout[side].map((d, i) => (
              <li key={d} className="row pin-row">
                <code style={{ flex: 1 }}>{d}</code>
                <button aria-label={`Move ${d} up`} title="Move up" disabled={i === 0} onClick={() => edit((p) => movePin(p, id, d, side, i - 1))}>
                  ↑
                </button>
                <button aria-label={`Move ${d} down`} title="Move down" disabled={i === layout[side].length - 1} onClick={() => edit((p) => movePin(p, id, d, side, i + 1))}>
                  ↓
                </button>
                <select aria-label={`Side of ${d}`} value={side} onChange={(e) => edit((p) => movePin(p, id, d, e.target.value as Side, layout[e.target.value as Side].length))}>
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NetInspector({ project, id, edit }: { project: Project; id: string; edit: Edit }) {
  const { net, domain } = findNet(project, id)!;
  const d = project.file.domains.find((x) => x.id === domain);
  const specs = [...project.library.wires.keys()].map((k) => `wires/${k}`).concat([...project.library.cables.keys()].map((k) => `cables/${k}`));
  const free = allConnectorAddresses(project).filter((a) => !net.connectors.includes(a));
  const hasBends = Object.keys(project.connectivityCanvas.bends).some((k) => k === id || k.startsWith(`${id}:`));
  return (
    <div className="pane pane-right">
      <h3>Net</h3>
      <div className="field">
        <label>Name</label>
        <input value={net.name ?? ""} placeholder={net.id} onChange={(e) => edit((p) => renameNet(p, id, e.target.value))} />
      </div>
      <div className="field">
        <label>Domain</label>
        <select value={domain} onChange={(e) => edit((p) => moveNetToDomain(p, id, e.target.value))}>
          {project.file.domains.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Spec override</label>
        <div className="row">
          <select value={net.spec ?? ""} onChange={(e) => edit((p) => setNetSpec(p, id, e.target.value || undefined, net.conductors))}>
            <option value="">domain default{d?.spec ? ` (${d.spec})` : " (none)"}</option>
            {specs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Conductors</label>
          <input type="number" min={1} value={net.conductors ?? ""} placeholder={String(d?.conductors ?? 1)} onChange={(e) => edit((p) => setNetSpec(p, id, net.spec, e.target.value ? Math.max(1, Number(e.target.value)) : undefined))} />
        </div>
      </div>
      <h3>Connectors</h3>
      <ul className="list">
        {net.connectors.map((a) => (
          <li key={a} className="row" onMouseEnter={() => hover({ nets: [id], component: a.split("/")[0] })} onMouseLeave={unhover}>
            <span style={{ flex: 1 }}>{connectorLabel(project, a)}</span>
            <button onClick={() => edit((p) => removeConnectorFromNet(p, id, a))} title="Remove from net" disabled={net.connectors.length <= 2}>
              x
            </button>
          </li>
        ))}
      </ul>
      <select value="" onChange={(e) => e.target.value && edit((p) => addConnectorToNet(p, id, e.target.value))} aria-label="Add connector to net">
        <option value="">Add connector</option>
        {free.map((a) => (
          <option key={a} value={a}>
            {connectorLabel(project, a)}
          </option>
        ))}
      </select>
      <div className="row">
        <button onClick={() => edit((p) => resetBends(p, id))} disabled={!hasBends} title="Forget the hand-placed bends; the line routes itself again">
          Reset bends
        </button>
        <button onClick={() => edit((p) => removeNet(p, id))}>Delete net</button>
      </div>
    </div>
  );
}
