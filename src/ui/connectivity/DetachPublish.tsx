import { detachComponent, freeDefinitionId, publishDefinition, type Component, type Project } from "../../core";
import { tryEdit } from "./ConnectorEditor";

type Edit = (fn: (p: Project) => Project) => void;

/**
 * The two escape hatches between a definition and a one-off (ADR 0003). A
 * component with a definition can take its own copy of the connectors; a
 * one-off can publish its connectors as a definition others then share.
 * Each is one undo step.
 */
export function DetachPublish({ project, component, edit }: { project: Project; component: Component; edit: Edit }) {
  const id = component.id;
  if (component.definition) {
    return (
      <div className="row">
        <button
          title="Give this component its own copy of the connectors, so later edits to the definition pass it by"
          onClick={() => {
            if (!window.confirm(`Detach ${component.name} from its definition? It keeps its connectors and wiring, and later edits to the definition no longer reach it.`)) return;
            tryEdit(edit, (p) => detachComponent(p, id));
          }}
        >
          Detach from the definition
        </button>
      </div>
    );
  }
  return (
    <div className="row">
      <button
        title={`Write these connectors as a project definition, components/${freeDefinitionId(project, component.name)}, that other components can share`}
        onClick={() => tryEdit(edit, (p) => publishDefinition(p, id).project)}
      >
        Publish as a definition
      </button>
    </div>
  );
}
