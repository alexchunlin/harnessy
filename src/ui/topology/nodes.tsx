import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ENDPOINT_SIZE, type EndpointNodeData, type LabelNodeData, type TieNodeData } from "./model";

export function EndpointNode({ data, selected }: NodeProps<Node<EndpointNodeData>>) {
  const { endpoint, label, degree, onRoute } = data;
  const size = ENDPOINT_SIZE[endpoint.kind];
  const bad =
    (endpoint.kind === "connector" && degree !== 1) || (endpoint.kind === "point" && degree !== 2) || (endpoint.kind === "breakout" && degree < 3) || (endpoint.kind === "splice" && degree < 2);
  return (
    <div className={`ep ep-${endpoint.kind}${selected ? " selected" : ""}${bad ? " bad" : ""}${onRoute ? " on-route" : ""}`} style={{ width: size.w, height: size.h }} title={`${endpoint.kind}, ${degree} segment${degree === 1 ? "" : "s"}`}>
      {endpoint.kind === "connector" && <span className="ep-label">{label}</span>}
      {endpoint.kind === "breakout" && label && <span className="ep-tag">{label}</span>}
      {endpoint.kind === "splice" && <span className="ep-tag">{label}</span>}
      <Handle id="h" type="source" position={Position.Top} className="ep-handle" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} />
    </div>
  );
}

export function TieNode({ data, selected }: NodeProps<Node<TieNodeData>>) {
  return <div className={`tie${selected ? " selected" : ""}`} title={data.label} />;
}

export function HarnessLabelNode({ data }: NodeProps<Node<LabelNodeData>>) {
  const h = data.harness;
  const unnamed = h.anchors.length === 0;
  const doubled = h.anchors.length > 1;
  return (
    <div className={`harness-label${unnamed ? " unnamed" : ""}${doubled ? " doubled" : ""}`} title={doubled ? "Two names in one piece" : unnamed ? "Unnamed harness" : h.partNumber ?? ""}>
      {h.label}
      {h.partNumber && <span className="muted"> {h.partNumber}</span>}
    </div>
  );
}
