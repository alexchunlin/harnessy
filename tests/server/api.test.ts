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

describe("upload and bytes", () => {
  const robot = () => path.join(home, "robot");
  const bytes = (s: string) => new Uint8Array(Buffer.from(s));

  it("upload writes into reference/ under a safe name and returns the relative path", async () => {
    await api.open(robot());
    const rel = await api.upload(robot(), "RAMMP frame v2.STEP", bytes("ISO-10303-21;"));
    expect(rel).toBe("reference/rammp-frame-v2.step");
    expect(await fs.readFile(path.join(robot(), rel), "utf8")).toBe("ISO-10303-21;");
  });

  it("upload picks a new name when the name is taken", async () => {
    await api.open(robot());
    expect(await api.upload(robot(), "IMG_0001.jpg", bytes("a"))).toBe("reference/img-0001.jpg");
    expect(await api.upload(robot(), "IMG_0001.jpg", bytes("b"))).toBe("reference/img-0001-2.jpg");
    expect(await api.upload(robot(), "img 0001.JPG", bytes("c"))).toBe("reference/img-0001-3.jpg");
    expect(await fs.readFile(path.join(robot(), "reference/img-0001.jpg"), "utf8")).toBe("a");
  });

  it("upload refuses HEIC with the export message and other types with the accepted list", async () => {
    await api.open(robot());
    await expect(api.upload(robot(), "photo.HEIC", bytes("x"))).rejects.toThrow(/export it as JPEG/);
    await expect(api.upload(robot(), "photo.heif", bytes("x"))).rejects.toThrow(/export it as JPEG/);
    await expect(api.upload(robot(), "notes.pdf", bytes("x"))).rejects.toThrow(/\.jpg.*\.png.*\.step.*\.obj/);
    await expect(fs.readdir(path.join(robot(), "reference"))).rejects.toThrow();
  });

  it("upload stays inside reference/ of an opened folder", async () => {
    await expect(api.upload(robot(), "frame.step", bytes("x"))).rejects.toThrow(/not opened/);
    await api.open(robot());
    const rel = await api.upload(robot(), "../../escape.step", bytes("x"));
    expect(rel).toBe("reference/escape.step");
    await expect(fs.access(path.join(home, "escape.step"))).rejects.toThrow();
  });

  it("bytes returns what upload wrote with a content type from its extension", async () => {
    await api.open(robot());
    const rel = await api.upload(robot(), "frame.glb", bytes("glTF"));
    const got = await api.bytes(robot(), rel);
    expect(Buffer.from(got.bytes).toString()).toBe("glTF");
    expect(got.type).toBe("model/gltf-binary");
    expect((await api.bytes(robot(), await api.upload(robot(), "a.png", bytes("p")))).type).toBe("image/png");
    expect((await api.bytes(robot(), await api.upload(robot(), "a.step", bytes("s")))).type).toBe("application/octet-stream");
  });

  it("bytes is fenced like read and answers 404 for a missing file", async () => {
    await expect(api.bytes(robot(), "project.json")).rejects.toThrow(/not opened/);
    await api.open(robot());
    await expect(api.bytes(robot(), "../secret.json")).rejects.toThrow(/escapes/);
    await expect(api.bytes(robot(), "reference/gone.step")).rejects.toMatchObject({ status: 404 });
  });
});
