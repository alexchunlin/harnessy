import { useState } from "react";
import { ALL_LAYER_ID, addDomain, addLayer, removeDomain, removeLayer, renameProject, setKeepApart, updateDomain, updateLayer, LIBRARY_FOLDERS } from "../../core";
import { useDoc, useProject } from "../store";

/** Project settings: name, domains, layers, keep-apart pairs. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useProject();
  const edit = useDoc((s) => s.edit);
  const [tab, setTab] = useState<"domains" | "layers" | "keep-apart">("domains");
  const specs = [...project.library.wires.keys()].map((id) => `wires/${id}`).concat([...project.library.cables.keys()].map((id) => `cables/${id}`));
  void LIBRARY_FOLDERS;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <label>
            Project name <input value={project.file.name} onChange={(e) => edit((p) => renameProject(p, e.target.value))} />
          </label>
          <button onClick={onClose}>Close</button>
        </header>
        <nav className="tabs">
          {(["domains", "layers", "keep-apart"] as const).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "keep-apart" ? "Keep apart" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        {tab === "domains" && (
          <table className="settings-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Name</th>
                <th>Colour</th>
                <th>Default spec</th>
                <th>Conductors</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.file.domains.map((d) => (
                <tr key={d.id}>
                  <td>
                    <code>{d.id}</code>
                  </td>
                  <td>
                    <input value={d.name} onChange={(e) => edit((p) => updateDomain(p, d.id, { name: e.target.value }))} />
                  </td>
                  <td>
                    <input type="color" value={d.color} onChange={(e) => edit((p) => updateDomain(p, d.id, { color: e.target.value }))} />
                  </td>
                  <td>
                    <select value={d.spec ?? ""} onChange={(e) => edit((p) => updateDomain(p, d.id, { spec: e.target.value || undefined }))}>
                      <option value="">none</option>
                      {specs.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" min={1} value={d.conductors} onChange={(e) => edit((p) => updateDomain(p, d.id, { conductors: Math.max(1, Number(e.target.value) || 1) }))} />
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        const count = project.nets.get(d.id)?.length ?? 0;
                        if (count && !window.confirm(`Delete domain ${d.name} and its ${count} nets?`)) return;
                        edit((p) => removeDomain(p, d.id));
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "domains" && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const id = (form.elements.namedItem("id") as HTMLInputElement).value.trim();
              const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
              if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return window.alert("A domain id is a lowercase slug, like 48v or motor-phase.");
              if (project.file.domains.some((d) => d.id === id)) return window.alert(`Domain ${id} exists.`);
              edit((p) => addDomain(p, { id, name: name || id, color: "#888888", conductors: 1 }));
              form.reset();
            }}
          >
            <input name="id" placeholder="new domain id (slug)" />
            <input name="name" placeholder="name" />
            <button type="submit">Add domain</button>
          </form>
        )}
        {tab === "layers" && (
          <div>
            {project.file.layers.map((l) => (
              <div key={l.id} className="layer-row">
                <code>{l.id}</code>
                <input value={l.name} onChange={(e) => edit((p) => updateLayer(p, l.id, { name: e.target.value }))} />
                <div className="chips">
                  {project.file.domains.map((d) => {
                    const on = l.domains.includes(d.id);
                    return (
                      <label key={d.id} className={`chip${on ? " on" : ""}`} style={{ borderColor: d.color }}>
                        <input type="checkbox" checked={on} onChange={() => edit((p) => updateLayer(p, l.id, { domains: on ? l.domains.filter((x) => x !== d.id) : [...l.domains, d.id] }))} />
                        {d.name}
                      </label>
                    );
                  })}
                </div>
                <button onClick={() => edit((p) => removeLayer(p, l.id))}>Delete</button>
              </div>
            ))}
            <div className="layer-row muted">
              <code>{ALL_LAYER_ID}</code> All: every domain, built in.
            </div>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const id = (form.elements.namedItem("id") as HTMLInputElement).value.trim();
                const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
                if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id === ALL_LAYER_ID) return window.alert("A layer id is a lowercase slug, and 'all' is taken.");
                if (project.file.layers.some((l) => l.id === id)) return window.alert(`Layer ${id} exists.`);
                edit((p) => addLayer(p, { id, name: name || id, domains: [] }));
                form.reset();
              }}
            >
              <input name="id" placeholder="new layer id (slug)" />
              <input name="name" placeholder="name" />
              <button type="submit">Add layer</button>
            </form>
          </div>
        )}
        {tab === "keep-apart" && (
          <div>
            <p className="muted">Pairs of domains that warn when they share a segment.</p>
            <ul>
              {(project.file.keep_apart ?? []).map(([a, b], i) => (
                <li key={i}>
                  {a} and {b}{" "}
                  <button onClick={() => edit((p) => setKeepApart(p, (p.file.keep_apart ?? []).filter((_, j) => j !== i)))}>Remove</button>
                </li>
              ))}
            </ul>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const a = (form.elements.namedItem("a") as HTMLSelectElement).value;
                const b = (form.elements.namedItem("b") as HTMLSelectElement).value;
                if (!a || !b || a === b) return;
                edit((p) => setKeepApart(p, [...(p.file.keep_apart ?? []), [a, b]]));
              }}
            >
              <select name="a">{project.file.domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <select name="b">{project.file.domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <button type="submit">Add pair</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
