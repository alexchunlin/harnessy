import { create } from "zustand";

/**
 * Viewing preferences that live in the browser with the theme, not in the
 * project: whether the ratsnest is drawn.
 */

const RATSNEST_KEY = "harnessy.ratsnest";

interface PrefsState {
  /** Draw thin lines between the connectors of nets not yet routed. On by default. */
  ratsnest: boolean;
  setRatsnest(on: boolean): void;
}

export const usePrefs = create<PrefsState>()((set) => ({
  ratsnest: localStorage.getItem(RATSNEST_KEY) !== "off",
  setRatsnest(on) {
    localStorage.setItem(RATSNEST_KEY, on ? "on" : "off");
    set({ ratsnest: on });
  },
}));
