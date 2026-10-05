/** The pieces the 3D harness scene is built from: the stage, handles, tubes and labels. */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewcube, Grid, Html, OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { useTheme } from "../theme";
import type { Vec3 } from "./model";

export function Stage({ children, onPointerMissed }: { children: ReactNode; onPointerMissed?: () => void }) {
  const theme = useTheme((s) => s.theme);
  return (
    <Canvas onPointerMissed={onPointerMissed} camera={{ position: [350, 450, 700], fov: 40, near: 5, far: 20000 }} style={{ background: theme === "dark" ? "#1a1b1e" : "#f4f4f4" }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[300, 800, 500]} intensity={1.4} />
      <directionalLight position={[-400, 200, -300]} intensity={0.4} />
      <Grid args={[2000, 2000]} position={[0, -60, 0]} cellSize={50} sectionSize={250} cellColor={theme === "dark" ? "#2c2d31" : "#dddddd"} sectionColor={theme === "dark" ? "#3a3b40" : "#bbbbbb"} fadeDistance={2500} infiniteGrid />
      <OrbitControls makeDefault target={[0, 180, 0]} />
      {/* Click a face, edge or corner to snap to that view. */}
      <GizmoHelper alignment="top-right" margin={[72, 72]}>
        <GizmoViewcube color={theme === "dark" ? "#3a3d44" : "#e8e8e8"} textColor={theme === "dark" ? "#e6e6e6" : "#1e1f22"} strokeColor={theme === "dark" ? "#8a909c" : "#777777"} hoverColor="#5b9cf5" />
      </GizmoHelper>
      {children}
    </Canvas>
  );
}

/**
 * Drag on a plane facing the camera through the grabbed point. Orbit is off
 * while a drag is live; orbit the camera first to drag in another plane.
 */
export function useDrag(onMove: (id: string, p: Vec3) => void, onEnd?: (id: string) => void) {
  const { camera, gl, controls } = useThree();
  const live = useRef<{ id: string; plane: THREE.Plane; offset: THREE.Vector3 } | null>(null);
  const handlers = useRef({ onMove, onEnd });
  handlers.current = { onMove, onEnd };

  useEffect(() => {
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const move = (e: PointerEvent) => {
      const d = live.current;
      if (!d) return;
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      if (!ray.ray.intersectPlane(d.plane, hit)) return;
      const p = hit.clone().add(d.offset);
      handlers.current.onMove(d.id, [p.x, p.y, p.z]);
    };
    const up = () => {
      const d = live.current;
      if (!d) return;
      live.current = null;
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      handlers.current.onEnd?.(d.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [camera, gl, controls]);

  return (id: string, at: Vec3, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    const point = new THREE.Vector3(...at);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    live.current = { id, plane, offset: point.clone().sub(e.point) };
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
  };
}

/**
 * Cartesian handles on one thing: red, green and blue arrows to move it, or
 * rings to turn it. The handles sit on an empty object that mirrors the
 * thing's position and rotation, and every change is reported back.
 */
export function Gizmo({ at, rotation = [0, 0, 0], mode, onChange }: { at: Vec3; rotation?: Vec3; mode: "translate" | "rotate"; onChange: (position: Vec3, rotation: Vec3) => void }) {
  const target = useRef<THREE.Group>(null!);
  return (
    <>
      <group ref={target} position={at} rotation={rotation} />
      <TransformControls
        object={target}
        mode={mode}
        space={mode === "rotate" ? "local" : "world"}
        size={0.8}
        onObjectChange={() => {
          const o = target.current;
          onChange([o.position.x, o.position.y, o.position.z], [o.rotation.x, o.rotation.y, o.rotation.z]);
        }}
      />
    </>
  );
}

/** Points the camera at a ball of space whenever `token` changes. */
export function Frame({ centre, radius, token }: { centre: Vec3; radius: number; token: unknown }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!controls) return;
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 40);
    const away = new THREE.Vector3(0.35, 0.3, 0.9).normalize().multiplyScalar(Math.max(400, (radius / Math.tan(fov / 2)) * 1.25));
    camera.position.set(...centre).add(away);
    const c = controls as unknown as { target: THREE.Vector3; update: () => void };
    c.target.set(...centre);
    c.update();
  }, [token, controls]);
  return null;
}

export function Tube({ points, radius, color, onDoubleClick }: { points: Vec3[]; radius: number; color: string; onDoubleClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const geometry = useMemo(() => {
    const v = points.map((p) => new THREE.Vector3(...p));
    const curve = v.length === 2 ? new THREE.LineCurve3(v[0], v[1]) : new THREE.CatmullRomCurve3(v);
    return new THREE.TubeGeometry(curve as THREE.Curve<THREE.Vector3>, Math.max(2, v.length * 2), radius, 10, false);
  }, [points, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} onDoubleClick={onDoubleClick}>
      <meshStandardMaterial color={color} roughness={0.55} />
    </mesh>
  );
}

const handleTextures = new Map<string, THREE.CanvasTexture>();
function handleTexture(shape: "circle" | "diamond", color: string) {
  const key = `${shape}-${color}`;
  let t = handleTextures.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.beginPath();
    if (shape === "circle") g.arc(32, 32, 24, 0, Math.PI * 2);
    else {
      g.moveTo(32, 6);
      g.lineTo(58, 32);
      g.lineTo(32, 58);
      g.lineTo(6, 32);
      g.closePath();
    }
    g.fillStyle = color;
    g.globalAlpha = 0.25;
    g.fill();
    // A dark rim under the outline keeps it visible on the light theme.
    g.globalAlpha = 0.55;
    g.lineWidth = 10;
    g.strokeStyle = "#1e1f22";
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 5;
    g.strokeStyle = color;
    g.stroke();
    t = new THREE.CanvasTexture(c);
    handleTextures.set(key, t);
  }
  return t;
}

/**
 * A grab point drawn flat on the screen: a see-through outline that keeps its
 * size at any zoom and shows through the wiring and the reference model, so
 * it reads as a control and not as part of the harness.
 */
export function Handle({ at, shape, color, onPointerDown }: { at: Vec3; shape: "circle" | "diamond"; color: string; onPointerDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <sprite position={at} scale={[0.032, 0.032, 1]} renderOrder={10} onPointerDown={onPointerDown} onPointerOver={(e) => (e.stopPropagation(), (document.body.style.cursor = "grab"))} onPointerOut={() => (document.body.style.cursor = "")}>
      <spriteMaterial map={handleTexture(shape, color)} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

export function Label({ at, children, tone = "plain" }: { at: Vec3; children: ReactNode; tone?: "plain" | "muted" | "accent" }) {
  return (
    <Html position={at} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
      <div className={`h3d-label h3d-${tone}`}>{children}</div>
    </Html>
  );
}

/**
 * One floating card for whichever connector is hovered or selected. It stays
 * mounted and only moves, so nothing flickers as the pointer crosses parts.
 */
export function Card({ at, title, lines }: { at: Vec3 | undefined; title?: string; lines?: string[] }) {
  return (
    <Html position={at ?? [0, 0, 0]} zIndexRange={[20, 11]} style={{ pointerEvents: "none", display: at ? "block" : "none" }}>
      <div className="h3d-card">
        <strong>{title ?? ""}</strong>
        {(lines ?? []).map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </Html>
  );
}
