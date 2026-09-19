import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ComponentSchema,
  ConnectivityCanvasSchema,
  DrcFileSchema,
  LIBRARY_SCHEMAS,
  NetsFileSchema,
  ProjectFileSchema,
  TopologyCanvasSchema,
  TopologySchema,
} from "../src/core/schema";

/**
 * Generate JSON Schema from the Zod schemas so hand-edited library and
 * project files get editor validation. The Zod schemas stay the source of
 * truth; this output is checked in and regenerated with `pnpm schemas`.
 */

const out = path.resolve(process.cwd(), "schemas");

const files: Record<string, z.ZodTypeAny> = {
  "project.schema.json": ProjectFileSchema,
  "component.schema.json": ComponentSchema,
  "nets.schema.json": NetsFileSchema,
  "topology.schema.json": TopologySchema,
  "canvas-connectivity.schema.json": ConnectivityCanvasSchema,
  "canvas-topology.schema.json": TopologyCanvasSchema,
  "drc.schema.json": DrcFileSchema,
};
for (const [folder, schema] of Object.entries(LIBRARY_SCHEMAS)) files[`library-${folder}.schema.json`] = schema;

await fs.mkdir(out, { recursive: true });
for (const [name, schema] of Object.entries(files)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  await fs.writeFile(path.join(out, name), JSON.stringify({ $id: `https://harnessy.dev/schemas/${name}`, ...json }, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(files).length} schemas to ${out}`);
