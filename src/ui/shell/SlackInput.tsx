import { useState } from "react";

/** A millimetre field that commits on blur or Enter, so one edit is one undo step. Negative or non-numeric input reverts. */
export function SlackInput({ label, value, placeholder, onCommit }: { label: string; value: number | undefined; placeholder: string; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const commit = () => {
    const v = text.trim() === "" ? undefined : Number(text);
    if (v !== undefined && !(v >= 0)) {
      setText(value === undefined ? "" : String(value));
      return;
    }
    if (v !== value) onCommit(v);
  };
  return (
    <input
      type="number"
      min={0}
      style={{ width: 70 }}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(ev) => setText(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") ev.currentTarget.blur();
        if (ev.key === "Escape") setText(value === undefined ? "" : String(value));
      }}
    />
  );
}
