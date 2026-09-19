import { z } from "zod";
import {
  ComponentSchema,
  ConnectivityCanvasSchema,
  DrcFileSchema,
  NetsFileSchema,
  ProjectFileSchema,
  TopologyCanvasSchema,
  TopologySchema,
  LIBRARY_SCHEMAS,
  LIBRARY_FOLDERS,
  type Component,
  type ConnectivityCanvas,
  type DefinitionConnector,
  type DrcFile,
  type Net,
  type ProjectFile,
  type Topology,
  type TopologyCanvas,
  type LibraryFolder,
  type Side,
  SIDES,
} from "./schema";
import { emptyLibrary, explain, loadLibrary, mergeLibraries, resolveRef, type FileProblem, type Files, type Library } from "./library";
import { serialize } from "./serialize";
import { parseAddress } from "./refs";

/** A loaded project. Nets are keyed by domain id, matching the file split. */
export interface Project {
  file: ProjectFile;
  components: Map<string, Component>;
  nets: Map<string, Net[]>;
  topologies: Map<string, Topology>;
  connectivityCanvas: ConnectivityCanvas;
  topologyCanvases: Map<string, TopologyCanvas>;
  drc: DrcFile;
  /** The project's own library entries, which shadow the repo library. */
  projectLibrary: Library;
  /** Repo library merged with the project library. What references resolve against. */
  library: Library;
}

export const PROJECT_FILE = "project.json";

export function isProjectFolder(files: Files): boolean {
  return files.has(PROJECT_FILE);
}

export function emptyProject(name: string, repoLibrary: Library = emptyLibrary()): Project {
  const projectLibrary = emptyLibrary();
  return {
    file: { schema: 1, name, domains: [], layers: [] },
    components: new Map(),
    nets: new Map(),
    topologies: new Map(),
    connectivityCanvas: { components: {}, hubs: {}, groups: [], notes: [], bends: {}, pins: {} },
    topologyCanvases: new Map(),
    drc: { silences: [] },
    projectLibrary,
    library: mergeLibraries(repoLibrary, projectLibrary),
  };
}

function parseJson<T>(schema: z.ZodType<T>, path: string, text: string, problems: FileProblem[]): T | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    problems.push({ path, message: `invalid JSON: ${(e as Error).message}` });
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    problems.push({ path, message: explain(parsed.error) });
    return undefined;
  }
  return parsed.data;
}

/**
 * Load a project from a folder's files. Malformed files are reported and
 * skipped. Dangling references never block a load; the design rule check
 * lists them.
 */
export function loadProject(files: Files, repoLibrary: Library = emptyLibrary()): { project: Project; problems: FileProblem[] } {
  const problems: FileProblem[] = [];
  const text = files.get(PROJECT_FILE);
  if (text === undefined) throw new Error(`not a project folder: no ${PROJECT_FILE}`);
  const file = parseJson(ProjectFileSchema, PROJECT_FILE, text, problems);
  if (!file) throw new Error(`unreadable ${PROJECT_FILE}: ${problems[0]?.message}`);

  const project = emptyProject(file.name, repoLibrary);
  project.file = file;
  for (const d of file.domains) project.nets.set(d.id, []);

  for (const [path, body] of files) {
    let m: RegExpExecArray | null;
    if ((m = /^components\/([^/]+)\.json$/.exec(path))) {
      const c = parseJson(ComponentSchema, path, body, problems);
      if (!c) continue;
      if (c.id !== m[1]) {
        problems.push({ path, message: `filename ${m[1]} does not match id ${c.id}` });
        continue;
      }
      project.components.set(c.id, c);
    } else if ((m = /^nets\/([^/]+)\.json$/.exec(path))) {
      const nets = parseJson(NetsFileSchema, path, body, problems);
      if (!nets) continue;
      if (!file.domains.some((d) => d.id === m![1])) problems.push({ path, message: `no domain ${m[1]} in ${PROJECT_FILE}` });
      project.nets.set(m[1], nets);
    } else if ((m = /^topologies\/([^/]+)\.json$/.exec(path))) {
      const t = parseJson(TopologySchema, path, body, problems);
      if (!t) continue;
      if (t.id !== m[1]) {
        problems.push({ path, message: `filename ${m[1]} does not match id ${t.id}` });
        continue;
      }
      project.topologies.set(t.id, t);
    } else if (path === "canvas/connectivity.json") {
      const c = parseJson(ConnectivityCanvasSchema, path, body, problems);
      if (c) project.connectivityCanvas = c;
    } else if ((m = /^canvas\/([^/]+)\.json$/.exec(path))) {
      const c = parseJson(TopologyCanvasSchema, path, body, problems);
      if (c) project.topologyCanvases.set(m[1], c);
    } else if (path === "drc.json") {
      const d = parseJson(DrcFileSchema, path, body, problems);
      if (d) project.drc = d;
    }
  }

  const lib = loadLibrary(files, "library/");
  problems.push(...lib.problems);
  project.projectLibrary = lib.library;
  project.library = mergeLibraries(repoLibrary, lib.library);
  return { project, problems };
}

/** Serialize a project to files. Every file the project owns is present. */
export function saveProject(project: Project): Files {
  const files: Files = new Map();
  files.set(PROJECT_FILE, serialize(ProjectFileSchema, project.file));
  for (const c of project.components.values()) files.set(`components/${c.id}.json`, serialize(ComponentSchema, c));
  for (const [domain, nets] of project.nets) files.set(`nets/${domain}.json`, serialize(NetsFileSchema, nets));
  for (const t of project.topologies.values()) files.set(`topologies/${t.id}.json`, serialize(TopologySchema, t));
  files.set("canvas/connectivity.json", serialize(ConnectivityCanvasSchema, project.connectivityCanvas));
  for (const [id, c] of project.topologyCanvases) files.set(`canvas/${id}.json`, serialize(TopologyCanvasSchema, c));
  files.set("drc.json", serialize(DrcFileSchema, project.drc));
  for (const folder of LIBRARY_FOLDERS) {
    for (const entry of project.projectLibrary[folder].values()) {
      files.set(`library/${folder}/${(entry as { id: string }).id}.json`, serialize(LIBRARY_SCHEMAS[folder as LibraryFolder], entry));
    }
  }
  return files;
}

/** Paths that `saveProject` would write which `previous` has and `next` lacks. */
export function deletedPaths(previous: Files, next: Files): string[] {
  return [...previous.keys()].filter((p) => !next.has(p));
}

// Lookups ---------------------------------------------------------------------

export function domainOf(project: Project, netId: string): string | undefined {
  for (const [domain, nets] of project.nets) if (nets.some((n) => n.id === netId)) return domain;
  return undefined;
}

export function findNet(project: Project, netId: string): { net: Net; domain: string } | undefined {
  for (const [domain, nets] of project.nets) {
    const net = nets.find((n) => n.id === netId);
    if (net) return { net, domain };
  }
  return undefined;
}

export function allNets(project: Project): { net: Net; domain: string }[] {
  const out: { net: Net; domain: string }[] = [];
  for (const [domain, nets] of project.nets) for (const net of nets) out.push({ net, domain });
  return out;
}

/** The connectors a component has, from its definition or inline. Undefined when the definition is missing. */
export function componentConnectors(project: Project, component: Component): DefinitionConnector[] | undefined {
  if (component.connectors) return component.connectors;
  if (!component.definition) return [];
  const def = resolveRef(project.library, component.definition, "components");
  return def?.connectors;
}

/** Resolve a connector address to its component and definition connector, or explain why not. */
export function resolveConnector(
  project: Project,
  address: string,
): { component: Component; connector: DefinitionConnector } | { error: "no-component" | "no-definition" | "no-designator" } {
  const { component: cmpId, designator } = parseAddress(address);
  const component = project.components.get(cmpId);
  if (!component) return { error: "no-component" };
  const connectors = componentConnectors(project, component);
  if (!connectors) return { error: "no-definition" };
  const connector = connectors.find((c) => c.designator === designator);
  if (!connector) return { error: "no-designator" };
  return { component, connector };
}

/** Human label for a connector: component name plus designator. */
export function connectorLabel(project: Project, address: string): string {
  const { component, designator } = parseAddress(address);
  const name = project.components.get(component)?.name ?? component;
  return `${name} ${designator}`;
}

/** All connector addresses in the project, id-sorted. */
export function allConnectorAddresses(project: Project): string[] {
  const out: string[] = [];
  for (const c of [...project.components.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const con of componentConnectors(project, c) ?? []) out.push(`${c.id}/${con.designator}`);
  }
  return out;
}

/**
 * Where a component's pins sit: the canvas override where it lists a
 * designator, else the definition's side, else alternating left and right
 * down the connector list. Order within a side follows the override, then
 * the definition.
 */
export function pinLayout(project: Project, component: Component): Record<Side, string[]> {
  const connectors = componentConnectors(project, component) ?? [];
  const override = project.connectivityCanvas.pins[component.id] ?? {};
  const out: Record<Side, string[]> = { left: [], right: [], top: [], bottom: [] };
  const known = new Set(connectors.map((c) => c.designator));
  const placed = new Set<string>();
  for (const side of SIDES) {
    for (const d of override[side] ?? []) {
      if (!known.has(d) || placed.has(d)) continue;
      out[side].push(d);
      placed.add(d);
    }
  }
  connectors.forEach((c, i) => {
    if (placed.has(c.designator)) return;
    out[c.side ?? (i % 2 === 0 ? "left" : "right")].push(c.designator);
  });
  return out;
}

export function netSpec(project: Project, net: Net, domain: string): { ref: string | undefined; conductors: number } {
  const d = project.file.domains.find((x) => x.id === domain);
  return { ref: net.spec ?? d?.spec, conductors: net.conductors ?? d?.conductors ?? 1 };
}
