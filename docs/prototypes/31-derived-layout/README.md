# Prototype for issue 31: the topology view when the app owns the layout

Throwaway. Lives on the `prototype/31-derived-layout` branch and never lands on `main`.

Run `pnpm dev`, open a project, switch to Topology, and add `?variant=A` to the URL. The bar at the bottom cycles the variants; the left and right arrow keys do the same.

- A, Radial arcs: children spread on an arc facing away from the parent.
- B, Left to right: a tidy tree, root on the left, leaves stacked on the right.
- C, Spine: the longest path lies flat and branches hang off it. No root.

The screenshots here were taken on the RAMMP example by `scripts/prototype-31-shots.mjs` against a dev server on port 5231.
