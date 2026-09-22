/**
 * Plugin identity for a process the assistant spawns from `mcp.json`.
 *
 * An MCP stdio child does not inherit the assistant's in-process plugin
 * context, and the host does not inject `VELLUM_PLUGIN_NAME` for MCP
 * children the way it does for bash and skill-sandbox children. The host's
 * own resolver (`assistant/src/plugin-api/plugin-name-env.ts`) therefore
 * falls back to the entry script path under
 * `plugins/<name>/skills/<skill>/{scripts,tools}/`. The functions here
 * reproduce that rule so the name this plugin puts in a credential
 * reference is the same name the host will scope that reference to.
 */

import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

/** Env var the host injects for bash and skill-sandbox children. */
export const PLUGIN_NAME_ENV = "VELLUM_PLUGIN_NAME";

/**
 * Name used when neither the env var, the installed-path layout, nor a
 * `package.json` walk-up yields one. It matches this repository's
 * directory name, which is also the install-directory basename the host
 * forces `package.json` `name` to equal.
 */
export const DEFAULT_PLUGIN_NAME = "jinko-vellum-plugin";

/** Directories the host accepts as a skill's script root. */
const SKILL_SCRIPT_ROOTS = new Set(["scripts", "tools"]);

/** Read the injected plugin name, ignoring empty and whitespace-only values. */
export function readPluginNameFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[PLUGIN_NAME_ENV];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read `<name>` out of a path shaped like
 * `.../plugins/<name>/skills/<skill>/{scripts,tools}/<file>`.
 *
 * The host anchors the same rule at its own workspace plugins directory;
 * this copy matches on the `plugins` segment instead, because the child
 * cannot see the host's workspace layout. Only the last such segment is
 * considered, so a path that merely contains the word elsewhere does not
 * produce a name from the wrong level.
 */
export function derivePluginNameFromSkillScriptPath(
  scriptPath: string,
): string | undefined {
  if (scriptPath.length === 0) {
    return undefined;
  }
  const parts = scriptPath.split(sep).filter((part) => part.length > 0);
  for (let i = parts.length - 5; i >= 0; i -= 1) {
    if (parts[i] !== "plugins") {
      continue;
    }
    const [name, skillsSeg, skillId, root] = parts.slice(i + 1, i + 5);
    if (
      name !== undefined &&
      name.length > 0 &&
      skillsSeg === "skills" &&
      skillId !== undefined &&
      skillId.length > 0 &&
      root !== undefined &&
      SKILL_SCRIPT_ROOTS.has(root)
    ) {
      return name;
    }
  }
  return undefined;
}

/**
 * Walk up from `scriptPath` to the nearest directory holding a
 * `package.json` and return that directory's basename. This is what makes
 * a checkout of this repository resolve to its own directory name when it
 * is run outside an install tree.
 */
export function derivePluginNameFromPackageDir(
  scriptPath: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (scriptPath.length === 0) {
    return undefined;
  }
  let dir = dirname(isAbsolute(scriptPath) ? scriptPath : resolve(scriptPath));
  for (;;) {
    if (exists(`${dir}${sep}package.json`)) {
      const name = basename(dir);
      return name.length > 0 ? name : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Plugin identity for `scriptPath`: the injected env var, then the
 * installed-path layout, then the nearest `package.json` directory.
 * Returns `undefined` when none of the three applies.
 */
export function derivePluginName(
  scriptPath: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  return (
    readPluginNameFromEnv(env) ??
    derivePluginNameFromSkillScriptPath(scriptPath) ??
    derivePluginNameFromPackageDir(scriptPath, exists)
  );
}

/** {@link derivePluginName} with {@link DEFAULT_PLUGIN_NAME} as the last resort. */
export function resolvePluginName(
  scriptPath: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  return derivePluginName(scriptPath, env, exists) ?? DEFAULT_PLUGIN_NAME;
}
