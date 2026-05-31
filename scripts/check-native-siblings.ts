#!/usr/bin/env bun
/**
 * check-native-siblings.ts — fail if a `*.native.{ts,tsx}` file in
 * packages/ui/src/ doesn't have a non-`.native` companion. Metro's
 * platform resolution falls through to the non-native file on web;
 * Vite's resolver plugin assumes the same. A missing sibling silently
 * breaks web while native works (or vice versa), depending on which
 * half was authored first.
 *
 * Run via `bun run check` (root). Cheap (< 50ms); aim is structural.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../packages/ui/src/", import.meta.url).pathname;

function* walk(dir: string): Generator<string> {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.native\.tsx?$/.test(ent)) yield p;
  }
}

const orphans: string[] = [];
for (const f of walk(ROOT)) {
  const sibling = f.replace(/\.native(\.tsx?)$/, "$1");
  if (!existsSync(sibling)) orphans.push(f);
}

if (orphans.length > 0) {
  console.error("check-native-siblings: ORPHAN .native files (no non-native sibling):");
  for (const o of orphans) console.error("  " + o);
  process.exit(1);
}
console.log("check-native-siblings: OK");
