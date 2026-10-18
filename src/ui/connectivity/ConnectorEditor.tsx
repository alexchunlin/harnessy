import { useState, type ReactNode } from "react";
import { addConnector, connectorOwner, definitionUsers, revertDefinition, updateConnector, type Component, type ConnectorTypeUse, type DefinitionConnector, type Project } from "../../core";
import { MissingTypeLine, TypePicker } from "./ConnectorDrawer";

/**
 * The component inspector's connector editing (ADR 0003). A component with a
 * definition edits the definition, which reaches every component sharing it
 * and lands as a project copy when the definition is shared. A one-off edits
 * its own inline connectors.
 */

type Edit = (fn: (p: Project) => Project) => void;

/** Run an op that can refuse, and say why it did. */
export function tryEdit(edit: Edit, fn: (p: Project) => Project): boolean {
  try {
    edit(fn);
    return true;
  } catch (e) {
    window.alert((e as Error).message);
    return false;
  }
}

/** A free designator for a new connector: J1, J2, and so on. */
export function nextDesignator(taken: string[]): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`J${n}`)) return `J${n}`;
}

/** Whether a definition is the shared entry, a project copy that shadows it, or the project's own. */
export function definitionStanding(project: Project, id: string): "shared" | "shadowed" | "project" {
  if (!project.projectLibrary.components.has(id)) return "shared";
  return project.repoLibrary.components.has(id) ? "shadowed" : "project";
}

/** The mark a shadowed definition carries, in the inspector and the library panel. */
export function ShadowMark() {
  return (
    <span className="shadow-mark" title="This project keeps its own copy, which shadows the shared catalogue">
      project copy
    </span>
  );
}

/** How far an edit to the component's definition reaches, whether it is shadowed, and the give-back control. */
export function DefinitionStatus({ project, component, edit }: { project: Project; component: Component; edit: Edit }) {
  const owner = connectorOwner(component);
  if (owner.kind !== "definition") return null;
  const id = owner.id;
  const users = definitionUsers(project, id).length;
  const standing = definitionStanding(project, id);
  const name = project.library.components.get(id)?.name ?? id;
  return (
    <div className="definition-status">
      <p className="muted">
        {users === 1 ? "Only this component uses the definition." : `${users} components share the definition, and a connector edit here changes all of them.`}{" "}
        {standing === "shared" && "An edit takes a project copy; the shared catalogue stays as it is."}
        {standing === "project" && "The definition is this project's own."}
      </p>
      {standing === "shadowed" && (
        <div className="row">
          <ShadowMark />
          <button
            title="Delete this project's copy so the shared catalogue entry stands again"
            onClick={() => {
              if (!window.confirm(`Give back this project's copy of ${name}? The shared catalogue entry stands again, and its edits here are lost.`)) return;
              tryEdit(edit, (p) => revertDefinition(p, id));
            }}
          >
            Give back to the shared entry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One connector: its designator and its type. `designator` replaces the
 * plain label when the designator is editable; `children` holds the row's
 * other controls.
 */
export function ConnectorRow({
  ownerName,
  connector,
  inventory,
  onType,
  designator,
  children,
}: {
  ownerName: string;
  connector: DefinitionConnector;
  inventory: ConnectorTypeUse[];
  onType: (type: string) => void;
  designator?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="row">
      {designator ?? <strong>{connector.designator}</strong>}
      <TypePicker label={`Connector type of ${ownerName} ${connector.designator}`} inventory={inventory} value={connector.connector} onChange={onType} />
      {children}
    </div>
  );
}

/** Retype one connector of the component's owner, one undo step. */
export function retype(edit: Edit, component: Component, designator: string, type: string): void {
  tryEdit(edit, (p) => updateConnector(p, connectorOwner(component), designator, { connector: type }));
}

/** A designator and a type, then Add. Refusals, such as a designator already taken, are said aloud. */
export function AddConnector({ component, taken, inventory, edit }: { component: Component; taken: string[]; inventory: ConnectorTypeUse[]; edit: Edit }) {
  const [designator, setDesignator] = useState<string | undefined>(undefined);
  const [type, setType] = useState("");
  const shown = designator ?? nextDesignator(taken);
  const chosen = type || inventory[0]?.type || "";
  const add = () => {
    if (!chosen) return window.alert("The library has no connector types.");
    if (tryEdit(edit, (p) => addConnector(p, connectorOwner(component), { designator: shown.trim(), connector: chosen }))) setDesignator(undefined);
  };
  return (
    <div className="add-connector">
      <div className="row">
        <input className="short" aria-label="New connector designator" value={shown} onChange={(e) => setDesignator(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <TypePicker label="New connector type" inventory={inventory} value={chosen} onChange={setType} />
        <button onClick={add}>Add connector</button>
      </div>
      <MissingTypeLine />
    </div>
  );
}
