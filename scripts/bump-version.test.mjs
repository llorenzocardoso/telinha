import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION_FILES, applyVersion, currentVersion, nextVersion } from "./bump-version.mjs";

const repoTexts = () =>
  Object.fromEntries(VERSION_FILES.map(({ path }) => [path, readFileSync(path, "utf8")]));

describe("nextVersion", () => {
  it("bumps each level", () => {
    expect(nextVersion("0.7.1")).toBe("0.7.2");
    expect(nextVersion("0.7.1", "minor")).toBe("0.8.0");
    expect(nextVersion("0.7.1", "major")).toBe("1.0.0");
    expect(nextVersion("0.7.1", "1.2.3")).toBe("1.2.3");
  });

  it("rejects unknown levels", () => {
    expect(() => nextVersion("0.7.1", "huge")).toThrow(/Nível desconhecido/);
  });
});

describe("version files in this repo", () => {
  it("all agree on one version", () => {
    expect(currentVersion(repoTexts())).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("changes only the app version lines", () => {
    const texts = repoTexts();
    const from = currentVersion(texts);
    const updated = applyVersion(texts, from, "9.9.9");
    expect(currentVersion(updated)).toBe("9.9.9");
    for (const { path, count } of VERSION_FILES) {
      const before = texts[path].split(/\r?\n/);
      const after = updated[path].split(/\r?\n/);
      expect(after.length, path).toBe(before.length);
      const changed = after.filter((line, index) => line !== before[index]);
      expect(changed.length, path).toBe(count);
      expect(changed.every((line) => line.includes("9.9.9")), path).toBe(true);
    }
  });

  it("keeps dependency versions in the lockfiles", () => {
    const texts = repoTexts();
    const from = currentVersion(texts);
    const updated = applyVersion(texts, from, "9.9.9");
    const lock = JSON.parse(updated["package-lock.json"]);
    expect(lock.version).toBe("9.9.9");
    expect(lock.packages[""].version).toBe("9.9.9");
    const deps = Object.entries(lock.packages).filter(([key]) => key !== "");
    expect(deps.some(([, pkg]) => pkg.version === "9.9.9")).toBe(false);
  });
});

describe("currentVersion", () => {
  it("refuses files that disagree", () => {
    const texts = repoTexts();
    texts["src/lib/protocol.ts"] = 'export const APP_VERSION = "0.0.1";\n';
    expect(() => currentVersion(texts)).toThrow(/Versões diferentes/);
  });

  it("refuses a file without the version", () => {
    const texts = repoTexts();
    texts["src-tauri/Cargo.lock"] = "";
    expect(() => currentVersion(texts)).toThrow(/Cargo.lock/);
  });

  it("handles CRLF files", () => {
    const texts = repoTexts();
    texts["src-tauri/Cargo.lock"] = texts["src-tauri/Cargo.lock"].replace(/\r?\n/g, "\r\n");
    const from = currentVersion(texts);
    const updated = applyVersion(texts, from, "9.9.9");
    expect(updated["src-tauri/Cargo.lock"]).toContain('name = "telinha"\r\nversion = "9.9.9"');
  });
});
