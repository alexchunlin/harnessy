import { mergeLibraries, resolveRef } from "./library";
import type { Project } from "./project";
import { designator, type Bridges, type Component, type ComponentDefinition, type DefinitionConnector, type Net, type PinLayout, type Topology, SIDES } from "./schema";
import type { DrawerOwner } from "./drawer";

/**
 * Edits to component definitions and one-off connectors (ADR 0003). An edit
 * to a shared definition lands in the project's own library as a copy that
 * shadows the shared entry; the repo library is never written.
 */

/** Components that take their connectors from `components/<id>`. */
export function definitionUsers(project: Project, id: string): Component[] {
  const ref = `components/${id}`;
  return [...project.components.values()].filter((c) => c.definition === ref);
}

function definitionOrThrow(project: Project, id: string): ComponentDefinition {
  const def = resolveRef(project.library, `components/${id}`, "components");
  if (!def) throw new Error(`no component definition ${id}`);
  return def;
}

/** Write a definition into the project library, shadowing any shared entry, and re-merge. */
function putDefinition(project: Project, def: ComponentDefinition): Project {
  const projectLibrary = { ...project.projectLibrary, components: new Map(project.projectLibrary.components).set(def.id, def) };
  return { ...project, projectLibrary, library: mergeLibraries(project.repoLibrary, projectLibrary) };
}

/**
 * Give a project copy back: delete it so the shared entry stands again, and
 * the file goes on save. A definition the project authored has no shared
 * entry to fall back to, so it is refused while components use it.
 */
export function revertDefinition(project: Project, id: string): Project {
  if (!project.projectLibrary.components.has(id)) throw new Error(`the project has no project copy of ${id} to give back`);
  if (!project.repoLibrary.components.has(id)) {
    const users = definitionUsers(project, id).length;
    if (users > 0) throw new Error(`${id} has no shared entry to fall back to, and ${users} component${users === 1 ? " uses" : "s use"} it`);
  }
  const components = new Map(project.projectLibrary.components);
  components.delete(id);
  const projectLibrary = { ...project.projectLibrary, components };
  return { ...project, projectLibrary, library: mergeLibraries(project.repoLibrary, projectLibrary) };
}

function inlineOrThrow(project: Project, id: string): { component: Component; connectors: DefinitionConnector[] } {
  const component = project.components.get(id);
  if (!component) throw new Error(`no component ${id}`);
  if (!component.connectors) throw new Error(`component ${id} takes its connectors from ${component.definition}`);
  return { component, connectors: component.connectors };
}

function patchAt(connectors: DefinitionConnector[], designator: string, patch: ConnectorPatch, where: string): DefinitionConnector[] {
  const at = connectors.findIndex((c) => c.designator === designator);
  if (at < 0) throw new Error(`no connector ${designator} on ${where}`);
  return connectors.map((c, i) => (i === at ? { ...c, ...patch } : c));
}

function checkType(project: Project, patch: ConnectorPatch): void {
  if (patch.connector !== undefined && !resolveRef(project.library, patch.connector, "connectors")) throw new Error(`no connector type ${patch.connector} in the library`);
}

/** Check a connector about to join `connectors`: a valid designator not already taken, and a type the library has. */
function checkNew(project: Project, connectors: DefinitionConnector[], connector: DefinitionConnector, where: string): void {
  if (!designator.safeParse(connector.designator).success) throw new Error(`designator ${JSON.stringify(connector.designator)}: use letters, digits, hyphen, underscore`);
  if (connectors.some((c) => c.designator === connector.designator)) throw new Error(`${where} already has a connector ${connector.designator}`);
  checkType(project, { connector: connector.connector });
}

/** Add a connector to a definition. Reaches every component sharing it. Shadows a shared definition. */
export function addDefinitionConnector(project: Project, id: string, connector: DefinitionConnector): Project {
  const def = definitionOrThrow(project, id);
  checkNew(project, def.connectors, connector, `definition ${id}`);
  return putDefinition(project, { ...def, connectors: [...def.connectors, connector] });
}

/** Add an inline connector to a one-off component. */
export function addInlineConnector(project: Project, componentId: string, connector: DefinitionConnector): Project {
  const { component, connectors } = inlineOrThrow(project, componentId);
  checkNew(project, connectors, connector, `component ${componentId}`);
  const components = new Map(project.components);
  components.set(componentId, { ...component, connectors: [...connectors, connector] });
  return { ...project, components };
}

/** What an edit may change on one connector. A new designator renames it and carries its wiring. */
export type ConnectorPatch = Partial<Pick<DefinitionConnector, "designator" | "connector" | "label" | "side">>;

/** Refuse a new designator that is not a name or that the owner already has. */
function checkRename(connectors: DefinitionConnector[], from: string, patch: ConnectorPatch, where: string): string | undefined {
  const to = patch.designator;
  if (to === undefined || to === from) return undefined;
  if (!designator.safeParse(to).success) throw new Error(`designator ${JSON.stringify(to)}: use letters, digits, hyphen, underscore`);
  if (connectors.some((c) => c.designator === to)) throw new Error(`${where} already has a connector ${to}`);
  return to;
}

/**
 * Point every reference to `<component>/<from>` at `<component>/<to>`, for
 * each of `componentIds`: net connector lists and their pins keys, topology
 * connector endpoints, star-net bend keys, the drawn pin layout and design
 * rule silences.
 */
function renameConnectorRefs(project: Project, componentIds: string[], from: string, to: string): Project {
  let p = project;
  for (const componentId of componentIds) {
    const was = `${componentId}/${from}`;
    const now = `${componentId}/${to}`;
    const nets = new Map<string, Net[]>();
    for (const [domain, list] of p.nets) nets.set(domain, list.map((n) => (n.connectors.includes(was) ? renameOnNet(n, was, now) : n)));
    const topologies = new Map<string, Topology>();
    for (const [id, t] of p.topologies) topologies.set(id, { ...t, endpoints: t.endpoints.map((e) => (e.kind === "connector" && e.connector === was ? { ...e, connector: now } : e)) });
    const canvas = p.connectivityCanvas;
    const bends: typeof canvas.bends = {};
    for (const [key, value] of Object.entries(canvas.bends)) bends[renameTarget(key, was, now)] = value;
    const pins = { ...canvas.pins };
    const layout = pins[componentId];
    if (layout) {
      const renamed: PinLayout = {};
      for (const side of SIDES) if (layout[side]) renamed[side] = layout[side]!.map((d) => (d === from ? to : d));
      pins[componentId] = renamed;
    }
    const silences = p.drc.silences.map((x) => ({ ...x, target: renameTarget(x.target, was, now) }));
    p = { ...p, nets, topologies, connectivityCanvas: { ...canvas, bends, pins }, drc: { ...p.drc, silences } };
  }
  return p;
}

function renameInBridges(bridges: Bridges | undefined, from: string, to: string): Bridges | undefined {
  return bridges?.map((b) => b.map((d) => (d === from ? to : d)));
}

/** A bend key or silence target names an address, or `<net>:<address>` for one net at one connector. */
function renameTarget(target: string, was: string, now: string): string {
  if (target === was) return now;
  return target.endsWith(`:${was}`) ? `${target.slice(0, -was.length)}${now}` : target;
}

function renameOnNet(net: Net, was: string, now: string): Net {
  const out: Net = { ...net, connectors: net.connectors.map((a) => (a === was ? now : a)) };
  if (net.pins && was in net.pins) {
    const pins: NonNullable<Net["pins"]> = {};
    for (const [address, list] of Object.entries(net.pins)) pins[address === was ? now : address] = list;
    out.pins = pins;
  }
  return out;
}

/** Change one connector of a definition. Reaches every component sharing it. Shadows a shared definition. */
export function updateDefinitionConnector(project: Project, id: string, designator: string, patch: ConnectorPatch): Project {
  checkType(project, patch);
  const def = definitionOrThrow(project, id);
  const to = checkRename(def.connectors, designator, patch, `definition ${id}`);
  const connectors = patchAt(def.connectors, designator, patch, `definition ${id}`);
  const p = putDefinition(project, { ...def, connectors, bridges: to ? renameInBridges(def.bridges, designator, to) : def.bridges });
  return to ? renameConnectorRefs(p, definitionUsers(p, id).map((c) => c.id), designator, to) : p;
}

/** Change one inline connector of a one-off component. */
export function updateInlineConnector(project: Project, componentId: string, designator: string, patch: ConnectorPatch): Project {
  checkType(project, patch);
  const { component, connectors } = inlineOrThrow(project, componentId);
  const to = checkRename(connectors, designator, patch, `component ${componentId}`);
  const components = new Map(project.components);
  const bridges = to ? renameInBridges(component.bridges, designator, to) : component.bridges;
  components.set(componentId, { ...component, connectors: patchAt(connectors, designator, patch, `component ${componentId}`), bridges });
  const p = { ...project, components };
  return to ? renameConnectorRefs(p, [componentId], designator, to) : p;
}

export interface ConnectorTypeChange {
  owner: DrawerOwner;
  designator: string;
  /** Connector type ref the library has, `connectors/<id>`. */
  type: string;
}

/**
 * Set the type of many connectors at once, the drawer's bulk edit. A
 * definition owner edits the definition; a component owner edits its inline
 * connector. Never detaches a component. One call, so one undo step.
 */
export function setConnectorTypes(project: Project, changes: ConnectorTypeChange[]): Project {
  let p = project;
  for (const { owner, designator, type } of changes) p = updateConnector(p, owner, designator, { connector: type });
  return p;
}

/** Who owns a component's connectors: its definition, or the component itself when it is a one-off. */
export function connectorOwner(component: Component): DrawerOwner {
  return component.definition ? { kind: "definition", id: component.definition.slice(component.definition.indexOf("/") + 1) } : { kind: "component", id: component.id };
}

/** Add a connector to whichever owns it, a definition or a one-off. */
export function addConnector(project: Project, owner: DrawerOwner, connector: DefinitionConnector): Project {
  return owner.kind === "definition" ? addDefinitionConnector(project, owner.id, connector) : addInlineConnector(project, owner.id, connector);
}

/** Change one connector of whichever owns it, a definition or a one-off. */
export function updateConnector(project: Project, owner: DrawerOwner, designator: string, patch: ConnectorPatch): Project {
  return owner.kind === "definition" ? updateDefinitionConnector(project, owner.id, designator, patch) : updateInlineConnector(project, owner.id, designator, patch);
}
