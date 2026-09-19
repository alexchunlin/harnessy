import { useState } from "react";
import { ALL_LAYER_ID, createTopology, runChecks, visibleLayers } from "../../core";
import { redo, undo, useDoc, useProject, useTemporal } from "../store";
import { exportBom } from "./export";
import { SettingsDialog } from "./Settings";

export function Toolbar() {
  const project = useProject();
  const root = useDoc((s) => s.root);
  const view = useDoc((s) => s.view);
  const setView = useDoc((s) => s.setView);
  const activeLayer = useDoc((s) => s.activeLayer);
  const setActiveLayer = useDoc((s) => s.setActiveLayer);
  const activeTopology = useDoc((s) => s.activeTopology);
  const setActiveTopology = useDoc((s) => s.setActiveTopology);
  const edit = useDoc((s) => s.edit);
  const toggleDrc = useDoc((s) => s.toggleDrc);
  const drcOpen = useDoc((s) => s.drcOpen);
  const saving = useDoc((s) => s.saving);
  const saveError = useDoc((s) => s.saveError);
  const closeProject = useDoc((s) => s.closeProject);
  const canUndo = useTemporal((t) => t.pastStates.length > 0);
  const canRedo = useTemporal((t) => t.futureStates.length > 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportError, setExportError] = useState<string | undefined>();

  const topology = activeTopology ? project.topologies.get(activeTopology) : undefined;
  const findings = runChecks(project, topology);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning" && !f.silenced).length;

  function newTopology() {
    const name = window.prompt("Topology name", `Topology ${project.topologies.size + 1}`);
    if (!name) return;
    let id = "";
    edit((p) => {
      const r = createTopology(p, name);
      id = r.id;
      return r.project;
    });
    setActiveTopology(id);
    setView("topology");
  }

  function doExport() {
    if (!topology) return;
    try {
      exportBom(project, topology);
      setExportError(undefined);
    } catch (e) {
      setExportError((e as Error).message);
      toggleDrc(true);
    }
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <strong className="toolbar-title" title={root}>
          {project.file.name}
        </strong>
        <button onClick={() => void useDoc.getState().flush().then(closeProject)} title="Close project">
          Close
        </button>
      </div>
      <div className="toolbar-group toolbar-tabs">
        <button className={view === "connectivity" ? "active" : ""} onClick={() => setView("connectivity")}>
          Connectivity
        </button>
        <button className={view === "topology" ? "active" : ""} onClick={() => setView("topology")}>
          Topology
        </button>
      </div>
      {view === "connectivity" ? (
        <div className="toolbar-group">
          <label>
            Layer{" "}
            <select value={activeLayer} onChange={(e) => setActiveLayer(e.target.value)}>
              {visibleLayers(project).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {activeLayer !== ALL_LAYER_ID && <span className="muted">{visibleLayers(project).find((l) => l.id === activeLayer)?.domains.length} domains</span>}
        </div>
      ) : (
        <div className="toolbar-group">
          <label>
            Topology{" "}
            <select value={activeTopology ?? ""} onChange={(e) => setActiveTopology(e.target.value || undefined)}>
              {project.topologies.size === 0 && <option value="">none</option>}
              {[...project.topologies.values()]
                .sort((a, b) => (a.id < b.id ? -1 : 1))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <button onClick={newTopology}>New topology</button>
          <button onClick={doExport} disabled={!topology} title={errors ? "Export is refused while the topology has design rule errors" : "Download cut list and summary CSV"}>
            Export BOM
          </button>
          {exportError && <span className="error">{exportError}</span>}
        </div>
      )}
      <div className="toolbar-group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)">
          Redo
        </button>
      </div>
      <div className="toolbar-group toolbar-right">
        <span className="muted">{saveError ? <span className="error">Save failed: {saveError}</span> : saving ? "Saving" : "Saved"}</span>
        <button onClick={() => setSettingsOpen(true)}>Settings</button>
        <button className={drcOpen ? "active" : ""} onClick={() => toggleDrc()} title="Design rule checks">
          DRC <span className={errors ? "badge badge-error" : "badge"}>{errors}</span> <span className={warnings ? "badge badge-warning" : "badge"}>{warnings}</span>
        </button>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
