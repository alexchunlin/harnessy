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
};

export function toFiles(map: FileMap): Map<string, string> {
  return new Map(Object.entries(map));
}

export function fromFiles(files: Map<string, string>): FileMap {
  return Object.fromEntries(files);
}
