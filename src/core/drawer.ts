import { connectorShortName, resolveRef } from "./library";
import { componentConnectors, type Project } from "./project";
import { parseRef } from "./refs";
import type { DefinitionConnector } from "./schema";

/**
 * The connector drawer: every connector in the project whose type can
 * change, one row per designator of a definition in use and one per inline
 * connector of a one-off. Derived, never stored.
 */

/** Who a drawer row's connector belongs to: a component definition by id, or a one-off component by id. */
export type DrawerOwner = { kind: "definition"; id: string } | { kind: "component"; id: string };

export interface DrawerRow {
  owner: DrawerOwner;
  /** The definition's name, or the one-off component's own name. */
  ownerName: string;
  designator: string;
  /** Connector type ref, `connectors/<id>`. */
  type: string;
  /** The type's mating part number; undefined when the type does not resolve. */
  mating?: string;
  /** The type's pin count; undefined when the type does not resolve. */
  pins?: number;
  /** How many components the row reaches: those sharing the definition, or 1 for a one-off. */
  users: number;
}

export function ownerKey(owner: DrawerOwner): string {
  return `${owner.kind}:${owner.id}`;
}

/** Rows grouped by owner, owners by name, connectors in their listed order. A definition that does not resolve has no rows. */
export function drawerRows(project: Project): DrawerRow[] {
  const groups: { owner: DrawerOwner; name: string; connectors: DefinitionConnector[]; users: number }[] = [];
  const defs = new Map<string, { users: number }>();
  for (const c of project.components.values()) {
    if (c.connectors) {
      groups.push({ owner: { kind: "component", id: c.id }, name: c.name, connectors: c.connectors, users: 1 });
    } else if (c.definition) {
      const entry = defs.get(c.definition);
      if (entry) entry.users++;
      else defs.set(c.definition, { users: 1 });
    }
  }
  for (const [ref, { users }] of defs) {
    const def = resolveRef(project.library, ref, "components");
    if (!def) continue;
    groups.push({ owner: { kind: "definition", id: parseRef(ref).id }, name: def.name, connectors: def.connectors, users });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name) || (ownerKey(a.owner) < ownerKey(b.owner) ? -1 : 1));
  return groups.flatMap((g) =>
    g.connectors.map((con) => {
      const type = resolveRef(project.library, con.connector, "connectors");
      return { owner: g.owner, ownerName: g.name, designator: con.designator, type: con.connector, mating: type?.mating.part_number, pins: type?.pins, users: g.users };
    }),
  );
}

export interface ConnectorTypeUse {
  /** Connector type ref, `connectors/<id>`. */
  type: string;
  /** What the canvas calls it. */
  short: string;
  name: string;
  /** Project connectors carrying the type, counted per component. */
  count: number;
}

/** Every connector type in the merged library with the number of project connectors carrying it, zero included, by short name. */
export function connectorTypeInventory(project: Project): ConnectorTypeUse[] {
  const counts = new Map<string, number>();
  for (const c of project.components.values()) {
    for (const con of componentConnectors(project, c) ?? []) counts.set(con.connector, (counts.get(con.connector) ?? 0) + 1);
  }
  return [...project.library.connectors.values()]
    .map((t) => {
      const type = `connectors/${t.id}`;
      return { type, short: connectorShortName(project.library, type), name: t.name, count: counts.get(type) ?? 0 };
    })
    .sort((a, b) => a.short.localeCompare(b.short) || (a.type < b.type ? -1 : 1));
}
