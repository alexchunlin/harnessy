import type { Domain, Layer } from "./schema";
import { emptyProject, type Project } from "./project";
import type { Library } from "./library";

/** The RAMMP starter domains. Colours follow the Gen 1.5 diagram legend where it has one. */
export const STARTER_DOMAINS: Domain[] = [
  { id: "48v", name: "48 V", color: "#d62728", spec: "wires/awg12-red", conductors: 2 },
  { id: "24v", name: "24 V", color: "#ff7f0e", spec: "wires/awg18-red", conductors: 2 },
  { id: "can", name: "CAN", color: "#2ca02c", spec: "cables/can-twisted-pair-22awg", conductors: 1 },
  { id: "ethernet", name: "Ethernet", color: "#1f77b4", spec: "cables/cat6-utp-24awg", conductors: 1 },
  { id: "analog", name: "Analog", color: "#9467bd", spec: "wires/awg22-white", conductors: 2 },
  { id: "motor-phase", name: "Motor phase", color: "#8c564b", spec: "wires/awg14-black", conductors: 3 },
  { id: "encoder-abz", name: "Encoder ABZ", color: "#e377c2", spec: "cables/shielded-6c-24awg", conductors: 1 },
  { id: "spi", name: "SPI", color: "#7f7f7f", spec: "wires/awg26-yellow", conductors: 4 },
  { id: "pwm", name: "PWM", color: "#bcbd22", spec: "wires/awg24-blue", conductors: 3 },
  { id: "digital-io", name: "Digital I/O", color: "#17becf", spec: "wires/awg24-green", conductors: 2 },
  { id: "usb", name: "USB", color: "#393b79", spec: "cables/usb-a-c-2m", conductors: 1 },
  { id: "hdmi", name: "HDMI", color: "#637939", spec: "cables/hdmi-2m", conductors: 1 },
  { id: "gmsl", name: "GMSL", color: "#8c6d31", spec: "cables/fakra-coax", conductors: 1 },
];

export const STARTER_LAYERS: Layer[] = [
  { id: "power", name: "Power", domains: ["48v", "24v", "motor-phase"] },
  { id: "signals", name: "Signals", domains: ["can", "ethernet", "spi", "encoder-abz", "pwm", "analog", "digital-io"] },
  { id: "compute-peripherals", name: "Compute peripherals", domains: ["usb", "hdmi", "gmsl"] },
];

/** A fresh project with the starter domains and layers and one empty topology-less canvas. */
export function starterProject(name: string, repoLibrary?: Library): Project {
  const p = emptyProject(name, repoLibrary);
  p.file = { ...p.file, domains: STARTER_DOMAINS, layers: STARTER_LAYERS };
  for (const d of STARTER_DOMAINS) p.nets.set(d.id, []);
  return p;
}
