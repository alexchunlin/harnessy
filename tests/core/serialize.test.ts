import { describe, expect, it } from "vitest";
import { serialize } from "../../src/core/serialize";
import { ComponentSchema, NetsFileSchema, TopologyCanvasSchema, TopologySchema } from "../../src/core/schema";
import { loadProject, saveProject } from "../../src/core/project";
import { testLibrary, twoNetProject } from "./fixture";

describe("serializer", () => {
  it("puts id then name first and keeps schema order after", () => {
    const text = serialize(ComponentSchema, { definition: "components/mib", name: "MIB", id: "cmp-aaaaaa" });
    expect(text).toBe('{\n  "id": "cmp-aaaaaa",\n  "name": "MIB",\n  "definition": "components/mib"\n}\n');
  });

  it("sorts arrays of records by id", () => {
    const text = serialize(NetsFileSchema, [
      { id: "net-bbbbbb", connectors: [] },
      { id: "net-aaaaaa", connectors: [] },
    ]);
    expect(JSON.parse(text).map((n: { id: string }) => n.id)).toEqual(["net-aaaaaa", "net-bbbbbb"]);
  });

  it("rounds integer fields so sub-pixel drift never dirties a file", () => {
    const text = serialize(TopologyCanvasSchema, { endpoints: { "end-aaaaaa": { x: 10.4, y: 19.6 } } });
    expect(JSON.parse(text)).toEqual({ endpoints: { "end-aaaaaa": { x: 10, y: 20 } } });
    const top = serialize(TopologySchema, { id: "top-aaaaaa", name: "t", endpoints: [], segments: [{ id: "seg-aaaaaa", ends: ["end-aaaaaa", "end-aaaaab"], length_mm: 12.7 }], sheaths: [], ties: [] });
    expect(JSON.parse(top).segments[0].length_mm).toBe(13);
  });

  it("sorts record keys", () => {
    const text = serialize(TopologyCanvasSchema, { endpoints: { "end-b": { x: 0, y: 0 }, "end-a": { x: 0, y: 0 } } });
    expect(Object.keys(JSON.parse(text).endpoints)).toEqual(["end-a", "end-b"]);
  });
});

describe("project round trip", () => {
  it("save, load, save yields identical files", () => {
    const { project } = twoNetProject();
    const first = saveProject(project);
    const { project: reloaded, problems } = loadProject(first, testLibrary());
    expect(problems).toEqual([]);
    const second = saveProject(reloaded);
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    for (const [path, text] of first) expect(second.get(path), path).toBe(text);
  });

  it("writes one file per component, per domain, per topology, and positions only under canvas/", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(project);
    expect(files.has(`components/${ids.bat}.json`)).toBe(true);
    expect(files.has("nets/48v.json")).toBe(true);
    expect(files.has(`topologies/${ids.top}.json`)).toBe(true);
    expect(files.has(`canvas/${ids.top}.json`)).toBe(true);
    for (const [path, text] of files) {
      if (path.startsWith("canvas/")) continue;
      expect(text, path).not.toMatch(/"x":/);
    }
  });

  it("a net does not repeat its domain; the file says it", () => {
    const { project } = twoNetProject();
    const nets = JSON.parse(saveProject(project).get("nets/48v.json")!);
    expect(nets).toHaveLength(1);
    expect(nets[0]).not.toHaveProperty("domain");
  });
});
