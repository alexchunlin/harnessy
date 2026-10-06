import { conductorColor, type Project } from "../../core";

/**
 * A net's or a domain's conductors as a list of coloured rows, one spec
 * each. Editing any row writes the whole list back, so a single spec with
 * a count becomes a list the first time a row changes.
 */
export function ConductorList({ project, specs, domainColor, onChange, label }: { project: Project; specs: (string | undefined)[]; domainColor: string; onChange: (specs: string[]) => void; label: string }) {
  const options = [...project.library.wires.keys()].map((k) => `wires/${k}`).concat([...project.library.cables.keys()].map((k) => `cables/${k}`));
  const fallback = options[0] ?? "";
  const filled = () => specs.map((s) => s ?? fallback);
  const set = (i: number, ref: string) => {
    const next = filled();
    next[i] = ref;
    onChange(next);
  };
  return (
    <div className="conductor-list">
      {specs.map((s, i) => {
        const color = conductorColor(project.library, s, i, domainColor);
        return (
          <div key={i} className="row conductor-row">
            <span className="swatch" style={{ background: color }} title={color} />
            <span className="muted">{i + 1}</span>
            <select aria-label={`${label} conductor ${i + 1}`} value={s ?? ""} onChange={(e) => set(i, e.target.value)}>
              {s === undefined && <option value="">no spec</option>}
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <button
              title="Remove this conductor"
              disabled={specs.length <= 1}
              onClick={() => {
                const next = filled();
                next.splice(i, 1);
                onChange(next);
              }}
            >
              x
            </button>
          </div>
        );
      })}
      <button disabled={!fallback} onClick={() => onChange([...filled(), filled().at(-1) ?? fallback])}>
        Add conductor
      </button>
    </div>
  );
}
