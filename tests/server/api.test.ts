import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApiError, createApi, type Api } from "../../src/server/api";

let home: string;
let api: Api;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "harnessy-"));
  await fs.mkdir(path.join(home, "robot", "components"), { recursive: true });
  await fs.writeFile(path.join(home, "robot", "project.json"), '{"schema":1}');
  await fs.writeFile(path.join(home, "robot", "components", "cmp-aaaaaa.json"), "{}");
  await fs.mkdir(path.join(home, "notes"));
  await fs.mkdir(path.join(home, "repo", "library", "wires"), { recursive: true });
  await fs.writeFile(path.join(home, "repo", "library", "wires", "awg12-red.json"), '{"id":"awg12-red"}');
  await fs.writeFile(path.join(home, "secret.json"), "shh");
  api = createApi({ home, repoLibrary: path.join(home, "repo", "library") });
});

afterEach(() => fs.rm(home, { recursive: true, force: true }));

describe("listing", () => {
  it("lists folders under home and marks projects", async () => {
    const l = await api.list();
    expect(l.parent).toBeUndefined();
    expect(l.folders.map((f) => [f.name, f.isProject])).toEqual([
      ["notes", false],
      ["repo", false],
      ["robot", true],
    ]);
    const sub = await api.list(path.join(home, "robot"));
    expect(sub.isProject).toBe(true);
    expect(sub.parent).toBe(home);
  });

  it("refuses to list outside home", async () => {
    await expect(api.list(path.dirname(home))).rejects.toBeInstanceOf(ApiError);
    await expect(api.list(path.join(home, "..", path.basename(home), ".."))).rejects.toThrow(/stays under/);
  });
});

describe("open, read, write", () => {
  it("open returns every JSON file under the folder with forward-slash paths", async () => {
    const r = await api.open(path.join(home, "robot"));
    expect(r.isProject).toBe(true);
    expect(Object.keys(r.files).sort()).toEqual(["components/cmp-aaaaaa.json", "project.json"]);
  });

  it("opening a folder without project.json works and reports it, so the app can offer to create one", async () => {
    const r = await api.open(path.join(home, "notes"));
    expect(r.isProject).toBe(false);
    expect(r.files).toEqual({});
  });

  it("reads and writes only inside opened folders", async () => {
    const robot = path.join(home, "robot");
    await expect(api.read(robot, "project.json")).rejects.toThrow(/not opened/);
    await expect(api.write(robot, { "x.json": "{}" })).rejects.toThrow(/not opened/);
    await api.open(robot);
    expect(await api.read(robot, "project.json")).toBe('{"schema":1}');
    await api.write(robot, { "nets/48v.json": "[]\n", "project.json": '{"schema":1,"name":"r"}' }, ["components/cmp-aaaaaa.json"]);
    expect(await fs.readFile(path.join(robot, "nets", "48v.json"), "utf8")).toBe("[]\n");
    expect(await api.read(robot, "project.json")).toBe('{"schema":1,"name":"r"}');
    await expect(fs.access(path.join(robot, "components", "cmp-aaaaaa.json"))).rejects.toThrow();
  });

  it("refuses paths that escape the opened folder", async () => {
    const robot = path.join(home, "robot");
    await api.open(robot);
    await expect(api.read(robot, "../secret.json")).rejects.toThrow(/escapes/);
    await expect(api.write(robot, { "../secret.json": "x" })).rejects.toThrow(/escapes/);
    await expect(api.read(robot, path.join(home, "secret.json"))).rejects.toThrow(/escapes/);
    expect(await fs.readFile(path.join(home, "secret.json"), "utf8")).toBe("shh");
  });

  it("opening one folder does not open its sibling", async () => {
    await api.open(path.join(home, "robot"));
    await expect(api.read(path.join(home, "notes"), "anything.json")).rejects.toThrow(/not opened/);
  });
});

describe("repo library", () => {
  it("is readable without opening and prefixed with library/", async () => {
    const files = await api.library();
    expect(files).toEqual({ "library/wires/awg12-red.json": '{"id":"awg12-red"}' });
  });

  it("is not writable", async () => {
    await expect(api.write(path.join(home, "repo", "library"), { "wires/x.json": "{}" })).rejects.toThrow(/not opened/);
  });
});
