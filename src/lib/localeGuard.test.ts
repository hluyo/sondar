import { describe, expect, it } from "vitest";
import { normalizeLanguage } from "./localeGuard";

describe("normalizeLanguage", () => {
  it("keeps valid tags", () => {
    expect(normalizeLanguage("es-ES")).toBe("es-ES");
    expect(normalizeLanguage("en")).toBe("en");
  });
  it("turns the POSIX locale into English", () => {
    expect(normalizeLanguage("C")).toBe("en-US");
    expect(normalizeLanguage("POSIX")).toBe("en-US");
    expect(normalizeLanguage("C.UTF-8")).toBe("en-US");
  });
  it("turns POSIX-style locales into tags", () => {
    expect(normalizeLanguage("es_ES.UTF-8")).toBe("es-ES");
    expect(normalizeLanguage("ca_ES@valencia")).toBe("ca-ES");
  });
  it("falls back when there is nothing usable", () => {
    expect(normalizeLanguage("")).toBe("en-US");
    expect(normalizeLanguage(undefined)).toBe("en-US");
  });
});
