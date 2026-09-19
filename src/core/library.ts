import { z } from "zod";
import { LIBRARY_FOLDERS, LIBRARY_SCHEMAS, type LibraryEntry, type LibraryFolder } from "./schema";
import { parseRef } from "./refs";

/** Relative path to file text. The unit of exchange with disk. */
export type Files = Map<string, string>;

export interface FileProblem {
  path: string;
  message: string;
}

export type Library = { [F in LibraryFolder]: Map<string, LibraryEntry[F]> };

export function emptyLibrary(): Library {
  const lib = {} as Library;
  for (const folder of LIBRARY_FOLDERS) (lib as Record<string, Map<string, unknown>>)[folder] = new Map();
  return lib;
}

/** Explain a Zod failure as a list of path plus message lines. */
export function explain(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "<root>"}: ${i.message}`).join("; ");
}

/**
 * Read library entries from files under `prefix` (for example `library/`).
 * A malformed file is reported and skipped, never fatal.
 */
export function loadLibrary(files: Files, prefix = "library/"): { library: Library; problems: FileProblem[] } {
  const library = emptyLibrary();
  const problems: FileProblem[] = [];
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(${LIBRARY_FOLDERS.join("|")})/([^/]+)\\.json$`);
  for (const [path, text] of files) {
    const m = re.exec(path);
    if (!m) continue;
    const folder = m[1] as LibraryFolder;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      problems.push({ path, message: `invalid JSON: ${(e as Error).message}` });
      continue;
    }
    const parsed = LIBRARY_SCHEMAS[folder].safeParse(raw);
    if (!parsed.success) {
      problems.push({ path, message: explain(parsed.error) });
      continue;
    }
    const entry = parsed.data as { id: string };
    if (entry.id !== m[2]) {
      problems.push({ path, message: `filename ${m[2]} does not match id ${entry.id}` });
      continue;
    }
    (library[folder] as Map<string, unknown>).set(entry.id, entry);
  }
  return { library, problems };
}

/** Project library shadows the repo library whole, entry by entry. */
export function mergeLibraries(repo: Library, project: Library): Library {
  const out = emptyLibrary();
  for (const folder of LIBRARY_FOLDERS) {
    const target = out[folder] as Map<string, unknown>;
    for (const [id, e] of repo[folder]) target.set(id, e);
    for (const [id, e] of project[folder]) target.set(id, e);
  }
  return out;
}

export function resolveRef<F extends LibraryFolder>(library: Library, ref: string, expect?: F): LibraryEntry[F] | undefined {
  const { folder, id } = parseRef(ref);
  if (!LIBRARY_FOLDERS.includes(folder)) return undefined;
  if (expect && folder !== expect) return undefined;
  return library[folder].get(id) as LibraryEntry[F] | undefined;
}

export function resolveSpec(library: Library, ref: string): { kind: "wire"; spec: LibraryEntry["wires"] } | { kind: "cable"; spec: LibraryEntry["cables"] } | undefined {
  const { folder, id } = parseRef(ref);
  if (folder === "wires") {
    const spec = library.wires.get(id);
    return spec ? { kind: "wire", spec } : undefined;
  }
  if (folder === "cables") {
    const spec = library.cables.get(id);
    return spec ? { kind: "cable", spec } : undefined;
  }
  return undefined;
}
