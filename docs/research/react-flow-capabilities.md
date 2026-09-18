# React Flow capabilities for the connectivity canvas

Checked against `@xyflow/react` 12.11.6 (npm latest, published 2026-09-01, MIT,
depends on `@xyflow/system` 0.0.82). Sources are reactflow.dev, the xyflow
GitHub repo, and the npm registry. Read on 2026-09-18.

## Verdict

React Flow can carry the canvas. Five of the six needs are covered by documented
API. The one gap is item 1: the library renders several edges between the same
handle pair, but its internal `connectionLookup` keys by handle pair, so only one
of them is visible to the connection hooks, and the maintainers say they do not
support it. We work around it with one custom edge type that fans parallel nets
apart by index, or with one handle per net on the connector. Nothing at 45
components and 120 nets is near any limit the project documents.

## 1. Several nets between one connector pair

The `Edge` type only requires `id` to be unique; `source`, `target`,
`sourceHandle` and `targetHandle` may repeat
(https://reactflow.dev/api-reference/types/edge). `EdgeRenderer` maps over
edge ids from `useVisibleEdgeIds`, so every edge with a distinct id gets drawn
(https://github.com/xyflow/xyflow/blob/main/packages/react/src/container/EdgeRenderer/index.tsx).

The catch is in `@xyflow/system`. `updateConnectionLookup` builds the key
`${source}-${sourceHandle}--${target}-${targetHandle}` and calls
`map.set(key, connection)`, so a second edge on the same handle pair replaces
the first inside `connectionLookup`
(https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/store.ts,
`updateConnectionLookup` and `addConnectionToLookup`). Anything reading that
lookup (`useNodeConnections`, `useHandleConnections`, connection counts) sees
one net. Maintainer moklick, closing issue #5503 as not planned: "We are not
supporting multiple edges between the same handles. You would need to render
multiple handles for this." (https://github.com/xyflow/xyflow/issues/5503).
Maintainer peterkogo in #5451: "We do not support that. a->b = a->b."
(https://github.com/xyflow/xyflow/issues/5451). Box selection of parallel
edges was the bug in #5451; it is closed as completed (2025-08-25).

Rendering without overlap is our job. With the default edge types every
parallel edge takes the same path. Two documented routes:

- One handle per net on the connector node. Custom nodes may declare any
  number of `<Handle>` elements with distinct `id`s
  (https://reactflow.dev/learn/customization/custom-nodes). This is the route
  the maintainers recommend in discussion #2692
  (https://github.com/xyflow/xyflow/discussions/2692).
- One custom edge type that fans siblings apart. `getBezierPath` accepts
  `curvature` (default 0.25) and `getSmoothStepPath` accepts `offset`; the
  built-in `bezier` and `smoothstep` edges expose them as `pathOptions`
  (https://reactflow.dev/api-reference/utils/get-bezier-path,
  https://reactflow.dev/api-reference/types/edge). A custom edge can look up its
  siblings with `useEdges` or from `data`, compute its index, and pass a
  per-edge curvature or hand-built SVG path to `<BaseEdge>`
  (https://reactflow.dev/learn/customization/custom-edges).

Harnessy nets are undirected and connector-level, so the second route keeps
the data model honest and pushes the layout problem into one component. We
should not rely on `useNodeConnections` for net counts; read our own store.

## 2. Stroke width and colour per net

`Edge.style` is a `CSSProperties` object, `Edge.markerEnd` and
`Edge.markerStart` take an `EdgeMarkerType` with `type`, `color`, `width`,
`height`, and `Edge.data` is arbitrary
(https://reactflow.dev/api-reference/types/edge). Custom edge components
receive `data`, `style`, `markerEnd`, `sourceX/Y`, `targetX/Y` and render
`<BaseEdge path style markerEnd>`
(https://reactflow.dev/learn/customization/custom-edges). Domain colour and
gauge-driven width can be set either on `style` when the edge object is built
or derived from `data.domain` inside the edge component. `defaultEdgeOptions`
sets shared defaults (https://reactflow.dev/api-reference/react-flow).

## 3. Dimming a component without unmounting it

`Node.className` and `Node.style` are applied to the wrapper div
(https://reactflow.dev/api-reference/types/node). In `NodeWrapper` the wrapper
gets `className={cc(['react-flow__node', ..., node.className])}` and
`style={{...node.style, ...}}`, and `if (node.hidden) return null` is the only
early exit, so `hidden` unmounts but `className`/`style` do not
(https://github.com/xyflow/xyflow/blob/main/packages/react/src/components/NodeWrapper/index.tsx).
Text hiding is done inside our custom node from a `data.dimmed` flag, or with a
CSS rule on the dim class. `NodeWrapper` is `memo`ised and `NodeRenderer`
subscribes only to the list of visible node ids, so changing one node's
`className` re-renders that wrapper and its custom component, not the others
(https://github.com/xyflow/xyflow/blob/main/packages/react/src/container/NodeRenderer/index.tsx).
Switching layers updates every node object once (they all change class), which
is fine at 45 nodes. `updateNode(id, partial)` and `updateNodeData(id, partial)`
on the instance do the per-node patch
(https://reactflow.dev/api-reference/types/react-flow-instance).

## 4. Labelled groups and dragging components into them

Sub flows: a child sets `parentId`; its `position` is relative to the parent's
top left; `extent: 'parent'` keeps it inside; `expandParent: true` grows the
parent when a child is dragged to its edge; parents must appear before their
children in the `nodes` array; the built-in `group` node type "is just a
convenience node type that has no handles attached"
(https://reactflow.dev/learn/layouting/sub-flows,
https://reactflow.dev/api-reference/types/node). A free labelled group node
exists in the xyflow UI component library, installed with
`npx shadcn@latest add https://ui.reactflow.dev/labeled-group-node`
(https://reactflow.dev/components/nodes/labeled-group-node).

Re-parenting by drag is not a library feature. The sub flows page does not
mention it. The parent-child-relation example that does it ("drag a node over a
group node to attach it as a child") is a Pro example under the xyflow Pro
License (https://reactflow.dev/examples/grouping/parent-child-relation). The
open-source pieces to write it ourselves are `onNodeDragStop`,
`getIntersectingNodes(node, partially?)` and `updateNode`
(https://reactflow.dev/api-reference/react-flow,
https://reactflow.dev/api-reference/types/react-flow-instance). On drop we set
`parentId` and convert the absolute position to parent-relative. Known rough
edges when doing this: `expandParent` on a re-parented node (issue #3340,
https://github.com/xyflow/xyflow/issues/3340) and a request for absolute
positioning inside sub flows (issue #3393,
https://github.com/xyflow/xyflow/issues/3393). Groups are visual only in the
glossary, so a short handler on drag stop is acceptable.

## 5. Performance at 45 components and 120 nets

The performance guide names no node or edge limit. Its tips: memoise or hoist
custom node and edge components and `nodeTypes`/`edgeTypes`, wrap handlers in
`useCallback` and objects like `defaultEdgeOptions` in `useMemo`, avoid reading
the whole `nodes` array inside a node component, collapse large trees with
`hidden`, and keep node and edge styles free of shadows and animations
(https://reactflow.dev/learn/advanced-use/performance). The
`onlyRenderVisibleElements` prop culls offscreen nodes and edges
(https://reactflow.dev/api-reference/react-flow). The site's stress example
renders a 10 by 10 grid, 100 nodes and 90 edges, as its demonstration
(https://reactflow.dev/examples/nodes/stress). Our canvas is smaller than the
demo. The one thing to watch is item 3: a layer switch touches all 45 node
objects at once, so build the dim class from a stable data field rather than
allocating new `style` objects per render.

## 6. Licence and pricing

The library is MIT, copyright 2019-2025 webkid GmbH
(https://github.com/xyflow/xyflow/blob/main/LICENSE). The README: "React Flow
and Svelte Flow are MIT licensed" and organisations making money with it are
asked, not required, to sponsor
(https://github.com/xyflow/xyflow/blob/main/README.md). The rendered canvas
carries a small "React Flow" attribution link; the docs say "Subscribing to
React Flow Pro permits you to remove the attribution from your flows"
(https://reactflow.dev/learn/troubleshooting/remove-attribution). Pro is a
subscription for that removal, the Pro examples and support, listed at Starter
169 USD/month and up on the same page. The MIT licence itself does not require
the attribution, so keeping it is the polite default and costs nothing.
