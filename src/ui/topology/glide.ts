import { useEffect, useRef, useState } from "react";
import type { Position } from "../../core";

/** How long endpoints take to reach their new homes after an edit, in milliseconds. */
const GLIDE_MS = 350;
const ease = (f: number) => 1 - Math.pow(1 - f, 3);

const same = (a: Map<string, Position>, b: Map<string, Position>) => a.size === b.size && [...a].every(([id, p]) => b.get(id)?.x === p.x && b.get(id)?.y === p.y);

/**
 * Positions that glide from wherever they were drawn to `target` whenever it
 * changes, so the eye can follow what moved. An id new to the picture starts
 * at its entry in `from`, if the caller left one there, else at its target.
 * `from` is emptied once read.
 */
export function useGlide(target: Map<string, Position>, from: { current: Map<string, Position> }): Map<string, Position> {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const start = new Map(shownRef.current);
    for (const [id, p] of from.current) start.set(id, p);
    from.current = new Map();
    if (same(start, target)) {
      setShown(target);
      return;
    }
    // Draw the start at once, so an entry in `from` holds from this frame and not only from the first tick.
    setShown(start);
    const t0 = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const f = Math.min(1, (t - t0) / GLIDE_MS);
      if (f === 1) {
        setShown(target);
        return;
      }
      const e = ease(f);
      const next = new Map<string, Position>();
      for (const [id, p] of target) {
        const q = start.get(id) ?? p;
        next.set(id, { x: q.x + (p.x - q.x) * e, y: q.y + (p.y - q.y) * e });
      }
      setShown(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, from]);
  return shown;
}
