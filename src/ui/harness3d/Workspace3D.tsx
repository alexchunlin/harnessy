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
 * state and, on release, places the one part it moved as one undoable edit.
 * Opening the view changes nothing in the project.
 *
 * Writing still puts the routed lengths and the tie points into the project
 * as one undo step, until lengths come from the placement itself.
 *
 * The project's reference CAD model draws at real scale. It is scenery: it
 * has its own handles and nothing snaps to it. Each move of it is one edit
 * to its entry in `canvas/reference.json`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { addTiePoint, clearPlacement, placementOf, placeParts, removeTiePoint, setSegmentLength, updateTiePoint, type Placement } from "../../core";
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

/** A tie point made in 3D that the project does not have yet. It lives here until it is written. */
interface FreshTie extends PlacedTie {
  at: Vec3;
}

/** A tie point made in 3D that the project does not have yet carries this id prefix until it is written. */
const UNWRITTEN = "tie-new";

/** The one part a drag or a handle is moving right now, drawn here until it is let go. Rotation in radians. */
interface Live {
  id: string;
  at: Vec3;
  rotation?: Vec3;
}

type Mode = "translate" | "rotate";

/** How far a segment travels along its connector's axis before it is free to bend. */
const STUB_MM = 25;
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
function poseOf(world: World3, placement: Placement, fresh: FreshTie[], live: Live | undefined): Pose {
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
  for (const c of fresh) {
    if (!segments.has(c.segment)) continue;
    positions[c.id] = over(c.id, c.at);
    placed.push({ id: c.id, segment: c.segment, label: c.label });
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

export function Workspace3D({ world, show, topologyId, referenceModel }: { world: World3; show: string; topologyId: string; referenceModel: ReferenceState }) {
  const harness = world.all;
  // What is drawn: one harness, or all of them.
  const shown: Harness3 = useMemo(() => {
    const m = world.members[show];
    if (show === ALL || !m) return harness;
    return { ...harness, name: show, nodes: harness.nodes.filter((n) => m.nodes.has(n.id)), segments: harness.segments.filter((s) => m.segments.has(s.id)), ties: [] };
  }, [world, show, harness]);
  const tieSpecs = useDoc((d) => d.project?.library.ties);
  const placement = useDoc((d) => (d.project ? placementOf(d.project, topologyId) : undefined));
  const connectors = useMemo(() => new Set(harness.nodes.filter((n) => n.kind === "connector").map((n) => n.id)), [harness]);

  const [fresh, setFresh] = useState<FreshTie[]>([]);
  const [live, setLiveState] = useState<Live>();
  // The latest live part, read when a drag is let go, which can come before React renders the last move.
  const liveRef = useRef<Live | undefined>(undefined);
  const setLive = (l: Live | undefined) => {
    liveRef.current = l;
    setLiveState(l);
  };
  const { positions, rotations, placed, chains } = useMemo(() => poseOf(world, placement ?? { positions: {}, rotations: {}, ties: {} }, fresh, live), [world, placement, fresh, live]);

  const [selected, setSelected] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<Mode>("translate");
  // The project's reference model, drawn where its handles have it while they are held. Rotation in radians.
  const reference = referenceModel.status === "ready" ? { ...referenceModel, position: live?.id === REFERENCE ? live.at : referenceModel.model.position, rotation: live?.id === REFERENCE && live.rotation ? live.rotation : rad(referenceModel.model.rotation) } : undefined;
  const [notice, setNotice] = useState<string>();
  const measured = Object.fromEntries(harness.segments.map((s) => [s.id, s.lengthMm]));

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
    const stub = (id: string) => (connectors.has(id) && rotations[id] ? [{ at: add(positions[id], scale(exitDirection(rotations[id]), STUB_MM)) }] : []);
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
   * Let go of the live part. A part the project has is placed as one edit; a
   * connector saves the rotation it is drawn with, turned or not. A tie point
   * made here only moves here.
   */
  function commit() {
    const l = liveRef.current;
    if (!l) return;
    setLive(undefined);
    if (l.id === REFERENCE) {
      if (referenceModel.status !== "none") placeReference(referenceModel.model, l.at, l.rotation ?? rad(referenceModel.model.rotation));
      return;
    }
    if (fresh.some((c) => c.id === l.id)) {
      setFresh((cs) => cs.map((c) => (c.id === l.id ? { ...c, at: l.at } : c)));
      return;
    }
    const isTie = harness.ties.some((t) => t.id === l.id);
    const parts = isTie ? { ties: { [l.id]: l.at } } : { positions: { [l.id]: l.at }, ...(connectors.has(l.id) ? { rotations: { [l.id]: deg(l.rotation ?? rotations[l.id]) } } : {}) };
    useDoc.getState().edit((p) => placeParts(p, topologyId, parts), "Place in 3D");
  }

  function addTie(segId: string, at: Vec3) {
    const spec = tieSpecs?.has("p-clip-10mm") ? "p-clip-10mm" : [...(tieSpecs?.keys() ?? [])][0];
    if (!spec) {
      setNotice("The library has no tie spec, so there is nothing to add.");
      return;
    }
    const id = `${UNWRITTEN}${Math.random().toString(36).slice(2, 7)}`;
    setFresh((cs) => [...cs, { id, segment: segId, label: spec, at }]);
    setSelected(id);
  }

  /** The harness "Clear placement" acts on: the shown one, or with all shown, the one holding the selected part. */
  const clearTarget = show !== ALL ? [...(world.members[show]?.nodes ?? [])][0] : (fresh.find((c) => c.id === selected)?.segment ?? (harness.nodes.some((n) => n.id === selected) || harness.ties.some((t) => t.id === selected) ? selected : undefined));
  function clearShown() {
    if (clearTarget) useDoc.getState().edit((p) => clearPlacement(p, topologyId, clearTarget), "Clear placement");
  }

  function removeTie(id: string) {
    if (fresh.some((c) => c.id === id)) setFresh((cs) => cs.filter((c) => c.id !== id));
    else useDoc.getState().edit((p) => removeTiePoint(p, topologyId, id), "Remove tie point");
    setSelected((s) => (s === id ? undefined : s));
  }

  /** Put the routed lengths and the tie points of the drawn segments into the project, as one undoable edit. */
  function writeAll() {
    const doc = useDoc.getState();
    const top = doc.project?.topologies.get(topologyId);
    if (!doc.project || !top) return;
    // Until parts are placed against the machine the positions are only a sketch, so a write is never silent.
    if (!window.confirm(`Write ${diffs.length} segment lengths and ${tieChanges} tie point changes from 3D into "${top.name}"? This replaces the lengths the topology view holds for ${show === ALL ? "every harness" : show}. Undo takes it back.`)) return;
    let next = doc.project;
    let fixed = 0;
    for (const s of top.segments) {
      if (!shown.segments.some((x) => x.id === s.id)) continue;
      // A purchased assembly has its length fixed by the library.
      if (s.assembly) fixed++;
      else next = setSegmentLength(next, topologyId, s.id, Math.ceil(routed(s.id)));
    }
    const written = new Set<string>();
    for (const c of shownTies) {
      const d = tieDistance(c.id);
      if (top.ties.some((t) => t.id === c.id)) next = updateTiePoint(next, topologyId, c.id, { segment: c.segment, from: d.from, distance_mm: d.mm });
      else {
        // A tie point made here becomes real with its position placed in the same edit.
        const added = addTiePoint(next, topologyId, c.segment, `ties/${c.label}`, d.mm, d.from);
        next = placeParts(added.project, topologyId, { ties: { [added.id]: positions[c.id] } });
        written.add(c.id);
      }
    }
    doc.edit(() => next, "Write 3D lengths and tie points");
    setFresh((cs) => cs.filter((c) => !written.has(c.id)));
    setSelected((s) => (s !== undefined && written.has(s) ? undefined : s));
    setNotice(`Written to the project. Undo takes it back.${fixed ? ` ${fixed} purchased ${fixed === 1 ? "assembly keeps" : "assemblies keep"} the library length.` : ""}`);
  }

  function moved(position: Vec3, rotation: Vec3) {
    if (selected === undefined) return;
    setLive(selected === REFERENCE ? { id: REFERENCE, at: position, rotation } : { id: selected, at: position, ...(connectors.has(selected) ? { rotation } : {}) });
  }

  const shownAt = shown.nodes.map((n) => positions[n.id]);
  const middle = scale(shownAt.reduce((t, p) => add(t, p), [0, 0, 0] as Vec3), 1 / Math.max(1, shownAt.length));
  const reach = Math.max(100, ...shownAt.map((p) => dist(p, middle)));
  const diffs = shown.segments.filter((s) => Math.abs(Math.ceil(routed(s.id)) - measured[s.id]) >= 1);
  const stored = new Map(harness.ties.map((t) => [t.id, t]));
  const tieChanges = shownTies.filter((c) => {
    const t = stored.get(c.id);
    const d = tieDistance(c.id);
    return !t || t.segment !== c.segment || t.from !== d.from || Math.abs(t.distanceMm - d.mm) >= 1;
  }).length;
  const selectedLabel = selected === undefined ? undefined : selected === REFERENCE ? reference?.model.path : (harness.nodes.find((n) => n.id === selected)?.label ?? placed.find((c) => c.id === selected)?.label);

  return (
    <div className="h3d-workspace">
      <Stage onPointerMissed={() => setSelected(undefined)}>
        <Frame centre={middle} radius={reach} token={frame} />
        {reference && <ReferenceObject loaded={reference.loaded} units={reference.model.units} position={reference.position} rotation={reference.rotation} />}
        <RouteScene harness={shown} positions={positions} rotations={rotations} placed={shownTies} path={path} routed={routed} measured={measured} selected={selected} onSelect={setSelected} onDrag={(id, p) => setLive({ id, at: p })} onDragEnd={commit} onAddTie={addTie} tieDistance={tieDistance} />
        {selected !== undefined && (selected !== REFERENCE || reference) && <Gizmo key={selected} at={selected === REFERENCE ? reference!.position : positions[selected]} rotation={selected === REFERENCE ? reference!.rotation : rotations[selected]} mode={liveMode} onChange={moved} onEnd={commit} />}
      </Stage>
      <aside className="h3d-panel">
        <p className="muted">Hover or click a connector for its name and type. Click a part for its handles: arrows move it along X, Y and Z, and rings turn a connector. Breakouts and points (circles) and tie points (diamonds) also drag freely. Double-click a segment to add a tie point there. Delete removes the selected tie point. F frames the harness. Esc lets go.</p>
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
        <ReferencePanel state={referenceModel} middle={middle} onHandles={() => setSelected(REFERENCE)} onRemoved={() => setSelected((id) => (id === REFERENCE ? undefined : id))} />
        <button onClick={writeAll} disabled={diffs.length + tieChanges === 0}>
          Write to the harness ({diffs.length} lengths, {tieChanges} tie points)
        </button>
        {notice && <p className="muted">{notice}</p>}
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

function RouteScene({ harness, positions, rotations, placed, path, routed, measured, selected, onSelect, onDrag, onDragEnd, onAddTie, tieDistance }: { harness: Harness3; positions: Record<string, Vec3>; rotations: Record<string, Vec3>; placed: PlacedTie[]; path: (segId: string) => Vec3[]; routed: (segId: string) => number; measured: Record<string, number>; selected: string | undefined; onSelect: (id: string) => void; onDrag: (id: string, p: Vec3) => void; onDragEnd: () => void; onAddTie: (segId: string, at: Vec3) => void; tieDistance: (id: string) => { from: string; mm: number } }) {
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
        const r = Math.ceil(routed(s.id));
        const delta = r - measured[s.id];
        const longest = pts.slice(1).reduce((best, p, i) => (dist(pts[i], p) > dist(pts[best], pts[best + 1]) ? i : best), 0);
        const mid = lerp(pts[longest], pts[longest + 1], 0.5);
        return (
          <group key={s.id}>
            {pts.slice(1).map((p, i) => (
              <Tube
                key={i}
                points={[pts[i], p]}
                radius={s.odMm / 2}
                color={s.color}
                onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
                  e.stopPropagation();
                  onAddTie(s.id, [e.point.x, e.point.y, e.point.z]);
                }}
              />
            ))}
            <Label at={mid} tone={Math.abs(delta) >= 1 ? "accent" : "muted"}>
              {r}
              <span className="h3d-ghost">{Math.abs(delta) >= 1 ? ` / ${measured[s.id]} (${delta > 0 ? "+" : ""}${delta})` : ""}</span>
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
              {c.id.startsWith(UNWRITTEN) ? " (new)" : ""}
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
