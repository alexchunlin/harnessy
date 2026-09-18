# Harnessy direction notes

Decisions from the charting session on 2026-09-17 and 2026-09-18. The glossary is `CONTEXT.md`; open questions live on the wayfinder map in GitHub Issues. This file holds the shape of the thing so a new reader does not have to reconstruct it from tickets.

## Two views over one project

KiCad splits a schematic from a board layout. Harnesses have the same split. The connectivity view answers "which connector talks to which connector, in what domain". The topology view answers "which conductors share a bundle, where it breaks out, how long each segment is". Both read the same project; a component exists once and appears in both.

Layers are a named set of domains and change only what the connectivity canvas shows. Component positions are shared, so switching from the power layer to the Ethernet layer keeps every box where it was. Components with nothing in the active layer keep a dimmed outline and lose their text, like KiCad's dimmed inactive layers.

A net in the MVP connects connectors, not pins. Pin assignment is a later refinement, and the design rule check will list nets that lack it once it exists. A connector can carry several nets from different domains, which is how PoE on an RJ45 and SPI plus 3.3 V on a JST-SH are represented: two nets between the same two connectors.

## Topology and the BOM

The destination of the first map is a manufacturing BOM: connectors, wire and cable by spec and cut length, sheaths by spec and length, tie points by type. That needs the topology view, so the MVP includes a minimal one: segments with hand-typed lengths, breakouts, sheaths that cover a path of segments, and tie points. Lengths come from the team laying out yarn and rope on the robot, measuring, and typing the numbers in. No bundle volume checks and no 3D in this map.

A harness is whatever stays connected when you lift it off the machine: one connected piece of the topology graph, ending at connectors.

## Stack and files

Browser app: Vite, React, TypeScript, React Flow for the canvas, Zustand for the document store. Engineers clone the repo and run it locally; review happens over screen share. A project is a folder of JSON files, one per component, topology, and canvas, opened through the browser's directory picker. Component, connector, wire, cable, and sheath definitions live in a library folder in this repo and are referenced by id, with per-project overrides.

## Test case

RAMMP Gen 1.5. Roughly 45 components across 48 V power, 24 V power, UART/CAN, Ethernet, USB, HDMI, SPI, analog, motor phase, and encoder ABZ domains. The current diagram (`docs/reference/rammp-gen1.5-diagram.png`) is the picture to reproduce.

## Ruled out for now

Onshape export (a future plugin will take segment endpoints and tie points as coordinates), SVG or PDF export for review, KiCad netlist import, volumetric bundle checks, and 3D routing.

## Prior art

WireViz has a minimal YAML data model for connectors, cables, and connections worth matching for export. KiCad's layer and DRC panels are the interaction model to copy. Obsidian Canvas has the feel we want for the connectivity view.
