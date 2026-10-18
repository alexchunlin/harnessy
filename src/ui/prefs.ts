import { create } from "zustand";

/**
 * Viewing preferences that live in the browser with the theme, not in the
 * project: whether the ratsnest is drawn, where the side by side divider
 * sits, and whether the 3D view moves a harness whole or stretches it.
 */

const RATSNEST_KEY = "harnessy.ratsnest";
const DIVIDER_KEY = "harnessy.divider";
const LENGTHS_KEY = "harnessy.lengths";

export const DIVIDER_MIN = 20;
export const DIVIDER_MAX = 80;

/** Keep the divider where both canvases stay usable. */
export function clampDivider(pct: number): number {
  if (!Number.isFinite(pct)) return 50;
  return Math.min(DIVIDER_MAX, Math.max(DIVIDER_MIN, pct));
}

interface PrefsState {
  /** Draw thin lines between the connectors of nets not yet routed. On by default. */
  ratsnest: boolean;
  setRatsnest(on: boolean): void;
  /** The share of the width the connectivity canvas gets in the side by side view, as a percentage. */
  divider: number;
  setDivider(pct: number): void;
  /** Lengths locked: a drag in 3D moves the whole harness. Off is Stretch: one part moves alone. On by default. */
  lengthsLocked: boolean;
  setLengthsLocked(on: boolean): void;
  /** How far the reference model is faded so the harness shows through it, from 0 (solid) to 0.9. */
  referenceDimness: number;
  setReferenceDimness(d: number): void;
}

const DIMNESS_KEY = "harnessy.referenceDimness";
const DIMNESS_DEFAULT = 0.4;
function clampDimness(d: number): number {
  return Number.isFinite(d) ? Math.min(0.9, Math.max(0, d)) : DIMNESS_DEFAULT;
}

export const usePrefs = create<PrefsState>()((set) => ({
  ratsnest: localStorage.getItem(RATSNEST_KEY) !== "off",
  setRatsnest(on) {
    localStorage.setItem(RATSNEST_KEY, on ? "on" : "off");
    set({ ratsnest: on });
  },
  referenceDimness: clampDimness(Number(localStorage.getItem(DIMNESS_KEY) ?? DIMNESS_DEFAULT)),
  setReferenceDimness(d) {
    const referenceDimness = clampDimness(d);
    localStorage.setItem(DIMNESS_KEY, String(referenceDimness));
    set({ referenceDimness });
  },
  divider: clampDivider(Number(localStorage.getItem(DIVIDER_KEY) ?? 50)),
  setDivider(pct) {
    const divider = clampDivider(pct);
    localStorage.setItem(DIVIDER_KEY, String(divider));
    set({ divider });
  },
  lengthsLocked: localStorage.getItem(LENGTHS_KEY) !== "stretch",
  setLengthsLocked(on) {
    localStorage.setItem(LENGTHS_KEY, on ? "locked" : "stretch");
    set({ lengthsLocked: on });
  },
}));
