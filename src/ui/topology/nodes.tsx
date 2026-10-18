import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ENDPOINT_SIZE, type EndpointNodeData, type LabelNodeData, type TieNodeData } from "./model";

/** Width of the grab ring around an endpoint that starts a segment. Inside it, a drag moves the endpoint. */
const RING = 7;

export function EndpointNode({ data, selected }: NodeProps<Node<EndpointNodeData>>) {
  const { endpoint, label, title, degree, onRoute, lit, outOfLayer } = data;
  const size = ENDPOINT_SIZE[endpoint.kind];
  const bad =
    // PROTOTYPE #31: `waiting` marks a connector that has nets but no segment yet, which the derived layout shows without alarm.
    (endpoint.kind === "connector" && degree !== 1 && !data.waiting) || (endpoint.kind === "point" && degree !== 2) || (endpoint.kind === "breakout" && degree < 3) || (endpoint.kind === "splice" && degree < 2);
  return (
    <div className={`ep ep-${endpoint.kind}${selected ? " selected" : ""}${bad && !outOfLayer ? " bad" : ""}${onRoute || lit ? " on-route" : ""}${lit ? " lit" : ""}${outOfLayer ? " out-of-layer" : ""}`} style={{ width: size.w, height: size.h }} title={`${title ? `${title}: ` : ""}${endpoint.kind}, ${degree} segment${degree === 1 ? "" : "s"}`}>
      <Handle id="h" type="source" position={Position.Top} className="ep-handle" isConnectable={!outOfLayer} style={{ top: -RING, left: -RING, right: -RING, bottom: -RING, width: "auto", height: "auto", transform: "none" }} />
      <span className="ep-body" />
      {endpoint.kind === "connector" && <span className="ep-label">{label}</span>}
      {endpoint.kind === "breakout" && label && <span className="ep-tag">{label}</span>}
      {endpoint.kind === "splice" && <span className="ep-tag">{label}</span>}
    </div>
  );
}

export function TieNode({ data, selected }: NodeProps<Node<TieNodeData>>) {
  return <div className={`tie${selected ? " selected" : ""}${data.outOfLayer ? " out-of-layer" : ""}`} title={data.label} />;
}

export function HarnessLabelNode({ data }: NodeProps<Node<LabelNodeData>>) {
  const h = data.harness;
  const unnamed = h.anchors.length === 0;
  const doubled = h.anchors.length > 1;
  return (
    <div className={`harness-label${unnamed ? " unnamed" : ""}${doubled ? " doubled" : ""}${data.outOfLayer ? " out-of-layer" : ""}`} title={doubled ? "Two names in one piece" : unnamed ? "Unnamed harness" : h.partNumber ?? ""}>
      {h.label}
      {h.partNumber && <span className="muted"> {h.partNumber}</span>}
    </div>
  );
}
