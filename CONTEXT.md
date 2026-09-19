# Harnessy

A tool for designing the wire harnesses of a machine. It sits between a schematic tool (rigorous connectivity) and a diagramming tool (freeform canvas), and its output is harnesses you can build, wrap, and place in CAD.

## Language

### Things on the machine

**Component**:
A physical device on the machine with one or more connectors. A motor driver, a compute board, a bus bar, a battery. Usually an instance of a component definition from the library; a one-off may declare its connectors itself instead.
_Avoid_: Node, box, part, device, instance

**Component definition**:
A library entry describing a kind of device: its name, part number, and connectors, each with a designator such as `J1` or `CAN-A`. Many components in a project can share one definition, and editing it changes all of them.
_Avoid_: Component type, part, template

**Connector**:
A pluggable interface on a component, known by its designator (`J1`, `CAN-A`) and its connector type. Holds pins.
_Avoid_: Port, plug, socket

**Connector type**:
A library entry for a kind of connector (JST-GH-6, M12 D-coded, ring terminal): pin count and the mating part, which is the half the harness carries and the BOM lists.
_Avoid_: Connector spec, housing

**Designator**:
The name a component definition gives one of its connectors, as printed on the board or in its datasheet. Unique within the definition.
_Avoid_: Slot, port name

**Pin**:
One electrical contact within a connector. Nets attach to connectors, not pins; pin assignment is a later refinement.
_Avoid_: Terminal, contact

### Logical connectivity

**Net**:
A logical electrical connection between two or more connectors, independent of how it is wired. Belongs to exactly one domain and takes that domain's wire or cable spec unless it overrides it. A connector can terminate several nets from different domains. A bus daisy-chained with patch cables is a chain of two-connector nets, one per cable.
_Avoid_: Signal, link, edge, connection

**Domain**:
The signal family a net belongs to. The RAMMP starter set: 48 V, 24 V, CAN, Ethernet, analog, motor phase, encoder ABZ, SPI, PWM, digital I/O, USB, HDMI, GMSL. A sensor rail is not a domain; the signal domain's default cable carries it. A domain names a default wire or cable spec and conductor count, which a net can override. No catch-all domains; "local" is not a domain.
_Avoid_: Type, category, class, local

**Layer**:
A named set of domains shown together on the connectivity canvas. A "Power" layer might show the 48 V, 24 V, and motor phase domains; the Ethernet domain would not be shown with it. A domain may sit in several layers. The "All" layer is built in and cannot be deleted. Layers only affect what is visible; they own no data. Components with no net in the active layer stay drawn with dimmed outlines and hidden text.
_Avoid_: View, page, sheet

### Physical realization

**Topology**:
One complete physical arrangement of segments that realizes every net in the project. A project can hold several topologies to compare.
_Avoid_: Routing, layout, plan

**Segment**:
A run of bundled conductors between two endpoints in a topology, with a length in millimetres typed by hand. Segments are undirected and never form a cycle. An endpoint is a connector, a breakout, a splice, or a point. A segment flagged as a purchased assembly (a USB, HDMI, or Ethernet patch cable) has a part number and a fixed length, and its two connector ends produce no mating-part BOM rows.
_Avoid_: Branch, leg, cable run

**Purchased assembly**:
A segment bought finished rather than built: a USB, HDMI, Ethernet, or CAN patch cable with a part number and a fixed length. It runs connector to connector, so it is always its own piece of the graph and never part of a harness.
_Avoid_: Off-the-shelf cable, pre-made

**Endpoint**:
A node in a topology graph that segments end at. Each node has a drawn position on the topology canvas, kept with the canvas rather than the model. Degree rules: a connector ends exactly one segment, a point exactly two, a breakout three or more, a splice two or more.
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

**Net hub**:
The small dot on the connectivity canvas that a net with three or more connectors is drawn around, one edge per connector. Visual only; a two-connector net has none.
_Avoid_: Junction, node

**Note**:
A text annotation on the canvas, optionally attached to one component or one net. Visual only; it changes nothing about connectivity or the BOM.
_Avoid_: Comment, annotation, label

**Route**:
The set of segments a net's conductors run through in a topology: the smallest subtree that reaches all of the net's connectors. A route is derived from the topology graph and never stored. Where a route branches there must be a splice for that net.
_Avoid_: Path, routing, assignment

**Splice**:
An endpoint where the conductors of one or more nets are joined outside a connector. A splice references the nets it joins, one BOM row per net. It never joins two different nets; that would make them one net.
_Avoid_: Join, tap

**Harness**:
One connected piece of a topology graph that contains at least one built segment, with connectors at its ends. Removing it from the machine removes one connected piece of wiring. Membership is derived from the graph; the user names a harness by anchoring the name to one of its segments, and may give it a part number. A piece made only of a purchased assembly is a purchased cable, not a harness. A robot has several harnesses.
_Avoid_: Loom, cable assembly, wiring

**Sheath**:
A covering (braided sleeve, spiral wrap, heat shrink) applied over an ordered, contiguous list of segments. Sheaths overlap at breakouts, so a segment can lie under more than one sheath. Cut length is the sum of the covered segments plus an optional per-sheath overlap in millimetres, default zero.
_Avoid_: Sleeving, wrap, jacket (jacket is the cable spec's own outer layer)

**Tie point**:
A location along a segment where the harness is fastened to the machine. Its position is a distance in millimetres from one named endpoint of the segment, and it references a tie spec. Each tie point is a BOM item.
_Avoid_: Tie-down, anchor, mount

**Design rule check**:
A check the app runs continuously over the project and the active topology. An error means the BOM would be wrong and blocks export; a warning can be silenced per item.
_Avoid_: Lint, validation

**BOM**:
The list manufacturing builds a harness from: mating connectors, wire and cable by spec and cut length, purchased cables by part number, sheaths by spec and cut length, splices and breakout parts, and tie points by type. Slack and service loops are not modelled in the MVP.
_Avoid_: Parts list, cut list (a cut list is one section of the BOM)

### Project and library

**Project**:
One machine's harness design: its components, nets, domains, layers, topologies, and canvases. A project references library entries by id and may shadow any of them with its own copy.
_Avoid_: Document, workspace, file

**Library**:
The shared catalogue of component definitions, connector types, wire, cable, sheath, breakout, splice, and tie specs, and purchased assemblies that projects reference by id. A project's own copy of an entry, under the same id, replaces the shared one whole.
_Avoid_: Catalogue, parts database

### Specs

**Wire spec**:
A reusable description of a single conductor: gauge, insulation outer diameter, color, ampacity.

**Cable spec**:
A reusable description of a jacketed multi-conductor cable such as Cat6 or a 4-core shielded cable, with its jacket outer diameter and conductor count.
_Avoid_: Wire type, cable type

**Sheath spec**:
A reusable description of a covering: braid, spiral wrap, or heat shrink, with its nominal inside diameter.

**Breakout spec**:
A reusable description of the part fitted at a breakout: a Y-boot, a taped transition, or a heat-shrink transition. Becomes a BOM row when a breakout references it.

**Splice spec**:
A reusable description of how a splice is made: a solder sleeve or a crimp butt splice. Optional on a splice.

**Tie spec**:
A reusable description of a fastener: a zip tie, a P-clip, or an adhesive mount.
