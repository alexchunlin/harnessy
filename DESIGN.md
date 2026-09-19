# Harnessy direction notes

Decisions from the charting session on 2026-09-17 and 2026-09-18. The glossary is `CONTEXT.md`; open questions live on the wayfinder map in GitHub Issues. This file holds the shape of the thing so a new reader does not have to reconstruct it from tickets.

## Two views over one project

KiCad splits a schematic from a board layout. Harnesses have the same split. The connectivity view answers "which connector talks to which connector, in what domain". The topology view answers "which conductors share a bundle, where it breaks out, how long each segment is". Both read the same project; a component exists once and appears in both.

Layers are a named set of domains and change only what the connectivity canvas shows. Component positions are shared, so switching from the power layer to the Ethernet layer keeps every box where it was. Components with nothing in the active layer keep a dimmed outline and lose their text, like KiCad's dimmed inactive layers.

A net in the MVP connects connectors, not pins. Pin assignment is a later refinement, and the design rule check will list nets that lack it once it exists. A connector can carry several nets from different domains, which is how PoE on an RJ45 and SPI plus 3.3 V on a JST-SH are represented: two nets between the same two connectors.

## Topology and the BOM

The destination of the first map is a manufacturing BOM: connectors, wire and cable by spec and cut length, sheaths by spec and length, tie points by type. That needs the topology view, so the MVP includes a minimal one: segments with hand-typed lengths, breakouts, sheaths that cover a path of segments, and tie points. Lengths come from the team laying out yarn and rope on the robot, measuring, and typing the numbers in. No bundle volume checks and no 3D in this map.

A topology graph is a forest. A net's route is the unique subtree reaching its connectors, derived on demand and stored nowhere. Two-connector nets need no choice at all. A net with three or more connectors branches only at a splice; a branch point with no splice for that net is a design rule error. RAMMP Gen 1.5 has no such net: the CAN bus daisy-chains between the motor controllers and the MIB with purchased patch cables, so each hop is its own two-connector net, and UART is dropped.

A harness is whatever stays connected when you lift it off the machine: one connected piece of the topology graph, ending at connectors. Membership is derived, like routes. A name is stored on one segment of the piece as an anchor, with an optional part number. Splitting a harness leaves the piece without the anchor unnamed, which is a warning; joining two named harnesses puts two anchors in one piece, which is an error until one is dropped. Nothing is renamed or reassigned silently. A piece made only of a purchased assembly (a patch cable) is not a harness and the BOM lists it under purchased cables. A sheath cannot span two harnesses, because two bundles under one sleeve come off together and so share a segment.

## Stack and files

Browser app: Vite, React, TypeScript, React Flow for the canvas, Zustand for the document store. Engineers clone the repo and run it locally; review happens over screen share. Only Chromium can write to a local folder from page JavaScript, so a Vite server plugin does the file access instead and every browser gets it. A project is any folder on disk, opened through an in-app folder browser the plugin serves. The plugin only touches folders opened in the session plus the repo library.

A project folder holds `project.json` (schema version, name, domains, layers), one file per component under `components/`, one file per domain under `nets/` listing that domain's nets, one file per topology under `topologies/`, and every drawn position under `canvas/` so no model file carries layout. A project `library/` mirrors the repo library and a file with the same id shadows the repo one whole. Ids are generated, never typed and never renumbered: a three-letter type prefix and six unambiguous lowercase characters, `cmp-k3f9qa`, with connectors addressed by their designator as `cmp-k3f9qa/CAN-A`. Domains and layers are typed slugs because they name files. A file's name is its id and never changes on rename. One serializer writes every file with fixed key order, id-sorted arrays, and integer lengths and positions, so diffs show only what the user changed. Active layer, viewport, and selection live in browser localStorage. ADR-0001 records the trade-offs.

## Library

The repo carries a library, and a project `library/` mirrors it: one folder per kind (`components`, `connectors`, `wires`, `cables`, `sheaths`, `breakouts`, `splices`, `ties`, `assemblies`), one file per entry, filename equals id. A project file at the same path shadows the repo file whole. Library ids are typed slugs (`jst-gh-6`, `xt60`) rather than generated, because the part is the natural key and a readable catalogue tree matters for hand editing. Every reference to a library entry is spelled `<folder>/<id>`, so a domain default or a net override can name either a wire or a cable. A library component is a component definition whose connectors carry designators; a project component references one live, or declares connectors inline for a one-off. Removing a designator a net still uses leaves a dangling reference for the design rule check to list. Zod schemas in the app define every file, and generated JSON Schema is checked in for editor validation. ADR-0002 records the id split.

## BOM export

One export per topology, downloaded as two CSV files. The cut list has one row per physical piece: housing and contacts per connector end, one wire row per conductor per leg (a spliced net has a leg per connector), one cable row per net, sheaths with their overlap, tie points with segment and distance, splices per net joined, breakouts, and purchased assemblies. Every row carries the harness, so builders filter and buyers sum. The summary aggregates by library reference. No slack allowance; rope-mockup lengths carry their own margin. Export is refused while the topology has design rule errors.

## Design rule checks

Checks run continuously and show in a KiCad-style panel. Errors are anything that would make the BOM wrong: unrouted or single-connector nets, a route branching without a splice, broken endpoint degree rules, missing lengths, sheath gaps or sheaths across two harnesses, two harness anchors in one piece, dangling references. Warnings cover idle connectors and components, an unnamed harness, a tie point past its segment, two domains from the project's optional `keep_apart` list sharing a segment, and a net with no spec. Warnings can be silenced per item in `drc.json`; errors cannot.

## Interaction

Connectivity canvas: library panel, canvas, inspector. Drag a definition from the library to place a component; drag from one connector handle to another to draw a net, choosing its domain on drop. A net with three or more connectors draws as a star around a net hub. Layers hide edges of other domains and dim components with nothing in the layer. Groups wrap a selection and take members by drag. Session undo and autosave.

Topology view: one topology at a time. A tray lists connectors not yet placed; drag to place. Drag from an endpoint to empty canvas to grow a point, which becomes a breakout at three segments or a splice on request. Lengths are typed inline. Shift-click a chain of segments to apply a sheath, drop tie points on a segment and drag them along it, name a harness from any of its segments. Selecting a net highlights its route.

These two models were decided on paper rather than prototyped, at Alex's request. The first working build is where the feel gets checked.

## Test case

RAMMP Gen 1.5. Roughly 45 components across thirteen domains: 48 V, 24 V, CAN, Ethernet, analog, motor phase, encoder ABZ, SPI, PWM, digital I/O, USB, HDMI, and GMSL. The default layers are Power (48 V, 24 V, motor phase), Signals (CAN, Ethernet, SPI, encoder ABZ, PWM, analog, digital I/O), Compute peripherals (USB, HDMI, GMSL), and a built-in All. The current diagram (`docs/reference/rammp-gen1.5-diagram.png`) is the picture to reproduce, with two corrections: the finished robot has six fisheye cameras on GMSL rather than four on USB, and four encoders are PWM rather than SPI. The diagram's "local" colour splits into motor phase, encoder ABZ, SPI, digital I/O, USB, and HDMI. PoE is not modelled; every Ethernet run is a purchased patch cable.

## Ruled out for now

Onshape export (a future plugin will take segment endpoints and tie points as coordinates), SVG or PDF export for review, KiCad netlist import, volumetric bundle checks, and 3D routing. Deferred past the MVP: pin-level assignment, collapsing groups, CAD length import, PoE port budgets, wire sizing help, persistent undo and multi-user editing.

## Prior art

WireViz has a minimal YAML data model for connectors, cables, and connections worth matching for export. KiCad's layer and DRC panels are the interaction model to copy. Obsidian Canvas has the feel we want for the connectivity view.
