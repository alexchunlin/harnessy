import { generateId } from "./ids";
import { resolveRef } from "./library";
import { componentConnectors, findNet, netPinCount, netPins, pinLayout, type Project } from "./project";
import { buildGraph, buses, busOf, degree, otherEnd, stretchesOf, type SlackOwner } from "./derive";
import type { Bridges, Component, DefinitionConnector, Domain, Endpoint, Group, HarnessAnchor, Layer, Net, Note, Position, Segment, Sheath, Side, TiePoint, Topology } from "./schema";
import { ALL_LAYER_ID } from "./schema";

/**
 * Operations over a project. Each returns a new Project sharing unchanged
 * parts with the old one, so a store can keep history by reference.
 * Operations throw on impossible requests; the UI validates before calling.
 */

type Patch = Partial<Project>;

function next(project: Project, patch: Patch): Project {
  return { ...project, ...patch };
}

function takenIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const id of project.components.keys()) ids.add(id);
  for (const nets of project.nets.values()) for (const n of nets) ids.add(n.id);
  for (const t of project.topologies.values()) {
    ids.add(t.id);
    for (const e of t.endpoints) ids.add(e.id);
    for (const s of t.segments) ids.add(s.id);
    for (const s of t.sheaths) ids.add(s.id);
    for (const s of t.ties) ids.add(s.id);
  }
  for (const g of project.connectivityCanvas.groups) ids.add(g.id);
  for (const n of project.connectivityCanvas.notes) ids.add(n.id);
  return ids;
}

function newId(project: Project, prefix: Parameters<typeof generateId>[0]): string {
  return generateId(prefix, takenIds(project));
}

function round(p: Position): Position {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

// Project settings -----------------------------------------------------------

export function renameProject(project: Project, name: string): Project {
  return next(project, { file: { ...project.file, name } });
}

/** Set the project's default slack. Zero and absent mean the same, so zero leaves the key out of the file. */
export function setProjectSlack(project: Project, slackMm: number | undefined): Project {
  if (slackMm !== undefined && !(slackMm >= 0)) throw new Error(`slack is never negative: ${slackMm}`);
  const slack_mm = slackMm ? Math.round(slackMm) : undefined;
  return next(project, { file: { ...project.file, slack_mm } });
}

export function addDomain(project: Project, domain: Domain): Project {
  if (project.file.domains.some((d) => d.id === domain.id)) throw new Error(`domain ${domain.id} exists`);
  const nets = new Map(project.nets);
  nets.set(domain.id, []);
  return next(project, { file: { ...project.file, domains: [...project.file.domains, domain] }, nets });
}

export function updateDomain(project: Project, id: string, patch: Partial<Omit<Domain, "id">>): Project {
  return fitDomainPins(next(project, { file: { ...project.file, domains: project.file.domains.map((d) => (d.id === id ? { ...d, ...patch } : d)) } }), id);
}

/** One spec per conductor on a domain. Clears the single spec and count; an empty or undefined list leaves the domain with no spec and one conductor. */
export function setDomainConductors(project: Project, id: string, specs: string[] | undefined): Project {
  return updateDomain(project, id, { spec: undefined, conductors: undefined, conductor_specs: specs && specs.length ? [...specs] : undefined });
}

/** Removes the domain, its nets, and its entry in every layer. */
export function removeDomain(project: Project, id: string): Project {
  const nets = new Map(project.nets);
  nets.delete(id);
  return next(project, {
    file: {
      ...project.file,
      domains: project.file.domains.filter((d) => d.id !== id),
      layers: project.file.layers.map((l) => ({ ...l, domains: l.domains.filter((d) => d !== id) })),
      keep_apart: project.file.keep_apart?.filter(([a, b]) => a !== id && b !== id),
    },
    nets,
  });
}

export function addLayer(project: Project, layer: Layer): Project {
  if (layer.id === ALL_LAYER_ID) throw new Error(`layer id ${ALL_LAYER_ID} is built in`);
  if (project.file.layers.some((l) => l.id === layer.id)) throw new Error(`layer ${layer.id} exists`);
  return next(project, { file: { ...project.file, layers: [...project.file.layers, layer] } });
}

export function updateLayer(project: Project, id: string, patch: Partial<Omit<Layer, "id">>): Project {
  return next(project, { file: { ...project.file, layers: project.file.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) } });
}

export function removeLayer(project: Project, id: string): Project {
  if (id === ALL_LAYER_ID) throw new Error(`layer ${ALL_LAYER_ID} cannot be deleted`);
  return next(project, { file: { ...project.file, layers: project.file.layers.filter((l) => l.id !== id) } });
}

/** The layers the UI shows: the stored ones plus the built-in All. */
export function visibleLayers(project: Project): Layer[] {
  return [...project.file.layers, { id: ALL_LAYER_ID, name: "All", domains: project.file.domains.map((d) => d.id) }];
}

/** The domains a layer shows. Every domain for the All layer. */
export function activeDomains(project: Project, layerId: string): Set<string> {
  if (layerId === ALL_LAYER_ID) return new Set(project.file.domains.map((d) => d.id));
  return new Set(visibleLayers(project).find((l) => l.id === layerId)?.domains ?? []);
}

export function setKeepApart(project: Project, pairs: [string, string][]): Project {
  return next(project, { file: { ...project.file, keep_apart: pairs.length ? pairs : undefined } });
}

// Components ----------------------------------------------------------------

export function placeComponent(project: Project, definition: string, position: Position, name?: string): { project: Project; id: string } {
  const def = resolveRef(project.library, definition, "components");
  if (!def) throw new Error(`no component definition ${definition}`);
  const id = newId(project, "cmp");
  const component: Component = { id, name: name ?? def.name, definition };
  return { project: putComponent(project, component, position), id };
}

export function placeBlankComponent(project: Project, name: string, position: Position, connectors: DefinitionConnector[] = []): { project: Project; id: string } {
  const id = newId(project, "cmp");
  return { project: putComponent(project, { id, name, connectors }, position), id };
}

function putComponent(project: Project, component: Component, position: Position): Project {
  const components = new Map(project.components);
  components.set(component.id, component);
  return next(project, {
    components,
    connectivityCanvas: { ...project.connectivityCanvas, components: { ...project.connectivityCanvas.components, [component.id]: round(position) } },
  });
}

export function renameComponent(project: Project, id: string, name: string): Project {
  const c = project.components.get(id);
  if (!c) throw new Error(`no component ${id}`);
  const components = new Map(project.components);
  components.set(id, { ...c, name });
  return next(project, { components });
}

/** Replace a blank component's inline connectors. Definition-backed components are edited in the library. */
export function setInlineConnectors(project: Project, id: string, connectors: DefinitionConnector[]): Project {
  const c = project.components.get(id);
  if (!c) throw new Error(`no component ${id}`);
  if (c.definition) throw new Error(`component ${id} takes its connectors from ${c.definition}`);
  const components = new Map(project.components);
  components.set(id, { ...c, connectors });
  return next(project, { components });
}

/** Replace a blank component's bridges. Definition-backed components take theirs from the library. */
export function setInlineBridges(project: Project, id: string, bridges: Bridges): Project {
  const c = project.components.get(id);
  if (!c) throw new Error(`no component ${id}`);
  if (c.definition) throw new Error(`component ${id} takes its bridges from ${c.definition}`);
  const components = new Map(project.components);
  components.set(id, { ...c, bridges: bridges.length ? bridges : undefined });
  return next(project, { components });
}

export function moveComponent(project: Project, id: string, position: Position): Project {
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, components: { ...project.connectivityCanvas.components, [id]: round(position) } } });
}

// Arrange ----------------------------------------------------------------------

export interface BoxSize {
  w: number;
  h: number;
}

const GRID = 6;
const PITCH = 24;
const snapTo = (v: number) => Math.round(v / GRID) * GRID;

/**
 * Line selected components up in a row (left to right, tops aligned) or a
 * column (top to bottom, lefts aligned), one pin pitch apart, keeping their
 * current order along that axis. Sizes come from the canvas, which knows
 * how big each box draws.
 */
export function arrangeComponents(project: Project, ids: string[], how: "row" | "column", sizes: Record<string, BoxSize>): Project {
  const pos = project.connectivityCanvas.components;
  const placed = ids.filter((id) => pos[id] && sizes[id]);
  if (placed.length < 2) return project;
  const axis = how === "row" ? "x" : "y";
  const cross = how === "row" ? "y" : "x";
  const size = how === "row" ? "w" : "h";
  const sorted = [...placed].sort((a, b) => pos[a][axis] - pos[b][axis]);
  const origin = snapTo(Math.min(...sorted.map((id) => pos[id][cross])));
  let cursor = snapTo(pos[sorted[0]][axis]);
  let p = project;
  for (const id of sorted) {
    p = moveComponent(p, id, { [axis]: cursor, [cross]: origin } as unknown as Position);
    cursor += snapTo(sizes[id][size]) + PITCH;
  }
  return p;
}

/** Space selected components evenly between the two outermost, which stay put. The axis is the one they spread along most. */
export function distributeComponents(project: Project, ids: string[], sizes: Record<string, BoxSize>): Project {
  const pos = project.connectivityCanvas.components;
  const placed = ids.filter((id) => pos[id] && sizes[id]);
  if (placed.length < 3) return project;
  const spread = (axis: "x" | "y") => Math.max(...placed.map((id) => pos[id][axis])) - Math.min(...placed.map((id) => pos[id][axis]));
  const axis = spread("x") >= spread("y") ? "x" : "y";
  const size = axis === "x" ? "w" : "h";
  const sorted = [...placed].sort((a, b) => pos[a][axis] - pos[b][axis]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos[last][axis] - (pos[first][axis] + sizes[first][size]);
  const inner = sorted.slice(1, -1);
  const gap = (span - inner.reduce((sum, id) => sum + sizes[id][size], 0)) / (inner.length + 1);
  let cursor = pos[first][axis] + sizes[first][size] + gap;
  let p = project;
  for (const id of inner) {
    p = moveComponent(p, id, { ...pos[id], [axis]: snapTo(cursor) });
    cursor += sizes[id][size] + gap;
  }
  return p;
}

// Pin placement ----------------------------------------------------------------

/** Store a component's full pin arrangement on the canvas. */
export function setPinLayout(project: Project, id: string, layout: Record<Side, string[]>): Project {
  const pins = { ...project.connectivityCanvas.pins, [id]: { left: layout.left, right: layout.right, top: layout.top, bottom: layout.bottom } };
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, pins } });
}

/** Move one pin to a side at an index within that side. */
export function movePin(project: Project, id: string, designator: string, side: Side, index: number): Project {
  const c = project.components.get(id);
  if (!c) throw new Error(`no component ${id}`);
  const layout = pinLayout(project, c);
  const from = (Object.keys(layout) as Side[]).find((s) => layout[s].includes(designator));
  if (!from) throw new Error(`no pin ${designator} on ${id}`);
  const nextLayout: Record<Side, string[]> = { left: [...layout.left], right: [...layout.right], top: [...layout.top], bottom: [...layout.bottom] };
  nextLayout[from] = nextLayout[from].filter((d) => d !== designator);
  const at = Math.max(0, Math.min(index, nextLayout[side].length));
  nextLayout[side] = [...nextLayout[side].slice(0, at), designator, ...nextLayout[side].slice(at)];
  return setPinLayout(project, id, nextLayout);
}

/** Mirror a component's pins: horizontal swaps left and right, vertical swaps top and bottom. The other axis reverses order. */
export function flipComponent(project: Project, id: string, axis: "horizontal" | "vertical"): Project {
  const c = project.components.get(id);
  if (!c) throw new Error(`no component ${id}`);
  const l = pinLayout(project, c);
  const flipped: Record<Side, string[]> =
    axis === "horizontal"
      ? { left: l.right, right: l.left, top: [...l.top].reverse(), bottom: [...l.bottom].reverse() }
      : { left: [...l.left].reverse(), right: [...l.right].reverse(), top: l.bottom, bottom: l.top };
  return setPinLayout(project, id, flipped);
}

/** Nets that would lose their last other connector if this component went. */
export function netsOnlyOn(project: Project, componentId: string): Net[] {
  const out: Net[] = [];
  for (const nets of project.nets.values()) {
    for (const n of nets) {
      const remaining = n.connectors.filter((a) => !a.startsWith(`${componentId}/`));
      if (remaining.length < n.connectors.length && remaining.length < 2) out.push(n);
    }
  }
  return out;
}

/**
 * Remove a component. Nets it was on lose the connector; a net left with
 * fewer than two connectors is removed too. Topology endpoints for its
 * connectors go as well, along with their segments.
 */
export function removeComponent(project: Project, id: string): Project {
  const components = new Map(project.components);
  components.delete(id);
  const nets = new Map<string, Net[]>();
  for (const [domain, list] of project.nets) {
    nets.set(
      domain,
      list
        .map((n) => {
          if (!n.connectors.some((a) => a.startsWith(`${id}/`))) return n;
          return fitPins(project, { ...n, connectors: n.connectors.filter((a) => !a.startsWith(`${id}/`)) }, domain);
        })
        .filter((n, i) => n.connectors.length >= 2 || n.connectors.length === list[i].connectors.length),
    );
  }
  const canvasComponents = { ...project.connectivityCanvas.components };
  delete canvasComponents[id];
  const canvasPins = { ...project.connectivityCanvas.pins };
  delete canvasPins[id];
  const touched = new Set<string>();
  for (const list of project.nets.values()) for (const n of list) if (n.connectors.some((a) => a.startsWith(`${id}/`))) touched.add(n.id);
  let p = dropBends(project, (key) => touched.has(keyNet(key)));
  p = next(p, {
    components,
    nets,
    connectivityCanvas: {
      ...p.connectivityCanvas,
      components: canvasComponents,
      pins: canvasPins,
      groups: project.connectivityCanvas.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== id) })),
      notes: project.connectivityCanvas.notes.map((n) => (n.component === id ? { ...n, component: undefined } : n)),
    },
  });
  for (const t of p.topologies.values()) {
    for (const e of t.endpoints) if (e.kind === "connector" && e.connector.startsWith(`${id}/`)) p = removeEndpoint(p, t.id, e.id);
  }
  return p;
}

// Nets ---------------------------------------------------------------------------

export function createNet(project: Project, domain: string, connectors: string[], name?: string): { project: Project; id: string } {
  if (!project.nets.has(domain)) throw new Error(`no domain ${domain}`);
  const id = newId(project, "net");
  const nets = new Map(project.nets);
  nets.set(domain, [...(nets.get(domain) ?? []), { id, name, connectors: [...new Set(connectors)] }]);
  return { project: next(project, { nets }), id };
}

function updateNet(project: Project, id: string, fn: (n: Net) => Net): Project {
  const found = findNet(project, id);
  if (!found) throw new Error(`no net ${id}`);
  const nets = new Map(project.nets);
  nets.set(found.domain, nets.get(found.domain)!.map((n) => (n.id === id ? fn(n) : n)));
  return next(project, { nets });
}

// Pins ---------------------------------------------------------------------------

/**
 * Bring a net's pins in step with its connectors and pin count: drop entries
 * for connectors it no longer has, trim or pad each array to the count, drop
 * entries with no pin set, and drop the key when nothing is left. Returns the
 * same net when nothing changes.
 */
function fitPins(project: Project, net: Net, domain: string): Net {
  if (!net.pins) return net;
  const count = netPinCount(project, net, domain);
  const pins: Record<string, (number | null)[]> = {};
  for (const address of net.connectors) {
    const stored = net.pins[address];
    if (!stored) continue;
    const row = Array.from({ length: count }, (_, i) => stored[i] ?? null);
    if (row.some((x) => x !== null)) pins[address] = row;
  }
  const fitted = Object.keys(pins).length ? pins : undefined;
  if (JSON.stringify(fitted) === JSON.stringify(net.pins)) return net;
  return { ...net, pins: fitted };
}

function fitNetPins(project: Project, id: string): Project {
  const found = findNet(project, id);
  if (!found) return project;
  const fitted = fitPins(project, found.net, found.domain);
  return fitted === found.net ? project : updateNet(project, id, () => fitted);
}

function fitDomainPins(project: Project, domain: string): Project {
  const list = project.nets.get(domain);
  if (!list) return project;
  const fitted = list.map((n) => fitPins(project, n, domain));
  if (fitted.every((n, i) => n === list[i])) return project;
  const nets = new Map(project.nets);
  nets.set(domain, fitted);
  return next(project, { nets });
}

function putPins(project: Project, id: string, address: string, fn: (row: (number | null)[]) => (number | null)[]): Project {
  const found = findNet(project, id);
  if (!found) throw new Error(`no net ${id}`);
  if (!found.net.connectors.includes(address)) throw new Error(`net ${id} does not terminate ${address}`);
  const row = fn(netPins(project, found.net, found.domain, address));
  const net = fitPins(project, { ...found.net, pins: { ...found.net.pins, [address]: row } }, found.domain);
  return updateNet(project, id, () => net);
}

/** Set or clear (undefined or null) the pin conductor `index` lands on at one connector of a net. */
export function setPin(project: Project, id: string, address: string, index: number, pin: number | null | undefined): Project {
  if (pin != null && !(Number.isInteger(pin) && pin >= 1)) throw new Error(`pin must be a whole number from 1 up, got ${pin}`);
  return putPins(project, id, address, (row) => {
    if (!Number.isInteger(index) || index < 0 || index >= row.length) throw new Error(`net ${id} has no conductor ${index + 1}`);
    return row.map((x, i) => (i === index ? (pin ?? null) : x));
  });
}

/** Number a connector row of a net 1 to n in conductor order, overwriting what it held. */
export function numberPinsInOrder(project: Project, id: string, address: string): Project {
  return putPins(project, id, address, (row) => row.map((_, i) => i + 1));
}

export function addConnectorToNet(project: Project, id: string, address: string): Project {
  const found = findNet(project, id);
  if (found?.net.connectors.includes(address)) return project;
  return dropBends(updateNet(project, id, (n) => ({ ...n, connectors: [...n.connectors, address] })), (key) => keyNet(key) === id);
}

/**
 * Take a connector off a net. Its spoke's bends go. The other spokes keep
 * theirs while the net is still a star; under three connectors it is drawn as
 * one straight line, so every bend on it goes.
 */
export function removeConnectorFromNet(project: Project, id: string, address: string): Project {
  const p = fitNetPins(updateNet(project, id, (n) => ({ ...n, connectors: n.connectors.filter((a) => a !== address) })), id);
  const star = (findNet(p, id)?.net.connectors.length ?? 0) >= 3;
  return dropBends(p, (key) => (star ? key === bendsKey(id, address) : keyNet(key) === id));
}

// Bends -------------------------------------------------------------------------

/** The bends key for a net's drawn line: the net id, or `<net>:<address>` for a star net's spoke. */
export function bendsKey(netId: string, address?: string): string {
  return address ? `${netId}:${address}` : netId;
}

function keyNet(key: string): string {
  return key.split(":")[0];
}

/** Replace the hand-placed bends on one drawn line. `undefined` returns it to automatic routing. */
export function setBends(project: Project, key: string, bends: Position[] | undefined): Project {
  const all = { ...project.connectivityCanvas.bends };
  if (bends && bends.length) all[key] = bends.map(round);
  else delete all[key];
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, bends: all } });
}

/** Forget every hand-placed bend on a net, spokes included. */
export function resetBends(project: Project, netId: string): Project {
  return dropBends(project, (key) => keyNet(key) === netId);
}

function dropBends(project: Project, gone: (key: string) => boolean): Project {
  const keys = Object.keys(project.connectivityCanvas.bends).filter(gone);
  if (keys.length === 0) return project;
  const all = { ...project.connectivityCanvas.bends };
  for (const k of keys) delete all[k];
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, bends: all } });
}

export function renameNet(project: Project, id: string, name: string | undefined): Project {
  return updateNet(project, id, (n) => ({ ...n, name: name || undefined }));
}

/** One spec for every conductor and a count. Clears a per-conductor list; both undefined returns the net to its domain default. */
export function setNetSpec(project: Project, id: string, spec: string | undefined, conductors: number | undefined): Project {
  return fitNetPins(updateNet(project, id, (n) => ({ ...n, spec, conductors, conductor_specs: undefined })), id);
}

/** One spec per conductor. Clears the single spec and count; an empty or undefined list returns the net to its domain default. */
export function setNetConductors(project: Project, id: string, specs: string[] | undefined): Project {
  return fitNetPins(updateNet(project, id, (n) => ({ ...n, spec: undefined, conductors: undefined, conductor_specs: specs && specs.length ? [...specs] : undefined })), id);
}

/** Name the bus a net is on. The name sits on this net and leaves every other member, so a bus has one anchor. */
export function setBusName(project: Project, id: string, name: string | undefined): Project {
  const bus = busOf(buses(project), id);
  let p = project;
  for (const n of bus?.nets ?? []) if (n.id !== id && n.bus !== undefined) p = updateNet(p, n.id, (x) => ({ ...x, bus: undefined }));
  return updateNet(p, id, (n) => ({ ...n, bus: name || undefined }));
}

/** Moving a net between domains is a move between files. Splice references and hub positions follow the id. */
export function moveNetToDomain(project: Project, id: string, domain: string): Project {
  const found = findNet(project, id);
  if (!found) throw new Error(`no net ${id}`);
  if (!project.nets.has(domain)) throw new Error(`no domain ${domain}`);
  if (found.domain === domain) return project;
  const nets = new Map(project.nets);
  nets.set(found.domain, nets.get(found.domain)!.filter((n) => n.id !== id));
  nets.set(domain, [...nets.get(domain)!, found.net]);
  return fitNetPins(next(project, { nets }), id);
}

export function removeNet(project: Project, id: string): Project {
  const found = findNet(project, id);
  if (!found) return project;
  const nets = new Map(project.nets);
  nets.set(found.domain, nets.get(found.domain)!.filter((n) => n.id !== id));
  const hubs = { ...project.connectivityCanvas.hubs };
  delete hubs[id];
  const topologies = new Map<string, Topology>();
  for (const [tid, t] of project.topologies) {
    topologies.set(tid, { ...t, endpoints: t.endpoints.map((e) => (e.kind === "splice" ? { ...e, nets: e.nets.filter((n) => n !== id) } : e)) });
  }
  return dropBends(
    next(project, {
      nets,
      topologies,
      connectivityCanvas: { ...project.connectivityCanvas, hubs, notes: project.connectivityCanvas.notes.map((n) => (n.net === id ? { ...n, net: undefined } : n)) },
    }),
    (key) => keyNet(key) === id,
  );
}

export function moveHub(project: Project, netId: string, position: Position): Project {
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, hubs: { ...project.connectivityCanvas.hubs, [netId]: round(position) } } });
}

// Groups and notes -----------------------------------------------------------

export function createGroup(project: Project, label: string, rect: Group["rect"], members: string[]): { project: Project; id: string } {
  const id = newId(project, "grp");
  const group: Group = { id, label, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }, members };
  return { project: next(project, { connectivityCanvas: { ...project.connectivityCanvas, groups: [...project.connectivityCanvas.groups, group] } }), id };
}

export function updateGroup(project: Project, id: string, patch: Partial<Omit<Group, "id">>): Project {
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, groups: project.connectivityCanvas.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) } });
}

export function removeGroup(project: Project, id: string): Project {
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, groups: project.connectivityCanvas.groups.filter((g) => g.id !== id) } });
}

export function createNote(project: Project, text: string, position: Position): { project: Project; id: string } {
  const id = newId(project, "nte");
  const note: Note = { id, text, ...round(position) };
  return { project: next(project, { connectivityCanvas: { ...project.connectivityCanvas, notes: [...project.connectivityCanvas.notes, note] } }), id };
}

export function updateNote(project: Project, id: string, patch: Partial<Omit<Note, "id">>): Project {
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, notes: project.connectivityCanvas.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } });
}

export function removeNote(project: Project, id: string): Project {
  return next(project, { connectivityCanvas: { ...project.connectivityCanvas, notes: project.connectivityCanvas.notes.filter((n) => n.id !== id) } });
}

// Topologies -------------------------------------------------------------------

export function createTopology(project: Project, name: string): { project: Project; id: string } {
  const id = newId(project, "top");
  const topologies = new Map(project.topologies);
  topologies.set(id, { id, name, endpoints: [], segments: [], sheaths: [], ties: [] });
  const topologyCanvases = new Map(project.topologyCanvases);
  topologyCanvases.set(id, { endpoints: {} });
  return { project: next(project, { topologies, topologyCanvases }), id };
}

export function renameTopology(project: Project, id: string, name: string): Project {
  return updateTopology(project, id, (t) => ({ ...t, name }));
}

export function removeTopology(project: Project, id: string): Project {
  const topologies = new Map(project.topologies);
  topologies.delete(id);
  const topologyCanvases = new Map(project.topologyCanvases);
  topologyCanvases.delete(id);
  return next(project, { topologies, topologyCanvases });
}

function updateTopology(project: Project, id: string, fn: (t: Topology) => Topology): Project {
  const t = project.topologies.get(id);
  if (!t) throw new Error(`no topology ${id}`);
  const topologies = new Map(project.topologies);
  topologies.set(id, fn(t));
  return next(project, { topologies });
}

function setEndpointPosition(project: Project, topologyId: string, endpointId: string, position: Position | undefined): Project {
  const canvas = project.topologyCanvases.get(topologyId) ?? { endpoints: {} };
  const endpoints = { ...canvas.endpoints };
  if (position) endpoints[endpointId] = round(position);
  else delete endpoints[endpointId];
  const topologyCanvases = new Map(project.topologyCanvases);
  topologyCanvases.set(topologyId, { endpoints });
  return next(project, { topologyCanvases });
}

/** Place a connector in the topology. A connector appears at most once per topology. */
export function placeConnector(project: Project, topologyId: string, address: string, position: Position): { project: Project; id: string } {
  const t = project.topologies.get(topologyId);
  if (!t) throw new Error(`no topology ${topologyId}`);
  const existing = t.endpoints.find((e) => e.kind === "connector" && e.connector === address);
  if (existing) return { project: setEndpointPosition(project, topologyId, existing.id, position), id: existing.id };
  const id = newId(project, "end");
  const endpoint: Endpoint = { id, kind: "connector", connector: address };
  let p = updateTopology(project, topologyId, (t) => ({ ...t, endpoints: [...t.endpoints, endpoint] }));
  p = setEndpointPosition(p, topologyId, id, position);
  return { project: p, id };
}

export function addEndpoint(project: Project, topologyId: string, kind: "point" | "breakout" | "splice", position: Position): { project: Project; id: string } {
  const id = newId(project, "end");
  const endpoint: Endpoint = kind === "splice" ? { id, kind, nets: [] } : { id, kind };
  let p = updateTopology(project, topologyId, (t) => ({ ...t, endpoints: [...t.endpoints, endpoint] }));
  p = setEndpointPosition(p, topologyId, id, position);
  return { project: p, id };
}

export function moveEndpoint(project: Project, topologyId: string, endpointId: string, position: Position): Project {
  return setEndpointPosition(project, topologyId, endpointId, position);
}

/** Change a point, breakout, or splice into another of those kinds. Connectors stay connectors. */
export function setEndpointKind(project: Project, topologyId: string, endpointId: string, kind: "point" | "breakout" | "splice"): Project {
  return updateTopology(project, topologyId, (t) => ({
    ...t,
    endpoints: t.endpoints.map((e) => {
      if (e.id !== endpointId || e.kind === "connector") return e;
      if (kind === "splice") return { id: e.id, kind, nets: e.kind === "splice" ? e.nets : [], spec: e.kind === "splice" ? e.spec : undefined };
      if (kind === "breakout") return { id: e.id, kind, spec: e.kind === "breakout" ? e.spec : undefined };
      return { id: e.id, kind };
    }),
  }));
}

export function setBreakoutSpec(project: Project, topologyId: string, endpointId: string, spec: string | undefined): Project {
  return updateTopology(project, topologyId, (t) => ({ ...t, endpoints: t.endpoints.map((e) => (e.id === endpointId && e.kind === "breakout" ? { ...e, spec } : e)) }));
}

export function setSpliceNets(project: Project, topologyId: string, endpointId: string, nets: string[], spec?: string): Project {
  return updateTopology(project, topologyId, (t) => ({
    ...t,
    endpoints: t.endpoints.map((e) => (e.id === endpointId && e.kind === "splice" ? { ...e, nets: [...new Set(nets)].sort(), spec: spec === undefined ? e.spec : spec } : e)),
  }));
}

/** Remove an endpoint and every segment ending there, plus sheaths and ties on those segments. */
export function removeEndpoint(project: Project, topologyId: string, endpointId: string): Project {
  const t = project.topologies.get(topologyId);
  if (!t) return project;
  let p = project;
  for (const s of t.segments) if (s.ends.includes(endpointId)) p = removeSegment(p, topologyId, s.id);
  p = updateTopology(p, topologyId, (t) => ({ ...t, endpoints: t.endpoints.filter((e) => e.id !== endpointId) }));
  return setEndpointPosition(p, topologyId, endpointId, undefined);
}

// Segments -----------------------------------------------------------------------

/**
 * Join two endpoints. A point that gains a third segment becomes a
 * breakout, so the common gesture never asks for a node kind.
 */
export function addSegment(project: Project, topologyId: string, a: string, b: string, lengthMm?: number): { project: Project; id: string } {
  if (a === b) throw new Error("a segment needs two different endpoints");
  const t = project.topologies.get(topologyId);
  if (!t) throw new Error(`no topology ${topologyId}`);
  const id = newId(project, "seg");
  const segment: Segment = { id, ends: [a, b], length_mm: lengthMm === undefined ? undefined : Math.round(lengthMm) };
  const p = updateTopology(project, topologyId, (t) => ({ ...t, segments: [...t.segments, segment] }));
  return { project: promotePoints(p, topologyId, [a, b]), id };
}

function promotePoints(project: Project, topologyId: string, endpointIds: string[]): Project {
  const t = project.topologies.get(topologyId)!;
  const graph = buildGraph(t);
  let p = project;
  for (const id of endpointIds) {
    const e = graph.endpoints.get(id);
    if (e?.kind === "point" && degree(graph, id) >= 3) p = setEndpointKind(p, topologyId, id, "breakout");
  }
  return p;
}

/** Drag from an endpoint into empty canvas: a new point there and a segment to it. */
export function growSegment(project: Project, topologyId: string, from: string, position: Position): { project: Project; segment: string; endpoint: string } {
  const added = addEndpoint(project, topologyId, "point", position);
  const seg = addSegment(added.project, topologyId, from, added.id);
  return { project: seg.project, segment: seg.id, endpoint: added.id };
}

function updateSegment(project: Project, topologyId: string, segmentId: string, fn: (s: Segment) => Segment): Project {
  return updateTopology(project, topologyId, (t) => {
    if (!t.segments.some((s) => s.id === segmentId)) throw new Error(`no segment ${segmentId}`);
    return { ...t, segments: t.segments.map((s) => (s.id === segmentId ? fn(s) : s)) };
  });
}

export function setSegmentLength(project: Project, topologyId: string, segmentId: string, lengthMm: number | undefined): Project {
  return updateSegment(project, topologyId, segmentId, (s) => ({ ...s, length_mm: lengthMm === undefined ? undefined : Math.round(lengthMm) }));
}

/** Flag a segment as a purchased assembly. The library entry fixes the length; the segment's own length is dropped. */
export function setSegmentAssembly(project: Project, topologyId: string, segmentId: string, assembly: string | undefined): Project {
  if (assembly && !resolveRef(project.library, assembly, "assemblies")) throw new Error(`no assembly ${assembly}`);
  return updateSegment(project, topologyId, segmentId, (s) => (assembly ? { ...s, assembly, length_mm: undefined } : { ...s, assembly: undefined }));
}

export function setHarnessAnchor(project: Project, topologyId: string, segmentId: string, anchor: HarnessAnchor | undefined): Project {
  const slack = anchor?.slack_mm;
  if (slack !== undefined && !(slack >= 0)) throw new Error(`slack is never negative: ${slack}`);
  if (slack !== undefined) anchor = { ...anchor!, slack_mm: Math.round(slack) };
  return updateSegment(project, topologyId, segmentId, (s) => ({ ...s, harness: anchor }));
}

/**
 * Remove a segment and any sheath or tie point on it. A breakout left with
 * two segments becomes a point again; nothing else changes kind.
 */
export function removeSegment(project: Project, topologyId: string, segmentId: string): Project {
  const t = project.topologies.get(topologyId);
  const seg = t?.segments.find((s) => s.id === segmentId);
  if (!t || !seg) return project;
  let p = updateTopology(project, topologyId, (t) => ({
    ...t,
    segments: t.segments.filter((s) => s.id !== segmentId),
    sheaths: t.sheaths.filter((sh) => !sh.segments.includes(segmentId)),
    ties: t.ties.filter((tie) => tie.segment !== segmentId),
  }));
  const graph = buildGraph(p.topologies.get(topologyId)!);
  for (const e of seg.ends) {
    const ep = graph.endpoints.get(e);
    if (ep?.kind === "breakout" && degree(graph, e) === 2 && !ep.spec) p = setEndpointKind(p, topologyId, e, "point");
  }
  return p;
}

// Sheaths and tie points --------------------------------------------------------

export function applySheath(project: Project, topologyId: string, segments: string[], spec: string, overlapMm = 0): { project: Project; id: string } {
  if (segments.length === 0) throw new Error("a sheath covers at least one segment");
  const id = newId(project, "sht");
  const sheath: Sheath = { id, spec, segments: orderChain(project.topologies.get(topologyId)!, segments), overlap_mm: Math.round(overlapMm) };
  return { project: updateTopology(project, topologyId, (t) => ({ ...t, sheaths: [...t.sheaths, sheath] })), id };
}

/** Put a set of segments in path order when they form a chain; otherwise return them as given. */
export function orderChain(topology: Topology, segmentIds: string[]): string[] {
  const graph = buildGraph(topology);
  const set = new Set(segmentIds);
  const count = new Map<string, number>();
  for (const id of set) for (const e of graph.segments.get(id)?.ends ?? []) count.set(e, (count.get(e) ?? 0) + 1);
  const start = [...count].find(([, c]) => c === 1)?.[0];
  if (!start) return segmentIds;
  const ordered: string[] = [];
  let cur = start;
  const used = new Set<string>();
  for (;;) {
    const s = (graph.incident.get(cur) ?? []).find((s) => set.has(s.id) && !used.has(s.id));
    if (!s) break;
    used.add(s.id);
    ordered.push(s.id);
    cur = otherEnd(s, cur);
  }
  return ordered.length === set.size ? ordered : segmentIds;
}

export function updateSheath(project: Project, topologyId: string, sheathId: string, patch: Partial<Omit<Sheath, "id">>): Project {
  return updateTopology(project, topologyId, (t) => ({ ...t, sheaths: t.sheaths.map((s) => (s.id === sheathId ? { ...s, ...patch, overlap_mm: Math.round(patch.overlap_mm ?? s.overlap_mm) } : s)) }));
}

export function removeSheath(project: Project, topologyId: string, sheathId: string): Project {
  return updateTopology(project, topologyId, (t) => ({ ...t, sheaths: t.sheaths.filter((s) => s.id !== sheathId) }));
}

export function addTiePoint(project: Project, topologyId: string, segmentId: string, spec: string, distanceMm?: number, from?: string): { project: Project; id: string } {
  const t = project.topologies.get(topologyId);
  const seg = t?.segments.find((s) => s.id === segmentId);
  if (!t || !seg) throw new Error(`no segment ${segmentId}`);
  const id = newId(project, "tie");
  const length = seg.length_mm ?? (seg.assembly ? resolveRef(project.library, seg.assembly, "assemblies")?.length_mm : undefined) ?? 0;
  const tie: TiePoint = { id, segment: segmentId, from: from ?? seg.ends[0], distance_mm: Math.round(distanceMm ?? length / 2), spec };
  return { project: updateTopology(project, topologyId, (t) => ({ ...t, ties: [...t.ties, tie] })), id };
}

export function updateTiePoint(project: Project, topologyId: string, tieId: string, patch: Partial<Omit<TiePoint, "id">>): Project {
  return updateTopology(project, topologyId, (t) => ({
    ...t,
    ties: t.ties.map((tie) => (tie.id === tieId ? { ...tie, ...patch, distance_mm: Math.round(patch.distance_mm ?? tie.distance_mm) } : tie)),
  }));
}

/**
 * Set or clear one stretch's slack. A tie point owns the stretch on its
 * first-end side; the segment owns its last stretch. Slack is never negative.
 */
export function setStretchSlack(project: Project, topologyId: string, owner: SlackOwner, slackMm: number | undefined): Project {
  if (slackMm !== undefined && !(slackMm >= 0)) throw new Error(`slack is never negative: ${slackMm}`);
  const slack_mm = slackMm === undefined ? undefined : Math.round(slackMm);
  if (owner.kind === "segment") return updateSegment(project, topologyId, owner.id, (s) => ({ ...s, slack_mm }));
  return updateTopology(project, topologyId, (t) => {
    if (!t.ties.some((tie) => tie.id === owner.id)) throw new Error(`no tie point ${owner.id}`);
    return { ...t, ties: t.ties.map((tie) => (tie.id === owner.id ? { ...tie, slack_mm } : tie)) };
  });
}

/**
 * Remove a tie point. The stretch beyond it absorbs the stretch it bounded,
 * and takes the sum of both stretches' effective slack, so no cut length moves.
 */
export function removeTiePoint(project: Project, topologyId: string, tieId: string): Project {
  const t = project.topologies.get(topologyId);
  const tie = t?.ties.find((x) => x.id === tieId);
  const seg = tie && t?.segments.find((s) => s.id === tie.segment);
  const p = updateTopology(project, topologyId, (t) => ({ ...t, ties: t.ties.filter((tie) => tie.id !== tieId) }));
  if (!t || !seg) return p;
  const graph = buildGraph(t);
  const stretches = stretchesOf(project, graph, seg);
  const i = stretches.findIndex((s) => s.owner.kind === "tie" && s.owner.id === tieId);
  const [removed, absorbing] = [stretches[i], stretches[i + 1]];
  if (!removed || !absorbing) return p;
  const sum = removed.effectiveSlackMm + absorbing.effectiveSlackMm;
  // An unset stretch that would come out the same anyway stays unset.
  if (absorbing.slackMm === undefined && sum === absorbing.effectiveSlackMm) return p;
  return setStretchSlack(p, topologyId, absorbing.owner, sum);
}

// Design rule silences ---------------------------------------------------------

export function silence(project: Project, check: string, target: string): Project {
  if (project.drc.silences.some((s) => s.check === check && s.target === target)) return project;
  return next(project, { drc: { silences: [...project.drc.silences, { check, target }] } });
}

export function unsilence(project: Project, check: string, target: string): Project {
  return next(project, { drc: { silences: project.drc.silences.filter((s) => !(s.check === check && s.target === target)) } });
}

// Helpers the UI needs -------------------------------------------------------------

/** Connectors in the project not yet placed in this topology, the tray's contents. */
export function unplacedConnectors(project: Project, topologyId: string): string[] {
  const t = project.topologies.get(topologyId);
  const placed = new Set(t?.endpoints.flatMap((e) => (e.kind === "connector" ? [e.connector] : [])) ?? []);
  const out: string[] = [];
  for (const c of [...project.components.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const con of componentConnectors(project, c) ?? []) {
      const address = `${c.id}/${con.designator}`;
      if (!placed.has(address)) out.push(address);
    }
  }
  return out;
}
