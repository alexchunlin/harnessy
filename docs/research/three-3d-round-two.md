# What three.js, drei and occt-import-js give the 3D round

Research for issue #36. Checked on 2026-10-09 against the versions pnpm has
installed in this checkout: three 0.186.1 (r186), @react-three/fiber 9.8.1,
@react-three/drei 10.7.9, occt-import-js 0.0.23. drei brings three-stdlib
2.36.1, camera-controls 3.1.2, three-mesh-bvh 0.8.3 and @use-gesture/react
10.3.1 with it; only drei's own exports of those are reachable from app code.
Sources are the installed files under `node_modules`, the r186 tree and docs
at threejs.org, the r3f and drei docs, the occt-import-js repo, and the GitHub
pull requests cited inline.

Where the text says "today" it means `src/ui/harness3d/scene.tsx`,
`Workspace3D.tsx` and `reference.ts` on main at 22b529f.

## Verdict

Four items are documented API that we switch on or call: the raycast hit
with a usable normal (1), zoom toward the cursor (7), turning the reference
model (8) and tubes along a curve (6, apart from the curvature number, which
we compute). Two are half covered: STEP in a worker (2) because the library
ships a classic worker but we must write the Vite module worker and the
typed-array transfer, and orthographic views (3) because drei swaps cameras
and the view cube takes an `onClick`, but matching the frustum and switching
back on orbit is ours. Two are hand-written on public hooks: group transforms
(4), where `TransformControls` holds one object and the delta is ours to
apply, and the hold-R gesture (5), which nothing in drei does.

One fact changes how we read the rest. drei's `OrbitControls`,
`TransformControls`, `ArcballControls` and `Line` wrap `three-stdlib`, not
`three/examples/jsm`
(https://github.com/pmndrs/drei/blob/master/src/core/OrbitControls.tsx,
`import { OrbitControls as OrbitControlsImpl } from 'three-stdlib'`). So the
r169 change where `TransformControls` stopped being an `Object3D` and needs
`scene.add(controls.getHelper())`
(https://github.com/mrdoob/three.js/wiki/Migration-Guide, r168 to r169) does
not reach us, and features land for us when three-stdlib has them, not when
three does.

## 1. Snapping to the reference model

Documented. `Raycaster.setFromCamera(ndc, camera)` and
`intersectObject(object, recursive)` return hits sorted by distance with
`point` (world space), `face` (`a`, `b`, `c`, `normal`), `faceIndex`,
`object`, `barycoord` and, when the geometry has a `normal` attribute, an
interpolated `normal` (https://threejs.org/docs/#api/en/core/Raycaster,
`src/objects/Mesh.js` `checkGeometryIntersection`). `face.normal` is the flat
triangle normal; `normal` is the smooth vertex normal, flipped to face the
ray. Both are in the mesh's object space. `Intersection.normal` arrived in
r151 (https://github.com/mrdoob/three.js/pull/25566). To use either in world
space: `new Matrix3().getNormalMatrix(mesh.matrixWorld)` then
`normal.applyMatrix3(m).normalize()`, or `transformDirection(matrixWorld)`
when the scale is uniform, which ours is (the reference group scales by one
unit factor).

react-three-fiber spreads the hit onto the event, so an `onPointerMove` or
`onClick` on the `<primitive object={reference.object}>` receives `e.point`,
`e.face`, `e.normal`, `e.faceIndex`, `e.object` (the child mesh hit) and
`e.eventObject` (the primitive) (https://r3f.docs.pmnd.rs/api/events,
`dist/declarations/src/core/events.d.ts`). r3f raycasts recursively from the
object that holds the handler, so the group of meshes `loadStep` builds needs
one handler.

Orienting a connector against the face is `Quaternion.setFromUnitVectors(
matingAxis, worldNormal)` (https://threejs.org/docs/#api/en/math/Quaternion);
it leaves roll about the normal free, which the existing turn handles can
set. `Object3D.lookAt` fixes roll from `up` but flips near the pole.

Gotchas. `Mesh.raycast` never reads `material.transparent`, `opacity` or
`visible`; the see-through model at 0.6 still catches every ray, and so does
anything we hide (`src/objects/Mesh.js`). `material.side` does matter:
`FrontSide` drops back-face hits. There is no BVH in core; each ray loops the
mesh's triangles after a bounding-sphere test, and a bounding-box test only if
`geometry.computeBoundingBox()` has been called. three-mesh-bvh 0.8.3 is
installed via drei, which exports `<Bvh firstHitOnly>` and `useBVH`
(https://drei.docs.pmnd.rs/performances/bvh, `core/Bvh.js` patches
`computeBoundsTree` and `acceleratedRaycast`). Wrap the reference in it if
hover raycasts get slow on a big STEP.

occt-import-js meshes carry per-vertex normals from the BRep surface. Each
face's `OcctFace` calls `BRep_Tool::Triangulation` and then
`triangulation->ComputeNormals()`, and `EnumerateNormals` emits
`triangulation->Normal(node)` transformed by the face location and negated
for `TopAbs_REVERSED` faces
(https://github.com/kovacsv/occt-import-js/blob/main/occt-import-js/src/importer-utils.cpp).
The JS side sets `attributes.normal` only when the normal count equals the
vertex count (`js-interface.cpp`), so one face without a triangulation drops
the attribute for the whole mesh; the `computeVertexNormals()` fallback in
`reference.ts` stays. Vertices are not shared between BRep faces, so edges
are hard either way. Each mesh also carries `brep_faces[{ first, last,
color }]`, the first and last triangle index of each CAD face
(https://github.com/kovacsv/occt-import-js#readme). The three.js `faceIndex`
is the same triangle number (`Math.floor(i / 3)`), so a hit maps back to a
CAD face and a click can select the whole planar face rather than one
triangle. Tessellation params, with defaults from `importer.cpp`:
`linearUnit` (`millimeter`), `linearDeflectionType` (`bounding_box_ratio`),
`linearDeflection` (0.001), `angularDeflection` (0.5).

What changes today: nothing in `reference.ts`; `Workspace3D` adds a snap mode
that moves the selected connector to `e.point` and turns it with the world
normal.

## 2. STEP in a web worker

Half documented. The README covers only `<script>` and node use, but the
package ships `dist/occt-import-js-worker.js`, a classic worker:
`importScripts('occt-import-js.js')`, then on each message
`occt.ReadFile(ev.data.format, ev.data.buffer, ev.data.params)` and
`postMessage(result)`. `examples/browser_step_worker.html` drives it with
`new Worker('../dist/occt-import-js-worker.js')` and
`postMessage({ format: 'step', buffer: Uint8Array, params: null })`
(https://github.com/kovacsv/occt-import-js/blob/main/dist/occt-import-js-worker.js,
https://github.com/kovacsv/occt-import-js/blob/main/examples/browser_step_worker.html).
`ReadFile(format, buffer, params)` with `step`, `iges` or `brep` is bound in
`js-interface.cpp` next to `ReadStepFile` but is not in the README. The
shipped worker also re-creates the wasm module on every message; ours should
create it once.

The module is an Emscripten MODULARIZE build in UMD form (`main:
./dist/occt-import-js.js`, `module.exports = occtimportjs`, no `exports`
field, no ESM file, no types), built with `ALLOW_MEMORY_GROWTH=1`, a 10 MB
stack and no `MAXIMUM_MEMORY`
(https://github.com/kovacsv/occt-import-js/blob/main/CMakeLists.txt). It
detects a worker by `typeof importScripts == "function"`, which a module
worker still satisfies. Vite's documented form is `new Worker(new
URL('./step.worker.ts', import.meta.url), { type: 'module' })`
(https://vite.dev/guide/features#web-workers); inside it `import occtimportjs
from 'occt-import-js'` goes through the same CJS pre-bundling that makes
today's `await import("occt-import-js")` work
(https://vite.dev/guide/dep-pre-bundling), and the `?url` wasm import plus
`locateFile` carries over unchanged. Add `optimizeDeps.include:
['occt-import-js']` so the dynamic import is pre-bundled on first run.

Transfer is ours. The result arrays are plain JS arrays built with
`emscripten::val::array()` and `set(i, x)` (`js-interface.cpp`), so there is
no `ArrayBuffer` to transfer out of the parser. Posting `result` as is works
but structured-clones millions of numbers. Better: in the worker,
`Float32Array.from(position.array)`, `Float32Array.from(normal.array)`,
`Uint32Array.from(index.array)`, then `postMessage(msg, [buffers])`; typed
arrays are serialisable but their `ArrayBuffer` is transferable, and the
source side is detached afterwards
(https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects).
Keep `brep_faces`, `name` and `color` as plain JSON beside them. Send the
input file the same way (`[buffer]`). On the main thread wrap with `new
THREE.BufferAttribute(array, 3)`, which keeps the typed array;
`Float32BufferAttribute` copies (`src/core/BufferAttribute.js`). A THREE
object cannot cross `postMessage`: functions throw `DataCloneError` and
prototypes are not cloned
(https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

Memory. wasm32 caps the heap at 2 GB. Issue #19 reports a 142 MB STEP coming
back empty (https://github.com/kovacsv/occt-import-js/issues/19), #59
proposes a 4 GB build and has a test build from 2025-09-03 that is not in
0.0.23 (https://github.com/kovacsv/occt-import-js/issues/59), and #34 is
about memory not returning across repeated reads
(https://github.com/kovacsv/occt-import-js/issues/34). A grown heap never
shrinks, so `worker.terminate()` after a large import and a fresh worker on
the next one is the cheap way to give it back. None of the issues is about
worker use itself.

What changes today: `loadStep` moves into a worker file, `reference.ts`
builds geometry from the transferred arrays, and the 30 ms `setTimeout` in
`importReference` goes because the page no longer blocks.

## 3. Orthographic views from the view cube

Half documented. drei's `GizmoHelper` owns the camera tween and
`GizmoViewcube` the clicks (`core/GizmoHelper.js`, `core/GizmoViewcube.js`;
docs https://drei.docs.pmnd.rs/gizmos/gizmo-helper). What the source does:

- `tweenCamera(direction)` reads the focus point from `onTarget()` or
  `controls.target`, sets the goal quaternion from `dummy.lookAt`, and in
  `useFrame` slerps the main camera's quaternion toward it at 2π rad/s,
  placing `camera.position = (0,0,1).applyQuaternion(q) * radius +
  focusPoint`, then calls `onUpdate()` if given, else `controls.update()`.
  It stops when the angle is under 0.01 rad and restores `camera.up`. There
  is no completion callback; `onUpdate` fires per animated frame and replaces
  the `controls.update()` call when present.
- The radius is `mainCamera.position.distanceTo(target)` where `target` is a
  module-level `Vector3` that is never written, so it is the camera's
  distance to the world origin, not to the orbit target. With today's camera
  at [350, 450, 700] and target [0, 180, 0] every face click moves the
  camera from about 830 mm to about 900 mm from the target.
- `FaceCube` uses `onClick: props.onClick || handleClick` where `handleClick`
  is `tweenCamera(e.face.normal)`; the 12 edge and 8 corner cubes do the same
  with their own position. An `onClick` passed to `<GizmoViewcube>` replaces
  the tween for all 26 targets. `useGizmoContext()` is exported and returns
  `{ tweenCamera }`, so our handler calls it after recording which standard
  view was picked. For a face the direction is `e.face.normal`; for an edge
  or corner use `e.object.position`.
- Face order follows `BoxGeometry` material indices (+X, -X, +Y, -Y, +Z, -Z)
  and `defaultFaces` is `['Right', 'Left', 'Top', 'Bottom', 'Front',
  'Back']`, so Front is +Z and Top is +Y with Y up. The `faces` prop relabels
  only.

Swapping cameras at runtime is documented: drei's `<OrthographicCamera
makeDefault>` and `<PerspectiveCamera makeDefault>` call `set({ camera })` in
a layout effect and restore the old camera on cleanup
(https://drei.docs.pmnd.rs/cameras/orthographic-camera,
`core/OrthographicCamera.js`), and r3f's `set` is the documented store
setter (https://r3f.docs.pmnd.rs/api/hooks). The `orthographic` prop on
`<Canvas>` only picks the camera at mount
(https://r3f.docs.pmnd.rs/api/canvas). drei's ortho camera sizes its frustum
to `±size.width/2`, `±size.height/2` so one world unit is one pixel at zoom
1. drei's `OrbitControls` builds a new `three-stdlib` `OrbitControls` on
every camera change (`useMemo(() => new OrbitControls(explCamera),
[explCamera])`) and re-applies its props, so the `target` prop survives but a
panned target, damping and an in-flight drag do not; `TransformControls`
rebuilds the same way. three-stdlib's `OrbitControls` handles an
orthographic camera through `camera.zoom`, `minZoom` and `maxZoom`.

Matching the frustum is hand-written. A perspective camera at distance `d`
from the target shows a height of `2 d tan(fov/2)`; the ortho camera shows
`(top - bottom) / zoom`, so `zoom = size.height / (2 d tan(fov/2))` with
drei's defaults, and the camera keeps its position and quaternion. Coming
back, place the perspective camera at `target - forward * size.height / (2
zoom tan(fov/2))`. Set `near` and `far` on the ortho camera; drei's defaults
are 0.1 and 1000 and the scene is in millimetres to 20000.

Switching back on orbit is ours too. OrbitControls fires `start`, `change`
and `end`, and drei exposes them as `onStart`, `onChange`, `onEnd`
(https://threejs.org/docs/#examples/en/controls/OrbitControls). `start` also
fires on wheel zoom and pan, so compare the camera quaternion against the
snapped one in `onChange` and swap once it drifts. The gizmo's own tween
goes through `controls.update()` and never fires `start`.

An alternative is drei's `<CameraControls>`, which wraps camera-controls
3.1.2 (installed via drei, https://drei.docs.pmnd.rs/controls/camera-controls);
`GizmoHelper` duck-types it through `getTarget`. Not checked further here.

What changes today: `Stage` mounts both cameras and flips `makeDefault` from
state, `GizmoViewcube` gets an `onClick`, and `Frame` reads `fov` only when
the camera is perspective.

## 4. Multi-select and group transforms

Hand-written on public hooks. `TransformControls.attach(object)` takes one
`Object3D` (https://threejs.org/docs/#examples/en/controls/TransformControls);
the `objectChange` event is `{ type: 'objectChange' }` with no delta, and
the official `misc_controls_transform` example attaches one mesh. The only
"group" notion in three's controls is `DragControls.transformGroup`. Today's
`Gizmo` already uses the right pattern: an empty mirror group under the
controls and React state as the truth. For a selection, record each member's
start transform on `onMouseDown`, then on each `objectChange` apply `dPos =
group.position - positionStart` and `qDelta = group.quaternion *
quaternionStart⁻¹` to every member from its start, rotating positions about
the pivot with `p' = pivot + qDelta * (p - pivot)`. three-stdlib's class
exposes `positionStart`, `quaternionStart`, `pointStart`, `pointEnd`,
`rotationAxis` and `rotationAngle` as public fields; in three 0.186 proper
`_positionStart` and `_quaternionStart` are private, another reason to stay
on drei's wrapper. The pivot is the mean of the selected positions, or
`Box3.setFromObject` on a group of them
(https://threejs.org/docs/#api/en/math/Box3).

`PivotControls` is the other documented route
(https://drei.docs.pmnd.rs/gizmos/pivot-controls). Its `onDrag(l, deltaL,
w, deltaW)` hands over local and world matrices and deltas measured from
drag start (`web/pivotControls/index.js`: `mW = mdW * mW0` each move), and
with `autoTransform={false}` the drag never writes the gizmo; `matrix` is
applied every frame from props, so state owns it. Set each member to `deltaW
* memberStartWorld`. Props: `anchor`, `fixed` (pixel size), `lineWidth`,
`activeAxes`, `disableAxes`, `disableSliders`, `disableRotations`,
`disableScaling`, `depthTest`, `annotations`. Its rotation handles are
three arcs, one per plane, drawn with fat lines, which answers the "thicker
handles" wish without a custom gizmo.

An arcball handle for an object already half exists. `TransformControls`
rotate mode draws X, Y and Z rings plus an `E` ring about the view axis and
an invisible `XYZE` sphere of radius 0.7 that tumbles the object about
`offset × eye` (three-stdlib `TransformControls.js` lines 281 and 894). Both
rotate about screen axes even in `space="local"`. three 0.186 adds `showE`
and `showXYZE` but three-stdlib has neither; it hides them only when one of
`showX/Y/Z` is false. `ArcballControls` in three and drei is a camera
control with a gizmo drawn around the camera target, not an object handle. A
true Shoemake arcball is hand-written: map the pointer to a sphere, rotate
start and current points into world by `camera.quaternion`,
`qDelta.setFromUnitVectors(a, b)`, `quaternion.premultiply(qDelta)`.

Multi-select is simple in r3f: the event spreads the DOM event, so
`e.shiftKey` works on `onPointerDown` (https://r3f.docs.pmnd.rs/api/events).
drei's `<Select multiple box onChange>` adds shift-click and shift-box
selection using three-stdlib's `SelectionBox`
(https://drei.docs.pmnd.rs/misc/select) but keeps only `isMesh` objects
under it, so today's sprite handles would not be selectable and the ids
must come back through `userData`. Owning the set in state, as `selected`
is owned today, is less code.

What changes today: `selected` becomes a set, `Gizmo` takes the set and a
pivot and applies deltas, and `R` cycling of a connector's six faces snaps
the member quaternions to the nearest axis-aligned one.

## 5. A hold-key gesture that turns an object from mouse movement

Hand-written. drei has no keyboard-driven object manipulation.
`KeyboardControls` maps keys to a zustand store (`map={[{ name, keys, up?
}]}`, `useKeyboardControls(s => s.rotate)` or `[subscribe, get]`,
https://drei.docs.pmnd.rs/controls/keyboard-controls), which answers "is R
held" and nothing else. drei's `DragControls` is translation only
(`onDrag(local, deltaLocal, world, deltaWorld)`, `axisLock`, `dragLimits`,
https://drei.docs.pmnd.rs/gizmos/drag-controls). three's own `DragControls`
rotates on the right mouse button with `rotateSpeed`, but about camera-aligned
world axes, `rotateOnWorldAxis(_up, dx)` and `rotateOnWorldAxis(_right,
-dy)` (`examples/jsm/controls/DragControls.js` line 265), and it writes the
object directly; drei does not wrap it.

The recipe: `keydown` for `r` ignoring `e.repeat`, a `pointermove` listener
on `gl.domElement` reading `movementX`/`movementY` (or r3f's
`useThree(s => s.pointer)` NDC), then a delta quaternion. For a screen-relative
feel that still turns the object about its own centre: `right = (1,0,0)` and
`up = (0,1,0)` rotated by `camera.quaternion`, `qDelta = axisAngle(up, dx k)
* axisAngle(right, -dy k)`, `q = qDelta * qStart`, written back with
`Euler.setFromQuaternion` because state stores `[x, y, z]`. For spin about
the object's own axes, `rotateOnAxis(axis, angle)` and `rotateX/Y/Z` are
documented as local-space
(https://threejs.org/docs/#api/en/core/Object3D). On release, snap to the
nearest of the 24 axis-aligned orientations by `quaternion.angleTo`. The
custom `useDrag` in `scene.tsx` is the seam; `@use-gesture/react` is only
reachable through drei and its `keys` option is arrow-key dragging, not
modifier detection (https://use-gesture.netlify.app/docs/options/).

What changes today: a `useTurn` hook beside `useDrag`, and a translucent
`<Box>` drawn around the selection while R is held.

## 6. Smooth tubes and a bend radius number

Documented, apart from curvature. `new CatmullRomCurve3(points, closed,
curveType, tension)` passes through every point; `curveType` defaults to
`'centripetal'`, which the source and Yuksel's paper say avoids cusps and
self-intersection, and `tension` applies only to `'catmullrom'`
(https://threejs.org/docs/#api/en/extras/curves/CatmullRomCurve3,
`src/extras/curves/CatmullRomCurve3.js`). `Curve` gives `getPointAt(u)`,
`getTangentAt(u)`, `getSpacedPoints(n)`, `getLength()`, `getLengths()`,
`arcLengthDivisions` (200), `updateArcLengths()` and
`computeFrenetFrames(segments)`
(https://threejs.org/docs/#api/en/extras/core/Curve). `getTangent` is a
finite difference with `delta = 0.0001` in `t`. `computeFrenetFrames` is a
parallel-transport frame despite its name, so it does not flip at inflection
points. `TubeGeometry(path, tubularSegments, radius, radialSegments, closed)`
samples `path.getPointAt(i / tubularSegments)`, so rings are even by arc
length (https://threejs.org/docs/#api/en/geometries/TubeGeometry). Every
build allocates; keep the `dispose` effect that `Tube` has.

No `getCurvature` exists on `Curve` or any subclass (`grep -rn curvature
src/extras` finds nothing), so the bend radius is ours. Two honest recipes:
sample `getTangentAt` at `u` and `u + du`, `kappa = |T1 - T0| / ds` with `ds
= getLength() / N`, `R = 1 / kappa`; or take `getSpacedPoints(N)` and the
circumradius of each consecutive triple, `R = |ab| |bc| |ac| / (2 |(b - a) ×
(c - a)|)`. Keep `ds` well under the smallest allowed radius and raise
`arcLengthDivisions` on a curve with many points. The check is `min R >= k
* odMm` with `k` from the cable spec. Today's polylines have infinite
curvature at every corner, so the check only means something once the
geometry is a curve.

The straight stub out of a connector survives with `CurvePath`:
`add(LineCurve3(connector, stubEnd))`, `add(CatmullRomCurve3([stubEnd, ...ties,
otherStubEnd]))`, `add(LineCurve3(...))`. `CurvePath.getPoint` is
arc-length aware across pieces
(https://threejs.org/docs/#api/en/extras/core/CurvePath). The joins are
continuous in position but not in tangent, because the spline's end tangent
comes from an extrapolated phantom point; prepending a point a little way
along the stub direction fixes it in practice. `CurvePath` caches lengths by
curve count, so call `updateArcLengths()` after editing a piece in place, or
build fresh curves per edit as `Tube` does.

Length: `curve.getLength()` is a 200-sample chord sum. A curve through the
same ordered points is longer than the polyline through them, so moving
`length_mm` to the curve nudges stored lengths up, not down.

Width lines are the cheap alternative: drei `<Line points lineWidth
worldUnits>` and `<CatmullRomLine curveType tension segments>` wrap
three-stdlib's `Line2` and `LineMaterial` (`core/Line.js`,
`core/CatmullRomLine.js`); `LineSegments2.raycast` respects the width in
either unit mode. They do not shade, so bundles with a real OD read better as
tubes; lines suit the conductor strands at a fanned end.

What changes today: `Tube` takes a `CurvePath` per segment instead of one
straight tube per span, `routed()` reads `getLength()`, and a DRC rule reads
the minimum radius.

## 7. Zooming toward the cursor

Documented. `OrbitControls.zoomToCursor` ("Setting this property to true
allows to zoom to the cursor's position", default false,
https://threejs.org/docs/#examples/en/controls/OrbitControls.zoomToCursor)
arrived in r155 (https://github.com/mrdoob/three.js/pull/26165), touch
followed in r160 (https://github.com/mrdoob/three.js/pull/27384), and
three-stdlib 2.36.1 carries it (`controls/OrbitControls.js` line 58). drei
spreads unknown props onto `<primitive object={controls}>`, so the whole
change is `<OrbitControls makeDefault zoomToCursor />`.

Behaviour from the source: a perspective camera moves along the ray under
the pointer, still clamped by `minDistance` and `maxDistance`; an
orthographic camera changes `zoom` and shifts sideways so the point under
the cursor stays put. The target then moves too: with `screenSpacePanning`
(the default) it is re-placed in front of the camera at the new distance.
That is what makes later orbits circle the zoomed-in area, and it is also
why `GizmoHelper`'s view-cube clicks centre on the drifted point afterwards.
Note the r187 fix (https://github.com/mrdoob/three.js/pull/34856, merged
2026-10-07) repairs middle-button drag dolly, which only the first move
honoured; wheel zoom, which is what we use, was fine. It is not in 0.186.1
or in three-stdlib 2.36.1.

What changes today: one prop on `Stage`.

## 8. A one-off rotation of the reference model

Documented. The reference sits in `<group position rotation scale>` and
`rotation` is a stored Euler in `XYZ` order
(https://threejs.org/docs/#api/en/math/Euler, `Euler.DEFAULT_ORDER`). A
quarter turn about a world axis on the stored value is
`Object3D.rotateOnWorldAxis(axis, Math.PI / 2)` on a scratch object followed
by `Euler.setFromQuaternion`, or `Quaternion.setFromAxisAngle` premultiplied
(https://threejs.org/docs/#api/en/core/Object3D). Baking is also documented,
`BufferGeometry.rotateX/Y/Z` and `applyMatrix4`, which the docs describe as
a one-time operation (https://threejs.org/docs/#api/en/core/BufferGeometry),
but keeping the turn in state composes with the handles and shows in
"Placement data", so baking buys nothing. `Box3.setFromObject(group)` after
`group.updateWorldMatrix(true, true)` gives the axis-aligned bounds of the
turned model; for multiples of 90 degrees the default non-precise box is
exact (https://threejs.org/docs/#api/en/math/Box3).

The skew Alex saw is the up axis. OpenCascade and STEP are Z-up; three.js is
Y-up (`Object3D.DEFAULT_UP` is (0, 1, 0)) and has no up-axis setting. The
view cube's Front is +Z and Top is +Y (item 3). So a "Z up" control beside
the units selector sets `rotation = [-Math.PI / 2, 0, 0]`, and quarter turns
about Y then put the right side of the machine on Right. Snapping any stored
Euler to the nearest multiple of π/2 per component is enough to square a
model that came in slightly off.

What changes today: a `Z up` checkbox and quarter-turn buttons in the
reference panel, writing `reference.rotation`.
