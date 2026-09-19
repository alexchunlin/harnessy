import { z } from "zod";

/**
 * One serializer for every file. Keys come out in schema order with `id` then
 * `name` first, arrays of records sort by `id`, numbers that the schema marks
 * as integers round to integers, two-space indent, trailing newline.
 */
export function serialize(schema: z.ZodTypeAny, value: unknown): string {
  return JSON.stringify(canonical(schema, value), null, 2) + "\n";
}

type Def = { type: string; [k: string]: unknown };

function def(schema: z.ZodTypeAny): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  for (;;) {
    const d = def(schema);
    if (d.type === "optional" || d.type === "nullable" || d.type === "default" || d.type === "readonly" || d.type === "nonoptional") {
      schema = d.innerType as z.ZodTypeAny;
      continue;
    }
    if (d.type === "pipe") {
      schema = d.in as z.ZodTypeAny;
      continue;
    }
    return schema;
  }
}

function pickUnionMember(schema: z.ZodTypeAny, value: unknown): z.ZodTypeAny | undefined {
  const d = def(schema);
  const options = d.options as z.ZodTypeAny[];
  for (const option of options) if (option.safeParse(value).success) return option;
  return undefined;
}

function canonical(schema: z.ZodTypeAny, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const s = unwrap(schema);
  const d = def(s);
  switch (d.type) {
    case "object": {
      const shape = d.shape as Record<string, z.ZodTypeAny>;
      const input = value as Record<string, unknown>;
      const order = ["id", "name", ...Object.keys(shape).filter((k) => k !== "id" && k !== "name")];
      const out: Record<string, unknown> = {};
      for (const key of order) {
        if (!(key in shape) || input[key] === undefined) continue;
        out[key] = canonical(shape[key], input[key]);
      }
      for (const key of Object.keys(input).sort()) {
        if (key in shape || input[key] === undefined) continue;
        out[key] = input[key];
      }
      return out;
    }
    case "array": {
      const element = d.element as z.ZodTypeAny;
      const items = (value as unknown[]).map((v) => canonical(element, v));
      if (items.length > 0 && items.every((v) => v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string")) {
        items.sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1));
      }
      return items;
    }
    case "tuple": {
      const items = d.items as z.ZodTypeAny[];
      return (value as unknown[]).map((v, i) => canonical(items[i] ?? items[items.length - 1], v));
    }
    case "record": {
      const valueType = d.valueType as z.ZodTypeAny;
      const input = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input).sort()) out[key] = canonical(valueType, input[key]);
      return out;
    }
    case "union": {
      const member = pickUnionMember(s, value);
      return member ? canonical(member, value) : value;
    }
    case "number": {
      const checks = (d.checks ?? []) as { _zod: { def: { check: string; format?: string } } }[];
      const isInt = checks.some((c) => c._zod.def.check === "number_format" && c._zod.def.format?.startsWith("safeint"));
      return isInt ? Math.round(value as number) : value;
    }
    default:
      return value;
  }
}
