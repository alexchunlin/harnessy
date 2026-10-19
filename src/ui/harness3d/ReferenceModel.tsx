/**
 * The reference CAD model in the 3D view. The project lists it in
 * `canvas/reference.json` and keeps the file in `reference/`; this module
 * reads the file back through the server, draws it, and turns each change
 * in the panel into one edit to the entry. Dimness is a browser preference.
 */
import { useEffect, useState } from "react";
import * as THREE from "three";
import { clearReferenceModel, setReferenceModel, type ReferenceModel } from "../../core";
import { api } from "../api";
import { useDoc } from "../store";
import { usePrefs } from "../prefs";
import { round, scale, sub, type Vec3 } from "./model";
import { ACCEPT, guessUnits, loadReference, setOpacity, UNITS, type Loaded, type Units } from "./reference";

export type ReferenceState =
  | { status: "none" }
  | { status: "loading"; model: ReferenceModel }
  | { status: "missing"; model: ReferenceModel }
  | { status: "error"; model: ReferenceModel; message: string }
  | { status: "ready"; model: ReferenceModel; loaded: Loaded };

const deg = (v: Vec3): Vec3 => [THREE.MathUtils.radToDeg(v[0]), THREE.MathUtils.radToDeg(v[1]), THREE.MathUtils.radToDeg(v[2])];
export const rad = (v: Vec3): Vec3 => [THREE.MathUtils.degToRad(v[0]), THREE.MathUtils.degToRad(v[1]), THREE.MathUtils.degToRad(v[2])];

/** The project's reference model, read from its saved path whenever that path changes. */
export function useReferenceModel(): ReferenceState {
  const root = useDoc((d) => d.root);
  const model = useDoc((d) => d.project?.reference.model);
  const [read, setRead] = useState<{ key: string; loaded?: Loaded; missing?: boolean; message?: string }>();
  const key = model && root ? `${root}\n${model.path}` : undefined;

  useEffect(() => {
    if (!key || !root || !model) return;
    let live = true;
    void (async () => {
      try {
        const bytes = await api.bytes(root, model.path);
        if (!live) return;
        if (!bytes) return setRead({ key, missing: true });
        // Let "Reading" paint before a large STEP file blocks the page.
        await new Promise((r) => setTimeout(r, 30));
        const loaded = await loadReference(new File([bytes], model.path.split("/").pop()!));
        if (live) setRead({ key, loaded });
      } catch (e) {
        if (live) setRead({ key, message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);

  if (!model) return { status: "none" };
  if (!read || read.key !== key) return { status: "loading", model };
  if (read.missing) return { status: "missing", model };
  if (read.loaded) return { status: "ready", model, loaded: read.loaded };
  return { status: "error", model, message: read.message ?? "unreadable" };
}

/** Save a pose the handles left the model at, rotation in radians, as one edit. */
export function placeReference(model: ReferenceModel, position: Vec3, rotation: Vec3): void {
  useDoc.getState().edit((p) => setReferenceModel(p, { ...model, position, rotation: deg(rotation) }), "Move reference model");
}

/** The model at real scale, faded by the dimness preference. Rotation in radians. */
export function ReferenceObject({ loaded, units, position, rotation }: { loaded: Loaded; units: Units; position: Vec3; rotation: Vec3 }) {
  const dimness = usePrefs((p) => p.referenceDimness);
  useEffect(() => setOpacity(loaded.object, 1 - dimness), [loaded.object, dimness]);
  return (
    <group position={position} rotation={rotation} scale={UNITS[units]}>
      <primitive object={loaded.object} />
    </group>
  );
}

/** The panel section: import, the missing file notice, units, dimness, handles, centre and remove. */
export function ReferencePanel({ state, middle, onHandles, onRemoved }: { state: ReferenceState; middle: Vec3; onHandles: () => void; onRemoved: () => void }) {
  const root = useDoc((d) => d.root);
  const dimness = usePrefs((p) => p.referenceDimness);
  const setDimness = usePrefs((p) => p.setReferenceDimness);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState<string>();
  const model = state.status === "none" ? undefined : state.model;

  /** Copy the file into reference/ and point the entry at it. A new file drops in where the old one sat. */
  async function importFile(file: File) {
    if (!root) return;
    setError(undefined);
    setImporting(file.name);
    try {
      const path = await api.upload(root, file);
      const old = useDoc.getState().project?.reference.model;
      useDoc.getState().edit((p) => setReferenceModel(p, { path, units: guessUnits(file.name), position: old?.position ?? [0, 0, 0], rotation: old?.rotation ?? [0, 0, 0] }), "Import reference model");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(undefined);
    }
  }

  const edit = (patch: Partial<ReferenceModel>, label: string) => model && useDoc.getState().edit((p) => setReferenceModel(p, { ...model, ...patch }), label);

  return (
    <div className="h3d-reference">
      <h4>Reference model</h4>
      <label className="h3d-row">
        <input type="file" accept={ACCEPT} onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
      </label>
      {importing && <p className="muted">Copying {importing} into the project.</p>}
      {state.status === "loading" && <p className="muted">Reading {state.model.path}. A large STEP file can take a while.</p>}
      {state.status === "missing" && <p className="error">The reference model {state.model.path} is missing from the project folder. Import the CAD file again.</p>}
      {state.status === "error" && (
        <p className="error">
          {state.model.path}: {state.message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {model && (
        <>
          {state.status === "ready" && (
            <p className="muted">
              {model.path}: {round(state.loaded.size[0] * UNITS[model.units])} × {round(state.loaded.size[1] * UNITS[model.units])} × {round(state.loaded.size[2] * UNITS[model.units])} mm
            </p>
          )}
          <div className="h3d-row">
            <label>
              File units{" "}
              <select value={model.units} onChange={(e) => edit({ units: e.target.value as Units }, "Reference model units")}>
                {Object.keys(UNITS).map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label>
              Dimness <input type="range" min={0} max={0.9} step={0.05} value={dimness} onChange={(e) => setDimness(Number(e.target.value))} />
            </label>
          </div>
          <div className="h3d-row">
            <button disabled={state.status !== "ready"} onClick={onHandles}>
              Handles
            </button>
            {/* Put the middle of the model on the middle of the harness, unturned. */}
            <button disabled={state.status !== "ready"} onClick={() => state.status === "ready" && edit({ rotation: [0, 0, 0], position: sub(middle, scale(state.loaded.centre, UNITS[model.units])) }, "Centre reference model")}>
              Centre on harness
            </button>
            <button
              onClick={() => {
                useDoc.getState().edit(clearReferenceModel, "Remove reference model");
                onRemoved();
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
