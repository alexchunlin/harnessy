import { useEffect, useRef } from "react";
import type { Domain } from "../../core";

export function DomainPicker({ domains, first, lastUsed, at, onPick, onCancel }: { domains: Domain[]; first: Set<string>; lastUsed: string | undefined; at: { x: number; y: number }; onPick: (id: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ordered = [...domains].sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onCancel]);
  useEffect(() => {
    (ref.current?.querySelector<HTMLButtonElement>("button.default") ?? ref.current?.querySelector("button"))?.focus();
  }, []);
  return (
    <div ref={ref} className="domain-picker" style={{ left: at.x, top: at.y }} role="dialog" aria-label="Choose a domain">
      <div className="muted">Domain for the new net</div>
      {ordered.map((d) => (
        <button key={d.id} className={d.id === lastUsed ? "default" : ""} onClick={() => onPick(d.id)} style={{ borderLeftColor: d.color }}>
          {d.name}
          {!first.has(d.id) && <span className="muted"> (other layer)</span>}
        </button>
      ))}
    </div>
  );
}
