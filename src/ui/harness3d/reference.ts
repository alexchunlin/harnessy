/**
 * Reads a CAD file into a three.js object so the 3D harness view can show
 * the machine at real scale behind the harnesses. STEP goes
 * through occt-import-js (OpenCascade in wasm); GLB, STL and OBJ use the
 * three.js loaders. The file stays in memory and is not saved with the project.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import type { Vec3 } from "./model";

export const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;
export type Units = keyof typeof UNITS;

export interface Loaded {
  object: THREE.Object3D;
  /** The unit the file most likely uses. STEP comes out of OpenCascade in millimetres; glTF is metres by its spec. */
  units: Units;
  /** Bounding box in the file's own units. */
  size: Vec3;
  centre: Vec3;
}

export const ACCEPT = ".step,.stp,.glb,.gltf,.stl,.obj";

const grey = () => new THREE.MeshStandardMaterial({ color: "#8a909c", roughness: 0.7, metalness: 0.1 });

interface OcctMesh {
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
  color?: [number, number, number];
}

async function loadStep(buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const { default: occtimportjs } = await import("occt-import-js");
  const occt = await occtimportjs({ locateFile: () => occtWasmUrl });
  const result = occt.ReadStepFile(new Uint8Array(buffer), null) as { success: boolean; meshes: OcctMesh[] };
  if (!result.success) throw new Error("OpenCascade could not read this STEP file.");
  const group = new THREE.Group();
  for (const m of result.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) g.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    g.setIndex(m.index.array);
    if (!m.attributes.normal) g.computeVertexNormals();
    const material = grey();
    if (m.color) material.color.setRGB(m.color[0], m.color[1], m.color[2]);
    group.add(new THREE.Mesh(g, material));
  }
  return group;
}

export async function loadReference(file: File): Promise<Loaded> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  let object: THREE.Object3D;
  let units: Units = "mm";
  if (ext === "step" || ext === "stp") object = await loadStep(await file.arrayBuffer());
  else if (ext === "glb" || ext === "gltf") {
    object = (await new GLTFLoader().parseAsync(await file.arrayBuffer(), "")).scene;
    units = "m";
  } else if (ext === "stl") object = new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer()), grey());
  else if (ext === "obj") {
    object = new OBJLoader().parse(await file.text());
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = grey();
    });
  } else throw new Error(`No reader for .${ext} files. Use STEP, GLB, STL or OBJ.`);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error("The file holds no geometry.");
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  return { object, units, size: [size.x, size.y, size.z], centre: [centre.x, centre.y, centre.z] };
}

/** One opacity for every material in the model, so the harness shows through it. */
export function setOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
      m.needsUpdate = true;
    }
  });
}
