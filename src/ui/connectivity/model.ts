import type { Edge, Node } from "@xyflow/react";
import { ALL_LAYER_ID, allNets, bendsKey, componentConnectors, pinLayout, visibleLayers, type Component, type DefinitionConnector, type Domain, type Group, type Net, type Note, type Position, type Project, type Side } from "../../core";

/** Derive React Flow nodes and edges from the project, the active layer, and the selection. */

export interface ComponentNodeData {
  component: Component;
  connectors: DefinitionConnector[];
  geometry: BoxGeometry;
  dimmed: boolean;
  /** designator to the nets attached there, for handle tooltips */
  netsAt: Record<string, { net: Net; domain: Domain }[]>;
  [key: string]: unknown;
}
export interface HubNodeData { net: Net; color: string; label: string; inactive: boolean; [key: string]: unknown }
export interface GroupNodeData { group: Group; [key: string]: unknown }
export interface NoteNodeData { note: Note; [key: string]: unknown }
export interface NetEdgeData {
  color: string;
  netId: string;
  siblingIndex: number;
  siblingCount: number;
  label: string;
  inactive: boolean;
  /** Key under the canvas file's bends. */
  key: string;
  /** Hand-placed bends, if any. */
  bends?: Position[];
  /** The target is a net hub, which has no side and no stub. */
  hub: boolean;
  [key: string]: unknown;
}

export type FlowNode = Node<ComponentNodeData, "component"> | Node<HubNodeData, "hub"> | Node<GroupNodeData, "group"> | Node<NoteNodeData, "note">;

/** Pin pitch. Rows, header, bands, and padding are multiples of the 6 px snap grid so pins land on it. */
export const HANDLE_ROW = 24;
export const NODE_HEADER = 30;
/** Height of the band that holds top or bottom pin labels. */
export const PIN_BAND = 36;
export const NODE_WIDTH = 180;
const MIN_WIDTH = 120;

export interface PinSpot extends Position {
  side: Side;
}

/** A component box: its size and where each pin sits, relative to the box. */
export interface BoxGeometry {
  width: number;
  height: number;
  /** Top of the title bar; below the top pin band when there is one. */
  header: number;
  sides: Record<Side, string[]>;
  pins: Record<string, PinSpot>;
}

const roundUp = (v: number, step: number) => Math.ceil(v / step) * step;

/** Text width in the canvas fonts, measured once per string. Without a DOM (unit tests) a per-character estimate stands in. */
const TITLE_FONT = "600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const PIN_FONT = "11px ui-monospace, Menlo, monospace";
const measured = new Map<string, number>();
// Typed loosely so the module compiles for the example generator, which has no DOM lib.
interface TextContext {
  font: string;
  measureText(text: string): { width: number };
}
let context: TextContext | null | undefined;
function makeContext(): TextContext | null {
  const g = globalThis as unknown as { document?: { createElement(tag: string): { getContext(kind: string): TextContext | null } } };
  return g.document ? g.document.createElement("canvas").getContext("2d") : null;
}
export function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const hit = measured.get(key);
  if (hit !== undefined) return hit;
  if (context === undefined) context = makeContext();
  let w: number;
  if (context) {
    context.font = font;
    w = context.measureText(text).width;
  } else {
    w = text.length * (font === PIN_FONT ? 6.6 : 7);
  }
  measured.set(key, w);
  return w;
}

/** A box wide enough for its name and its widest left and right pin labels, with room for the net dots. */
export function fittedWidth(name: string, sides: Record<Side, string[]>, dots: Record<string, number>, oneOff: boolean): number {
  const pin = (d: string) => textWidth(d, PIN_FONT) + (dots[d] ? dots[d] * 8 + 4 : 0);
  const widest = (list: string[]) => list.reduce((m, d) => Math.max(m, pin(d)), 0);
  const pins = 10 + widest(sides.left) + 24 + widest(sides.right) + 10;
  const title = 8 + textWidth(name, TITLE_FONT) + (oneOff ? 44 : 0) + 8;
  return Math.max(pins, title);
}

export function boxGeometry(sides: Record<Side, string[]>, width = NODE_WIDTH): BoxGeometry {
  const rows = Math.max(1, sides.left.length, sides.right.length);
  const topBand = sides.top.length ? PIN_BAND : 0;
  const bottomBand = sides.bottom.length ? PIN_BAND : 0;
  const cols = Math.max(sides.top.length, sides.bottom.length);
  const w = Math.max(MIN_WIDTH, roundUp(width, 6), roundUp((cols + 1) * HANDLE_ROW, 6));
  const height = topBand + NODE_HEADER + rows * HANDLE_ROW + (bottomBand || 6);
  const pins: Record<string, PinSpot> = {};
  sides.left.forEach((d, i) => (pins[d] = { x: 0, y: topBand + NODE_HEADER + i * HANDLE_ROW + HANDLE_ROW / 2, side: "left" }));
  sides.right.forEach((d, i) => (pins[d] = { x: w, y: topBand + NODE_HEADER + i * HANDLE_ROW + HANDLE_ROW / 2, side: "right" }));
  sides.top.forEach((d, i) => (pins[d] = { x: HANDLE_ROW + i * HANDLE_ROW, y: 0, side: "top" }));
  sides.bottom.forEach((d, i) => (pins[d] = { x: HANDLE_ROW + i * HANDLE_ROW, y: height, side: "bottom" }));
  return { width: w, height, header: topBand, sides, pins };
}

/** Where a pointer over a box would drop a pin: the nearest side and the slot index among the other pins there. */
export function pinSlotAt(g: BoxGeometry, rel: Position, moving: string): { side: Side; index: number } {
  const d: Record<Side, number> = { left: rel.x, right: g.width - rel.x, top: rel.y, bottom: g.height - rel.y };
  const side = (Object.keys(d) as Side[]).reduce((best, k) => (d[k] < d[best] ? k : best));
  const others = g.sides[side].filter((x) => x !== moving);
  const along = side === "left" || side === "right" ? rel.y - g.header - NODE_HEADER : rel.x - HANDLE_ROW / 2;
  const index = Math.max(0, Math.min(others.length, Math.round(along / HANDLE_ROW)));
  return { side, index };
}

/** Where the slot marker draws, relative to the box. */
export function slotMarker(g: BoxGeometry, side: Side, index: number): { x: number; y: number; horizontal: boolean } {
  if (side === "left" || side === "right") return { x: side === "left" ? 0 : g.width, y: g.header + NODE_HEADER + index * HANDLE_ROW, horizontal: true };
  return { x: HANDLE_ROW / 2 + index * HANDLE_ROW, y: side === "top" ? 0 : g.height, horizontal: false };
}

export function hubDefaultPosition(project: Project, net: Net): Position {
  const pts = net.connectors.map((a) => project.connectivityCanvas.components[a.split("/")[0]]).filter(Boolean);
  if (pts.length === 0) return { x: 0, y: 0 };
  return { x: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length + NODE_WIDTH / 2), y: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length + 60) };
}

export function activeDomains(project: Project, layerId: string): Set<string> {
  if (layerId === ALL_LAYER_ID) return new Set(project.file.domains.map((d) => d.id));
  return new Set(visibleLayers(project).find((l) => l.id === layerId)?.domains ?? []);
}

export function deriveFlow(project: Project, layerId: string, selected: Set<string>): { nodes: FlowNode[]; edges: Edge<NetEdgeData>[] } {
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const visible = activeDomains(project, layerId);
  const nets = allNets(project);
  const netsAt = new Map<string, { net: Net; domain: Domain }[]>();
  const litComponents = new Set<string>();
  for (const { net, domain } of nets) {
    const d = domains.get(domain);
    for (const a of net.connectors) {
      if (!netsAt.has(a)) netsAt.set(a, []);
      if (d) netsAt.get(a)!.push({ net, domain: d });
      if (visible.has(domain)) litComponents.add(a.split("/")[0]);
    }
  }

  const nodes: FlowNode[] = [];
  for (const g of project.connectivityCanvas.groups) {
    const pos = { x: g.rect.x, y: g.rect.y };
    nodes.push({ id: g.id, type: "group", position: pos, data: { group: g }, width: g.rect.w, height: g.rect.h, zIndex: -1, selected: selected.has(g.id), draggable: true, selectable: true });
  }
  for (const c of project.components.values()) {
    const connectors = componentConnectors(project, c) ?? [];
    const dimmed = !litComponents.has(c.id) && layerId !== ALL_LAYER_ID;
    const at: ComponentNodeData["netsAt"] = {};
    const dots: Record<string, number> = {};
    for (const con of connectors) {
      at[con.designator] = netsAt.get(`${c.id}/${con.designator}`) ?? [];
      dots[con.designator] = at[con.designator].length;
    }
    const sides = pinLayout(project, c);
    const geometry = boxGeometry(sides, fittedWidth(c.name, sides, dots, c.definition === undefined));
    nodes.push({
      id: c.id,
      type: "component",
      position: project.connectivityCanvas.components[c.id] ?? { x: 0, y: 0 },
      data: { component: c, connectors, geometry, dimmed, netsAt: at },
      selected: selected.has(c.id),
      selectable: !dimmed,
      connectable: !dimmed,
      draggable: !dimmed,
      className: dimmed ? "dimmed" : undefined,
    });
  }
  const edges: Edge<NetEdgeData>[] = [];
  const pairCount = new Map<string, Edge<NetEdgeData>[]>();
  for (const { net, domain } of nets) {
    // Nets outside the layer stay drawn, greyed and untouchable, like an inactive KiCad layer.
    const inactive = !visible.has(domain);
    const color = domains.get(domain)?.color ?? "#888";
    const label = net.name ?? net.id;
    const ends = net.connectors.filter((a) => project.components.has(a.split("/")[0]));
    const isSelected = !inactive && selected.has(net.id);
    // Edges sit under boxes; a selected edge is lifted above them.
    const edgeProps = { selected: isSelected, zIndex: isSelected ? 5 : 0, selectable: !inactive, focusable: !inactive, className: inactive ? "inactive" : undefined };
    if (ends.length === 2) {
      const [a, b] = ends;
      const edge: Edge<NetEdgeData> = {
        id: net.id, type: "net", source: a.split("/")[0], sourceHandle: a.split("/")[1], target: b.split("/")[0], targetHandle: b.split("/")[1],
        data: { color, netId: net.id, siblingIndex: 0, siblingCount: 1, label, inactive, key: bendsKey(net.id), bends: project.connectivityCanvas.bends[bendsKey(net.id)], hub: false }, ...edgeProps,
      };
      edges.push(edge);
      const key = [a, b].sort().join("|");
      if (!pairCount.has(key)) pairCount.set(key, []);
      pairCount.get(key)!.push(edge);
    } else if (ends.length >= 3) {
      const hubId = `hub:${net.id}`;
      nodes.push({
        id: hubId, type: "hub", position: project.connectivityCanvas.hubs[net.id] ?? hubDefaultPosition(project, net), data: { net, color, label, inactive },
        selected: isSelected, zIndex: inactive ? 0 : 2, selectable: !inactive, draggable: !inactive, connectable: !inactive, className: inactive ? "inactive" : undefined,
      });
      for (const a of ends) {
        edges.push({
          id: `${net.id}:${a}`, type: "net", source: a.split("/")[0], sourceHandle: a.split("/")[1], target: hubId, targetHandle: "hub",
          data: { color, netId: net.id, siblingIndex: 0, siblingCount: 1, label, inactive, key: bendsKey(net.id, a), bends: project.connectivityCanvas.bends[bendsKey(net.id, a)], hub: true }, ...edgeProps,
        });
      }
    }
  }
  for (const list of pairCount.values()) {
    if (list.length < 2) continue;
    list.forEach((e, i) => {
      e.data!.siblingIndex = i;
      e.data!.siblingCount = list.length;
    });
  }
  for (const n of project.connectivityCanvas.notes) {
    nodes.push({ id: n.id, type: "note", position: { x: n.x, y: n.y }, data: { note: n }, selected: selected.has(n.id), zIndex: 3 });
    const netSize = n.net ? (nets.find((x) => x.net.id === n.net)?.net.connectors.length ?? 0) : 0;
    const target = n.component ?? (netSize >= 3 ? `hub:${n.net}` : undefined);
    if (target && nodes.some((x) => x.id === target)) {
      edges.push({ id: `note:${n.id}`, type: "notelink", source: n.id, target, selectable: false, zIndex: 0, data: { color: "#999", netId: "", siblingIndex: 0, siblingCount: 1, label: "", inactive: false, key: "", hub: false } });
    }
  }
  return { nodes, edges };
}

/**
 * Keep object identity across derivations. React Flow re-renders a node or
 * edge only when the object it was handed changes, so a derived item that
 * equals its predecessor is replaced by the predecessor. Equality is
 * structural to a fixed depth; deeper values compare by reference, which the
 * model's immutable updates make correct. Nodes also keep their measured
 * size, which React Flow stores on the object.
 */
export function reconcile<T extends { id: string; measured?: unknown }>(prev: T[], derived: T[]): T[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  let changed = prev.length !== derived.length;
  const out = derived.map((d, i) => {
    const p = byId.get(d.id);
    if (p && equalTo(p, d, 7)) {
      if (p !== prev[i]) changed = true;
      return p;
    }
    changed = true;
    return p && p.measured !== undefined ? { ...d, measured: p.measured } : d;
  });
  return changed ? out : prev;
}

function equalTo(a: unknown, b: unknown, depth: number): boolean {
  if (a === b) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => k !== "measured");
  const kb = Object.keys(b).filter((k) => k !== "measured");
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!equalTo((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1)) return false;
  return true;
}
