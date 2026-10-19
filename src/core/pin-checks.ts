import type { Net, Topology } from "./schema";
import { allNets, connectorLabel, netPins, resolveConnector, type Project } from "./project";
import { resolveRef } from "./library";
import { formatNetAddress } from "./refs";
import { buildGraph, isBuilt, netLabeller, routeOf, type Graph } from "./derive";

type AddPinFinding = (check: "pin-duplicate" | "pin-out-of-range" | "pin-missing", target: string, message: string) => void;

/**
 * The pin checks. Two conductors on one pin of one connector, counted over
 * every net that terminates it, is an error. So is a pin above the
 * connector type's count. A conductor with no pin is a warning, one per
 * connector row of a net, unless the net runs only over purchased
 * assemblies in the active topology.
 */
export function checkPins(project: Project, topology: Topology | undefined, add: AddPinFinding): void {
  const label = netLabeller(project);
  const graph = topology ? buildGraph(topology) : undefined;
  // address -> pin -> the conductors that land on it
  const onPin = new Map<string, Map<number, string[]>>();

  for (const { net, domain } of allNets(project)) {
    const asks = asksForPinsOn(graph, net, domain);
    for (const address of net.connectors) {
      const pins = netPins(project, net, domain, address);
      const row = `${label(net)} at ${connectorLabel(project, address)}`;
      const type = connectorType(project, address);
      if (type) {
        const over = pins.flatMap((pin, i) => (pin !== null && pin > type.pins ? [`pin ${pin} (conductor ${i + 1})`] : []));
        if (over.length > 0) add("pin-out-of-range", formatNetAddress(net.id, address), `${row}: ${over.join(", ")} ${over.length === 1 ? "is" : "are"} above the ${type.pins} pins of ${type.name}`);
      }
      const open = pins.flatMap((pin, i) => (pin === null ? [i + 1] : []));
      if (asks && open.length > 0) add("pin-missing", formatNetAddress(net.id, address), `${row}: conductor${open.length === 1 ? "" : "s"} ${open.join(", ")} ${open.length === 1 ? "has" : "have"} no pin`);
      pins.forEach((pin, i) => {
        if (pin === null) return;
        const byPin = onPin.get(address) ?? new Map<number, string[]>();
        onPin.set(address, byPin);
        byPin.set(pin, [...(byPin.get(pin) ?? []), `${label(net)} conductor ${i + 1}`]);
      });
    }
  }

  for (const [address, byPin] of onPin) {
    for (const [pin, conductors] of byPin) {
      if (conductors.length > 1) add("pin-duplicate", address, `${connectorLabel(project, address)} pin ${pin} carries ${conductors.join(" and ")}`);
    }
  }
}

/**
 * Whether a net asks for pins. A net whose route in the topology runs only
 * over purchased assemblies does not: a moulded cable has its pinout built
 * in. Without a topology, or before the net is routed, every net asks.
 */
export function asksForPins(topology: Topology | undefined, net: Net, domain: string): boolean {
  return asksForPinsOn(topology ? buildGraph(topology) : undefined, net, domain);
}

function asksForPinsOn(graph: Graph | undefined, net: Net, domain: string): boolean {
  if (!graph) return true;
  const segments = [...routeOf(graph, net, domain).segments].map((id) => graph.segments.get(id));
  return segments.length === 0 || segments.some((s) => !s || isBuilt(s));
}

/** The connector type at an address, or undefined where it does not resolve (dangling-reference reports that). */
function connectorType(project: Project, address: string) {
  const r = resolveConnector(project, address);
  return "error" in r ? undefined : resolveRef(project.library, r.connector.connector, "connectors");
}
