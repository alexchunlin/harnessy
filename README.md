# Harnessy

Good wire harnesses are as difficult to find as the Loch Ness monster. Harnessy is here to change that.

Harnessy is a browser app for designing the wire harnesses of a machine. It sits between a schematic tool and a diagramming tool: a connectivity canvas with layers, a topology view with hand-typed segment lengths, design rule checks, and a BOM export manufacturing can build from. `CONTEXT.md` is the glossary and `DESIGN.md` the shape of the thing.

## Run it

```
pnpm install
pnpm dev
```

Open the printed URL. The folder browser starts at your home folder; set `HARNESSY_HOME=/some/path` to start elsewhere. Pick a folder with a `project.json` to open it, or any other folder to create a project there. The example project is `examples/rammp-gen1.5`.

Every browser works. The Vite dev server does the file access through a small plugin, so nothing depends on the Chromium-only File System Access API. The plugin reads and writes only inside folders you open in a session plus the repo `library/`.

## Project folder

```
project.json                schema version, name, domains, layers, keep_apart
components/<cmp-id>.json    one file per component
nets/<domain-id>.json       that domain's nets
topologies/<top-id>.json    endpoints, segments, sheaths, tie points, harness anchors
canvas/connectivity.json    component positions, hubs, groups, notes
canvas/<top-id>.json        endpoint positions for one topology
drc.json                    silenced warnings
library/                    mirrors the repo library; a file with the same path shadows the repo one
```

One serializer writes every file with fixed key order, id-sorted arrays, and integer millimetres and pixels, so a git diff shows only what you changed. See `docs/adr/`.

## Library

`library/` holds one folder per kind and one JSON file per entry, filename equals id. `schemas/` holds JSON Schema generated from the app's Zod schemas for editor validation. Regenerate with `pnpm schemas`.

## Scripts

```
pnpm test           unit tests over the core and the server plugin
pnpm test:e2e       browser tests against the running app
pnpm typecheck
pnpm schemas        regenerate schemas/ from src/core/schema.ts
pnpm build:library  regenerate library/ from scripts/build-library.ts
pnpm build:example  regenerate examples/rammp-gen1.5 from scripts/build-rammp-example.ts
```
