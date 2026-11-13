import { useCallback, useState } from "react";
import { KEYS, storage } from "../lib/storage";

export type Theme = "light" | "dark";

/**
 * Light/dark mode. The starting theme is set by a small script in app.html before the page
 * draws (saved choice, else the computer's setting); this hook reads it and handles the toggle.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    storage.set(KEYS.theme, next);
    setTheme(next);
  }, [theme]);

  return { theme, toggleTheme };
}
