import { mergeLibraries, resolveRef } from "./library";
import { removeConnectorFromNet, removeEndpoint, removeNet } from "./ops";
import { allNets, findNet, type Project } from "./project";
import { designator, type Bridges, type Component, type ComponentDefinition, type DefinitionConnector } from "./schema";
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

/** What an edit may change on one connector. The designator is renamed by its own op. */
export type ConnectorPatch = Partial<Pick<DefinitionConnector, "connector" | "label" | "side">>;

/** Change one connector of a definition. Reaches every component sharing it. Shadows a shared definition. */
export function updateDefinitionConnector(project: Project, id: string, designator: string, patch: ConnectorPatch): Project {
  checkType(project, patch);
  const def = definitionOrThrow(project, id);
  return putDefinition(project, { ...def, connectors: patchAt(def.connectors, designator, patch, `definition ${id}`) });
}

/** Change one inline connector of a one-off component. */
export function updateInlineConnector(project: Project, componentId: string, designator: string, patch: ConnectorPatch): Project {
  checkType(project, patch);
  const { component, connectors } = inlineOrThrow(project, componentId);
  const components = new Map(project.components);
  components.set(componentId, { ...component, connectors: patchAt(connectors, designator, patch, `component ${componentId}`) });
  return { ...project, components };
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

/**
 * Take the wiring off one designator on each of these components: the nets
 * that used it lose it and its pins, a net left under two connectors goes,
 * its topology endpoints go with their segments, and the canvas forgets
 * where its pin was drawn.
 */
function detachConnectorRefs(project: Project, componentIds: string[], designator: string): Project {
  let p = project;
  for (const componentId of componentIds) {
    const address = `${componentId}/${designator}`;
    for (const { net } of allNets(p)) {
      if (!net.connectors.includes(address)) continue;
      p = removeConnectorFromNet(p, net.id, address);
      if ((findNet(p, net.id)?.net.connectors.length ?? 0) < 2) p = removeNet(p, net.id);
    }
    // An endpoint goes with its segments, and they take their ties and slack.
    for (const t of [...p.topologies.values()]) {
      for (const e of t.endpoints) if (e.kind === "connector" && e.connector === address) p = removeEndpoint(p, t.id, e.id);
    }
    const layout = p.connectivityCanvas.pins[componentId];
    if (layout) {
      const kept = Object.fromEntries(Object.entries(layout).map(([side, ds]) => [side, ds?.filter((d) => d !== designator)]));
      p = { ...p, connectivityCanvas: { ...p.connectivityCanvas, pins: { ...p.connectivityCanvas.pins, [componentId]: kept } } };
    }
  }
  return p;
}

/** Bridges without one designator. A bridge left joining fewer than two goes, and no bridges at all is undefined. */
function bridgesWithout(bridges: Bridges | undefined, designator: string): Bridges | undefined {
  if (!bridges) return undefined;
  const kept = bridges.map((b) => b.filter((d) => d !== designator)).filter((b) => b.length >= 2);
  return kept.length ? kept : undefined;
}

/** Remove a connector from a definition. Reaches every component sharing it. Shadows a shared definition. */
export function removeDefinitionConnector(project: Project, id: string, designator: string): Project {
  const def = definitionOrThrow(project, id);
  if (!def.connectors.some((c) => c.designator === designator)) throw new Error(`no connector ${designator} on definition ${id}`);
  const users = definitionUsers(project, id).map((c) => c.id);
  const p = putDefinition(project, { ...def, connectors: def.connectors.filter((c) => c.designator !== designator), bridges: bridgesWithout(def.bridges, designator) });
  return detachConnectorRefs(p, users, designator);
}

/** Remove an inline connector from a one-off component. */
export function removeInlineConnector(project: Project, componentId: string, designator: string): Project {
  const { component, connectors } = inlineOrThrow(project, componentId);
  if (!connectors.some((c) => c.designator === designator)) throw new Error(`no connector ${designator} on component ${componentId}`);
  const components = new Map(project.components);
  components.set(componentId, { ...component, connectors: connectors.filter((c) => c.designator !== designator), bridges: bridgesWithout(component.bridges, designator) });
  return detachConnectorRefs({ ...project, components }, [componentId], designator);
}

/**
 * Remove a connector from whichever owns it, a definition or a one-off, and
 * clean up after it on every component it reached. One call, so one undo step.
 */
export function removeConnector(project: Project, owner: DrawerOwner, designator: string): Project {
  return owner.kind === "definition" ? removeDefinitionConnector(project, owner.id, designator) : removeInlineConnector(project, owner.id, designator);
}
