/**
 * Build the RAMMP Gen 1.5 example project under `examples/rammp-gen1.5/`.
 *
 * The connectivity follows `docs/reference/rammp-gen1.5-diagram.png` with the
 * corrections in DESIGN.md. Ids come from a sequential source so re-running
 * writes an identical tree. Lengths are placeholders. Run with
 * `pnpm build:example`; the script fails if the topology has design rule errors.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { sequentialIdSource, setIdSource } from "../src/core/ids";
import { loadLibrary, type Files } from "../src/core/library";
import { saveProject, type Project } from "../src/core/project";
import { starterProject } from "../src/core/starter";
import * as ops from "../src/core/ops";
import { runChecks } from "../src/core/drc";
import { buildBom } from "../src/core/bom";
import type { Position } from "../src/core/schema";

setIdSource(sequentialIdSource());

const ROOT = join(import.meta.dirname, "..");
const LIBRARY = join(ROOT, "library");
const OUT = join(ROOT, "examples", "rammp-gen1.5");

// Repo library ---------------------------------------------------------------

function walk(dir: string, into: Files): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, into);
    else if (name.endsWith(".json")) into.set(relative(ROOT, full), readFileSync(full, "utf8"));
  }
}

const libraryFiles: Files = new Map();
walk(LIBRARY, libraryFiles);
const loaded = loadLibrary(libraryFiles, "library/");
if (loaded.problems.length) throw new Error(`library problems:\n  ${loaded.problems.map((p) => `${p.path}: ${p.message}`).join("\n  ")}`);

let p: Project = starterProject("RAMMP Gen 1.5", loaded.library);

// Components -------------------------------------------------------------------
// Positions follow the diagram roughly, in canvas pixels.

function place(definition: string, name: string, x: number, y: number): string {
  const r = ops.placeComponent(p, `components/${definition}`, { x, y }, name);
  p = r.project;
  return r.id;
}

// Compute and peripherals (top right of the diagram)
const cams = [1, 2, 3, 4, 5, 6].map((i) => place("fisheye-gmsl-camera", `Fisheye camera ${i}`, 1200 + i * 130, 60));
const orbbec1 = place("orbbec-gemini-336l", "Orbbec 336L 1", 1900, 160);
const orbbec2 = place("orbbec-gemini-336l", "Orbbec 336L 2", 1900, 250);
const hub = place("usb-hub-powered", "USB hub (powered)", 1800, 340);
const jetson = place("jetson-orin-carrier", "Nvidia Jetson Orin", 1620, 570);
const screen = place("touchscreen-10in", "10.1 inch touchscreen", 1850, 570);
const dcdc = place("dcdc-48-24", "24 V DC/DC", 1500, 440);
const joystick = place("joystick-haptics-screen", "Joystick + haptics + screen", 1260, 300);
const kinova = place("kinova-gen3", "Kinova Gen3", 1430, 300);
const eth = place("ethernet-switch-poe-8", "Ethernet switch", 550, 570);
const mib = place("mib", "MIB", 812, 970);

// Power (bottom left)
const battery = place("battery-48v-bms", "48 V battery + BMS", 460, 1300);
const chargePort = place("charge-port-xt60", "Charge port", 290, 1300);
const inlineSwitch = place("inline-switch-fuse", "In-line switch / fuse", 580, 1340);
const busBar = place("bus-bar-48v", "Bus bar", 615, 1210);

// Drive corners: PACE RACER, BLDC motor, SPI encoder
type Corner = { tag: string; racer: [number, number]; motor: [number, number]; enc: [number, number] };
const corners: Corner[] = [
  { tag: "FL", racer: [720, 330], motor: [600, 200], enc: [720, 190] },
  { tag: "FR", racer: [900, 330], motor: [1020, 200], enc: [900, 190] },
  { tag: "RL", racer: [305, 940], motor: [120, 965], enc: [105, 857] },
  { tag: "RR", racer: [1375, 912], motor: [1545, 985], enc: [1550, 840] },
];
const drive = corners.map((c) => ({
  tag: c.tag,
  racer: place("pace-racer", `PACE RACER ${c.tag}`, ...c.racer),
  motor: place("drive-motor-bldc", `Drive motor ${c.tag}`, ...c.motor),
  enc: place("spi-encoder", `SPI encoder ${c.tag}`, ...c.enc),
}));

// Lift and slide axes on three RoboClaws
const rcL = place("roboclaw-60v", "RoboClaw L", 555, 790);
const rcR = place("roboclaw-60v", "RoboClaw R", 1100, 790);
const rcRear = place("roboclaw-60v", "RoboClaw rear", 812, 1200);
const liftL = place("lift-motor-brushed", "Lift motor L", 470, 675);
const slideL = place("lift-motor-brushed", "Slide motor L", 470, 715);
const liftR = place("lift-motor-brushed", "Lift motor R", 1180, 680);
const slideR = place("lift-motor-brushed", "Slide motor R", 1180, 722);
const liftRear = place("lift-motor-brushed", "Rear lift motor", 812, 1300);
const liftFront = place("lift-motor-brushed", "Front lift motor", 860, 450);
const abzLLift = place("abz-encoder", "ABZ encoder L lift", 185, 673);
const abzLSlide = place("abz-encoder", "ABZ encoder L slide", 569, 1000);
const abzRLift = place("abz-encoder", "ABZ encoder R lift", 1470, 675);
const abzRSlide = place("abz-encoder", "ABZ encoder R slide", 1085, 1000);
const abzRearLift = place("abz-encoder", "ABZ encoder rear lift", 990, 1405);
const abzFrontLift = place("abz-encoder", "ABZ encoder front lift", 1157, 517);

// Sensor clusters read by the MIB: strain gauge, PWM encoder, limit switch pair
type Cluster = { tag: string; strain: [number, number]; pwm: [number, number]; limit: [number, number] };
const clusterSpecs: Cluster[] = [
  { tag: "front", strain: [1037, 458], pwm: [805, 528], limit: [1037, 516] },
  { tag: "left", strain: [290, 645], pwm: [350, 760], limit: [290, 700] },
  { tag: "right", strain: [1355, 645], pwm: [1300, 760], limit: [1355, 705] },
  { tag: "rear", strain: [990, 1290], pwm: [1125, 1355], limit: [990, 1345] },
];
const clusters = clusterSpecs.map((c, i) => ({
  n: i + 1,
  tag: c.tag,
  strain: place("strain-gauge", `Strain gauge ${c.tag}`, ...c.strain),
  pwm: place("pwm-encoder", `PWM encoder ${c.tag} lift`, ...c.pwm),
  limit: place("limit-switch-pair", `Limit switches ${c.tag}`, ...c.limit),
}));

// Nets ----------------------------------------------------------------------------

const at = (component: string, designator: string) => `${component}/${designator}`;

function net(domain: string, connectors: string[], name: string, override?: { spec?: string; conductors?: number }): string {
  const r = ops.createNet(p, domain, connectors, name);
  p = r.project;
  if (override) p = ops.setNetSpec(p, r.id, override.spec, override.conductors);
  return r.id;
}

// 48 V: battery feed, charge, and one two-connector net per load off the bus bar
const heavy = { spec: "wires/awg8-red", conductors: 2 };
net("48v", [at(battery, "MAIN"), at(inlineSwitch, "IN")], "Battery to switch", heavy);
net("48v", [at(inlineSwitch, "OUT"), at(busBar, "BAT")], "Switch to bus bar", heavy);
net("48v", [at(battery, "CHG"), at(chargePort, "J1")], "Charge");
const loads48: [string, string, string][] = [
  [at(drive[0].racer, "PWR"), "L1", "48 V PACE RACER FL"],
  [at(drive[1].racer, "PWR"), "L2", "48 V PACE RACER FR"],
  [at(eth, "PWR"), "L3", "48 V Ethernet switch"],
  [at(dcdc, "IN"), "L4", "48 V DC/DC"],
  [at(mib, "PWR"), "L5", "48 V MIB"],
  [at(drive[2].racer, "PWR"), "L6", "48 V PACE RACER RL"],
  [at(drive[3].racer, "PWR"), "L7", "48 V PACE RACER RR"],
  [at(rcL, "PWR"), "L8", "48 V RoboClaw L"],
  [at(rcR, "PWR"), "L9", "48 V RoboClaw R"],
  [at(rcRear, "PWR"), "L10", "48 V RoboClaw rear"],
];
for (const [load, pos, name] of loads48) net("48v", [at(busBar, pos), load], name);

// 24 V from the DC/DC
net("24v", [at(dcdc, "OUT1"), at(kinova, "PWR")], "24 V Kinova");
net("24v", [at(dcdc, "OUT2"), at(hub, "PWR")], "24 V USB hub");
net("24v", [at(dcdc, "OUT3"), at(jetson, "PWR")], "24 V Jetson");
net("24v", [at(dcdc, "OUT4"), at(joystick, "PWR")], "24 V joystick");

// CAN daisy chain: battery BMS, MIB, RoboClaw L, R, rear. One net per hop.
const canHops: [string, string, string, string][] = [
  [at(mib, "CAN-B"), at(battery, "CAN"), "CAN MIB to BMS", "can-patch-gh4-500mm"],
  [at(mib, "CAN-A"), at(rcL, "CAN-A"), "CAN MIB to RoboClaw L", "can-patch-gh4-500mm"],
  [at(rcL, "CAN-B"), at(rcR, "CAN-A"), "CAN RoboClaw L to R", "can-patch-gh4-500mm"],
  [at(rcR, "CAN-B"), at(rcRear, "CAN-A"), "CAN RoboClaw R to rear", "can-patch-gh4-300mm"],
];
const canNets = canHops.map(([a, b, name, assembly]) => ({ a, b, assembly, net: net("can", [a, b], name) }));

// Ethernet: every run is a patch cable from the switch
const ethRuns: [string, string, string, string][] = [
  [at(eth, "P1"), at(jetson, "ETH"), "Ethernet Jetson", "ethernet-patch-2000mm"],
  [at(eth, "P2"), at(mib, "ETH"), "Ethernet MIB", "ethernet-patch-1000mm"],
  [at(eth, "P3"), at(joystick, "ETH"), "Ethernet joystick", "ethernet-patch-2000mm"],
  [at(eth, "P4"), at(kinova, "ETH"), "Ethernet Kinova", "ethernet-patch-2000mm"],
  [at(eth, "P5"), at(drive[0].racer, "ETH"), "Ethernet PACE RACER FL", "ethernet-patch-500mm"],
  [at(eth, "P6"), at(drive[1].racer, "ETH"), "Ethernet PACE RACER FR", "ethernet-patch-500mm"],
  [at(eth, "P7"), at(drive[2].racer, "ETH"), "Ethernet PACE RACER RL", "ethernet-patch-1000mm"],
  [at(eth, "P8"), at(drive[3].racer, "ETH"), "Ethernet PACE RACER RR", "ethernet-patch-1000mm"],
];
const ethNets = ethRuns.map(([a, b, name, assembly]) => ({ a, b, assembly, net: net("ethernet", [a, b], name) }));

// USB, HDMI, GMSL: purchased cables
const usbRuns: [string, string, string, string][] = [
  [at(jetson, "USB1"), at(hub, "UP"), "USB Jetson to hub", "usb-a-c-1000mm"],
  [at(hub, "D1"), at(orbbec1, "USB"), "USB Orbbec 1", "usb-a-c-2000mm"],
  [at(hub, "D2"), at(orbbec2, "USB"), "USB Orbbec 2", "usb-a-c-2000mm"],
  [at(jetson, "USB2"), at(screen, "USB"), "USB touchscreen", "usb-a-c-2000mm"],
];
const usbNets = usbRuns.map(([a, b, name, assembly]) => ({ a, b, assembly, net: net("usb", [a, b], name) }));
const hdmiNet = { a: at(jetson, "HDMI"), b: at(screen, "HDMI"), assembly: "hdmi-2000mm", net: net("hdmi", [at(jetson, "HDMI"), at(screen, "HDMI")], "HDMI touchscreen") };
const gmslNets = cams.map((cam, i) => {
  const a = at(jetson, `CAM${i + 1}`);
  const b = at(cam, "GMSL");
  return { a, b, assembly: i < 3 ? "fakra-gmsl-1000mm" : "fakra-gmsl-2000mm", net: net("gmsl", [a, b], `GMSL camera ${i + 1}`) };
});

// Drive corners: three-phase motor and SPI encoder
for (const d of drive) {
  net("motor-phase", [at(d.racer, "MOT"), at(d.motor, "MOT")], `Motor phase ${d.tag}`);
  net("spi", [at(d.racer, "ENC"), at(d.enc, "J1")], `SPI encoder ${d.tag}`);
}

// Lift and slide axes: brushed motors take two conductors, encoders are ABZ
const brushed = { conductors: 2 };
type Axis = { rc: string; channel: "1" | "2"; motor: string; enc: string; name: string };
const axes: Axis[] = [
  { rc: rcL, channel: "1", motor: liftL, enc: abzLLift, name: "L lift" },
  { rc: rcL, channel: "2", motor: slideL, enc: abzLSlide, name: "L slide" },
  { rc: rcR, channel: "1", motor: liftR, enc: abzRLift, name: "R lift" },
  { rc: rcR, channel: "2", motor: slideR, enc: abzRSlide, name: "R slide" },
  { rc: rcRear, channel: "1", motor: liftRear, enc: abzRearLift, name: "rear lift" },
  { rc: rcRear, channel: "2", motor: liftFront, enc: abzFrontLift, name: "front lift" },
];
for (const a of axes) {
  net("motor-phase", [at(a.rc, `M${a.channel}`), at(a.motor, "MOT")], `Motor ${a.name}`, brushed);
  net("encoder-abz", [at(a.rc, `ENC${a.channel}`), at(a.enc, "J1")], `ABZ ${a.name}`);
}

// Sensor clusters into the MIB. Strain gauges carry their 10 V supply in the analog cable.
const strainCable = { spec: "cables/shielded-4c-24awg", conductors: 1 };
const limitPair = { conductors: 4 };
for (const c of clusters) {
  net("analog", [at(mib, `AIN${c.n}`), at(c.strain, "J1")], `Strain gauge ${c.tag}`, strainCable);
  net("pwm", [at(mib, `ENC${c.n}`), at(c.pwm, "J1")], `PWM encoder ${c.tag} lift`);
  net("digital-io", [at(mib, `DIO${c.n}`), at(c.limit, "J1")], `Limit switches ${c.tag}`, limitPair);
}

// Topology ----------------------------------------------------------------------------

const topology = ops.createTopology(p, "Gen 1.5 as built");
p = topology.project;
const top = topology.id;

function connector(address: string, pos: Position): string {
  const r = ops.placeConnector(p, top, address, pos);
  p = r.project;
  return r.id;
}

/** Grow a point from an endpoint. The point becomes a breakout once a third segment lands on it. */
function grow(from: string, pos: Position, lengthMm: number): { segment: string; endpoint: string } {
  const r = ops.growSegment(p, top, from, pos);
  p = ops.setSegmentLength(r.project, top, r.segment, lengthMm);
  return { segment: r.segment, endpoint: r.endpoint };
}

function join2(a: string, b: string, lengthMm: number): string {
  const r = ops.addSegment(p, top, a, b, lengthMm);
  p = r.project;
  return r.id;
}

function breakoutSpec(endpoint: string, spec: string): void {
  p = ops.setBreakoutSpec(p, top, endpoint, `breakouts/${spec}`);
}

function anchor(segment: string, name: string): void {
  p = ops.setHarnessAnchor(p, top, segment, { name });
}

function sheath(segments: string[], spec: string, overlapMm = 0): void {
  p = ops.applySheath(p, top, segments, `sheaths/${spec}`, overlapMm).project;
}

function tie(segment: string, spec: string, distanceMm: number): void {
  p = ops.addTiePoint(p, top, segment, `ties/${spec}`, distanceMm).project;
}

/** Place a purchased cable between two connectors. It is its own piece, never part of a harness. */
function purchased(a: string, b: string, assembly: string, pos: Position): void {
  const ea = connector(a, pos);
  const eb = connector(b, { x: pos.x + 200, y: pos.y });
  const seg = join2(ea, eb, 0);
  p = ops.setSegmentAssembly(p, top, seg, `assemblies/${assembly}`);
}

/**
 * Stubs from a row of connectors into one breakout. The first connector grows
 * the point; the rest join it, which promotes it to a breakout.
 */
function fan(addresses: string[], origin: Position, hub: Position, stubMm: number): string {
  let hubId = "";
  addresses.forEach((address, i) => {
    const ep = connector(address, { x: origin.x + i * 60, y: origin.y });
    if (i === 0) hubId = grow(ep, hub, stubMm).endpoint;
    else join2(ep, hubId, stubMm);
  });
  return hubId;
}

/** Leaves hanging off a breakout, laid out in a row. */
function leaves(from: string, items: { address: string; lengthMm: number }[], origin: Position): void {
  items.forEach((item, i) => {
    const ep = connector(item.address, { x: origin.x + i * 60, y: origin.y });
    join2(from, ep, item.lengthMm);
  });
}

// Purchased cables, laid out in rows on the right of the topology canvas.
let row = 0;
const purchasedRow = (x: number) => ({ x, y: 40 + row++ * 50 });
for (const n of ethNets) purchased(n.a, n.b, n.assembly, purchasedRow(2400));
for (const n of canNets) purchased(n.a, n.b, n.assembly, purchasedRow(2400));
for (const n of usbNets) purchased(n.a, n.b, n.assembly, purchasedRow(2400));
purchased(hdmiNet.a, hdmiNet.b, hdmiNet.assembly, purchasedRow(2400));
for (const n of gmslNets) purchased(n.a, n.b, n.assembly, purchasedRow(2400));

// Battery leads: three single-segment harnesses.
{
  const a = connector(at(battery, "MAIN"), { x: 40, y: 40 });
  const b = connector(at(inlineSwitch, "IN"), { x: 240, y: 40 });
  anchor(join2(a, b, 300), "Battery lead");
  const c = connector(at(inlineSwitch, "OUT"), { x: 40, y: 100 });
  const d = connector(at(busBar, "BAT"), { x: 240, y: 100 });
  anchor(join2(c, d, 250), "Bus bar feed");
  const e = connector(at(battery, "CHG"), { x: 40, y: 160 });
  const f = connector(at(chargePort, "J1"), { x: 240, y: 160 });
  anchor(join2(e, f, 400), "Charge lead");
}

// Power harness, front: bus bar L1 to L5 through a sheathed trunk to the front loads.
{
  const b0 = fan(["L1", "L2", "L3", "L4", "L5"].map((d) => at(busBar, d)), { x: 40, y: 300 }, { x: 160, y: 380 }, 80);
  breakoutSpec(b0, "tape-transition");
  const p1 = grow(b0, { x: 160, y: 480 }, 400);
  const b1 = grow(p1.endpoint, { x: 160, y: 580 }, 350);
  leaves(b1.endpoint, [{ address: at(drive[0].racer, "PWR"), lengthMm: 500 }, { address: at(drive[1].racer, "PWR"), lengthMm: 500 }], { x: 40, y: 660 });
  const p2 = grow(b1.endpoint, { x: 280, y: 580 }, 300);
  const b2 = grow(p2.endpoint, { x: 380, y: 580 }, 200);
  leaves(b2.endpoint, [{ address: at(eth, "PWR"), lengthMm: 300 }, { address: at(dcdc, "IN"), lengthMm: 400 }, { address: at(mib, "PWR"), lengthMm: 350 }], { x: 320, y: 660 });
  breakoutSpec(b1.endpoint, "heatshrink-transition");
  breakoutSpec(b2.endpoint, "heatshrink-transition");
  anchor(p1.segment, "Power harness, front");
  sheath([p1.segment, b1.segment, p2.segment, b2.segment], "braid-10mm", 20);
  tie(p1.segment, "p-clip-10mm", 200);
  tie(b1.segment, "zip-tie-100mm", 150);
  tie(p2.segment, "zip-tie-100mm", 150);
}

// Power harness, rear: bus bar L6 to L10 to the rear drive corners and the RoboClaws.
{
  const b3 = fan(["L6", "L7", "L8", "L9", "L10"].map((d) => at(busBar, d)), { x: 40, y: 800 }, { x: 160, y: 880 }, 80);
  breakoutSpec(b3, "tape-transition");
  const p1 = grow(b3, { x: 160, y: 980 }, 300);
  const b4 = grow(p1.endpoint, { x: 160, y: 1080 }, 300);
  leaves(b4.endpoint, [{ address: at(drive[2].racer, "PWR"), lengthMm: 450 }, { address: at(drive[3].racer, "PWR"), lengthMm: 900 }], { x: 40, y: 1160 });
  const p2 = grow(b4.endpoint, { x: 280, y: 1080 }, 250);
  const b5 = grow(p2.endpoint, { x: 380, y: 1080 }, 200);
  leaves(b5.endpoint, [{ address: at(rcL, "PWR"), lengthMm: 400 }, { address: at(rcR, "PWR"), lengthMm: 700 }, { address: at(rcRear, "PWR"), lengthMm: 250 }], { x: 320, y: 1160 });
  breakoutSpec(b4.endpoint, "heatshrink-transition");
  breakoutSpec(b5.endpoint, "heatshrink-transition");
  anchor(p1.segment, "Power harness, rear");
  sheath([p1.segment, b4.segment, p2.segment, b5.segment], "spiral-wrap-8mm");
  tie(b4.segment, "adhesive-mount-19mm", 100);
}

// MIB sensor harness: twelve MIB connectors through one trunk to four sensor clusters.
{
  const mibAddresses = [1, 2, 3, 4].flatMap((n) => [at(mib, `AIN${n}`), at(mib, `ENC${n}`), at(mib, `DIO${n}`)]);
  const bm = fan(mibAddresses, { x: 700, y: 300 }, { x: 1030, y: 400 }, 60);
  breakoutSpec(bm, "heatshrink-transition");
  const p1 = grow(bm, { x: 1030, y: 500 }, 250);
  const bc = grow(p1.endpoint, { x: 1030, y: 600 }, 200);
  breakoutSpec(bc.endpoint, "tape-transition");
  const legMm: Record<string, number> = { front: 600, left: 500, right: 500, rear: 400 };
  clusters.forEach((c, i) => {
    const x = 760 + i * 200;
    const leg = grow(bc.endpoint, { x, y: 700 }, legMm[c.tag]);
    leaves(leg.endpoint, [{ address: at(c.strain, "J1"), lengthMm: 150 }, { address: at(c.pwm, "J1"), lengthMm: 150 }, { address: at(c.limit, "J1"), lengthMm: 200 }], { x: x - 60, y: 780 });
    breakoutSpec(leg.endpoint, "tape-transition");
  });
  anchor(p1.segment, "MIB sensor harness");
  sheath([p1.segment, bc.segment], "braid-6mm", 10);
  tie(bc.segment, "adhesive-mount-19mm", 100);
}

// RoboClaw axis harnesses: motor and encoder for both channels of one controller.
function roboclawHarness(rc: string, name: string, axesOf: Axis[], origin: Position, legMm: [number, number]): void {
  const stubs = fan([at(rc, "M1"), at(rc, "ENC1"), at(rc, "M2"), at(rc, "ENC2")], origin, { x: origin.x + 90, y: origin.y + 80 }, 100);
  breakoutSpec(stubs, "heatshrink-transition");
  axesOf.forEach((axis, i) => {
    const leg = grow(stubs, { x: origin.x + i * 180, y: origin.y + 180 }, legMm[i]);
    leaves(leg.endpoint, [{ address: at(axis.motor, "MOT"), lengthMm: 150 }, { address: at(axis.enc, "J1"), lengthMm: 150 }], { x: origin.x + i * 180 - 30, y: origin.y + 260 });
    breakoutSpec(leg.endpoint, "y-boot");
    if (i === 0) anchor(leg.segment, name);
  });
}
roboclawHarness(rcL, "RoboClaw L axis harness", axes.filter((a) => a.rc === rcL), { x: 700, y: 900 }, [300, 350]);
roboclawHarness(rcR, "RoboClaw R axis harness", axes.filter((a) => a.rc === rcR), { x: 1100, y: 900 }, [300, 350]);
roboclawHarness(rcRear, "RoboClaw rear axis harness", axes.filter((a) => a.rc === rcRear), { x: 1500, y: 900 }, [250, 900]);

// Drive corner harnesses: three-phase plus SPI encoder from a PACE RACER to its motor.
drive.forEach((d, i) => {
  const origin = { x: 700 + i * 300, y: 1250 };
  const stubs = fan([at(d.racer, "MOT"), at(d.racer, "ENC")], origin, { x: origin.x + 30, y: origin.y + 80 }, 100);
  const leg = grow(stubs, { x: origin.x + 30, y: origin.y + 180 }, 250);
  leaves(leg.endpoint, [{ address: at(d.motor, "MOT"), lengthMm: 100 }, { address: at(d.enc, "J1"), lengthMm: 100 }], { x: origin.x, y: origin.y + 260 });
  breakoutSpec(stubs, "y-boot");
  breakoutSpec(leg.endpoint, "y-boot");
  anchor(leg.segment, `Drive corner ${d.tag} harness`);
  sheath([leg.segment], "heatshrink-12mm");
});

// 24 V harness from the DC/DC to the four 24 V loads.
{
  const b = fan([1, 2, 3, 4].map((n) => at(dcdc, `OUT${n}`)), { x: 1900, y: 300 }, { x: 1990, y: 380 }, 80);
  breakoutSpec(b, "heatshrink-transition");
  const p1 = grow(b, { x: 1990, y: 480 }, 300);
  const b2 = grow(p1.endpoint, { x: 1990, y: 580 }, 200);
  breakoutSpec(b2.endpoint, "tape-transition");
  leaves(
    b2.endpoint,
    [
      { address: at(kinova, "PWR"), lengthMm: 600 },
      { address: at(hub, "PWR"), lengthMm: 700 },
      { address: at(jetson, "PWR"), lengthMm: 500 },
      { address: at(joystick, "PWR"), lengthMm: 900 },
    ],
    { x: 1900, y: 660 },
  );
  anchor(p1.segment, "24 V harness");
  sheath([p1.segment, b2.segment], "braid-6mm");
  tie(p1.segment, "zip-tie-100mm", 150);
}

// Check, report, write ----------------------------------------------------------------

const t = p.topologies.get(top)!;
const findings = runChecks(p, t);
const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");
for (const f of errors) console.error(`error   ${f.check} ${f.target}: ${f.message}`);
for (const f of warnings) console.log(`warning ${f.check} ${f.target}: ${f.message}`);
if (errors.length) throw new Error(`${errors.length} design rule errors`);

const bom = buildBom(p, t);
const byKind = new Map<string, number>();
for (const r of bom.cutList) byKind.set(r.row, (byKind.get(r.row) ?? 0) + 1);
console.log(`components ${p.components.size}, nets ${[...p.nets.values()].reduce((n, l) => n + l.length, 0)}, endpoints ${t.endpoints.length}, segments ${t.segments.length}`);
console.log(`cut list rows ${bom.cutList.length}, summary rows ${bom.summary.length}`);
for (const [kind, n] of [...byKind].sort()) console.log(`  ${kind}: ${n}`);

mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT)) if (name !== "README.md") rmSync(join(OUT, name), { recursive: true });
const files = saveProject(p);
for (const [path, text] of files) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}
console.log(`wrote ${files.size} files under ${OUT}`);
