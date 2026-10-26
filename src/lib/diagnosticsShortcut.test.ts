import { describe, expect, it } from "vitest";
import { isDiagnosticsShortcut } from "./diagnosticsShortcut";

const press = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>>) => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
});

describe("isDiagnosticsShortcut", () => {
  it("é Ctrl+Shift+D, com D maiúsculo ou minúsculo", () => {
    expect(isDiagnosticsShortcut(press("D", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDiagnosticsShortcut(press("d", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("não dispara sem os dois modificadores nem com outro junto", () => {
    expect(isDiagnosticsShortcut(press("d", { ctrlKey: true }))).toBe(false);
    expect(isDiagnosticsShortcut(press("d", { shiftKey: true }))).toBe(false);
    expect(isDiagnosticsShortcut(press("d", { ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isDiagnosticsShortcut(press("d", { ctrlKey: true, shiftKey: true, metaKey: true }))).toBe(false);
  });

  it("não dispara em outra tecla", () => {
    expect(isDiagnosticsShortcut(press("s", { ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
