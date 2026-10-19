import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { layoutTopology } from "../../src/core/layout";
import type { Position } from "../../src/core/schema";
import type { Project } from "../../src/core/project";
import { freshProject } from "./fixture";

/** A topology to grow by hand, with connectors from MIB components made as needed. */
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
    set project(next: Project) {
      p = next;
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
    /** A hub with a long arm and `n` connectors on it, so the piece is lopsided and a turn shows. */
    tree(n: number) {
      const hub = b.point();
      const ends = [hub];
      const segs: string[] = [];
      let tip = hub;
      for (let i = 0; i < 2; i++) {
        const next = b.point();
        segs.push(b.join(tip, next));
        ends.push(next);
        tip = next;
      }
      for (let i = 0; i < n; i++) {
        const c = b.connector();
        ends.push(c);
        segs.push(b.join(hub, c));
      }
      return { hub, ends, segs };
    },
    piece(): string {
      return b.layout().pieces[0].id;
    },
    layout() {
      return layoutTopology(p, p.topologies.get(top)!, p.topologyCanvases.get(top)!);
    },
  };
  return b;
}

const sub = (a: Position, z: Position) => ({ x: a.x - z.x, y: a.y - z.y });
/** A quarter turn clockwise on screen, where y points down. */
const quarter = (v: Position) => ({ x: -v.y, y: v.x });
const close = (a: Position, z: Position) => {
  expect(a.x).toBeCloseTo(z.x, 6);
  expect(a.y).toBeCloseTo(z.y, 6);
};
const centre = (pts: Position[]) => {
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

describe("turning a harness", () => {
  it("one turn rotates every home a quarter clockwise about the piece's centre", () => {
    const b = bench();
    const { ends } = b.tree(3);
    const before = b.layout();
    b.project = ops.turnPiece(b.project, b.top, b.piece());
    const after = b.layout();
    const homesBefore = ends.map((id) => before.endpoints.get(id)!.home);
    const homesAfter = ends.map((id) => after.endpoints.get(id)!.home);
    const c0 = centre(homesBefore);
    const c1 = centre(homesAfter);
    ends.forEach((_, i) => close(sub(homesAfter[i], c1), quarter(sub(homesBefore[i], c0))));
  });

  it("a fan's arc turns with its harness", () => {
    const b = bench();
    const { hub, ends } = b.tree(3);
    const before = b.layout();
    b.project = ops.turnPiece(b.project, b.top, b.piece());
    const after = b.layout();
    const arcBefore = before.arcs.find((a) => a.node === hub)!;
    const arcAfter = after.arcs.find((a) => a.node === hub)!;
    const c0 = centre(ends.map((id) => before.endpoints.get(id)!.home));
    const c1 = centre(ends.map((id) => after.endpoints.get(id)!.home));
    close(sub(arcAfter.centre, c1), quarter(sub(arcBefore.centre, c0)));
    expect(arcAfter.radius).toBe(arcBefore.radius);
    expect(arcAfter.from - arcBefore.from).toBeCloseTo(90, 6);
    expect(arcAfter.to - arcBefore.to).toBeCloseTo(90, 6);
  });

  it("an endpoint's offset turns with its harness", () => {
    const b = bench();
    const { ends } = b.tree(3);
    const moved = ends[3];
    b.project = ops.setEndpointOffset(b.project, b.top, moved, { x: 40, y: 10 });
    b.project = ops.turnPiece(b.project, b.top, b.piece());
    const e = b.layout().endpoints.get(moved)!;
    close(sub(e.drawn, e.home), { x: -10, y: 40 });
    expect(b.project.topologyCanvases.get(b.top)!.offsets[moved]).toEqual({ x: 40, y: 10 });
  });

  it("four turns give back the original picture and leave no turn in the file", () => {
    const b = bench();
    const { ends } = b.tree(3);
    b.project = ops.setEndpointOffset(b.project, b.top, ends[4], { x: 40, y: 10 });
    const before = b.layout();
    const piece = b.piece();
    const turns: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      b.project = ops.turnPiece(b.project, b.top, piece);
      turns.push(b.project.topologyCanvases.get(b.top)!.pieces[piece]?.turns);
    }
    expect(turns).toEqual([1, 2, 3, undefined]);
    const after = b.layout();
    for (const id of ends) {
      close(after.endpoints.get(id)!.home, before.endpoints.get(id)!.home);
      close(after.endpoints.get(id)!.drawn, before.endpoints.get(id)!.drawn);
    }
  });

  it("a turn keeps the piece's box offset, and two turns lay a long arm the other way", () => {
    const b = bench();
    const { ends } = b.tree(3);
    const piece = b.piece();
    b.project = ops.setBoxOffset(b.project, b.top, piece, { x: 30, y: 0 });
    b.project = ops.turnPiece(b.project, b.top, piece);
    b.project = ops.turnPiece(b.project, b.top, piece);
    expect(b.project.topologyCanvases.get(b.top)!.pieces[piece]).toEqual({ offset: { x: 30, y: 0 }, turns: 2 });
    const before = bench();
    before.tree(3);
    const a = before.layout();
    const z = b.layout();
    const arm = (l: typeof a) => sub(l.endpoints.get(ends[2])!.home, l.endpoints.get(ends[0])!.home);
    close(arm(z), { x: -arm(a).x, y: -arm(a).y });
  });

  it("turning a selection turns the piece holding each endpoint, segment, sheath, tie point or box once", () => {
    const b = bench();
    const one = b.tree(3);
    const two = b.tree(0);
    const three = b.tree(0);
    const ids = b.layout().pieces.map((p) => p.id);
    const pieceOf = (segs: string[]) => ids.find((id) => segs.includes(id))!;
    const turnsOf = () => Object.fromEntries(Object.entries(b.project.topologyCanvases.get(b.top)!.pieces).map(([k, v]) => [k, v.turns]));

    // An endpoint and a segment of the same piece turn it once, and the other piece's box turns it too.
    b.project = ops.turnPiecesHolding(b.project, b.top, [one.ends[4], one.segs[1], `harness:${pieceOf(two.segs)}`]);
    expect(turnsOf()).toEqual({ [pieceOf(one.segs)]: 1, [pieceOf(two.segs)]: 1 });

    const sheath = ops.applySheath(b.project, b.top, [three.segs[1]], "sheaths/braid-10");
    b.project = sheath.project;
    b.project = ops.turnPiecesHolding(b.project, b.top, [sheath.id]);
    expect(turnsOf()[pieceOf(three.segs)]).toBe(1);

    const tie = ops.addTiePoint(b.project, b.top, two.segs[0], "ties/zip-tie", 40);
    b.project = tie.project;
    b.project = ops.turnPiecesHolding(b.project, b.top, [tie.id]);
    expect(turnsOf()[pieceOf(two.segs)]).toBe(2);

    // Anything else in the selection, like a net, turns nothing.
    const before = b.project;
    expect(ops.turnPiecesHolding(before, b.top, ["net-nope"])).toBe(before);
  });

  it("joining two pieces keeps the larger piece's turn", () => {
    const b = bench();
    const big = b.tree(3);
    const small = b.tree(0);
    const pieces = b.layout().pieces.map((p) => p.id);
    const bigId = pieces.find((id) => big.segs.includes(id))!;
    const smallId = pieces.find((id) => small.segs.includes(id))!;
    b.project = ops.turnPiece(b.project, b.top, bigId);
    b.project = ops.turnPiece(b.project, b.top, smallId);
    b.project = ops.turnPiece(b.project, b.top, smallId);
    b.join(small.ends[2], big.hub);
    const joined = b.layout().pieces;
    expect(joined).toHaveLength(1);
    expect(b.project.topologyCanvases.get(b.top)!.pieces).toEqual({ [joined[0].id]: { turns: 1 } });
  });
});
