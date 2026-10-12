import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const query = () => window.matchMedia("(prefers-color-scheme: light)");

/** Resolves the preference against the OS setting and applies it to the page. */
export function useTheme(preference: ThemePreference): Theme {
  const [systemLight, setSystemLight] = useState(() => query().matches);

  useEffect(() => {
    const media = query();
    const onChange = () => setSystemLight(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = preference === "system" ? (systemLight ? "light" : "dark") : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return theme;
}

/** Current value of a CSS color token, e.g. cssColor("--color-muted"). */
export function cssColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
