import { create } from "zustand";

/** Canvas theme. Dark by default; the choice lives in the browser, not the project. */
export type Theme = "dark" | "light";

const THEME_KEY = "harnessy.theme";

function stored(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  setTheme(theme: Theme): void;
}

export const useTheme = create<ThemeState>()((set) => ({
  theme: stored(),
  setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    apply(theme);
    set({ theme });
  },
}));

apply(useTheme.getState().theme);
