#!/usr/bin/env bun
/**
 * Render `skills/jinko-travel/` from the vendored upstream skill.
 *
 * The travel guidance is not written here: it is Jinko's canonical Agent
 * Skills package, vendored pristine under `vendor/jinko-skills/`. This script
 * is the only thing that writes `skills/jinko-travel/SKILL.md`, so the
 * rendered file is a pure function of three inputs — the vendored upstream,
 * `vellum/frontmatter.json`, and `vellum/overlay.md` — and re-syncing upstream
 * never has to be reconciled by hand.
 *
 *   bun scripts/render-skill.ts            write the rendered tree
 *   bun scripts/render-skill.ts --check    exit 1 with a diff if it is stale
 *   bun scripts/render-skill.ts --out DIR  render somewhere else (tests)
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const VENDOR_DIR = join(REPO_ROOT, "vendor", "jinko-skills");
const OVERLAY_PATH = join(REPO_ROOT, "vellum", "overlay.md");
const VELLUM_FRONTMATTER_PATH = join(REPO_ROOT, "vellum", "frontmatter.json");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "skills", "jinko-travel");

/**
 * Upstream frontmatter fields carried into the rendered skill, in this order.
 * Anything else upstream adds is dropped rather than passed through blindly:
 * the Vellum loader's schema is the reason this list is short, and a silent
 * pass-through would be a schema change nobody reviewed.
 */
const CARRIED_TOP_LEVEL = ["name", "description", "compatibility"] as const;
const CARRIED_METADATA = ["author", "version", "surface"] as const;

/** Marks the start of the section this repo adds to the upstream body. */
const OVERLAY_BEGIN =
  "<!-- BEGIN vellum overlay — generated from vellum/overlay.md by scripts/render-skill.ts -->";
const OVERLAY_END = "<!-- END vellum overlay -->";

/**
 * The overlay is inserted immediately before this heading so that upstream's
 * list of `references/*.md` links stays the last thing in the file, where a
 * "read next" list belongs. When upstream has no such heading the overlay is
 * appended instead, and the renderer says so on stderr.
 */
const READ_NEXT_HEADING = "## Read next";

// ─── Frontmatter ─────────────────────────────────────────────────────────────

export interface Frontmatter {
  /** Decoded scalar values, top level only. */
  readonly fields: ReadonlyMap<string, string>;
  /** Decoded scalar values under `metadata:`. */
  readonly metadata: ReadonlyMap<string, string>;
  /** Raw (still YAML-quoted) text of each top-level scalar, for re-emission. */
  readonly rawFields: ReadonlyMap<string, string>;
  /** Raw text of each `metadata:` scalar. */
  readonly rawMetadata: ReadonlyMap<string, string>;
  /** The document after the closing `---`. */
  readonly body: string;
}

const SCALAR_LINE = /^(\s*)([A-Za-z0-9_-]+):[ \t]*(.*)$/;

/**
 * Parse the strictly-shaped frontmatter upstream writes: top-level scalars
 * plus a `metadata:` block of two-space-indented scalars. Anything richer
 * (nested blocks, block scalars, sequences) throws instead of being guessed
 * at — a renderer that quietly mangles an upstream edit is worse than one
 * that stops.
 */
export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith("---\n")) {
    throw new Error("frontmatter: file does not start with '---'");
  }
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) {
    throw new Error("frontmatter: no closing '---' line");
  }

  const fields = new Map<string, string>();
  const metadata = new Map<string, string>();
  const rawFields = new Map<string, string>();
  const rawMetadata = new Map<string, string>();

  let inMetadata = false;
  for (const line of text.slice(4, end).split("\n")) {
    if (line.trim() === "") continue;
    const match = SCALAR_LINE.exec(line);
    if (!match) {
      throw new Error(`frontmatter: unsupported line ${JSON.stringify(line)}`);
    }
    const [, indent, key, rawValue] = match as unknown as [
      string,
      string,
      string,
      string,
    ];
    if (indent === "") {
      if (key === "metadata") {
        if (rawValue !== "") {
          throw new Error("frontmatter: 'metadata' must open a block");
        }
        inMetadata = true;
        continue;
      }
      inMetadata = false;
      if (rawValue === "") {
        throw new Error(`frontmatter: '${key}' opens an unsupported block`);
      }
      fields.set(key, decodeScalar(rawValue));
      rawFields.set(key, rawValue);
      continue;
    }
    if (!inMetadata || indent !== "  ") {
      throw new Error(`frontmatter: unsupported nesting at ${JSON.stringify(line)}`);
    }
    if (rawValue === "") {
      throw new Error(`frontmatter: 'metadata.${key}' opens an unsupported block`);
    }
    metadata.set(key, decodeScalar(rawValue));
    rawMetadata.set(key, rawValue);
  }

  return {
    fields,
    metadata,
    rawFields,
    rawMetadata,
    body: text.slice(end + "\n---\n".length),
  };
}

/** Decode the three scalar forms upstream uses: double-quoted, single, bare. */
function decodeScalar(raw: string): string {
  if (raw.startsWith('"')) {
    if (!raw.endsWith('"') || raw.length < 2) {
      throw new Error(`frontmatter: unterminated quoted scalar ${raw.slice(0, 40)}`);
    }
    return raw
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_all, escape: string) =>
        escape === "n" ? "\n" : escape === "t" ? "\t" : escape,
      );
  }
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'") || raw.length < 2) {
      throw new Error(`frontmatter: unterminated quoted scalar ${raw.slice(0, 40)}`);
    }
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

/** Emit a YAML double-quoted scalar. */
function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

// ─── Vellum metadata block ───────────────────────────────────────────────────

type VellumMetadata = Record<string, string | readonly string[]>;

export function readVellumMetadata(
  path: string = VELLUM_FRONTMATTER_PATH,
): VellumMetadata {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object`);
  }
  const result: VellumMetadata = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      result[key] = value as string[];
      continue;
    }
    throw new Error(
      `${path}: '${key}' must be a string or an array of strings; the Vellum ` +
        "metadata.vellum schema has no other shape this renderer emits",
    );
  }
  return result;
}

/** Render `metadata.vellum` at the indentation the merged frontmatter uses. */
function renderVellumMetadata(metadata: VellumMetadata): string[] {
  const lines = ["  vellum:"];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      lines.push(`    ${key}: ${quote(value)}`);
      continue;
    }
    lines.push(`    ${key}:`);
    for (const item of value) lines.push(`      - ${quote(item)}`);
  }
  return lines;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export interface RenderedTree {
  /** Path relative to the skill directory → file contents. */
  readonly files: ReadonlyMap<string, string>;
  /** Non-fatal notes about how the render was assembled. */
  readonly notes: readonly string[];
}

export function renderSkill(vendorDir: string = VENDOR_DIR): RenderedTree {
  const upstream = parseFrontmatter(
    readFileSync(join(vendorDir, "SKILL.md"), "utf8"),
  );
  const overlay = readFileSync(OVERLAY_PATH, "utf8").trim();
  const vellum = readVellumMetadata();
  const notes: string[] = [];

  const frontmatter = ["---"];
  for (const key of CARRIED_TOP_LEVEL) {
    const raw = upstream.rawFields.get(key);
    if (raw === undefined) {
      throw new Error(`vendor SKILL.md: missing required '${key}' in frontmatter`);
    }
    frontmatter.push(`${key}: ${raw}`);
  }
  frontmatter.push("metadata:");
  for (const key of CARRIED_METADATA) {
    const raw = upstream.rawMetadata.get(key);
    if (raw !== undefined) frontmatter.push(`  ${key}: ${raw}`);
  }
  frontmatter.push(...renderVellumMetadata(vellum), "---");

  const block = [OVERLAY_BEGIN, "", overlay, "", OVERLAY_END].join("\n");
  const body = upstream.body.trim();
  const heading = `\n${READ_NEXT_HEADING}`;
  const at = body.indexOf(heading);
  const insertable = at !== -1 && at === body.lastIndexOf(heading);
  notes.push(
    insertable
      ? `overlay placed before '${READ_NEXT_HEADING}'`
      : at === -1
        ? `'${READ_NEXT_HEADING}' not found in the vendored body; overlay appended at the end`
        : `'${READ_NEXT_HEADING}' appears more than once; overlay appended at the end`,
  );
  const merged = insertable
    ? `${body.slice(0, at).trimEnd()}\n\n${block}\n${body.slice(at)}`
    : `${body}\n\n${block}`;

  const files = new Map<string, string>([
    ["SKILL.md", `${frontmatter.join("\n")}\n\n${merged}\n`],
  ]);
  const referencesDir = join(vendorDir, "references");
  for (const entry of readdirSync(referencesDir).sort()) {
    if (!entry.endsWith(".md")) continue;
    files.set(`references/${entry}`, readFileSync(join(referencesDir, entry), "utf8"));
  }
  return { files, notes };
}

// ─── Writing and checking ────────────────────────────────────────────────────

function write(tree: RenderedTree, outDir: string): void {
  for (const [relative, contents] of tree.files) {
    const path = join(outDir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

/**
 * Compare the render against what is on disk. Only the rendered paths and the
 * rendered tree's own `references/` are considered: `scripts/` lives in the
 * same skill directory and is hand-written.
 */
export function checkRendered(tree: RenderedTree, outDir: string): string[] {
  const problems: string[] = [];
  for (const [relative, expected] of tree.files) {
    const path = join(outDir, relative);
    let actual: string;
    try {
      actual = readFileSync(path, "utf8");
    } catch {
      problems.push(`--- ${relative} (missing)\n+++ ${relative} (rendered)`);
      continue;
    }
    if (actual === expected) continue;
    problems.push(unifiedDiff(relative, actual, expected));
  }

  let present: string[];
  try {
    present = readdirSync(join(outDir, "references"));
  } catch {
    present = [];
  }
  for (const entry of present.sort()) {
    if (entry.endsWith(".md") && !tree.files.has(`references/${entry}`)) {
      problems.push(
        `references/${entry} is not produced by the render; it is stale from an ` +
          "earlier upstream and should be removed",
      );
    }
  }
  return problems;
}

/** Longest-common-subsequence unified diff. The rendered files are small. */
export function unifiedDiff(
  label: string,
  actual: string,
  expected: string,
  context = 3,
): string {
  const a = actual.split("\n");
  const b = expected.split("\n");
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  type Edit = { readonly sign: " " | "-" | "+"; readonly text: string };
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      edits.push({ sign: " ", text: a[i]! });
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      edits.push({ sign: "-", text: a[i]! });
      i++;
    } else {
      edits.push({ sign: "+", text: b[j]! });
      j++;
    }
  }
  for (; i < a.length; i++) edits.push({ sign: "-", text: a[i]! });
  for (; j < b.length; j++) edits.push({ sign: "+", text: b[j]! });

  const keep = new Array<boolean>(edits.length).fill(false);
  edits.forEach((edit, index) => {
    if (edit.sign === " ") return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(edits.length - 1, index + context);
      k++
    ) {
      keep[k] = true;
    }
  });

  const out = [`--- ${label} (on disk)`, `+++ ${label} (rendered)`];
  let aLine = 1;
  let bLine = 1;
  let hunk: string[] = [];
  let hunkStart: [number, number] | undefined;
  let aCount = 0;
  let bCount = 0;
  const flush = () => {
    if (hunkStart === undefined) return;
    out.push(`@@ -${hunkStart[0]},${aCount} +${hunkStart[1]},${bCount} @@`, ...hunk);
    hunk = [];
    hunkStart = undefined;
    aCount = 0;
    bCount = 0;
  };
  edits.forEach((edit, index) => {
    if (keep[index]) {
      hunkStart ??= [aLine, bLine];
      hunk.push(`${edit.sign}${edit.text}`);
      if (edit.sign !== "+") aCount++;
      if (edit.sign !== "-") bCount++;
    } else {
      flush();
    }
    if (edit.sign !== "+") aLine++;
    if (edit.sign !== "-") bLine++;
  });
  flush();
  return out.join("\n");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const outIndex = args.indexOf("--out");
  const outDir =
    outIndex === -1 ? DEFAULT_OUT_DIR : resolve(args[outIndex + 1] ?? "");
  if (outIndex !== -1 && args[outIndex + 1] === undefined) {
    console.error("--out needs a directory");
    process.exit(2);
  }

  const tree = renderSkill();
  for (const note of tree.notes) console.error(`render-skill: ${note}`);

  if (check) {
    const problems = checkRendered(tree, outDir);
    if (problems.length > 0) {
      console.error(
        `${outDir} does not match the render. Run: bun scripts/render-skill.ts`,
      );
      console.log(problems.join("\n\n"));
      process.exit(1);
    }
    console.error(`render-skill: ${outDir} is up to date`);
  } else {
    write(tree, outDir);
    console.error(
      `render-skill: wrote ${tree.files.size} file(s) under ${outDir}`,
    );
  }
}
