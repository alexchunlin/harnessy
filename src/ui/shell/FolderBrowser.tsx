import { useEffect, useState } from "react";
import type { Listing } from "../../server/api";
import { api } from "../api";
import { recentProjects, useDoc } from "../store";

/** Pick a folder on disk. A folder with project.json opens; any other offers to become a project. */
export function FolderBrowser() {
  const [listing, setListing] = useState<Listing | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [goTo, setGoTo] = useState("");
  const [pendingRoot, setPendingRoot] = useState<string | undefined>();
  const [newName, setNewName] = useState("");
  const openFolder = useDoc((s) => s.openFolder);
  const createProjectHere = useDoc((s) => s.createProjectHere);
  const recents = recentProjects();

  async function browse(path?: string) {
    try {
      setListing(await api.list(path));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void browse();
  }, []);

  async function open(path: string) {
    try {
      const r = await openFolder(path);
      if (!r.isProject) {
        setPendingRoot(path);
        setNewName(path.split("/").filter(Boolean).at(-1) ?? "Project");
      }
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (pendingRoot) {
    return (
      <div className="browser">
        <h1>Harnessy</h1>
        <p>
          <code>{pendingRoot}</code> has no <code>project.json</code>.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createProjectHere(newName).catch((err) => setError((err as Error).message));
          }}
        >
          <label>
            Project name <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </label>
          <button type="submit">Create project here</button>
          <button type="button" onClick={() => setPendingRoot(undefined)}>
            Back
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="browser">
      <h1>Harnessy</h1>
      <p>Open a project folder. A folder is a project when it holds project.json.</p>
      {recents.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul className="browser-list">
            {recents.map((r) => (
              <li key={r}>
                <button onClick={() => void open(r)}>{r}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        className="browser-goto"
        onSubmit={(e) => {
          e.preventDefault();
          if (goTo.trim()) void browse(goTo.trim());
        }}
      >
        <input placeholder="Go to path" value={goTo} onChange={(e) => setGoTo(e.target.value)} />
        <button type="submit">Go</button>
      </form>
      {listing && (
        <section>
          <h2>
            <code>{listing.path}</code>
          </h2>
          <div className="browser-actions">
            {listing.parent && <button onClick={() => void browse(listing.parent)}>Up</button>}
            <button onClick={() => void open(listing.path)}>{listing.isProject ? "Open this project" : "Use this folder"}</button>
          </div>
          <ul className="browser-list">
            {listing.folders.map((f) => (
              <li key={f.path}>
                <button onClick={() => void browse(f.path)}>{f.name}/</button>
                {f.isProject && <button onClick={() => void open(f.path)}>Open project</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
