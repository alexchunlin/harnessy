import { z } from "zod";

// Ids and references -------------------------------------------------------

export const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const PROJECT_ID_PREFIXES = ["cmp", "net", "top", "seg", "end", "sht", "tie", "grp", "nte"] as const;
export type IdPrefix = (typeof PROJECT_ID_PREFIXES)[number];

const projectId = (prefix: IdPrefix) => z.string().regex(new RegExp(`^${prefix}-[${ID_ALPHABET}]{6}$`), `expected ${prefix}-xxxxxx id`);

export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase slug");
export const designator = z.string().regex(/^[A-Za-z0-9_-]+$/, "designator: letters, digits, hyphen, underscore");

export const LIBRARY_FOLDERS = ["components", "connectors", "wires", "cables", "sheaths", "breakouts", "splices", "ties", "assemblies"] as const;
export type LibraryFolder = (typeof LIBRARY_FOLDERS)[number];

const ref = (...folders: LibraryFolder[]) =>
  z.string().regex(new RegExp(`^(${folders.join("|")})/[a-z0-9][a-z0-9-]*$`), `expected <${folders.join("|")}>/<id>`);

export const connectorRef = ref("connectors");
export const specRef = ref("wires", "cables");
export const wireRef = ref("wires");
export const cableRef = ref("cables");
export const sheathRef = ref("sheaths");
export const breakoutRef = ref("breakouts");
export const spliceRef = ref("splices");
export const tieRef = ref("ties");
export const assemblyRef = ref("assemblies");
export const definitionRef = ref("components");

/** Connector address on a component instance: `cmp-k3f9qa/CAN-A`. */
export const connectorAddress = z.string().regex(new RegExp(`^cmp-[${ID_ALPHABET}]{6}/[A-Za-z0-9_-]+$`), "expected cmp-xxxxxx/DESIGNATOR");

export const mm = z.number().int().nonnegative();
export const px = z.number().int();

// Library --------------------------------------------------------------------

export const ConnectorTypeSchema = z.object({
  id: slug,
  name: z.string(),
  pins: z.number().int().positive(),
  mating: z.object({ part_number: z.string(), contacts_part_number: z.string().optional() }),
  manufacturer: z.string().optional(),
  datasheet: z.string().optional(),
});

export const WireSpecSchema = z.object({
  id: slug,
  name: z.string(),
  awg: z.number(),
  od_mm: z.number().nonnegative(),
  ampacity_a: z.number().nonnegative(),
  color: z.string(),
  part_number: z.string().optional(),
});

export const CableSpecSchema = z.object({
  id: slug,
  name: z.string(),
  conductors: z.number().int().positive(),
  awg: z.number(),
  od_mm: z.number().nonnegative(),
  shielded: z.boolean(),
  part_number: z.string().optional(),
});

export const SheathSpecSchema = z.object({
  id: slug,
  name: z.string(),
  kind: z.enum(["braid", "spiral", "heatshrink"]),
  id_mm: z.number().nonnegative(),
  part_number: z.string().optional(),
});

export const BreakoutSpecSchema = z.object({
  id: slug,
  name: z.string(),
  kind: z.enum(["boot", "tape", "heatshrink"]),
  part_number: z.string().optional(),
  legs: z.number().int().positive().optional(),
});

export const SpliceSpecSchema = z.object({
  id: slug,
  name: z.string(),
  kind: z.enum(["solder_sleeve", "crimp_butt"]),
  part_number: z.string().optional(),
});

export const TieSpecSchema = z.object({
  id: slug,
  name: z.string(),
  kind: z.enum(["zip_tie", "p_clip", "adhesive_mount"]),
  part_number: z.string().optional(),
});

export const AssemblySchema = z.object({
  id: slug,
  name: z.string(),
  part_number: z.string(),
  length_mm: mm,
  ends: z.tuple([connectorRef, connectorRef]),
  cable: cableRef.optional(),
});

export const DefinitionConnectorSchema = z.object({
  designator,
  connector: connectorRef,
  label: z.string().optional(),
});

export const ComponentDefinitionSchema = z.object({
  id: slug,
  name: z.string(),
  connectors: z.array(DefinitionConnectorSchema),
  part_number: z.string().optional(),
  manufacturer: z.string().optional(),
});

export const LIBRARY_SCHEMAS = {
  components: ComponentDefinitionSchema,
  connectors: ConnectorTypeSchema,
  wires: WireSpecSchema,
  cables: CableSpecSchema,
  sheaths: SheathSpecSchema,
  breakouts: BreakoutSpecSchema,
  splices: SpliceSpecSchema,
  ties: TieSpecSchema,
  assemblies: AssemblySchema,
} as const satisfies Record<LibraryFolder, z.ZodTypeAny>;

export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;
export type WireSpec = z.infer<typeof WireSpecSchema>;
export type CableSpec = z.infer<typeof CableSpecSchema>;
export type SheathSpec = z.infer<typeof SheathSpecSchema>;
export type BreakoutSpec = z.infer<typeof BreakoutSpecSchema>;
export type SpliceSpec = z.infer<typeof SpliceSpecSchema>;
export type TieSpec = z.infer<typeof TieSpecSchema>;
export type Assembly = z.infer<typeof AssemblySchema>;
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;
export type DefinitionConnector = z.infer<typeof DefinitionConnectorSchema>;
export type LibraryEntry = {
  components: ComponentDefinition;
  connectors: ConnectorType;
  wires: WireSpec;
  cables: CableSpec;
  sheaths: SheathSpec;
  breakouts: BreakoutSpec;
  splices: SpliceSpec;
  ties: TieSpec;
  assemblies: Assembly;
};

// Project --------------------------------------------------------------------

export const DomainSchema = z.object({
  id: slug,
  name: z.string(),
  color: z.string(),
  spec: specRef.optional(),
  conductors: z.number().int().positive(),
});

export const LayerSchema = z.object({
  id: slug,
  name: z.string(),
  domains: z.array(slug),
});

export const ProjectFileSchema = z.object({
  schema: z.literal(1),
  name: z.string(),
  domains: z.array(DomainSchema),
  layers: z.array(LayerSchema),
  keep_apart: z.array(z.tuple([slug, slug])).optional(),
});

export const ComponentSchema = z
  .object({
    id: projectId("cmp"),
    name: z.string(),
    definition: definitionRef.optional(),
    connectors: z.array(DefinitionConnectorSchema).optional(),
  })
  .refine((c) => (c.definition === undefined) !== (c.connectors === undefined), {
    message: "a component references a definition or declares connectors, not both",
  });

export const NetSchema = z.object({
  id: projectId("net"),
  name: z.string().optional(),
  connectors: z.array(connectorAddress),
  spec: specRef.optional(),
  conductors: z.number().int().positive().optional(),
});

export const NetsFileSchema = z.array(NetSchema);

export const EndpointSchema = z.discriminatedUnion("kind", [
  z.object({ id: projectId("end"), kind: z.literal("connector"), connector: connectorAddress }),
  z.object({ id: projectId("end"), kind: z.literal("point") }),
  z.object({ id: projectId("end"), kind: z.literal("breakout"), spec: breakoutRef.optional() }),
  z.object({ id: projectId("end"), kind: z.literal("splice"), nets: z.array(projectId("net")), spec: spliceRef.optional() }),
]);

export const HarnessAnchorSchema = z.object({ name: z.string(), part_number: z.string().optional() });

export const SegmentSchema = z.object({
  id: projectId("seg"),
  ends: z.tuple([projectId("end"), projectId("end")]),
  length_mm: mm.optional(),
  assembly: assemblyRef.optional(),
  harness: HarnessAnchorSchema.optional(),
});

export const SheathSchema = z.object({
  id: projectId("sht"),
  spec: sheathRef,
  segments: z.array(projectId("seg")),
  overlap_mm: mm,
});

export const TiePointSchema = z.object({
  id: projectId("tie"),
  segment: projectId("seg"),
  from: projectId("end"),
  distance_mm: mm,
  spec: tieRef,
});

export const TopologySchema = z.object({
  id: projectId("top"),
  name: z.string(),
  endpoints: z.array(EndpointSchema),
  segments: z.array(SegmentSchema),
  sheaths: z.array(SheathSchema),
  ties: z.array(TiePointSchema),
});

export const PositionSchema = z.object({ x: px, y: px });

export const GroupSchema = z.object({
  id: projectId("grp"),
  label: z.string(),
  rect: z.object({ x: px, y: px, w: px, h: px }),
  members: z.array(projectId("cmp")),
});

export const NoteSchema = z.object({
  id: projectId("nte"),
  text: z.string(),
  x: px,
  y: px,
  component: projectId("cmp").optional(),
  net: projectId("net").optional(),
});

export const ConnectivityCanvasSchema = z.object({
  components: z.record(z.string(), PositionSchema),
  hubs: z.record(z.string(), PositionSchema),
  groups: z.array(GroupSchema),
  notes: z.array(NoteSchema),
});

export const TopologyCanvasSchema = z.object({
  endpoints: z.record(z.string(), PositionSchema),
});

export const DrcFileSchema = z.object({
  silences: z.array(z.object({ check: z.string(), target: z.string() })),
});

export type Domain = z.infer<typeof DomainSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Net = z.infer<typeof NetSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type EndpointKind = Endpoint["kind"];
export type HarnessAnchor = z.infer<typeof HarnessAnchorSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Sheath = z.infer<typeof SheathSchema>;
export type TiePoint = z.infer<typeof TiePointSchema>;
export type Topology = z.infer<typeof TopologySchema>;
export type Position = z.infer<typeof PositionSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type ConnectivityCanvas = z.infer<typeof ConnectivityCanvasSchema>;
export type TopologyCanvas = z.infer<typeof TopologyCanvasSchema>;
export type DrcFile = z.infer<typeof DrcFileSchema>;

export const ALL_LAYER_ID = "all";
