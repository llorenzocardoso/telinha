// Sobe a versão do Telinha em todos os lugares onde ela aparece, como os commits
// "chore: bump version to X" faziam à mão.
//
//   node scripts/bump-version.mjs [patch|minor|major|X.Y.Z]   (padrão: patch)
//
// Imprime `version=X.Y.Z` (formato do $GITHUB_OUTPUT). Recusa se os arquivos discordarem
// entre si: melhor parar do que publicar versões misturadas.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const V = String.raw`(\d+\.\d+\.\d+)`;

/**
 * Onde a versão mora em cada arquivo. `count` é quantas ocorrências precisam existir
 * (o package-lock repete a versão na raiz e em `packages[""]`).
 */
export const VERSION_FILES = [
  { path: "package.json", pattern: new RegExp(String.raw`^(  "version": ")${V}(")`, "m"), count: 1 },
  { path: "package-lock.json", pattern: new RegExp(String.raw`^( {2}| {6})("version": ")${V}(")`, "gm"), count: 2, lock: true },
  { path: "server/package.json", pattern: new RegExp(String.raw`^(  "version": ")${V}(")`, "m"), count: 1 },
  { path: "server/package-lock.json", pattern: new RegExp(String.raw`^( {2}| {6})("version": ")${V}(")`, "gm"), count: 2, lock: true },
  { path: "src-tauri/tauri.conf.json", pattern: new RegExp(String.raw`^(  "version": ")${V}(")`, "m"), count: 1 },
  { path: "src-tauri/Cargo.toml", pattern: new RegExp(String.raw`^(version = ")${V}(")`, "m"), count: 1 },
  { path: "src-tauri/Cargo.lock", pattern: new RegExp(String.raw`^(name = "telinha"\r?\nversion = ")${V}(")`, "m"), count: 1 },
  { path: "src/lib/protocol.ts", pattern: new RegExp(String.raw`^(export const APP_VERSION = ")${V}(")`, "m"), count: 1 },
];

export function nextVersion(current, level = "patch") {
  if (SEMVER.test(level)) return level;
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`Versão atual inválida: ${current}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Nível desconhecido: ${level} (use patch, minor, major ou X.Y.Z)`);
}

/** No package-lock só valem as duas primeiras: a raiz e `packages[""]`. Depois vêm as dependências. */
function occurrences(spec, text) {
  const pattern = new RegExp(spec.pattern.source, spec.pattern.flags.includes("g") ? spec.pattern.flags : `${spec.pattern.flags}g`);
  const found = [...text.matchAll(pattern)];
  return spec.lock ? found.slice(0, spec.count) : found;
}

function versionOf(match) {
  return match.find((group, index) => index > 0 && SEMVER.test(group ?? ""));
}

/** Lê a versão de cada arquivo; erro se faltar alguma ocorrência ou se elas discordarem. */
export function currentVersion(texts) {
  const versions = new Set();
  for (const spec of VERSION_FILES) {
    const text = texts[spec.path];
    if (text === undefined) throw new Error(`Arquivo ausente: ${spec.path}`);
    const found = occurrences(spec, text);
    if (found.length !== spec.count) {
      throw new Error(`${spec.path}: esperava ${spec.count} versão(ões), achei ${found.length}`);
    }
    for (const match of found) versions.add(versionOf(match));
  }
  if (versions.size !== 1) throw new Error(`Versões diferentes entre os arquivos: ${[...versions].join(", ")}`);
  return [...versions][0];
}

/** Devolve os textos com a versão trocada, tocando só nas ocorrências conhecidas. */
export function applyVersion(texts, from, to) {
  const out = {};
  for (const spec of VERSION_FILES) {
    let remaining = spec.count;
    const pattern = new RegExp(spec.pattern.source, spec.pattern.flags.includes("g") ? spec.pattern.flags : `${spec.pattern.flags}g`);
    out[spec.path] = texts[spec.path].replace(pattern, (whole, ...groups) => {
      if (remaining === 0) return whole;
      const captured = groups.slice(0, -2);
      const index = captured.findIndex((group) => group === from);
      if (index < 0) return whole;
      remaining -= 1;
      captured[index] = to;
      return captured.join("");
    });
  }
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const level = process.argv[2] ?? "patch";
  const texts = Object.fromEntries(
    VERSION_FILES.map(({ path }) => [path, readFileSync(join(root, path), "utf8")]),
  );
  const from = currentVersion(texts);
  const to = nextVersion(from, level);
  if (to === from) throw new Error(`A versão já é ${to}`);
  const updated = applyVersion(texts, from, to);
  for (const [path, text] of Object.entries(updated)) writeFileSync(join(root, path), text);
  if (currentVersion(updated) !== to) throw new Error("A troca de versão não ficou consistente");
  console.log(`version=${to}`);
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
