import type { FileMap, Listing } from "../server/api";

const PREFIX = "/__harnessy";

async function call<T>(method: "GET" | "POST", op: string, params?: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(`${PREFIX}${op}`, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${method} ${op} failed with ${res.status}`);
  return data;
}

/** Browser-side client for the Vite plugin's file API. */
export const api = {
  home: () => call<{ home: string }>("GET", "/home").then((r) => r.home),
  list: (path?: string) => call<Listing>("GET", "/list", path ? { path } : undefined),
  open: (path: string) => call<{ root: string; isProject: boolean; files: FileMap }>("POST", "/open", undefined, { path }),
  write: (root: string, files: FileMap, remove: string[] = []) => call<{ ok: true }>("POST", "/write", undefined, { root, files, remove }),
  library: () => call<{ files: FileMap }>("GET", "/library").then((r) => r.files),
  /** Copy a file into `reference/` of the opened folder. Resolves to the path written, relative to the folder. */
  async upload(root: string, file: File): Promise<string> {
    const url = new URL(`${PREFIX}/upload`, window.location.origin);
    url.searchParams.set("root", root);
    url.searchParams.set("name", file.name);
    const res = await fetch(url, { method: "POST", body: file });
    const data = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? `upload failed with ${res.status}`);
    return data.path;
  },
  /** A file's bytes inside the opened folder, or undefined when it is not there. */
  async bytes(root: string, path: string): Promise<ArrayBuffer | undefined> {
    const url = new URL(`${PREFIX}/bytes`, window.location.origin);
    url.searchParams.set("root", root);
    url.searchParams.set("path", path);
    const res = await fetch(url);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `reading ${path} failed with ${res.status}`);
    return res.arrayBuffer();
  },
};

export function toFiles(map: FileMap): Map<string, string> {
  return new Map(Object.entries(map));
}

export function fromFiles(files: Map<string, string>): FileMap {
  return Object.fromEntries(files);
}
