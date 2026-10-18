import { describe, expect, it } from "vitest";
import { connectorTypeInventory, drawerRows } from "../../src/core/drawer";
import { setConnectorTypes } from "../../src/core/definitions";
import { buildBom } from "../../src/core/bom";
import { createNet, placeBlankComponent, placeComponent, removeNet } from "../../src/core/ops";
import { componentConnectors, saveProject } from "../../src/core/project";
import { twoNetProject } from "./fixture";

/** The two-net fixture plus two switches sharing the `switch` definition and a one-off with two inline connectors. */
function drawerProject() {
  const { project, ids } = twoNetProject();
  const a = placeComponent(project, "components/switch", { x: 0, y: 200 });
  const b = placeComponent(a.project, "components/switch", { x: 200, y: 200 });
  const odd = placeBlankComponent(b.project, "Brake board", { x: 400, y: 200 }, [
    { designator: "PWR", connector: "connectors/xt60" },
    { designator: "SIG", connector: "connectors/jst-gh-2" },
  ]);
  const net = createNet(odd.project, "ethernet", [`${a.id}/P1`, `${b.id}/P1`], "switch trunk");
  return { project: net.project, ids: { ...ids, a: a.id, b: b.id, odd: odd.id } };
}

describe("connector drawer rows", () => {
  it("lists one row per designator of each definition in use, with its sharing count, and one per inline connector of a one-off", () => {
    const { project, ids } = drawerProject();
    const rows = drawerRows(project).map((r) => [r.ownerName, r.designator, r.type, r.mating, r.pins, r.users]);
    expect(rows).toEqual([
      ["Battery", "OUT", "connectors/xt60", "XT60H-F", 2, 1],
      ["Brake board", "PWR", "connectors/xt60", "XT60H-F", 2, 1],
      ["Brake board", "SIG", "connectors/jst-gh-2", "GHR-02V-S", 2, 1],
      ["Ethernet switch", "P1", "connectors/rj45", "RJ45-PLUG", 8, 2],
      ["Ethernet switch", "P2", "connectors/rj45", "RJ45-PLUG", 8, 2],
      ["MIB", "P1", "connectors/xt60", "XT60H-F", 2, 1],
      ["MIB", "J1", "connectors/jst-gh-2", "GHR-02V-S", 2, 1],
      ["MIB", "J2", "connectors/jst-gh-2", "GHR-02V-S", 2, 1],
      ["MIB", "ETH", "connectors/rj45", "RJ45-PLUG", 8, 1],
      ["Sensor", "J1", "connectors/jst-gh-2", "GHR-02V-S", 2, 1],
    ]);
    expect(drawerRows(project).find((r) => r.ownerName === "Brake board")?.owner).toEqual({ kind: "component", id: ids.odd });
    expect(drawerRows(project).find((r) => r.ownerName === "Ethernet switch")?.owner).toEqual({ kind: "definition", id: "switch" });
  });
});

describe("connector type inventory", () => {
  it("lists every library connector type with how many project connectors carry it, zeros included", () => {
    const { project } = drawerProject();
    const inv = connectorTypeInventory(project).map((t) => [t.type, t.count]);
    expect(inv).toEqual([
      ["connectors/jst-gh-2", 4],
      ["connectors/jst-gh-4", 0],
      ["connectors/rj45", 5],
      ["connectors/xt60", 3],
    ]);
  });
});

describe("setting connector types in bulk", () => {
  it("retypes a shared definition for every component sharing it and a one-off's inline connector, in one call", () => {
    const { project, ids } = drawerProject();
    const p = setConnectorTypes(project, [
      { owner: { kind: "definition", id: "switch" }, designator: "P1", type: "connectors/jst-gh-4" },
      { owner: { kind: "definition", id: "switch" }, designator: "P2", type: "connectors/jst-gh-4" },
      { owner: { kind: "component", id: ids.odd }, designator: "SIG", type: "connectors/jst-gh-4" },
    ]);
    for (const id of [ids.a, ids.b]) {
      const c = p.components.get(id)!;
      expect(c.definition).toBe("components/switch");
      expect(c.connectors).toBeUndefined();
      expect(componentConnectors(p, c)?.map((x) => x.connector)).toEqual(["connectors/jst-gh-4", "connectors/jst-gh-4"]);
    }
    expect(componentConnectors(p, p.components.get(ids.odd)!)?.map((x) => x.connector)).toEqual(["connectors/xt60", "connectors/jst-gh-4"]);
    expect(connectorTypeInventory(p).find((t) => t.type === "connectors/jst-gh-4")?.count).toBe(5);
  });

  it("writes a project copy of a shared definition and leaves the shared catalogue untouched on save", () => {
    const { project } = drawerProject();
    const p = setConnectorTypes(project, [{ owner: { kind: "definition", id: "switch" }, designator: "P1", type: "connectors/jst-gh-4" }]);
    expect(p.repoLibrary.components.get("switch")?.connectors[0].connector).toBe("connectors/rj45");
    expect(project.library.components.get("switch")?.connectors[0].connector).toBe("connectors/rj45");
    const files = saveProject(p);
    expect(JSON.parse(files.get("library/components/switch.json")!).connectors[0].connector).toBe("connectors/jst-gh-4");
    expect([...files.keys()].filter((f) => f.startsWith("library/"))).toEqual(["library/components/switch.json"]);
  });

  it("refuses a type the library does not have", () => {
    const { project } = drawerProject();
    expect(() => setConnectorTypes(project, [{ owner: { kind: "definition", id: "switch" }, designator: "P1", type: "connectors/nope" }])).toThrow(/no connector type/);
  });

  it("carries the new type's mating part and contacts onto the BOM", () => {
    const { project: withSensor, ids } = twoNetProject();
    const project = removeNet(withSensor, ids.sig);
    const p = setConnectorTypes(project, [
      { owner: { kind: "definition", id: "battery" }, designator: "OUT", type: "connectors/jst-gh-2" },
      { owner: { kind: "definition", id: "mib" }, designator: "P1", type: "connectors/jst-gh-2" },
    ]);
    const rows = buildBom(p, p.topologies.get(ids.top)!).cutList.filter((r) => r.from === "Battery OUT");
    expect(rows.find((r) => r.row === "housing")?.part_number).toBe("GHR-02V-S");
    expect(rows.find((r) => r.row === "contacts")?.part_number).toBe("SSHL-002T-P0.2");
  });
});
