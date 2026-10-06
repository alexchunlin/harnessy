import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { allRoutes, buildGraph, conductorAddress, conductorRoute, parseConductor } from "../../src/core/derive";
import { conductorColor } from "../../src/core/library";
import { findNet, loadProject, netConductors, netSpec, saveProject } from "../../src/core/project";
import { runChecks } from "../../src/core/drc";
import { serialize } from "../../src/core/serialize";
import { CableSpecSchema, DomainSchema, NetsFileSchema } from "../../src/core/schema";
import { testLibrary, twoNetProject } from "./fixture";

/** Colour through the bundle, #20: a spec per conductor on nets and domains, resolved net then domain. */

describe("a net's conductors", () => {
  it("come from the domain's list when the net overrides nothing", () => {
    const { project, ids } = twoNetProject();
    const { net } = findNet(project, ids.power)!;
    expect(netConductors(project, net, "48v")).toEqual(["wires/awg12-red", "wires/awg12-black"]);
    expect(netSpec(project, net, "48v")).toEqual({ ref: "wires/awg12-red", conductors: 2 });
  });

  it("repeat a single spec by the count, on the net or on the domain", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setNetSpec(p, ids.power, "wires/awg14-black", 3);
    expect(netConductors(p, findNet(p, ids.power)!.net, "48v")).toEqual(["wires/awg14-black", "wires/awg14-black", "wires/awg14-black"]);
    // The 24 V domain in the test library names one spec with a count of two.
    p = ops.updateDomain(p, "24v", { spec: "wires/awg18-red", conductors: 2, conductor_specs: undefined });
    expect(netConductors(p, findNet(p, ids.sig)!.net, "24v")).toEqual(["wires/awg18-red", "wires/awg18-red"]);
  });

  it("take the net's own list over everything else", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setNetConductors(p, ids.power, ["wires/awg14-black"]);
    const net = findNet(p, ids.power)!.net;
    expect(net.spec).toBeUndefined();
    expect(net.conductors).toBeUndefined();
    expect(netConductors(p, net, "48v")).toEqual(["wires/awg14-black"]);
    // Setting a single spec again clears the list.
    p = ops.setNetSpec(p, ids.power, "wires/awg12-red", 2);
    expect(findNet(p, ids.power)!.net.conductor_specs).toBeUndefined();
    // An empty list is the domain default.
    p = ops.setNetConductors(p, ids.power, []);
    expect(findNet(p, ids.power)!.net.conductor_specs).toBeUndefined();
    expect(netConductors(p, findNet(p, ids.power)!.net, "48v")).toEqual(["wires/awg12-red", "wires/awg12-black"]);
  });

  it("a net that overrides only the count takes the domain's list up to that count", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setNetSpec(p, ids.power, undefined, 1);
    expect(netConductors(p, findNet(p, ids.power)!.net, "48v")).toEqual(["wires/awg12-red"]);
    p = ops.setNetSpec(p, ids.power, undefined, 3);
    expect(netConductors(p, findNet(p, ids.power)!.net, "48v")).toEqual(["wires/awg12-red", "wires/awg12-black", undefined]);
  });

  it("a net with nothing anywhere carries one conductor with no spec, which is a warning", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setDomainConductors(p, "48v", undefined);
    expect(netConductors(p, findNet(p, ids.power)!.net, "48v")).toEqual([undefined]);
    const f = runChecks(p, undefined).filter((x) => x.check === "net-no-spec");
    expect(f.map((x) => x.target)).toEqual([ids.power]);
  });

  it("every conductor's spec must exist in the library", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setNetConductors(p, ids.power, ["wires/awg12-red", "wires/awg12-purple"]);
    p = ops.setDomainConductors(p, "24v", ["wires/awg18-red", "wires/awg18-orange"]);
    const f = runChecks(p, undefined).filter((x) => x.check === "dangling-reference");
    expect(f.map((x) => x.message)).toEqual([
      "domain 24 V references wires/awg18-orange, which has no library file",
      "net battery power references wires/awg12-purple, which has no library file",
      "net sensor power references wires/awg18-orange, which has no library file",
    ]);
  });
});

describe("conductor colour", () => {
  const lib = testLibrary();
  it("is the wire's colour, the cable's listed colour for that conductor, else the fallback", () => {
    expect(conductorColor(lib, "wires/awg12-red", 0, "#888")).toBe("red");
    expect(conductorColor(lib, "cables/shielded-6c-24awg", 3, "#888")).toBe("green");
    expect(conductorColor(lib, "cables/cat6-utp-24awg", 3, "#888")).toBe("#888");
    expect(conductorColor(lib, undefined, 0, "#888")).toBe("#888");
    expect(conductorColor(lib, "wires/nope", 0, "#888")).toBe("#888");
  });

  it("a cable lists one colour per conductor or none", () => {
    const bad = CableSpecSchema.safeParse({ id: "c", name: "C", conductors: 2, awg: 24, od_mm: 4, shielded: false, conductor_colors: ["red"] });
    expect(bad.success).toBe(false);
    const good = CableSpecSchema.safeParse({ id: "c", name: "C", conductors: 2, awg: 24, od_mm: 4, shielded: false, conductor_colors: ["red", "black"] });
    expect(good.success).toBe(true);
  });
});

describe("conductor identity", () => {
  it("is the net id and an index, derived and never stored", () => {
    expect(conductorAddress("net-aaaaaa", 1)).toBe("net-aaaaaa#1");
    expect(parseConductor("net-aaaaaa#1")).toEqual({ net: "net-aaaaaa", index: 1 });
    expect(parseConductor("net-aaaaaa")).toBeUndefined();
    expect(parseConductor("seg-aaaaaa#1")).toBeUndefined();
    const { project, ids } = twoNetProject();
    for (const text of saveProject(project).values()) expect(text).not.toContain(`${ids.power}#`);
  });

  it("routes over its net's segments and reaches the net's connector ends in connector order", () => {
    let { project: p, ids } = twoNetProject();
    // Route the sensor net too, through a point, so the route has two segments.
    const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    p = s.project;
    const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 300, y: 100 });
    p = m.project;
    const g = ops.growSegment(p, ids.top, m.id, { x: 150, y: 100 });
    p = g.project;
    const last = ops.addSegment(p, ids.top, g.endpoint, s.id, 100);
    p = last.project;
    const graph = buildGraph(p.topologies.get(ids.top)!);
    const routes = allRoutes(p, graph);
    const c = conductorRoute(routes, conductorAddress(ids.sig, 1))!;
    expect(c.index).toBe(1);
    expect([...c.segments].sort()).toEqual([g.segment, last.id].sort());
    expect(c.segments).toBe(routes.find((r) => r.net.id === ids.sig)!.segments);
    // The sensor net lists MIB J1 first, then the sensor.
    expect(c.ends).toEqual([m.id, s.id]);
    expect(conductorRoute(routes, "net-zzzzzz#0")).toBeUndefined();
    expect(conductorRoute(routes, ids.sig)).toBeUndefined();
  });

  it("an unplaced connector is left out of the ends", () => {
    const { project, ids } = twoNetProject();
    const routes = allRoutes(project, buildGraph(project.topologies.get(ids.top)!));
    const c = conductorRoute(routes, conductorAddress(ids.sig, 0))!;
    expect(c.segments.size).toBe(0);
    expect(c.ends).toEqual([]);
  });
});

describe("files", () => {
  it("conductor lists and cable colours survive the serializer and the schema generator", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setNetConductors(p, ids.power, ["wires/awg12-red", "wires/awg12-black"]);
    const files = saveProject(p);
    const { project: back, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    expect(findNet(back, ids.power)!.net.conductor_specs).toEqual(["wires/awg12-red", "wires/awg12-black"]);
    expect(back.file.domains.find((d) => d.id === "48v")!.conductor_specs).toEqual(["wires/awg12-red", "wires/awg12-black"]);
    expect(serialize(NetsFileSchema, [{ id: "net-aaaaaa", connectors: [], conductor_specs: ["wires/a"] }])).toContain('"conductor_specs": [');
    expect(serialize(DomainSchema, { id: "x", name: "X", color: "#000", conductor_specs: ["wires/a"] })).not.toContain('"conductors"');
    expect(serialize(CableSpecSchema, { id: "c", name: "C", conductors: 1, awg: 24, od_mm: 4, shielded: false, conductor_colors: ["red"] })).toContain('"conductor_colors": [');
    for (const [file, path] of [
      ["schemas/nets.schema.json", ["items", "properties", "conductor_specs"]],
      ["schemas/project.schema.json", ["properties", "domains", "items", "properties", "conductor_specs"]],
      ["schemas/library-cables.schema.json", ["properties", "conductor_colors"]],
    ] as const) {
      let node: unknown = JSON.parse(readFileSync(file, "utf8"));
      for (const key of path) node = (node as Record<string, unknown>)[key];
      expect(node, file).toBeDefined();
    }
  });
});
