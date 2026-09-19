import { create } from "zustand";
import { temporal } from "zundo";
import { useStore } from "zustand";
import {
  ALL_LAYER_ID,
  deletedPaths,
  loadLibrary,
  loadProject,
  saveProject,
  starterProject,
  type FileProblem,
  type Files,
  type Library,
  type Project,
} from "../core";
import { api, fromFiles, toFiles } from "./api";

/**
 * The document store. `project` is the model; every edit goes through
 * `edit(fn)`, which applies an operation from core and marks the document
 * dirty. Autosave diffs the serialized files against the last written set
 * and sends only what changed.
 */

export type View = "connectivity" | "topology";

export interface Selection {
  view: View;
  ids: string[];
}

/** What the pointer is over, anywhere in the app. The canvas glows the counterparts. */
export interface Hover {
  nets: string[];
  component?: string;
}

export const NO_HOVER: Hover = { nets: [] };

interface DocState {
  project: Project | undefined;
  root: string | undefined;
  repoLibrary: Library | undefined;
  problems: FileProblem[];
  /** The files as last written to disk, for diffing on save. */
  written: Files;
  saving: boolean;
  saveError: string | undefined;
  lastSavedAt: number | undefined;
  /** True while the last project is being reopened on load. */
  restoring: boolean;

  activeLayer: string;
  activeTopology: string | undefined;
  view: View;
  selection: Selection;
  hover: Hover;
  drcOpen: boolean;

  openFolder(path: string): Promise<{ isProject: boolean }>;
  /** Reopen the project from the previous session, if any. Resolves once done either way. */
  restoreLastProject(): Promise<void>;
  createProjectHere(name: string): Promise<void>;
  closeProject(): void;
  edit(fn: (p: Project) => Project, label?: string): void;
  setActiveLayer(id: string): void;
  setActiveTopology(id: string | undefined): void;
  setView(view: View): void;
  select(view: View, ids: string[]): void;
  setHover(hover: Hover): void;
  /** While the pointer is down on a box, hover is cleared and ignored, so nothing glows under a moving box. */
  lockHover(locked: boolean): void;
  toggleDrc(open?: boolean): void;
  flush(): Promise<void>;
}

const RECENTS_KEY = "harnessy.recents";
/** The project open when the page was last unloaded, reopened on load. */
const LAST_PROJECT_KEY = "harnessy.lastProject";
const UI_KEY = (root: string) => `harnessy.ui.${root}`;

export function recentProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function pushRecent(root: string) {
  const list = [root, ...recentProjects().filter((r) => r !== root)].slice(0, 10);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

interface UiState {
  activeLayer: string;
  activeTopology?: string;
  view: View;
}

function loadUi(root: string): Partial<UiState> {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY(root)) ?? "{}") as Partial<UiState>;
  } catch {
    return {};
  }
}

function saveUi(root: string, ui: UiState) {
  localStorage.setItem(UI_KEY(root), JSON.stringify(ui));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hoverLocked = false;

export const useDoc = create<DocState>()(
  temporal(
    (set, get) => ({
      project: undefined,
      root: undefined,
      repoLibrary: undefined,
      problems: [],
      written: new Map(),
      saving: false,
      saveError: undefined,
      lastSavedAt: undefined,
      restoring: localStorage.getItem(LAST_PROJECT_KEY) !== null,
      activeLayer: ALL_LAYER_ID,
      activeTopology: undefined,
      view: "connectivity",
      selection: { view: "connectivity", ids: [] },
      hover: NO_HOVER,
      drcOpen: false,

      async openFolder(path) {
        const repoLibrary = get().repoLibrary ?? loadLibrary(toFiles(await api.library()), "library/").library;
        const opened = await api.open(path);
        if (!opened.isProject) {
          set({ root: opened.root, repoLibrary, project: undefined, problems: [] });
          return { isProject: false };
        }
        const files = toFiles(opened.files);
        const { project, problems } = loadProject(files, repoLibrary);
        const ui = loadUi(opened.root);
        const firstTopology = [...project.topologies.keys()].sort()[0];
        pushRecent(opened.root);
        localStorage.setItem(LAST_PROJECT_KEY, opened.root);
        useDoc.temporal.getState().clear();
        set({
          project,
          root: opened.root,
          repoLibrary,
          problems,
          written: saveProject(project),
          activeLayer: ui.activeLayer && (ui.activeLayer === ALL_LAYER_ID || project.file.layers.some((l) => l.id === ui.activeLayer)) ? ui.activeLayer : ALL_LAYER_ID,
          activeTopology: ui.activeTopology && project.topologies.has(ui.activeTopology) ? ui.activeTopology : firstTopology,
          view: ui.view ?? "connectivity",
          selection: { view: "connectivity", ids: [] },
        });
        return { isProject: true };
      },

      async restoreLastProject() {
        const last = localStorage.getItem(LAST_PROJECT_KEY);
        if (last === null) return;
        try {
          const r = await get().openFolder(last);
          if (!r.isProject) localStorage.removeItem(LAST_PROJECT_KEY);
        } catch {
          localStorage.removeItem(LAST_PROJECT_KEY);
        } finally {
          set({ restoring: false });
        }
      },

      async createProjectHere(name) {
        const { root, repoLibrary } = get();
        if (!root) throw new Error("no folder open");
        const project = starterProject(name, repoLibrary);
        const files = saveProject(project);
        await api.write(root, fromFiles(files));
        pushRecent(root);
        localStorage.setItem(LAST_PROJECT_KEY, root);
        useDoc.temporal.getState().clear();
        set({ project, problems: [], written: files, activeLayer: ALL_LAYER_ID, activeTopology: undefined, view: "connectivity", selection: { view: "connectivity", ids: [] } });
      },

      closeProject() {
        localStorage.removeItem(LAST_PROJECT_KEY);
        set({ project: undefined, root: undefined, problems: [], written: new Map(), selection: { view: "connectivity", ids: [] } });
      },

      edit(fn) {
        const { project } = get();
        if (!project) return;
        const nextProject = fn(project);
        if (nextProject === project) return;
        set({ project: nextProject });
        scheduleSave();
      },

      setActiveLayer(id) {
        set({ activeLayer: id });
        persistUi(get());
      },
      setActiveTopology(id) {
        set({ activeTopology: id, selection: { view: "topology", ids: [] } });
        persistUi(get());
      },
      setView(view) {
        set({ view });
        persistUi(get());
      },
      select(view, ids) {
        set({ selection: { view, ids } });
      },
      lockHover(locked) {
        hoverLocked = locked;
        if (locked && get().hover !== NO_HOVER) set({ hover: NO_HOVER });
      },
      setHover(hover) {
        if (hoverLocked) return;
        const cur = get().hover;
        if (cur.component === hover.component && cur.nets.length === hover.nets.length && cur.nets.every((n, i) => n === hover.nets[i])) return;
        set({ hover });
      },
      toggleDrc(open) {
        set((s) => ({ drcOpen: open ?? !s.drcOpen }));
      },

      async flush() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = undefined;
        await saveNow();
      },
    }),
    {
      partialize: (s) => ({ project: s.project }) as DocState,
      limit: 200,
      equality: (a, b) => a.project === b.project,
    },
  ),
);

function persistUi(s: DocState) {
  if (s.root) saveUi(s.root, { activeLayer: s.activeLayer, activeTopology: s.activeTopology, view: s.view });
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void saveNow();
  }, 400);
}

async function saveNow() {
  const { project, root, written } = useDoc.getState();
  if (!project || !root) return;
  const files = saveProject(project);
  const changed: Record<string, string> = {};
  for (const [path, text] of files) if (written.get(path) !== text) changed[path] = text;
  const remove = deletedPaths(written, files);
  if (Object.keys(changed).length === 0 && remove.length === 0) return;
  useDoc.setState({ saving: true, saveError: undefined });
  try {
    await api.write(root, changed, remove);
    useDoc.setState({ written: files, saving: false, lastSavedAt: Date.now() });
  } catch (e) {
    useDoc.setState({ saving: false, saveError: (e as Error).message });
  }
}

// Undo and redo re-enter through the store so autosave sees them.
export function undo() {
  useDoc.temporal.getState().undo();
  scheduleSave();
}
export function redo() {
  useDoc.temporal.getState().redo();
  scheduleSave();
}

export function useTemporal<T>(selector: (s: ReturnType<typeof useDoc.temporal.getState>) => T): T {
  return useStore(useDoc.temporal, selector);
}

/** The project, asserted open. Components under the shell can rely on it. */
export function useProject(): Project {
  const p = useDoc((s) => s.project);
  if (!p) throw new Error("no project open");
  return p;
}
