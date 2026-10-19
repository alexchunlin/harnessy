import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { deriveTopology, type TopologyOptions } from "../../src/ui/topology/model";
import { twoNetProject } from "../core/fixture";

/** A tie point on the topology canvas drags along its segment only while its distance is the typed one. */

const options: TopologyOptions = { ratsnest: false, layerDomains: undefined, highlightNets: new Set(), highlightComponents: new Set() };

function tieNode(placed: boolean) {
  const { project, ids } = twoNetProject();
  const made = ops.addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 100);
  const p = placed
    ? ops.placeParts(made.project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [500, 0, 0] }, ties: { [made.id]: [200, 0, 0] } })
    : made.project;
  const model = deriveTopology(p, p.topologies.get(ids.top)!, new Set(), new Map(), options);
  return model.nodes.find((n) => n.id === made.id)!;
}

describe("dragging a tie point on the topology canvas", () => {
  it("is allowed while the tie point keeps its typed distance", () => {
    expect(tieNode(false).draggable).toBe(true);
  });

  it("is not allowed once 3D placement measures it, so its typed distance stays", () => {
    expect(tieNode(true).draggable).toBe(false);
  });
});
