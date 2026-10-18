import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { CALLOUT_DISTANCE, layoutTopology, STEP_DEGREES, UNIFORM_LENGTH } from "../../src/core/layout";
import type { Position, TopologyCanvas } from "../../src/core/schema";
import type { Project } from "../../src/core/project";
import { freshProject, loadExample } from "./fixture";

const EMPTY: TopologyCanvas = { offsets: {}, pieces: {}, roots: [] };

/** A topology to grow by hand. Connectors come from MIB components, four apiece, made as needed. */
function bench() {
  let p: Project = freshProject();
  const t = ops.createTopology(p, "Bench");
  p = t.project;
  const top = t.id;
  const free: string[] = [];
  const b = {
    get project() {
      return p;
    },
    top,
    connector(): string {
      if (free.length === 0) {
        const c = ops.placeComponent(p, "components/mib", { x: 0, y: 0 });
        p = c.project;
        free.push(...["P1", "J1", "J2", "ETH"].map((d) => `${c.id}/${d}`));
      }
      const r = ops.placeConnector(p, top, free.shift()!);
      p = r.project;
      return r.id;
    },
    point(): string {
      const r = ops.addEndpoint(p, top, "point");
      p = r.project;
      return r.id;
    },
    join(a: string, z: string): string {
      const r = ops.addSegment(p, top, a, z, 100);
      p = r.project;
      return r.id;
    },
    purchased(a: string, z: string): string {
      const id = b.join(a, z);
      p = ops.setSegmentAssembly(p, top, id, "assemblies/rj45-patch-500");
      return id;
    },
    layout(canvas: TopologyCanvas = EMPTY) {
      return layoutTopology(p, p.topologies.get(top)!, canvas);
    },
  };
  return b;
}

const dist = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (from: Position, to: Position) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
/** The signed difference a - b in degrees, folded into (-180, 180]. */
const turn = (a: number, b: number) => {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

describe("topology layout", () => {
  it("a breakout spreads three children 15 degrees apart around the away direction, each at the uniform length", () => {
    const b = bench();
    const start = b.connector();
    const hub = b.point();
    b.join(start, hub);
    const kids = [b.connector(), b.connector(), b.connector()];
    for (const k of kids) b.join(hub, k);
    const out = b.layout({ ...EMPTY, roots: [start] });
    const at = (id: string) => out.endpoints.get(id)!.drawn;

    expect(dist(at(start), at(hub))).toBeCloseTo(UNIFORM_LENGTH);
    const away = angle(at(start), at(hub));
    const spread = kids.map((k) => turn(angle(at(hub), at(k)), away)).sort((x, y) => x - y);
    expect(STEP_DEGREES).toBe(15);
    expect(spread[0]).toBeCloseTo(-15);
    expect(spread[1]).toBeCloseTo(0);
    expect(spread[2]).toBeCloseTo(15);
    for (const k of kids) expect(dist(at(hub), at(k))).toBeCloseTo(UNIFORM_LENGTH);
  });

  it("a marked root spreads its children evenly over the full circle", () => {
    const b = bench();
    const hub = b.point();
    const kids = [b.connector(), b.connector(), b.connector(), b.connector()];
    for (const k of kids) b.join(hub, k);
    const out = b.layout({ ...EMPTY, roots: [hub] });
    const at = (id: string) => out.endpoints.get(id)!.drawn;
    const angles = kids.map((k) => angle(at(hub), at(k))).sort((x, y) => x - y);
    for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(90);
    for (const k of kids) expect(dist(at(hub), at(k))).toBeCloseTo(UNIFORM_LENGTH);
  });

  it("with no root marked, the root is the middle of the longest path", () => {
    // c1 - h1 - h2 - h3 - c4, with a leaf on each breakout. The longest path runs c1 to c4 through five nodes; h2 is its middle.
    const b = bench();
    const [h1, h2, h3] = [b.point(), b.point(), b.point()];
    const c1 = b.connector();
    const c4 = b.connector();
    b.join(c1, h1);
    b.join(h1, h2);
    b.join(h2, h3);
    b.join(h3, c4);
    for (const h of [h1, h2, h3]) b.join(h, b.connector());
    const out = b.layout();
    const at = (id: string) => out.endpoints.get(id)!.drawn;
    // Only the root spreads over the full circle: its three children sit 120 degrees apart.
    const spread = [h1, h3, ...[...out.endpoints.keys()].filter((id) => ![c1, c4, h1, h2, h3].includes(id) && dist(at(id), at(h2)) < UNIFORM_LENGTH + 1)];
    expect(spread).toHaveLength(3);
    const angles = spread.map((id) => angle(at(h2), at(id))).sort((x, y) => x - y);
    expect(angles[1] - angles[0]).toBeCloseTo(120);
    expect(angles[2] - angles[1]).toBeCloseTo(120);
  });

  it("a chain of points sits evenly on one straight line and takes no step, and each point is still there", () => {
    const b = bench();
    const start = b.connector();
    const chain = [b.point(), b.point(), b.point()];
    const hub = b.point();
    b.join(start, chain[0]);
    b.join(chain[0], chain[1]);
    b.join(chain[1], chain[2]);
    b.join(chain[2], hub);
    const leaves = [b.connector(), b.connector()];
    for (const l of leaves) b.join(hub, l);
    const out = b.layout({ ...EMPTY, roots: [start] });
    const at = (id: string) => out.endpoints.get(id)!.drawn;

    // The whole chain is one logical edge at the uniform length.
    expect(dist(at(start), at(hub))).toBeCloseTo(UNIFORM_LENGTH);
    chain.forEach((id, i) => {
      const f = (i + 1) / 4;
      expect(at(id).x).toBeCloseTo(at(start).x + (at(hub).x - at(start).x) * f);
      expect(at(id).y).toBeCloseTo(at(start).y + (at(hub).y - at(start).y) * f);
    });
    // The hub fans its leaves around the line the chain came in on.
    const away = angle(at(start), at(hub));
    const spread = leaves.map((l) => turn(angle(at(hub), at(l)), away)).sort((x, y) => x - y);
    expect(spread[0]).toBeCloseTo(-STEP_DEGREES / 2);
    expect(spread[1]).toBeCloseTo(STEP_DEGREES / 2);
  });

  it("packs piece rectangles without overlap, purchased cables after harnesses, each endpoint inside its own", () => {
    const b = bench();
    const members = new Map<string, string[]>();
    const purchasedIds: string[] = [];
    // Purchased cables made first, so their segment ids sort before every harness's.
    for (let i = 0; i < 2; i++) {
      const [x, y] = [b.connector(), b.connector()];
      purchasedIds.push(b.purchased(x, y));
      members.set(purchasedIds[i], [x, y]);
    }
    for (let size = 1; size <= 5; size++) {
      const hub = b.point();
      const ends = [hub];
      let first = "";
      for (let i = 0; i < size + 2; i++) {
        const c = b.connector();
        ends.push(c);
        const s = b.join(hub, c);
        first ||= s;
      }
      members.set(first, ends);
    }
    const out = b.layout();
    expect(out.pieces).toHaveLength(7);
    expect(out.pieces.slice(0, 5).every((p) => p.built)).toBe(true);
    expect(out.pieces.slice(5).map((p) => p.id)).toEqual(purchasedIds);

    const rects = out.pieces.map((p) => p.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [r, s] = [rects[i], rects[j]];
        const overlap = r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
        expect(overlap, `${out.pieces[i].id} and ${out.pieces[j].id}`).toBe(false);
        // Shelf order: a later piece is further along its row, or on a later row.
        expect(s.y > r.y || (s.y === r.y && s.x > r.x)).toBe(true);
      }
    }
    for (const p of out.pieces) {
      for (const id of members.get(p.id)!) {
        const at = out.endpoints.get(id)!.drawn;
        expect(at.x).toBeGreaterThanOrEqual(p.rect.x);
        expect(at.x).toBeLessThanOrEqual(p.rect.x + p.rect.w);
        expect(at.y).toBeGreaterThanOrEqual(p.rect.y);
        expect(at.y).toBeLessThanOrEqual(p.rect.y + p.rect.h);
      }
    }
  });

  it("lays out the RAMMP example with every endpoint at a finite position and no two pieces overlapping", () => {
    const project = loadExample();
    const [topology] = [...project.topologies.values()];
    const out = layoutTopology(project, topology, project.topologyCanvases.get(topology.id)!);
    expect(out.endpoints.size).toBe(topology.endpoints.length);
    for (const [id, e] of out.endpoints) {
      expect(Number.isFinite(e.drawn.x) && Number.isFinite(e.drawn.y), id).toBe(true);
    }
    expect(out.pieces.length).toBeGreaterThan(1);
    const rects = out.pieces.map((p) => p.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [r, s] = [rects[i], rects[j]];
        expect(r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h, `${out.pieces[i].id} and ${out.pieces[j].id}`).toBe(false);
      }
    }
  });
});

describe("endpoint offsets", () => {
  /** A connector, a breakout with two connector children, and the hub's id. */
  function fan() {
    const b = bench();
    const start = b.connector();
    const hub = b.point();
    b.join(start, hub);
    const kids = [b.connector(), b.connector(), b.connector()];
    for (const k of kids) b.join(hub, k);
    return { b, start, hub, kids };
  }

  it("an offset moves its endpoint only, and its children stay where the home put them", () => {
    const { b, start, hub, kids } = fan();
    const plain = b.layout({ ...EMPTY, roots: [start] });
    const moved = b.layout({ ...EMPTY, roots: [start], offsets: { [hub]: { x: 10, y: -6 } } });

    const before = plain.endpoints.get(hub)!;
    const after = moved.endpoints.get(hub)!;
    expect(after.home).toEqual(before.home);
    expect(after.drawn).toEqual({ x: before.home.x + 10, y: before.home.y - 6 });
    for (const id of [start, ...kids]) expect(moved.endpoints.get(id)).toEqual(plain.endpoints.get(id));
  });

  it("past the call-out distance its segments end at home and a call-out line runs from home to the box; within it, segments end at the box and there is no line", () => {
    const { b, start, hub } = fan();
    const seg = b.project.topologies.get(b.top)!.segments.find((s) => s.ends.includes(start))!;
    const hubEnd = seg.ends.indexOf(hub);
    expect(CALLOUT_DISTANCE).toBe(24);

    const near = b.layout({ ...EMPTY, roots: [start], offsets: { [hub]: { x: 12, y: 16 } } });
    expect(near.segments.get(seg.id)![hubEnd]).toEqual(near.endpoints.get(hub)!.drawn);
    expect(near.callouts).toEqual([]);

    const far = b.layout({ ...EMPTY, roots: [start], offsets: { [hub]: { x: 60, y: 80 } } });
    const { home, drawn } = far.endpoints.get(hub)!;
    expect(far.segments.get(seg.id)![hubEnd]).toEqual(home);
    expect(far.callouts).toEqual([{ endpoint: hub, from: home, to: drawn }]);
  });
});
