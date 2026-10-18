import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The file API behind the Vite plugin. Pure functions over the filesystem so
 * tests can drive them against a temporary directory without a server.
 *
 * Scope rules: listing is read-only and stays under the home folder. Reads
 * and writes are allowed only inside folders opened in this session and the
 * repo library, which is read-only.
 */

export interface ApiOptions {
  /** Where the folder browser starts and the fence for listing. */
  home?: string;
  /** Absolute path to the repo `library/` folder. */
  repoLibrary: string;
}

export interface DirEntry {
  name: string;
  path: string;
  isProject: boolean;
}

export interface Listing {
  path: string;
  parent: string | undefined;
  folders: DirEntry[];
  isProject: boolean;
}

export type FileMap = Record<string, string>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const PROJECT_FILE = "project.json";
const REFERENCE_DIR = "reference";

/** What upload accepts, photos then CAD, with the content type bytes answers for each. */
const UPLOAD_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".step": "application/octet-stream",
  ".stp": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".stl": "model/stl",
  ".obj": "model/obj",
};

/** Lower case letters, digits and single dashes. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createApi(options: ApiOptions) {
  const home = path.resolve(options.home ?? os.homedir());
  const repoLibrary = path.resolve(options.repoLibrary);
  const opened = new Set<string>();

  function inside(parent: string, child: string): boolean {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  function assertOpened(root: string): string {
    const abs = path.resolve(root);
    if (!opened.has(abs)) throw new ApiError(403, `folder not opened in this session: ${root}`);
    return abs;
  }

  function safeJoin(root: string, rel: string): string {
    if (rel.split(/[\\/]/).some((part) => part === "..")) throw new ApiError(400, `path escapes its folder: ${rel}`);
    const abs = path.resolve(root, rel);
    if (!inside(root, abs)) throw new ApiError(400, `path escapes its folder: ${rel}`);
    return abs;
  }

  async function readTree(root: string): Promise<FileMap> {
    const out: FileMap = {};
    async function walk(dir: string) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) await walk(abs);
        else if (e.isFile() && e.name.endsWith(".json")) out[path.relative(root, abs).split(path.sep).join("/")] = await fs.readFile(abs, "utf8");
      }
    }
    await walk(root);
    return out;
  }

  return {
    home: () => home,

    /** Folders under `dir`, which must sit inside the home folder. */
    async list(dir: string = home): Promise<Listing> {
      const abs = path.resolve(dir);
      if (!inside(home, abs)) throw new ApiError(403, `listing stays under ${home}`);
      let entries;
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch (e) {
        throw new ApiError(404, `cannot list ${dir}: ${(e as Error).message}`);
      }
      const folders: DirEntry[] = [];
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
        const p = path.join(abs, e.name);
        folders.push({ name: e.name, path: p, isProject: await exists(path.join(p, PROJECT_FILE)) });
      }
      folders.sort((a, b) => a.name.localeCompare(b.name));
      const parent = abs === home ? undefined : path.dirname(abs);
      return { path: abs, parent, folders, isProject: await exists(path.join(abs, PROJECT_FILE)) };
    },

    /** Register a folder for this session and return every JSON file under it. Creates the folder if missing. */
    async open(dir: string): Promise<{ root: string; isProject: boolean; files: FileMap }> {
      const abs = path.resolve(dir);
      await fs.mkdir(abs, { recursive: true });
      opened.add(abs);
      const files = await readTree(abs);
      return { root: abs, isProject: PROJECT_FILE in files, files };
    },

    async read(root: string, rel: string): Promise<string> {
      const abs = safeJoin(assertOpened(root), rel);
      try {
        return await fs.readFile(abs, "utf8");
      } catch (e) {
        throw new ApiError(404, `cannot read ${rel}: ${(e as Error).message}`);
      }
    },

    /** Write and delete a batch of files inside an opened folder. */
    async write(root: string, files: FileMap, remove: string[] = []): Promise<void> {
      const base = assertOpened(root);
      const writes = Object.entries(files).map(([rel, text]) => [safeJoin(base, rel), text] as const);
      const removes = remove.map((rel) => safeJoin(base, rel));
      for (const [abs, text] of writes) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        const tmp = `${abs}.${process.pid}.tmp`;
        await fs.writeFile(tmp, text, "utf8");
        await fs.rename(tmp, abs);
      }
      for (const abs of removes) await fs.rm(abs, { force: true });
    },

    /**
     * Copy a reference photo or CAD file into `reference/` of an opened
     * folder. The name is reduced to a safe file name and gets `-2`, `-3`
     * and so on when taken. Returns the path written, relative to the folder.
     */
    async upload(root: string, name: string, bytes: Uint8Array): Promise<string> {
      const base = assertOpened(root);
      const parsed = path.parse(path.basename(name.replace(/\\/g, "/")));
      const ext = parsed.ext.toLowerCase();
      if (ext === ".heic" || ext === ".heif") throw new ApiError(415, `${name} is HEIC. Open it in Photos or Preview and export it as JPEG.`);
      if (!(ext in UPLOAD_TYPES)) throw new ApiError(415, `${name} is not a reference file. Use ${Object.keys(UPLOAD_TYPES).join(", ")}.`);
      const stem = slug(parsed.name) || "file";
      const dir = safeJoin(base, REFERENCE_DIR);
      await fs.mkdir(dir, { recursive: true });
      for (let n = 1; ; n++) {
        const file = `${stem}${n === 1 ? "" : `-${n}`}${ext}`;
        try {
          await fs.writeFile(path.join(dir, file), bytes, { flag: "wx" });
          return `${REFERENCE_DIR}/${file}`;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      }
    },

    /** A file's bytes and a content type from its extension, inside an opened folder. */
    async bytes(root: string, rel: string): Promise<{ bytes: Uint8Array; type: string }> {
      const abs = safeJoin(assertOpened(root), rel);
      try {
        return { bytes: await fs.readFile(abs), type: UPLOAD_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream" };
      } catch (e) {
        throw new ApiError(404, `cannot read ${rel}: ${(e as Error).message}`);
      }
    },

    /** Every JSON file under the repo library, read-only. */
    async library(): Promise<FileMap> {
      const files = await readTree(repoLibrary);
      const out: FileMap = {};
      for (const [rel, text] of Object.entries(files)) out[`library/${rel}`] = text;
      return out;
    },

    isOpened: (root: string) => opened.has(path.resolve(root)),
  };
}

export type Api = ReturnType<typeof createApi>;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
