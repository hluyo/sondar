import { describe, expect, it } from "vitest";
import { bitsPerChar, effectiveIdleMs, MAX_ENTRY, type RxEntry, RxFramer } from "./rxFramer";

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const asText = (b: Uint8Array) => String.fromCharCode(...b);

function setup(idleMs = 30) {
  const entries: RxEntry[] = [];
  const framer = new RxFramer((e) => entries.push(e), idleMs);
  const push = (s: string, time = 0) => framer.push(ascii(s), time);
  return { entries, framer, push, texts: () => entries.map((e) => e.text) };
}

describe("RxFramer", () => {
  it("joins an answer split into chunks", () => {
    const { push, entries } = setup();
    push("O", 100);
    push("K\r\n", 110);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ text: "OK", time: 100, end: "eol" });
    expect(asText(entries[0].bytes)).toBe("OK\r\n");
  });

  it("does not close a line just because its chunks arrive late", () => {
    // Only the backend's idle signal (a real silence on the wire) closes a line with no ending.
    const { push, entries } = setup();
    push("#05787 previous send took  5026", 0);
    push("91 cycles =  5984 us\r\n", 3);
    expect(entries.map((e) => e.text)).toEqual(["#05787 previous send took  502691 cycles =  5984 us"]);
  });

  it("splits several lines in one chunk", () => {
    const { push, texts } = setup();
    push("A=1\r\nB=2\r\nC=");
    expect(texts()).toEqual(["A=1", "B=2"]);
  });

  it("counts CR LF once when its bytes arrive in different chunks", () => {
    const { push, entries } = setup();
    push("OK\r");
    expect(entries).toHaveLength(0); // the LF may still come
    push("\nNEXT\r\n");
    expect(entries.map((e) => asText(e.bytes))).toEqual(["OK\r\n", "NEXT\r\n"]);
  });

  it("accepts CR, LF and LF CR as line endings", () => {
    const { push, texts } = setup();
    push("A\rB\nC\n\rD\r\n");
    expect(texts()).toEqual(["A", "B", "C", "D"]);
  });

  it("closes a lone CR at the next silence", () => {
    const { push, framer, entries } = setup();
    push("OK1\r");
    framer.idle();
    push("OK2\r");
    framer.idle();
    expect(entries.map((e) => [e.text, e.end])).toEqual([
      ["OK1", "eol"],
      ["OK2", "eol"],
    ]);
  });

  it("keeps blank lines", () => {
    const { push, framer, texts } = setup();
    push("A\r\n\r\nB\n\n");
    framer.idle();
    expect(texts()).toEqual(["A", "", "B", ""]);
  });

  it("closes messages with no line ending at a silence", () => {
    const { push, framer, entries } = setup();
    push("AB", 0);
    push("CD", 20);
    framer.idle();
    push("EFGH", 200);
    framer.idle();
    expect(entries.map((e) => [e.text, e.time, e.end])).toEqual([
      ["ABCD", 0, "idle"],
      ["EFGH", 200, "idle"],
    ]);
  });

  it("with idle 0 waits for a line ending", () => {
    const { push, framer, texts } = setup(0);
    push("ABCD");
    framer.idle();
    expect(texts()).toEqual([]);
    push("\r");
    framer.idle();
    expect(texts()).toEqual(["ABCD"]);
  });

  it("cuts very long entries", () => {
    const { push, entries } = setup(0);
    push("x".repeat(MAX_ENTRY + 5));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ end: "max" });
    expect(entries[0].bytes).toHaveLength(MAX_ENTRY);
  });

  it("flush closes the open entry", () => {
    const { push, framer, entries } = setup(0);
    push("PARTIAL");
    framer.flush();
    expect(entries.map((e) => [e.text, e.end])).toEqual([["PARTIAL", "flush"]]);
  });

  it("never drops or reorders bytes, however the stream is chunked", () => {
    const stream = Array.from({ length: 300 }, (_, i) => `line ${i}${["\r\n", "\n", "\r", "\n\r", ""][i % 5]}`).join("");
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 20; round++) {
      const { framer, entries } = setup();
      let i = 0;
      while (i < stream.length) {
        const n = 1 + Math.floor(random() * 12);
        framer.push(ascii(stream.slice(i, i + n)), i);
        i += n;
        if (random() < 0.1) framer.idle(); // a pause now and then
      }
      framer.flush();
      expect(entries.map((e) => asText(e.bytes)).join("")).toBe(stream);
    }
  });
});

describe("effectiveIdleMs", () => {
  it("uses the setting at normal baud rates", () => {
    expect(effectiveIdleMs(30, 115200)).toBe(30);
  });
  it("never goes below three characters on the wire", () => {
    expect(effectiveIdleMs(30, 300)).toBe(100);
  });
  it("0 stays off", () => {
    expect(effectiveIdleMs(0, 300)).toBe(0);
  });
  it("counts the frame bits", () => {
    expect(bitsPerChar({ dataBits: 8, parity: "none", stopBits: 1 })).toBe(10);
    expect(bitsPerChar({ dataBits: 7, parity: "even", stopBits: 2 })).toBe(11);
  });
});
