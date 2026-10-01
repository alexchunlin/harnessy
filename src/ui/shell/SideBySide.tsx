import { useCallback, useRef, useState } from "react";
import { ConnectivityView } from "../connectivity/ConnectivityView";
import { TopologyView } from "../topology/TopologyView";
import { clampDivider, DIVIDER_MAX, DIVIDER_MIN, usePrefs } from "../prefs";

/**
 * Connectivity on the left, topology on the right. Each canvas keeps its
 * own viewport, so panning one leaves the other alone; they share the
 * one selection. A plain draggable divider sets how the width is shared
 * and the browser remembers it.
 */
export function SideBySide() {
  const divider = usePrefs((s) => s.divider);
  const setDivider = usePrefs((s) => s.setDivider);
  const [live, setLive] = useState<number | undefined>();
  const ref = useRef<HTMLDivElement>(null);
  const pct = live ?? divider;

  const shareAt = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return divider;
      return clampDivider(((clientX - rect.left) / rect.width) * 100);
    },
    [divider],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setLive(shareAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) setLive(shareAt(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDivider(shareAt(e.clientX));
    setLive(undefined);
  };

  return (
    <div className="side-by-side" ref={ref} data-testid="side-by-side">
      <div className="side-pane side-pane-left" style={{ width: `${pct}%` }}>
        <ConnectivityView />
      </div>
      <div
        className="side-divider"
        role="separator"
        aria-label="Divider between connectivity and topology"
        aria-orientation="vertical"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={DIVIDER_MIN}
        aria-valuemax={DIVIDER_MAX}
        title="Drag to share the width between the two canvases"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="side-pane side-pane-right">
        <TopologyView />
      </div>
    </div>
  );
}
