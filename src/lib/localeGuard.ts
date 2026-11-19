/**
 * Makes sure `navigator.language` is a valid language tag before anything reads it.
 *
 * On Linux, WebKitGTK reports the system locale as is. With no locale set (`LANG=C`,
 * common on minimal installs, containers and some lab PCs) it says `"C"`, which is
 * not a valid BCP 47 tag, and uPlot calls `new Intl.NumberFormat(navigator.language)`
 * when it loads: the exception would stop the whole app from starting. POSIX-style
 * values such as `es_ES.UTF-8` are not valid either.
 *
 * Imported first in `main.tsx`, so it runs before any other module.
 */

const FALLBACK = "en-US";

function isValidTag(tag: string) {
  try {
    new Intl.NumberFormat(tag);
    return tag.length > 0;
  } catch {
    return false;
  }
}

/** A valid tag for a system locale: `es_ES.UTF-8` → `es-ES`, `C` or `POSIX` → `en-US`. */
export function normalizeLanguage(tag: string | undefined): string {
  const base = (tag ?? "").split(/[.@]/)[0];
  // "POSIX" looks like a valid tag (a 5-letter language subtag), so check it first.
  if (!base || /^(c|posix)$/i.test(base)) return FALLBACK;
  if (tag && isValidTag(tag)) return tag;
  const posix = base.replace(/_/g, "-");
  return isValidTag(posix) ? posix : FALLBACK;
}

if (typeof navigator !== "undefined") {
  const language = normalizeLanguage(navigator.language);
  if (language !== navigator.language) {
    const languages = (navigator.languages ?? []).map(normalizeLanguage);
    Object.defineProperty(navigator, "language", { value: language, configurable: true });
    Object.defineProperty(navigator, "languages", { value: languages.length ? languages : [language], configurable: true });
  }
}
