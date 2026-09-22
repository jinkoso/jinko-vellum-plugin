#!/usr/bin/env bun
/**
 * Refresh `vendor/jinko-skills/` from Jinko's canonical Agent Skills package
 * and re-render `skills/jinko-travel/`.
 *
 *   bun scripts/sync-upstream.ts /path/to/jinko-skills   from a local checkout
 *   bun scripts/sync-upstream.ts                         shallow-clone upstream
 *
 * jinkoso/jinko-skills is an internal repository, so the clone needs the
 * maintainer's git credentials. CI never runs this script; it runs
 * `bun scripts/render-skill.ts --check` against what is committed here.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { REPO_ROOT } from "./render-skill.ts";

const UPSTREAM_REPO = "jinkoso/jinko-skills";
const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPO}.git`;
const UPSTREAM_PATH = "skills/jinko-travel";

const VENDOR_DIR = join(REPO_ROOT, "vendor", "jinko-skills");

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString().trim();
}

const argument = process.argv[2];
let source: string;
let clone: string | undefined;

if (argument === undefined) {
  clone = mkdtempSync(join(tmpdir(), "jinko-skills-"));
  console.error(`sync-upstream: cloning ${UPSTREAM_URL} into ${clone}`);
  const result = Bun.spawnSync(["git", "clone", "--depth", "1", UPSTREAM_URL, clone], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    rmSync(clone, { recursive: true, force: true });
    console.error(
      `sync-upstream: clone failed. ${UPSTREAM_REPO} is internal — either ` +
        "authenticate git for it, or pass the path to a local checkout.",
    );
    process.exit(1);
  }
  source = clone;
} else {
  source = resolve(argument);
}

try {
  const commit = git(source, "rev-parse", "HEAD");
  const dirty = git(source, "status", "--porcelain");
  if (dirty !== "") {
    console.error(
      `sync-upstream: WARNING — ${source} has uncommitted changes, so the ` +
        `vendored files will not match commit ${commit}.`,
    );
  }

  const skillDir = join(source, UPSTREAM_PATH);
  writeFileSync(
    join(VENDOR_DIR, "SKILL.md"),
    readFileSync(join(skillDir, "SKILL.md"), "utf8"),
  );

  const referencesFrom = join(skillDir, "references");
  const referencesTo = join(VENDOR_DIR, "references");
  for (const stale of readdirSync(referencesTo)) {
    if (stale.endsWith(".md")) rmSync(join(referencesTo, stale));
  }
  const copied: string[] = [];
  for (const entry of readdirSync(referencesFrom).sort()) {
    if (!entry.endsWith(".md")) continue;
    writeFileSync(
      join(referencesTo, entry),
      readFileSync(join(referencesFrom, entry), "utf8"),
    );
    copied.push(entry);
  }

  writeFileSync(
    join(VENDOR_DIR, "UPSTREAM.json"),
    `${JSON.stringify(
      {
        repo: UPSTREAM_REPO,
        commit,
        path: UPSTREAM_PATH,
        syncedAt: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
  );
  console.error(
    `sync-upstream: vendored SKILL.md + ${copied.join(", ")} at ${commit}`,
  );
} finally {
  if (clone !== undefined) rmSync(clone, { recursive: true, force: true });
}

const render = Bun.spawnSync(["bun", join(REPO_ROOT, "scripts", "render-skill.ts")], {
  cwd: REPO_ROOT,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(render.exitCode ?? 1);
