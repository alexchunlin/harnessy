import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectorShortName, loadLibrary } from "../../src/core/library";
import { ConnectorTypeSchema } from "../../src/core/schema";
import { serialize } from "../../src/core/serialize";
import { testLibrary } from "./fixture";

/** A connector type's short name is what the canvas draws ahead of a designator. */
describe("connector type short name", () => {
  it("survives the serializer and loads back", () => {
    const entry = { id: "rj45", name: "RJ45 8P8C jack", short: "RJ45", pins: 8, mating: { part_number: "TBD" } };
    const text = serialize(ConnectorTypeSchema, entry);
    expect(text).toContain('"short": "RJ45"');
    const { library, problems } = loadLibrary(new Map([["library/connectors/rj45.json", text]]));
    expect(problems).toEqual([]);
    expect(library.connectors.get("rj45")?.short).toBe("RJ45");
  });

  it("is in the generated JSON schema", () => {
    const schema = JSON.parse(readFileSync("schemas/library-connectors.schema.json", "utf8"));
    expect(schema.properties.short).toEqual({ type: "string" });
  });

  it("falls back to the entry id when unset or when the reference dangles", () => {
    const lib = testLibrary();
    lib.connectors.get("rj45")!.short = "RJ45";
    expect(connectorShortName(lib, "connectors/rj45")).toBe("RJ45");
    expect(connectorShortName(lib, "connectors/xt60")).toBe("xt60");
    expect(connectorShortName(lib, "connectors/nope")).toBe("nope");
  });
});
