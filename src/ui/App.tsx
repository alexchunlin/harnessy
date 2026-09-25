import { useEffect } from "react";
import { useDoc, redo, undo } from "./store";
import { FolderBrowser } from "./shell/FolderBrowser";
import { Toolbar } from "./shell/Toolbar";
import { DrcPanel } from "./shell/DrcPanel";
import { ConnectivityView } from "./connectivity/ConnectivityView";
import { TopologyView } from "./topology/TopologyView";

export function App() {
  const project = useDoc((s) => s.project);
  const view = useDoc((s) => s.view);
  const drcOpen = useDoc((s) => s.drcOpen);
  const restoring = useDoc((s) => s.restoring);

  // A reload reopens the project that was open.
  useEffect(() => {
    void useDoc.getState().restoreLastProject();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onUnload = () => void useDoc.getState().flush();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  if (restoring && !project) return <div className="placeholder">Reopening the last project</div>;
  if (!project) return <FolderBrowser />;

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <div className="app-view">{view === "connectivity" ? <ConnectivityView /> : <TopologyView />}</div>
        {drcOpen && <DrcPanel />}
      </div>
    </div>
  );
}
