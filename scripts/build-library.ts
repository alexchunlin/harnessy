/**
 * Build the repo library under `library/` from the entries below.
 *
 * Every entry is validated against its schema and written with the app's
 * serializer, so the files match what the app would save. Run with
 * `pnpm build:library`. The script clears each folder first, so an entry
 * removed here disappears from disk.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIBRARY_FOLDERS, LIBRARY_SCHEMAS, type LibraryEntry, type LibraryFolder } from "../src/core/schema";
import { serialize } from "../src/core/serialize";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "library");

/** Placeholder for part numbers nobody has picked yet. */
const TBD = "TBD";

type Entries = { [F in LibraryFolder]: LibraryEntry[F][] };

// Connector types -------------------------------------------------------------

const connectors: LibraryEntry["connectors"][] = [
  { id: "jst-gh-2", name: "JST GH 2-pin", pins: 2, mating: { part_number: "GHR-02V-S", contacts_part_number: "SSHL-002T-P0.2" }, manufacturer: "JST" },
  { id: "jst-gh-4", name: "JST GH 4-pin", pins: 4, mating: { part_number: "GHR-04V-S", contacts_part_number: "SSHL-002T-P0.2" }, manufacturer: "JST" },
  { id: "jst-gh-6", name: "JST GH 6-pin", pins: 6, mating: { part_number: "GHR-06V-S", contacts_part_number: "SSHL-002T-P0.2" }, manufacturer: "JST" },
  { id: "jst-xh-4", name: "JST XH 4-pin", pins: 4, mating: { part_number: "XHP-4", contacts_part_number: "SXH-001T-P0.6" }, manufacturer: "JST" },
  { id: "jst-xh-6", name: "JST XH 6-pin", pins: 6, mating: { part_number: "XHP-6", contacts_part_number: "SXH-001T-P0.6" }, manufacturer: "JST" },
  { id: "xt30", name: "Amass XT30", pins: 2, mating: { part_number: "XT30U-M" }, manufacturer: "Amass" },
  { id: "xt60", name: "Amass XT60", pins: 2, mating: { part_number: "XT60H-M" }, manufacturer: "Amass" },
  { id: "xt90", name: "Amass XT90", pins: 2, mating: { part_number: "XT90H-M" }, manufacturer: "Amass" },
  { id: "mr30", name: "Amass MR30 3-pin motor connector", pins: 3, mating: { part_number: "MR30PB-M" }, manufacturer: "Amass" },
  { id: "m12-d-coded", name: "M12 D-coded 4-pin", pins: 4, mating: { part_number: TBD } },
  { id: "rj45", name: "RJ45 8P8C jack", pins: 8, mating: { part_number: TBD } },
  { id: "usb-a", name: "USB-A receptacle", pins: 4, mating: { part_number: TBD } },
  { id: "usb-c", name: "USB-C receptacle", pins: 24, mating: { part_number: TBD } },
  { id: "hdmi-a", name: "HDMI type A receptacle", pins: 19, mating: { part_number: TBD } },
  { id: "fakra-z", name: "FAKRA Z-code coax jack", pins: 1, mating: { part_number: TBD } },
  { id: "ring-m6", name: "M6 stud, single ring terminal", pins: 1, mating: { part_number: TBD } },
  { id: "busbar-m6-pair", name: "Bus bar M6 stud pair (positive and negative)", pins: 2, mating: { part_number: TBD } },
  { id: "molex-microfit-4", name: "Molex Micro-Fit 3.0 4-pin", pins: 4, mating: { part_number: "43025-0400", contacts_part_number: "43030-0007" }, manufacturer: "Molex" },
  { id: "deutsch-dt-2", name: "Deutsch DT 2-pin", pins: 2, mating: { part_number: "DT06-2S", contacts_part_number: "0462-201-16141" }, manufacturer: "TE Connectivity" },
  { id: "screw-term-2", name: "Screw terminal, 2 positions", pins: 2, mating: { part_number: TBD } },
  { id: "pin-header-254-6", name: "0.1 inch pin header, 1x6", pins: 6, mating: { part_number: TBD } },
  { id: "dc-barrel-5521", name: "DC barrel jack 5.5 x 2.1 mm", pins: 2, mating: { part_number: TBD } },
];

// Wire and cable specs ------------------------------------------------------------

const wires: LibraryEntry["wires"][] = [
  { id: "awg8-red", name: "8 AWG silicone, red", awg: 8, od_mm: 6.5, ampacity_a: 40, color: "red" },
  { id: "awg12-red", name: "12 AWG silicone, red", awg: 12, od_mm: 3.7, ampacity_a: 20, color: "red" },
  { id: "awg12-black", name: "12 AWG silicone, black", awg: 12, od_mm: 3.7, ampacity_a: 20, color: "black" },
  { id: "awg14-black", name: "14 AWG silicone, black", awg: 14, od_mm: 3.3, ampacity_a: 15, color: "black" },
  { id: "awg18-red", name: "18 AWG PVC, red", awg: 18, od_mm: 2.1, ampacity_a: 7, color: "red" },
  { id: "awg18-black", name: "18 AWG PVC, black", awg: 18, od_mm: 2.1, ampacity_a: 7, color: "black" },
  { id: "awg22-white", name: "22 AWG PVC, white", awg: 22, od_mm: 1.6, ampacity_a: 3, color: "white" },
  { id: "awg24-blue", name: "24 AWG PVC, blue", awg: 24, od_mm: 1.4, ampacity_a: 2, color: "blue" },
  { id: "awg24-green", name: "24 AWG PVC, green", awg: 24, od_mm: 1.4, ampacity_a: 2, color: "green" },
  { id: "awg26-yellow", name: "26 AWG PVC, yellow", awg: 26, od_mm: 1.2, ampacity_a: 1.5, color: "yellow" },
];

const cables: LibraryEntry["cables"][] = [
  { id: "can-twisted-pair-22awg", name: "CAN twisted pair, 22 AWG, shielded", conductors: 2, awg: 22, od_mm: 4.5, shielded: true },
  { id: "cat6-utp-24awg", name: "Cat6 UTP, 24 AWG", conductors: 8, awg: 24, od_mm: 6, shielded: false },
  { id: "shielded-4c-24awg", name: "4-core shielded, 24 AWG", conductors: 4, awg: 24, od_mm: 4.8, shielded: true },
  { id: "shielded-6c-24awg", name: "6-core shielded, 24 AWG", conductors: 6, awg: 24, od_mm: 5.5, shielded: true },
  { id: "usb-a-c-2m", name: "USB 3.0 A to C cable core", conductors: 9, awg: 28, od_mm: 4.5, shielded: true },
  { id: "hdmi-2m", name: "HDMI 2.0 cable core", conductors: 19, awg: 30, od_mm: 7, shielded: true },
  { id: "fakra-coax", name: "GMSL2 coax, RG174 class", conductors: 1, awg: 26, od_mm: 2.8, shielded: true },
];

// Sheaths, breakouts, splices, ties ----------------------------------------------

const sheaths: LibraryEntry["sheaths"][] = [
  { id: "braid-6mm", name: "Braided sleeve, 6 mm", kind: "braid", id_mm: 6, part_number: TBD },
  { id: "braid-10mm", name: "Braided sleeve, 10 mm", kind: "braid", id_mm: 10, part_number: TBD },
  { id: "spiral-wrap-8mm", name: "Spiral wrap, 8 mm", kind: "spiral", id_mm: 8, part_number: TBD },
  { id: "heatshrink-6mm", name: "Heat shrink 2:1, 6 mm", kind: "heatshrink", id_mm: 6, part_number: TBD },
  { id: "heatshrink-12mm", name: "Heat shrink 2:1, 12 mm", kind: "heatshrink", id_mm: 12, part_number: TBD },
];

const breakouts: LibraryEntry["breakouts"][] = [
  { id: "y-boot", name: "Moulded Y-boot", kind: "boot", part_number: TBD, legs: 3 },
  { id: "tape-transition", name: "Taped transition", kind: "tape", part_number: TBD },
  { id: "heatshrink-transition", name: "Heat-shrink transition", kind: "heatshrink", part_number: TBD },
];

const splices: LibraryEntry["splices"][] = [
  { id: "solder-sleeve", name: "Solder sleeve splice", kind: "solder_sleeve", part_number: TBD },
  { id: "crimp-butt", name: "Crimp butt splice", kind: "crimp_butt", part_number: TBD },
];

const ties: LibraryEntry["ties"][] = [
  { id: "zip-tie-100mm", name: "Zip tie, 100 mm", kind: "zip_tie", part_number: TBD },
  { id: "p-clip-10mm", name: "P-clip, 10 mm", kind: "p_clip", part_number: TBD },
  { id: "adhesive-mount-19mm", name: "Adhesive tie mount, 19 mm", kind: "adhesive_mount", part_number: TBD },
];

// Purchased assemblies ------------------------------------------------------------

function patch(id: string, name: string, lengthMm: number, ends: [string, string], cable: string): LibraryEntry["assemblies"] {
  return { id, name, part_number: TBD, length_mm: lengthMm, ends: [`connectors/${ends[0]}`, `connectors/${ends[1]}`], cable: `cables/${cable}` };
}

const assemblies: LibraryEntry["assemblies"][] = [
  patch("ethernet-patch-300mm", "Ethernet patch cable, Cat6, 0.3 m", 300, ["rj45", "rj45"], "cat6-utp-24awg"),
  patch("ethernet-patch-500mm", "Ethernet patch cable, Cat6, 0.5 m", 500, ["rj45", "rj45"], "cat6-utp-24awg"),
  patch("ethernet-patch-1000mm", "Ethernet patch cable, Cat6, 1 m", 1000, ["rj45", "rj45"], "cat6-utp-24awg"),
  patch("ethernet-patch-2000mm", "Ethernet patch cable, Cat6, 2 m", 2000, ["rj45", "rj45"], "cat6-utp-24awg"),
  patch("can-patch-gh4-300mm", "CAN patch cable, JST GH 4-pin to JST GH 4-pin, 0.3 m", 300, ["jst-gh-4", "jst-gh-4"], "can-twisted-pair-22awg"),
  patch("can-patch-gh4-500mm", "CAN patch cable, JST GH 4-pin to JST GH 4-pin, 0.5 m", 500, ["jst-gh-4", "jst-gh-4"], "can-twisted-pair-22awg"),
  patch("usb-a-c-1000mm", "USB 3.0 A to C cable, 1 m", 1000, ["usb-a", "usb-c"], "usb-a-c-2m"),
  patch("usb-a-c-2000mm", "USB 3.0 A to C cable, 2 m", 2000, ["usb-a", "usb-c"], "usb-a-c-2m"),
  patch("hdmi-2000mm", "HDMI 2.0 cable, 2 m", 2000, ["hdmi-a", "hdmi-a"], "hdmi-2m"),
  patch("fakra-gmsl-1000mm", "FAKRA Z GMSL2 coax, 1 m", 1000, ["fakra-z", "fakra-z"], "fakra-coax"),
  patch("fakra-gmsl-2000mm", "FAKRA Z GMSL2 coax, 2 m", 2000, ["fakra-z", "fakra-z"], "fakra-coax"),
];

// Component definitions -----------------------------------------------------------

type Con = LibraryEntry["components"]["connectors"][number];
type Side = Con["side"];

/** A connector, with the side of the box it is drawn on. Inputs face left, outputs right, as on a datasheet block diagram. */
function con(designator: string, connector: string, label?: string, side?: Side): Con {
  const c: Con = { designator, connector: `connectors/${connector}` };
  if (label) c.label = label;
  if (side) c.side = side;
  return c;
}

function numbered(prefix: string, count: number, connector: string, label?: (i: number) => string, side?: Side): Con[] {
  return Array.from({ length: count }, (_, i) => con(`${prefix}${i + 1}`, connector, label?.(i + 1), side));
}

const components: LibraryEntry["components"][] = [
  // Compute and peripherals
  {
    id: "jetson-orin-carrier",
    name: "Nvidia Jetson Orin on GMSL carrier",
    manufacturer: "NVIDIA",
    part_number: TBD,
    connectors: [con("PWR", "xt30", "24 V in", "left"), con("ETH", "rj45", undefined, "right"), con("HDMI", "hdmi-a", undefined, "right"), con("USB1", "usb-a", undefined, "right"), con("USB2", "usb-a", undefined, "right"), ...numbered("CAM", 6, "fakra-z", (i) => `GMSL2 camera ${i}`, "bottom")],
  },
  { id: "touchscreen-10in", name: "10.1 inch touchscreen", part_number: TBD, connectors: [con("HDMI", "hdmi-a"), con("USB", "usb-c", "touch")] },
  { id: "usb-hub-powered", name: "USB hub, powered, 4 port", part_number: TBD, connectors: [con("UP", "usb-c", "upstream", "left"), ...numbered("D", 4, "usb-a", undefined, "right"), con("PWR", "dc-barrel-5521", "24 V in", "left")] },
  { id: "orbbec-gemini-336l", name: "Orbbec Gemini 336L depth camera", manufacturer: "Orbbec", part_number: "Gemini 336L", connectors: [con("USB", "usb-c")] },
  { id: "fisheye-gmsl-camera", name: "Fisheye GMSL2 camera", part_number: TBD, connectors: [con("GMSL", "fakra-z")] },
  { id: "dcdc-48-24", name: "48 V to 24 V DC/DC converter", part_number: TBD, connectors: [con("IN", "xt60", "48 V in", "left"), ...numbered("OUT", 4, "xt30", () => "24 V out", "right")] },
  { id: "ethernet-switch-poe-8", name: "Ethernet switch, 8 port, PoE", part_number: TBD, connectors: [...numbered("P", 8, "rj45", undefined, "right"), con("PWR", "xt60", "48 V in", "left")] },
  {
    id: "mib",
    name: "MIB (main interface board)",
    part_number: TBD,
    connectors: [
      con("PWR", "xt60", "48 V in", "left"),
      con("ETH", "rj45", undefined, "left"),
      con("CAN-A", "jst-gh-4", undefined, "left"),
      con("CAN-B", "jst-gh-4", undefined, "left"),
      ...numbered("AIN", 4, "jst-gh-4", () => "strain gauge, 10 V supply plus analog", "right"),
      ...numbered("ENC", 4, "jst-gh-4", () => "PWM encoder", "right"),
      ...numbered("DIO", 4, "jst-xh-4", () => "limit switch pair", "right"),
    ],
  },
  { id: "joystick-haptics-screen", name: "Joystick with haptics and screen", part_number: TBD, connectors: [con("ETH", "rj45"), con("PWR", "xt30", "24 V in")] },
  { id: "kinova-gen3", name: "Kinova Gen3 arm", manufacturer: "Kinova", part_number: TBD, connectors: [con("ETH", "rj45"), con("PWR", "xt30", "24 V in")] },

  // Power
  { id: "battery-48v-bms", name: "48 V Li-ion battery with BMS", part_number: TBD, connectors: [con("MAIN", "xt90", "main output"), con("CHG", "xt60", "charge"), con("CAN", "jst-gh-4", "BMS CAN")] },
  { id: "charge-port-xt60", name: "Charge port, panel mount", part_number: TBD, connectors: [con("J1", "xt60")] },
  { id: "inline-switch-fuse", name: "In-line switch and fuse", part_number: TBD, connectors: [con("IN", "xt90", undefined, "left"), con("OUT", "xt90", undefined, "right")] },
  { id: "bus-bar-48v", name: "48 V bus bar", part_number: TBD, connectors: [con("BAT", "busbar-m6-pair", "battery feed", "left"), ...numbered("L", 10, "busbar-m6-pair", () => "load", "right")] },

  // Drive corners
  { id: "pace-racer", name: "PACE RACER motor controller", part_number: TBD, connectors: [con("PWR", "xt60", "48 V in", "left"), con("MOT", "mr30", "three phase out", "right"), con("ENC", "jst-gh-6", "SPI encoder", "right"), con("ETH", "rj45", undefined, "left")] },
  { id: "drive-motor-bldc", name: "Drive motor, BLDC", part_number: TBD, connectors: [con("MOT", "mr30")] },
  { id: "spi-encoder", name: "SPI encoder", part_number: TBD, connectors: [con("J1", "jst-gh-6")] },

  // Lift and slide axes
  {
    id: "roboclaw-60v",
    name: "RoboClaw 60 V dual motor controller",
    manufacturer: "Basicmicro",
    part_number: TBD,
    connectors: [con("PWR", "screw-term-2", "48 V in", "left"), con("M1", "screw-term-2", undefined, "right"), con("M2", "screw-term-2", undefined, "right"), con("ENC1", "pin-header-254-6", undefined, "right"), con("ENC2", "pin-header-254-6", undefined, "right"), con("CAN-A", "jst-gh-4", undefined, "left"), con("CAN-B", "jst-gh-4", undefined, "left")],
  },
  { id: "lift-motor-brushed", name: "Lift or slide motor, brushed DC", part_number: TBD, connectors: [con("MOT", "xt30")] },
  { id: "abz-encoder", name: "Incremental encoder, ABZ", part_number: TBD, connectors: [con("J1", "jst-xh-6")] },
  { id: "pwm-encoder", name: "Absolute encoder, PWM output", part_number: TBD, connectors: [con("J1", "jst-gh-4")] },

  // Sensors
  { id: "strain-gauge", name: "Strain gauge with amplifier", part_number: TBD, connectors: [con("J1", "jst-gh-4")] },
  { id: "limit-switch-pair", name: "Limit switch pair", part_number: TBD, connectors: [con("J1", "jst-xh-4")] },
];

const entries: Entries = { components, connectors, wires, cables, sheaths, breakouts, splices, ties, assemblies };

// Write -------------------------------------------------------------------------------

let count = 0;
for (const folder of LIBRARY_FOLDERS) {
  const dir = join(OUT, folder);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f));
  const seen = new Set<string>();
  for (const entry of entries[folder]) {
    const schema = LIBRARY_SCHEMAS[folder];
    const parsed = schema.safeParse(entry);
    if (!parsed.success) throw new Error(`${folder}/${entry.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (seen.has(entry.id)) throw new Error(`${folder}/${entry.id}: duplicate id`);
    seen.add(entry.id);
    writeFileSync(join(dir, `${entry.id}.json`), serialize(schema, parsed.data));
    count += 1;
  }
}

// Every reference inside the library must resolve within it.
const ids = new Set<string>();
for (const folder of LIBRARY_FOLDERS) for (const e of entries[folder]) ids.add(`${folder}/${e.id}`);
const missing: string[] = [];
for (const c of components) for (const con of c.connectors) if (!ids.has(con.connector)) missing.push(`${c.id} -> ${con.connector}`);
for (const a of assemblies) {
  for (const end of a.ends) if (!ids.has(end)) missing.push(`${a.id} -> ${end}`);
  if (a.cable && !ids.has(a.cable)) missing.push(`${a.id} -> ${a.cable}`);
}
if (missing.length) throw new Error(`dangling references inside the library:\n  ${missing.join("\n  ")}`);

console.log(`wrote ${count} library entries under ${OUT}`);
