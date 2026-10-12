import { ES } from "./i18n.es";

export type Language = "en" | "es";
export type LanguagePreference = "auto" | Language;

let current: Language = "en";

/** "auto" follows the operating system: Spanish for any "es-*" locale, English otherwise. */
export function resolveLanguage(preference: LanguagePreference): Language {
  if (preference !== "auto") return preference;
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

/** Set once per render by App, before its children render. */
export function setLanguage(language: Language) {
  current = language;
  document.documentElement.lang = language;
}

export function getLanguage() {
  return current;
}

/**
 * Translates a UI string. The key is the English text itself, so a missing
 * translation simply shows English. Placeholders look like {name}.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let text = current === "es" ? (ES[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

/** Numbers with the local decimal separator (0,5 in Spanish). */
export function formatNumber(n: number, digits = 0) {
  return n.toLocaleString(current === "es" ? "es-ES" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
