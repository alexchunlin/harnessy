/**
 * The 3D workspace for one topology. 3D owns the lengths here, the way a
 * yarn mockup on the machine does.
 *
 * Connectors are placed against the machine with move and turn handles, and
 * a segment leaves its connector along the connector's axis. Breakouts,
 * points and tie points are dragged into place, and segments pull straight
 * between them. The routed length of every segment is live and the stored
 * length shows beside it. A tie point is a position in space; its distance
 * along the segment is derived.
 *
 * What is drawn is the project's saved placement laid over the sketch: a
 * part nobody placed sits where the sketch has it. A drag draws from local
 * state and, on release, commits as one undoable edit. With lengths locked,
 * the default, it moves the whole harness rigidly; in Stretch it places the
 * one part it moved.
 * Opening the view changes nothing in the project. A segment with both ends
 * placed takes its length from the core bundle curve, so there is nothing
 * to write back.
 *
 * The project's reference CAD model draws at real scale. It is scenery: it
 * has its own handles and nothing snaps to it. Each move of it is one edit
 * to its entry in `canvas/reference.json`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { buildGraph, clearPlacement, lengthsOf, moveHarness, moveRigidly, pieceOf, pieces, placementOf, placeParts, removeTiePoint, type Placement, type RigidMove, type SegmentLength } from "../../core";
import { usePrefs } from "../prefs";
import { useDoc } from "../store";
import { ALL, add, dist, lerp, round, roundVec, scale, sub, type Harness3, type Vec3, type World3 } from "./model";
import { Card, Frame, Gizmo, Handle, Label, Stage, Tube, useDrag } from "./scene";
import { placeReference, rad, ReferenceObject, ReferencePanel, type ReferenceState } from "./ReferenceModel";

interface PlacedTie {
  id: string;
  segment: string;
  /** The tie spec id in the library, such as `p-clip-10mm`. */
  label: string;
}


/** The one part a drag or a handle is moving right now, drawn here until it is let go. Rotation in radians. */
interface Live {
  id: string;
  at: Vec3;
  rotation?: Vec3;
}

type Mode = "translate" | "rotate";

const REFERENCE = "reference";
const deg = (v: Vec3): Vec3 => [round(THREE.MathUtils.radToDeg(v[0])), round(THREE.MathUtils.radToDeg(v[1])), round(THREE.MathUtils.radToDeg(v[2]))];

/** A connector's wires leave along its local -Y. */
function exitDirection(rotation: Vec3): Vec3 {
  const v = new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(...rotation));
  return [v.x, v.y, v.z];
}

/** The turn that points a connector's wire exit from one point toward another. */
function turnToward(from: Vec3, to: Vec3): Vec3 {
  const toward = new THREE.Vector3(...sub(to, from));
  if (toward.lengthSq() < 1e-9) return [0, 0, 0];
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), toward.normalize()));
  return [e.x, e.y, e.z];
}

interface Pose {
  positions: Record<string, Vec3>;
  /** Connector rotations in radians. */
  rotations: Record<string, Vec3>;
  placed: PlacedTie[];
  /** Tie point order along each segment, from ends[0] to ends[1]. */
  chains: Record<string, string[]>;
}

/**
 * Where everything is drawn. A saved position wins over the sketch, and the
 * live part wins over both. A connector with no saved rotation exits toward
 * the far end of its segment. A tie point with no saved position sits at its
 * typed distance along the straight line between its segment's ends. Tie
 * points are ordered by their projection onto that line, ties broken by id.
 */
function poseOf(world: World3, placement: Placement, live: Live | undefined): Pose {
  const h = world.all;
  const over = (id: string, v: Vec3) => (live?.id === id ? live.at : v);
  const far = (s: { ends: [string, string] }, id: string) => (s.ends[0] === id ? s.ends[1] : s.ends[0]);
  const positions: Record<string, Vec3> = {};
  for (const n of h.nodes) positions[n.id] = over(n.id, placement.positions[n.id] ?? world.sketch[n.id]);

  const rotations: Record<string, Vec3> = {};
  for (const n of h.nodes) {
    if (n.kind !== "connector") continue;
    const saved = placement.rotations[n.id];
    const seg = h.segments.find((s) => s.ends.includes(n.id));
    rotations[n.id] = live?.id === n.id && live.rotation ? live.rotation : saved ? rad(saved) : seg ? turnToward(positions[n.id], positions[far(seg, n.id)]) : [0, 0, 0];
  }

  const segments = new Map(h.segments.map((s) => [s.id, s]));
  const placed: PlacedTie[] = [];
  for (const t of h.ties) {
    const s = segments.get(t.segment);
    if (!s) continue;
    const [a, b] = t.from === s.ends[0] ? s.ends : [s.ends[1], s.ends[0]];
    const typed = lerp(positions[a], positions[b], Math.min(1, t.distanceMm / Math.max(1, s.lengthMm)));
    positions[t.id] = over(t.id, placement.ties[t.id] ?? typed);
    placed.push({ id: t.id, segment: t.segment, label: t.label });
  }

  const chains: Record<string, string[]> = {};
  for (const s of h.segments) {
    const start = positions[s.ends[0]];
    const line = sub(positions[s.ends[1]], start);
    const along = (id: string) => sub(positions[id], start).reduce((sum, v, i) => sum + v * line[i], 0);
    chains[s.id] = placed
      .filter((c) => c.segment === s.id)
      .map((c) => c.id)
      .sort((x, y) => along(x) - along(y) || (x < y ? -1 : 1));
  }
  return { positions, rotations, placed, chains };
}

/** The parts that move with one part when lengths are locked: every endpoint and tie point of its harness. */
interface Members {
  endpoints: Set<string>;
  connectors: string[];
  ties: string[];
}

/** The rigid move a locked drag makes: from where the part was drawn before the drag to where it is now, turned about itself. */
function rigidMoveOf(base: Pose, l: Live): RigidMove {
  const from = base.positions[l.id];
  const translate = sub(l.at, from);
  const start = base.rotations[l.id];
  if (!l.rotation || !start) return { translate };
  const q = (r: Vec3) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
  const d = q(l.rotation).multiply(q(start).invert());
  return { translate, turn: { pivot: from, quaternion: [d.x, d.y, d.z, d.w] } };
}

/** A harness's part of the drawn pose, in the project's units: rotations in degrees, unrounded. */
function coreOf(pose: Pose, m: Members) {
  const at = (ids: Iterable<string>) => Object.fromEntries([...ids].map((id) => [id, pose.positions[id]]));
  return {
    positions: at(m.endpoints),
    rotations: Object.fromEntries(m.connectors.map((id) => [id, pose.rotations[id].map((r) => THREE.MathUtils.radToDeg(r)) as Vec3])),
    ties: at(m.ties),
  };
}

/** The drawn pose with one harness moved rigidly. */
function movedPose(base: Pose, m: Members, move: RigidMove): Pose {
  const moved = moveRigidly(coreOf(base, m), move);
  return {
    ...base,
    positions: { ...base.positions, ...moved.positions, ...moved.ties },
    rotations: { ...base.rotations, ...Object.fromEntries(Object.entries(moved.rotations).map(([id, r]) => [id, rad(r)])) },
  };
}

export function Workspace3D({ world, show, topologyId, referenceModel }: { world: World3; show: string; topologyId: string; referenceModel: ReferenceState }) {
  const harness = world.all;
  // What is drawn: one harness, or all of them.
  const shown: Harness3 = useMemo(() => {
    const m = world.members[show];
    if (show === ALL || !m) return harness;
    return { ...harness, name: show, nodes: harness.nodes.filter((n) => m.nodes.has(n.id)), segments: harness.segments.filter((s) => m.segments.has(s.id)), ties: [] };
  }, [world, show, harness]);
  // The lengths the project uses, the same numbers the topology inspector and the BOM show.
  const lengths = useDoc((d) => {
    const top = d.project?.topologies.get(topologyId);
    return d.project && top ? lengthsOf(d.project, top).segments : undefined;
  });
  const placement = useDoc((d) => (d.project ? placementOf(d.project, topologyId) : undefined));
  const connectors = useMemo(() => new Set(harness.nodes.filter((n) => n.kind === "connector").map((n) => n.id)), [harness]);
  const strainRelief = useMemo(() => Object.fromEntries(harness.nodes.map((n) => [n.id, n.strainReliefMm ?? 0])), [harness]);

  const [live, setLiveState] = useState<Live>();
  // The latest live part, read when a drag is let go, which can come before React renders the last move.
  const liveRef = useRef<Live | undefined>(undefined);
  const setLive = (l: Live | undefined) => {
    liveRef.current = l;
    setLiveState(l);
  };
  const locked = usePrefs((s) => s.lengthsLocked);
  const setLocked = usePrefs((s) => s.setLengthsLocked);
  const topology = useDoc((d) => d.project?.topologies.get(topologyId));
  const allPieces = useMemo(() => (topology ? pieces(buildGraph(topology)) : []), [topology]);
  /** The harness that moves with a part when lengths are locked. */
  const membersOf = (id: string): Members | undefined => {
    const piece = pieceOf(allPieces, harness.ties.find((t) => t.id === id)?.segment ?? id);
    if (!piece) return undefined;
    return { endpoints: piece.endpoints, connectors: [...piece.endpoints].filter((e) => connectors.has(e)), ties: harness.ties.filter((t) => piece.segments.has(t.segment)).map((t) => t.id) };
  };
  // What is drawn before the live part moves, and what is drawn now: the live part alone in Stretch, its whole harness when locked.
  const base = useMemo(() => poseOf(world, placement ?? { positions: {}, rotations: {}, ties: {} }, undefined), [world, placement]);
  const liveMembers = useMemo(() => (live && locked ? membersOf(live.id) : undefined), [live?.id, locked, allPieces]);
  const drawn = useMemo(() => (live && liveMembers ? movedPose(base, liveMembers, rigidMoveOf(base, live)) : poseOf(world, placement ?? { positions: {}, rotations: {}, ties: {} }, live)), [base, live, liveMembers, world, placement]);
  const { positions, rotations, placed, chains } = drawn;

  const [selected, setSelected] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<Mode>("translate");
  // The project's reference model, drawn where its handles have it while they are held. Rotation in radians.
  const reference = referenceModel.status === "ready" ? { ...referenceModel, position: live?.id === REFERENCE ? live.at : referenceModel.model.position, rotation: live?.id === REFERENCE && live.rotation ? live.rotation : rad(referenceModel.model.rotation) } : undefined;

  const shownTies = placed.filter((c) => shown.segments.some((s) => s.id === c.segment));
  const selectedTie = placed.find((c) => c.id === selected);

  // Handles do not follow a part that is no longer drawn. With no reference model the positions are only a sketch,
  // so the camera goes to the harness; with one, the camera stays where the machine is being worked on.
  useEffect(() => {
    if (!reference) setFrame((n) => n + 1);
    setSelected((id) => (id === undefined || id === REFERENCE || shown.nodes.some((n) => n.id === id) || shownTies.some((c) => c.id === id) ? id : undefined));
  }, [show]);

  const turnable = selected !== undefined && (selected === REFERENCE || connectors.has(selected));
  const liveMode: Mode = turnable ? mode : "translate";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") setSelected(undefined);
      if (e.key === "g") setMode("translate");
      if (e.key === "r") setMode("rotate");
      if (e.key === "f") setFrame((n) => n + 1);
      if ((e.key === "Delete" || e.key === "Backspace") && selectedTie) removeTie(selectedTie.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** The points a segment passes through, each tagged with the tie point or endpoint it belongs to. */
  const route = (segId: string): { id?: string; at: Vec3 }[] => {
    const s = harness.segments.find((x) => x.id === segId)!;
    const stub = (id: string) => (connectors.has(id) && rotations[id] && strainRelief[id] > 0 ? [{ at: add(positions[id], scale(exitDirection(rotations[id]), strainRelief[id])) }] : []);
    return [{ id: s.ends[0], at: positions[s.ends[0]] }, ...stub(s.ends[0]), ...chains[segId].map((id) => ({ id, at: positions[id] })), ...stub(s.ends[1]), { id: s.ends[1], at: positions[s.ends[1]] }];
  };
  const path = (segId: string) => route(segId).map((r) => r.at);
  const routed = (segId: string) => {
    const pts = path(segId);
    return pts.slice(1).reduce((t, p, i) => t + dist(pts[i], p), 0);
  };
  const tieDistance = (tieId: string) => {
    const c = placed.find((x) => x.id === tieId)!;
    const s = harness.segments.find((x) => x.id === c.segment)!;
    const r = route(s.id);
    let d = 0;
    for (let i = 1; i < r.length && r[i - 1].id !== tieId; i++) d += dist(r[i - 1].at, r[i].at);
    return { from: s.ends[0], mm: d };
  };

  /**
   * Let go of the live part, as one edit. With lengths locked its whole
   * harness moves from where it was drawn; in Stretch only the part is
   * placed. A connector saves the rotation it is drawn with, turned or not. A
   * tie point made here only moves here.
   */
  function commit() {
    const l = liveRef.current;
    if (!l) return;
    setLive(undefined);
    if (l.id === REFERENCE) {
      if (referenceModel.status !== "none") placeReference(referenceModel.model, l.at, l.rotation ?? rad(referenceModel.model.rotation));
      return;
    }
    const members = usePrefs.getState().lengthsLocked ? membersOf(l.id) : undefined;
    if (members) {
      useDoc.getState().edit((p) => moveHarness(p, topologyId, l.id, coreOf(base, members), rigidMoveOf(base, l)), "Move harness in 3D");
      return;
    }
    const isTie = harness.ties.some((t) => t.id === l.id);
    const parts = isTie ? { ties: { [l.id]: l.at } } : { positions: { [l.id]: l.at }, ...(connectors.has(l.id) ? { rotations: { [l.id]: deg(l.rotation ?? rotations[l.id]) } } : {}) };
    useDoc.getState().edit((p) => placeParts(p, topologyId, parts), "Place in 3D");
  }

  /** The harness "Clear placement" acts on: the shown one, or with all shown, the one holding the selected part. */
  const clearTarget = show !== ALL ? [...(world.members[show]?.nodes ?? [])][0] : (harness.nodes.some((n) => n.id === selected) || harness.ties.some((t) => t.id === selected) ? selected : undefined);
  function clearShown() {
    if (clearTarget) useDoc.getState().edit((p) => clearPlacement(p, topologyId, clearTarget), "Clear placement");
  }

  function removeTie(id: string) {
    useDoc.getState().edit((p) => removeTiePoint(p, topologyId, id), "Remove tie point");
    setSelected((s) => (s === id ? undefined : s));
  }

  function moved(position: Vec3, rotation: Vec3) {
    if (selected === undefined) return;
    setLive(selected === REFERENCE ? { id: REFERENCE, at: position, rotation } : { id: selected, at: position, ...(connectors.has(selected) ? { rotation } : {}) });
  }

  const shownAt = shown.nodes.map((n) => positions[n.id]);
  const middle = scale(shownAt.reduce((t, p) => add(t, p), [0, 0, 0] as Vec3), 1 / Math.max(1, shownAt.length));
  const reach = Math.max(100, ...shownAt.map((p) => dist(p, middle)));
  const selectedLabel = selected === undefined ? undefined : selected === REFERENCE ? reference?.model.path : (harness.nodes.find((n) => n.id === selected)?.label ?? placed.find((c) => c.id === selected)?.label);

  return (
    <div className="h3d-workspace">
      <Stage onPointerMissed={() => setSelected(undefined)}>
        <Frame centre={middle} radius={reach} token={frame} />
        {reference && <ReferenceObject loaded={reference.loaded} units={reference.model.units} position={reference.position} rotation={reference.rotation} />}
        <RouteScene harness={shown} positions={positions} rotations={rotations} placed={shownTies} path={path} routed={routed} lengths={lengths} selected={selected} onSelect={setSelected} onDrag={(id, p) => setLive({ id, at: p })} onDragEnd={commit} tieDistance={tieDistance} />
        {selected !== undefined && (selected !== REFERENCE || reference) && <Gizmo key={selected} at={selected === REFERENCE ? reference!.position : positions[selected]} rotation={selected === REFERENCE ? reference!.rotation : rotations[selected]} mode={liveMode} onChange={moved} onEnd={commit} />}
      </Stage>
      <aside className="h3d-panel">
        <p className="muted">Hover or click a connector for its name and type. Click a part for its handles: arrows move it along X, Y and Z, and rings turn a connector. Breakouts and points (circles) and tie points (diamonds) also drag freely. Delete removes the selected tie point. F frames the harness. Esc lets go.</p>
        <div className="h3d-row">
          <span>{selectedLabel ?? "Nothing selected"}</span>
          <button className={liveMode === "translate" ? "active" : ""} disabled={selected === undefined} onClick={() => setMode("translate")} title="G">
            Move
          </button>
          <button className={liveMode === "rotate" ? "active" : ""} disabled={!turnable} onClick={() => setMode("rotate")} title="R">
            Turn
          </button>
          <button onClick={() => setFrame((n) => n + 1)} title="F">
            Frame
          </button>
          {selectedTie && <button onClick={() => removeTie(selectedTie.id)}>Remove tie point</button>}
          <button disabled={clearTarget === undefined} onClick={clearShown} title="Return the harness to its typed numbers and the sketch">
            Clear placement
          </button>
        </div>
        {/* Locked, a drag moves the whole harness and no length changes. Stretch moves one part and stretches the segments at it. */}
        <div className="h3d-row">
          <button className={locked ? "active" : ""} aria-pressed={locked} onClick={() => setLocked(true)} title="Drag or turn any part to move its whole harness">
            Lengths locked
          </button>
          <button className={locked ? "" : "active"} aria-pressed={!locked} onClick={() => setLocked(false)} title="Drag a part on its own and stretch the segments at it">
            Stretch
          </button>
        </div>
        <ReferencePanel state={referenceModel} middle={middle} onHandles={() => setSelected(REFERENCE)} onRemoved={() => setSelected((id) => (id === REFERENCE ? undefined : id))} />
        <details>
          <summary>Placement data</summary>
          <pre>
            {JSON.stringify(
              {
                reference: referenceModel.status === "none" ? null : referenceModel.model,
                connectors: Object.fromEntries(shown.nodes.filter((n) => connectors.has(n.id)).map((n) => [n.id, { position: roundVec(positions[n.id]), rotation_deg: deg(rotations[n.id] ?? [0, 0, 0]) }])),
                points: Object.fromEntries([...shown.nodes.filter((n) => !connectors.has(n.id)).map((n) => n.id), ...shownTies.map((c) => c.id)].map((id) => [id, roundVec(positions[id])])),
              },
              null,
              2,
            )}
          </pre>
        </details>
      </aside>
    </div>
  );
}

function RouteScene({ harness, positions, rotations, placed, path, routed, lengths, selected, onSelect, onDrag, onDragEnd, tieDistance }: { harness: Harness3; positions: Record<string, Vec3>; rotations: Record<string, Vec3>; placed: PlacedTie[]; path: (segId: string) => Vec3[]; routed: (segId: string) => number; lengths: Map<string, SegmentLength> | undefined; selected: string | undefined; onSelect: (id: string) => void; onDrag: (id: string, p: Vec3) => void; onDragEnd: () => void; tieDistance: (id: string) => { from: string; mm: number } }) {
  const start = useDrag(onDrag, onDragEnd);
  const [hovered, setHovered] = useState<string>();
  // The card follows the pointer first, and falls back to the selected connector.
  const carded = harness.nodes.find((n) => n.kind === "connector" && n.id === hovered) ?? harness.nodes.find((n) => n.kind === "connector" && n.id === selected);
  // The handles own a selected part, so a free drag only starts on a part that is not selected yet.
  const grab = (id: string, at: Vec3) => (e: ThreeEvent<PointerEvent>) => {
    if (selected === id) return;
    onSelect(id);
    start(id, at, e);
  };
  return (
    <>
      {harness.segments.map((s) => {
        const pts = path(s.id);
        const length = lengths?.get(s.id);
        const longest = pts.slice(1).reduce((best, p, i) => (dist(pts[i], p) > dist(pts[best], pts[best + 1]) ? i : best), 0);
        const mid = lerp(pts[longest], pts[longest + 1], 0.5);
        return (
          <group key={s.id}>
            {pts.slice(1).map((p, i) => (
              <Tube key={i} points={[pts[i], p]} radius={s.odMm / 2} color={s.color} />
            ))}
            {/* A placed segment shows the length the project uses. An unplaced one shows what is drawn beside what is typed. */}
            <Label at={mid} tone="muted">
              {length?.source === "3d" ? length.mm : Math.round(routed(s.id))}
              {length?.source !== "3d" && <span className="h3d-ghost"> / {length?.mm ?? "?"} {length?.source ?? "typed"}</span>}
            </Label>
          </group>
        );
      })}
      {placed.map((c) => {
        const at = positions[c.id];
        return (
          <group key={c.id}>
            <Handle at={at} shape="diamond" color={selected === c.id ? "#ffd166" : "#ffffff"} onPointerDown={grab(c.id, at)} />
            <Label at={[at[0], at[1] + 22, at[2]]}>
              {c.label} @ {round(tieDistance(c.id).mm)}
            </Label>
          </group>
        );
      })}
      {harness.nodes.map((n) => {
        const at = positions[n.id];
        if (n.kind !== "connector") return <Handle key={n.id} at={at} shape="circle" color={selected === n.id ? "#ffd166" : "#ffffff"} onPointerDown={grab(n.id, at)} />;
        // A connector is a body with its wire exit at the bottom. It moves on its handles only, so a stray drag cannot knock it off the machine.
        return (
          <group key={n.id}>
            <group position={at} rotation={rotations[n.id] ?? [0, 0, 0]}>
              <mesh
                position={[0, 8, 0]}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(n.id);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = "pointer";
                  setHovered(n.id);
                }}
                onPointerOut={() => {
                  document.body.style.cursor = "";
                  setHovered((h) => (h === n.id ? undefined : h));
                }}
              >
                <boxGeometry args={[20, 24, 14]} />
                <meshStandardMaterial color={selected === n.id ? "#ffd166" : "#5b9cf5"} roughness={0.4} />
              </mesh>
              <mesh position={[0, -8, 0]}>
                <cylinderGeometry args={[5, 7, 10, 16]} />
                <meshStandardMaterial color="#3a3d44" roughness={0.6} />
              </mesh>
            </group>
          </group>
        );
      })}
      <Card at={carded && positions[carded.id]} title={carded?.label} lines={carded?.type ? [carded.type.name, `${carded.type.pins} pins, mates with ${carded.type.mating}`] : carded ? ["Connector type not found"] : []} />
    </>
  );
}
