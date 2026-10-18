import { mergeLibraries, resolveRef } from "./library";
import type { Project } from "./project";
import type { Component, ComponentDefinition, DefinitionConnector } from "./schema";
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
  for (const { owner, designator, type } of changes) {
    p = owner.kind === "definition" ? updateDefinitionConnector(p, owner.id, designator, { connector: type }) : updateInlineConnector(p, owner.id, designator, { connector: type });
  }
  return p;
}
