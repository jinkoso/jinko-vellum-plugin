import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PLUGIN_NAME,
  derivePluginName,
  derivePluginNameFromPackageDir,
  derivePluginNameFromSkillScriptPath,
  resolvePluginName,
} from "../src/plugin-name.ts";

const INSTALLED =
  "/x/plugins/jinko-vellum-plugin/skills/jinko-travel/scripts/mcp-proxy.ts";

describe("plugin name", () => {
  test("derives the install-directory name from a skill script path", () => {
    expect(derivePluginNameFromSkillScriptPath(INSTALLED)).toBe(
      "jinko-vellum-plugin",
    );
    expect(derivePluginName(INSTALLED, {})).toBe("jinko-vellum-plugin");
  });

  test("VELLUM_PLUGIN_NAME overrides the path", () => {
    expect(
      derivePluginName(INSTALLED, { VELLUM_PLUGIN_NAME: "renamed-plugin" }),
    ).toBe("renamed-plugin");
    expect(derivePluginName(INSTALLED, { VELLUM_PLUGIN_NAME: "  " })).toBe(
      "jinko-vellum-plugin",
    );
  });

  test("a path outside an install tree falls back to the package dir", () => {
    const path = "/checkout/jinko-vellum-plugin/skills/x/scripts/proxy.ts";
    const exists = (candidate: string) =>
      candidate === "/checkout/jinko-vellum-plugin/package.json";
    expect(derivePluginNameFromSkillScriptPath(path)).toBeUndefined();
    expect(derivePluginNameFromPackageDir(path, exists)).toBe(
      "jinko-vellum-plugin",
    );
    expect(derivePluginName(path, {}, exists)).toBe("jinko-vellum-plugin");
  });

  test("with nothing to go on it falls back to the canonical name", () => {
    expect(resolvePluginName("/nowhere/proxy.ts", {}, () => false)).toBe(
      DEFAULT_PLUGIN_NAME,
    );
  });
});
