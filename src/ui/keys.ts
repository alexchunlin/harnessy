import type { Selection, SelectionView } from "./store";

/** True when a key press lands in a field the user types into, so canvas shortcuts must let it through. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/**
 * The ids a key press asks to turn a quarter: the whole selection when the
 * key is a bare R, the press is not in a field, and the selection belongs to
 * `view`. Empty otherwise. Each canvas decides what turning its ids means.
 */
export function turnSelection(e: KeyboardEvent, selection: Selection, view: SelectionView): string[] {
  if (e.key !== "r" && e.key !== "R") return [];
  if (e.metaKey || e.ctrlKey || e.altKey) return [];
  if (isTyping(e.target)) return [];
  if (selection.view !== view) return [];
  return selection.ids;
}
