import type { LibraryFolder } from "./schema";

export interface LibraryRef {
  folder: LibraryFolder;
  id: string;
}

export function parseRef(ref: string): LibraryRef {
  const i = ref.indexOf("/");
  if (i < 0) throw new Error(`malformed library reference: ${ref}`);
  return { folder: ref.slice(0, i) as LibraryFolder, id: ref.slice(i + 1) };
}

export function formatRef(folder: LibraryFolder, id: string): string {
  return `${folder}/${id}`;
}

export interface ConnectorAddress {
  component: string;
  designator: string;
}

export function parseAddress(address: string): ConnectorAddress {
  const i = address.indexOf("/");
  if (i < 0) throw new Error(`malformed connector address: ${address}`);
  return { component: address.slice(0, i), designator: address.slice(i + 1) };
}

export function formatAddress(component: string, designator: string): string {
  return `${component}/${designator}`;
}

/** A finding target or bend key for one net at one connector: `<net>:<address>`. */
export function formatNetAddress(net: string, address: string): string {
  return `${net}:${address}`;
}

/**
 * Read a finding target or bend key. `<net>:<address>` names one net at one
 * connector, a bare `<component>/<designator>` names a connector, and anything
 * else is a plain id (a net, a segment, a component).
 */
export function parseTarget(target: string): { net?: string; address?: string } {
  const i = target.indexOf(":");
  if (i >= 0) return { net: target.slice(0, i), address: target.slice(i + 1) };
  return target.includes("/") ? { address: target } : {};
}
