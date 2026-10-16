# Harnessy

A tool for designing the wire harnesses of a machine. It sits between a schematic tool (rigorous connectivity) and a diagramming tool (freeform canvas), and its output is harnesses you can build, wrap, and place in CAD.

## Language

### Things on the machine

**Component**:
A physical device on the machine with one or more connectors. A motor driver, a compute board, a bus bar, a battery. Usually an instance of a component definition from the library; a one-off may declare its connectors itself instead.
_Avoid_: Node, box, part, device, instance

**Component definition**:
A library entry describing a kind of device: its name, part number, and connectors, each with a designator such as `J1` or `CAN-A`. Many components in a project can share one definition, and editing it changes all of them. A definition may list bridges, groups of its connectors that the device joins inside itself.
_Avoid_: Component type, part, template

**Connector**:
A pluggable interface on a component, known by its designator (`J1`, `CAN-A`) and its connector type. Holds pins, as many as the type counts.
_Avoid_: Port, plug, socket

**Connector type**:
A library entry for a kind of connector (JST-GH-6, M12 D-coded, ring terminal): pin count and the mating part, which is the half the harness carries and the BOM lists, and the strain relief the harness must give it.
_Avoid_: Connector spec, housing

**Designator**:
The name a component definition gives one of its connectors, as printed on the board or in its datasheet. Unique within the definition.
_Avoid_: Slot, port name

**Pin**:
One cavity of a connector, numbered from one to its connector type's pin count. A conductor lands on one pin at each connector of its net, and a pin holds at most one conductor across every net that connector terminates. A splice and a bridge have no pins. The connectivity canvas draws connectors, not pins; pins are read and set in the net inspector.
_Avoid_: Terminal, contact, cavity (as a term of its own), end (reserved for the topology)

### Logical connectivity

**Net**:
A logical electrical connection between two or more connectors, independent of how it is wired. Belongs to exactly one domain and takes that domain's conductors unless it overrides them, either as one spec with a count or as one spec per conductor. A connector can terminate several nets from different domains. A bus daisy-chained with patch cables is a chain of two-connector nets, one per cable. Nets that a bridge joins form a bus and stay separate nets.
_Avoid_: Signal, link, edge, connection

**Conductor**:
One wire of a net, or one core of a net's cable, counted from one. A net's conductors are the list of specs it resolves to, so each has its own colour and part number. A conductor is addressed as its net's id and its number, derived and never stored. On the topology view the conductors of a bundle fan out as coloured strands near each end of a segment.
_Avoid_: Core (for a loose wire), strand (a strand is the drawing of a conductor, not the thing), lead

**Domain**:
The signal family a net belongs to. The RAMMP starter set: 48 V, 24 V, CAN, Ethernet, analog, motor phase, encoder ABZ, SPI, PWM, digital I/O, USB, HDMI, GMSL. A sensor rail is not a domain; the signal domain's default cable carries it. A domain names its default conductors, either one wire or cable spec with a count or one spec per conductor, which a net can override. No catch-all domains; "local" is not a domain.
_Avoid_: Type, category, class, local

**Bridge**:
A group of a component definition's connectors that the device joins inside itself: the lugs of a bus bar, the IN and OUT of an in-line switch, the CAN-A and CAN-B of a board that passes CAN through. A designator sits in at most one bridge. A bridge joins nets into a bus. It never makes them one net, because the device does the joining rather than the harness. A one-off component that declares its own connectors may declare bridges the same way.
_Avoid_: Jumper, internal connection, common, bonded

**Bus**:
The set of nets joined through bridges, derived and never stored. A bus exists only where a bridge joins two or more nets, and it stays within one domain; a bridge that joins nets from two domains is a design rule error. One member net may carry the bus's name, and two names on one bus is an error. An unnamed bus is labelled from its domain and its largest bridging component, as in "48 V bus via Bus bar". A power bus is called a rail in conversation. A bus says nothing about routes, harnesses, or the BOM: each member net still routes and is cut on its own.
_Avoid_: Rail (in the model), node, supernet

**Layer**:
A named set of domains shown together on the connectivity canvas. A "Power" layer might show the 48 V, 24 V, and motor phase domains; the Ethernet domain would not be shown with it. A domain may sit in several layers. The "All" layer is built in and cannot be deleted. Layers only affect what is visible; they own no data. Components and nets outside the active layer stay drawn, greyed and darker, and cannot be selected, dragged, or connected until the layer changes.
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

**Bend**:
A hand-placed corner on the line a net is drawn with on the connectivity canvas. A net with no bends draws itself with right-angle corners from its pins' sides; steering a line stores its bends, and resetting them forgets them. Visual only, kept with the canvas.
_Avoid_: Waypoint, route (a route is a topology term)

**Note**:
A text annotation on the canvas, optionally attached to one component or one net. Visual only; it changes nothing about connectivity or the BOM.
_Avoid_: Comment, annotation, label

**Side by side**:
The view that shows the connectivity canvas on the left and the topology view on the right, each with its own viewport and one shared selection: a net or component picked on one side lights its counterpart on the other. A draggable divider sets the share of the width, and the browser remembers it.
_Avoid_: Split, split view, dual pane

**Route**:
The set of segments a net's conductors run through in a topology: the smallest subtree that reaches all of the net's connectors. A route is derived from the topology graph and never stored. Where a route branches there must be a splice for that net.
_Avoid_: Path, routing, assignment

**Ratsnest**:
The thin straight lines the topology canvas draws between the placed connectors of a net that is not yet routed, one chain through them in the net's domain colour. Derived from the routes and never stored; a line goes as soon as its net's route closes.
_Avoid_: Airwire, rubber band

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
A location along a segment where the harness is fastened to the machine. Its position is a distance in millimetres from one named endpoint of the segment, and it references a tie spec. Each tie point is a BOM item. A tie point bounds a stretch, and it carries the slack of the stretch on its first-end side.
_Avoid_: Tie-down, anchor, mount

**Stretch**:
A run of one segment between consecutive bounds, where a bound is an endpoint of the segment or a tie point on it. A segment with no tie points is one stretch. Derived from the tie points in order and never stored. Each stretch has a slack.
_Avoid_: Span, section, interval

**Slack**:
Extra conductor length added to a stretch beyond its routed length, in millimetres, so the harness can be fitted and dressed. A stretch without its own slack takes its harness's default, else the project's, which starts at zero. A purchased assembly has no slack. Slack is never negative.
_Avoid_: Buffer, allowance, margin, service loop (a service loop is one reason for slack, not the thing)

**Minimum bend radius**:
The tightest curve a conductor may be bent to without damage, in millimetres, declared on a wire spec, a cable spec, and optionally a sheath spec. A bundle's minimum bend radius is the largest of its conductors' and its sheaths', since a bundle bends no tighter than its stiffest member. The design rule check measures the curve the 3D view draws for a bundle, through its tie points and straight through any point endpoints, and warns where that curve bends tighter than the bundle allows. A breakout or splice ends the measured curve. A spec with no radius, or a bundle with no 3D placement, is not checked.
_Avoid_: Bend limit, min radius, curvature (curvature is the measured value, not the declared one)

**Strain relief**:
The straight length a bundle must run out of a connector before it may bend, in millimetres, declared on the connector type. The 3D view draws it as a straight stub and the bend radius check begins where it ends. A connector type with none draws no stub.
_Avoid_: Stub (the drawing, not the thing), exit length, boot

**Design rule check**:
A check the app runs continuously over the project and the active topology. An error means the BOM would be wrong and blocks export; a warning can be silenced per item.
_Avoid_: Lint, validation

**BOM**:
The list manufacturing builds a harness from: mating connectors, wire and cable by spec and cut length, purchased cables by part number, sheaths by spec and cut length, splices and breakout parts, and tie points by type. A cut length is the routed length plus the slack of every stretch the piece crosses, and the row says how much of it is slack.
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
A reusable description of a single conductor: gauge, insulation outer diameter, color, ampacity, and minimum bend radius.

**Cable spec**:
A reusable description of a jacketed multi-conductor cable such as Cat6 or a 4-core shielded cable, with its jacket outer diameter and conductor count. May list one colour per conductor inside the jacket, and a minimum bend radius.
_Avoid_: Wire type, cable type

**Sheath spec**:
A reusable description of a covering: braid, spiral wrap, or heat shrink, with its nominal inside diameter, and an optional minimum bend radius.

**Breakout spec**:
A reusable description of the part fitted at a breakout: a Y-boot, a taped transition, or a heat-shrink transition. Becomes a BOM row when a breakout references it.

**Splice spec**:
A reusable description of how a splice is made: a solder sleeve or a crimp butt splice. Optional on a splice.

**Tie spec**:
A reusable description of a fastener: a zip tie, a P-clip, or an adhesive mount.
