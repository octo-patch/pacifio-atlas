import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The lint-suppression ratchet.
 *
 * A suppression comment is invisible to every other gate by definition: the
 * line it silences type-checks, lints clean (that is what the comment is
 * FOR), renders, and passes its tests. So a tree can add one suppression a week
 * and nothing anywhere goes red; the first anyone learns of it is a reading of
 * the file. Only a suite that counts the comments can see the number grow.
 *
 * That is the whole job here, and it is a RATCHET rather than a ban because the
 * tree starts with real, argued suppressions (a regex that matches control
 * bytes on purpose, a dependency list keyed on a signature string, a thrown
 * plain object that mirrors Rust's `Err(PrError)`). The committed baseline
 * below holds the count per rule and can only go down:
 *
 *  - a count ABOVE its baseline fails: the new suppression needs either a fix
 *    or an argued baseline bump in the same diff, which a reviewer will see;
 *  - a rule with NO baseline entry fails the same way (its baseline is 0);
 *  - a count BELOW its baseline fails too, telling you to lower the baseline.
 *    Without that, a removed suppression leaves slack and the next one slips
 *    in under the old number;
 *  - an `eslint-` prefix fails outright. oxlint is the only linter, and both
 *    prefixes work, which is exactly why a tree drifts into mixing them. Use
 *    `oxlint-disable-next-line` / `oxlint-disable`.
 *
 * Scope is `src/`, excluding `*.test.ts(x)`: a test may suppress what it needs.
 * Counted per comment, not per rule listed in it, so `a, b` counts once for
 * each rule named.
 *
 * Note that a suppression for a rule the config does not enable (today: most of
 * `react-hooks/*`, `jsx-a11y/*`, `no-console`) does nothing yet; it records the
 * intent for the day that plugin is switched on, and is counted all the same.
 * `typescript/no-explicit-any` IS enabled as an error in `.oxlintrc.json`, so a
 * new `any` needs a suppression, and a suppression shows up here.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = "src";

/** Rule → how many suppressions of it `src/` may carry. Only ever lowered. */
const BASELINE: Record<string, number> = {
  "jsx-a11y/alt-text": 2,
  "jsx-a11y/media-has-caption": 1,
  "jsx-a11y/no-autofocus": 6,
  "jsx-a11y/no-static-element-interactions": 1,
  "no-control-regex": 6,
  "no-throw-literal": 6,
  "react-hooks/exhaustive-deps": 50,
  "react/no-array-index-key": 5,
  "react/no-danger": 2,
  "react/set-state-in-effect": 1,
  "typescript/no-explicit-any": 5,
};

const DIRECTIVE = /\b(eslint|oxlint)-disable(?:-next-line|-line)?\s+([^\n]*)/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

interface Scan {
  counts: Record<string, number>;
  eslintPrefixed: string[];
}

function scan(): Scan {
  const counts: Record<string, number> = {};
  const eslintPrefixed: string[] = [];
  for (const file of walk(path.join(REPO_ROOT, SCAN_ROOT))) {
    const where = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const match of line.matchAll(DIRECTIVE)) {
          if (match[1] === "eslint") eslintPrefixed.push(`${where}:${i + 1}`);
          // Rules end at the `--` that starts the reason, or at a closing `*/`.
          const rules = match[2]
            .split(/\s--\s|\*\//)[0]
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
          for (const rule of rules) counts[rule] = (counts[rule] ?? 0) + 1;
        }
      });
  }
  return { counts, eslintPrefixed };
}

describe("lint-suppression ratchet", () => {
  const { counts, eslintPrefixed } = scan();

  it("uses the oxlint prefix, never eslint", () => {
    expect(
      eslintPrefixed,
      "oxlint is the only linter. Write `oxlint-disable-next-line <rule>` instead.",
    ).toEqual([]);
  });

  it("no rule carries more suppressions than its baseline", () => {
    const grew = Object.entries(counts)
      .filter(([rule, n]) => n > (BASELINE[rule] ?? 0))
      .map(([rule, n]) => `  ${rule}: ${n} (baseline ${BASELINE[rule] ?? "none"})`);
    expect(
      grew,
      [
        "A suppression was added. Fix the code instead; if the rule truly cannot apply,",
        "raise the baseline in this file in the same diff and say why in the commit.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("the baseline is as low as the tree allows", () => {
    const slack = Object.entries(BASELINE)
      .filter(([rule, n]) => (counts[rule] ?? 0) < n)
      .map(([rule, n]) => `  ${rule}: ${counts[rule] ?? 0} now, baseline ${n}`);
    expect(
      slack,
      "Suppressions were removed. Lower BASELINE in tests/lint-suppression-ratchet.test.ts to match, so the number only goes down.",
    ).toEqual([]);
  });
});
