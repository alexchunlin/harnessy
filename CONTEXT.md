# Harnessy

A tool for designing the wire harnesses of a machine. It sits between a schematic tool (rigorous connectivity) and a diagramming tool (freeform canvas), and its output is harnesses you can build, wrap, and place in CAD.

## Language

### Things on the machine

**Component**:
A physical device with one or more connectors. A motor driver, a compute board, a bus bar, a battery.
_Avoid_: Node, box, part, device

**Connector**:
A pluggable interface on a component, identified by its type (JST-GH-6, M12 D-coded, ring terminal). Holds pins. The library entry for a connector names its mating part, which is the half the harness carries and the BOM lists.
_Avoid_: Port, plug, socket

**Pin**:
One electrical contact within a connector. Nets attach to connectors, not pins; pin assignment is a later refinement.
_Avoid_: Terminal, contact

### Logical connectivity

**Net**:
A logical electrical connection between two or more connectors, independent of how it is wired. Belongs to exactly one domain. A connector can terminate several nets from different domains.
_Avoid_: Signal, link, edge, connection

**Domain**:
The signal family a net belongs to. Examples on the RAMMP robot: 48 V battery power, 24 V power, UART/CAN, Ethernet, analog, USB, HDMI, SPI, motor phase, encoder ABZ. No catch-all domains; "local" is not a domain.
_Avoid_: Type, category, class, local

**Layer**:
A named set of domains shown together on the connectivity canvas. A "high power" layer might show the 60 V and 48 V domains; the Ethernet layer would not be shown with it. Layers only affect what is visible; they own no data. Components with no net in the active layer stay drawn with dimmed outlines and hidden text.
_Avoid_: View, page, sheet

### Physical realization

**Topology**:
One complete physical arrangement of segments that realizes every net in the project. A project can hold several topologies to compare.
_Avoid_: Routing, layout, plan

**Segment**:
A run of bundled conductors between two endpoints in a topology, with a length in millimetres typed by hand. Segments are undirected. An endpoint is a connector, a breakout, a splice, or a point. A segment flagged as a purchased assembly (a USB, HDMI, or Ethernet patch cable) has a part number and a fixed length, and its two connector ends produce no mating-part BOM rows.
_Avoid_: Branch, leg, cable run

**Endpoint**:
A node in a topology graph that segments end at. Each node stores a drawn position for the topology view. Degree rules: a connector ends exactly one segment, a point exactly two, a breakout three or more, a splice two or more.
_Avoid_: Vertex, junction

**Point**:
An endpoint with no electrical meaning, placed where a bundle turns a corner or passes through a bulkhead so lengths can be measured to it.
_Avoid_: Waypoint, bend

**Breakout**:
An endpoint where a segment splits into two or more segments. May reference a breakout spec (Y-boot, tape, heat-shrink transition) that becomes a BOM row.
_Avoid_: Split, junction, tee

**Group**:
A labelled region on the canvas that components are dragged into, for visual organisation only. A group says nothing about topology or harness membership.
_Avoid_: Assembly, module, subsystem

**Splice**:
An endpoint where the conductors of one or more nets are joined outside a connector. A splice references the nets it joins, one BOM row per net. It never joins two different nets; that would make them one net.
_Avoid_: Join, tap

**Harness**:
One physically connected assembly of segments in a topology, with connectors at its ends. Removing it from the machine removes one connected piece of wiring. A robot has several harnesses.
_Avoid_: Loom, cable assembly, wiring

**Sheath**:
A covering (braided sleeve, spiral wrap, heat shrink) applied over an ordered, contiguous list of segments. Sheaths overlap at breakouts, so a segment can lie under more than one sheath. Cut length is the sum of the covered segments plus an optional per-sheath overlap in millimetres, default zero.
_Avoid_: Sleeving, wrap, jacket (jacket is the cable spec's own outer layer)

**Tie point**:
A location along a segment where the harness is fastened to the machine with a zip tie, P-clip, or adhesive mount. Its position is a distance in millimetres from one named endpoint of the segment. Each tie point is a BOM item.
_Avoid_: Tie-down, anchor, mount

**BOM**:
The list manufacturing builds a harness from: mating connectors, wire and cable by spec and cut length, purchased cables by part number, sheaths by spec and cut length, splices and breakout parts, and tie points by type. Slack and service loops are not modelled in the MVP.
_Avoid_: Parts list, cut list (a cut list is one section of the BOM)

### Specs

**Wire spec**:
A reusable description of a single conductor: gauge, insulation outer diameter, color, ampacity.

**Cable spec**:
A reusable description of a jacketed multi-conductor cable such as Cat6 or a 4-core shielded cable, with its jacket outer diameter and conductor count.
_Avoid_: Wire type, cable type
