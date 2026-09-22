import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseFrontmatter,
  renderSkill,
  REPO_ROOT,
} from "../scripts/render-skill.ts";

const RENDER_SCRIPT = join(REPO_ROOT, "scripts", "render-skill.ts");
const SKILL_DIR = join(REPO_ROOT, "skills", "jinko-travel");
const VENDOR_SKILL = join(REPO_ROOT, "vendor", "jinko-skills", "SKILL.md");

interface RenderedFrontmatter {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly metadata?: { readonly vellum?: Record<string, unknown> };
}

/** Parse the rendered frontmatter the way a YAML-reading host would. */
function frontmatterOf(skillMarkdown: string): RenderedFrontmatter {
  const end = skillMarkdown.indexOf("\n---\n", 3);
  expect(skillMarkdown.startsWith("---\n")).toBe(true);
  expect(end).toBeGreaterThan(0);
  return Bun.YAML.parse(skillMarkdown.slice(4, end)) as RenderedFrontmatter;
}

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", RENDER_SCRIPT, ...args], { cwd: REPO_ROOT });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function withTempDir(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "render-skill-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("render-skill", () => {
  test("rendering twice produces the same bytes", () => {
    withTempDir((dir) => {
      expect(run(["--out", dir]).exitCode).toBe(0);
      const first = new Map(
        [...renderSkill().files.keys()].map((relative) => [
          relative,
          readFileSync(join(dir, relative), "utf8"),
        ]),
      );
      expect(run(["--out", dir]).exitCode).toBe(0);
      for (const [relative, contents] of first) {
        expect(readFileSync(join(dir, relative), "utf8")).toBe(contents);
      }
      expect(run(["--check", "--out", dir]).exitCode).toBe(0);
    });
  });

  test("the rendered frontmatter carries upstream's fields and the Vellum block", () => {
    const rendered = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    const frontmatter = frontmatterOf(rendered);
    const upstream = parseFrontmatter(readFileSync(VENDOR_SKILL, "utf8"));

    expect(frontmatter.name).toBe("jinko-travel");
    expect(frontmatter.description).toBe(upstream.fields.get("description"));
    expect(typeof frontmatter.description).toBe("string");
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect(frontmatter.metadata?.vellum?.category).toBe("travel");
  });

  test("the rendered body carries upstream's tool map and the Link overlay", () => {
    const rendered = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
    expect(rendered).toContain("\n## Tool map\n");
    expect(rendered).toContain("\n## Paying with Link\n");
    expect(rendered).toContain("500 USD per-request cap on Link spend requests");
    // The overlay sits before the references list so "Read next" stays last.
    expect(rendered.indexOf("## Paying with Link")).toBeLessThan(
      rendered.indexOf("## Read next"),
    );
  });

  test("--check passes on the committed tree", () => {
    const result = run(["--check"]);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("--check reports a unified diff when a rendered file is altered", () => {
    withTempDir((dir) => {
      expect(run(["--out", dir]).exitCode).toBe(0);

      const skillPath = join(dir, "SKILL.md");
      const original = readFileSync(skillPath, "utf8");
      writeFileSync(skillPath, original.replace("## Tool map", "## Tool list"));
      const edited = run(["--check", "--out", dir]);
      expect(edited.exitCode).toBe(1);
      expect(edited.stdout).toContain("--- SKILL.md (on disk)");
      expect(edited.stdout).toContain("-## Tool list");
      expect(edited.stdout).toContain("+## Tool map");

      writeFileSync(skillPath, original);
      rmSync(join(dir, "references", "places.md"));
      const missing = run(["--check", "--out", dir]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stdout).toContain("references/places.md (missing)");
    });
  });
});
