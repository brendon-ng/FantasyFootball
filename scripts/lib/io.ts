import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..", "..");
/** Shared across leagues: player metadata is league-agnostic. */
export const SHARED_DATA_DIR = join(ROOT, "data");
export const CACHE_DIR = join(ROOT, ".cache");

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Writes JSON with stable key ordering and a trailing newline.
 *
 * Stability matters more than it looks: these files are committed, and a sync
 * that reserialised the same data in a different key order would produce a diff
 * on every run, destroying the "only finalized data changes" signal in git.
 */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(sortKeys(value), null, 2) + "\n");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export function fileAgeMs(path: string): number {
  if (!existsSync(path)) return Infinity;
  return Date.now() - statSync(path).mtimeMs;
}

/** Zero-pads a week so `data/raw/2024/matchups/01.json` sorts lexicographically. */
export const wk = (week: number): string => String(week).padStart(2, "0");

export const log = {
  step: (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`),
  write: (msg: string) => console.log(`  \x1b[32m+\x1b[0m ${msg}`),
  skip: (msg: string) => console.log(`  \x1b[90m·\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`),
  info: (msg: string) => console.log(`  \x1b[36m→\x1b[0m ${msg}`),
};
