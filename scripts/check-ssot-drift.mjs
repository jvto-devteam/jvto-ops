// SSOT drift: catches page prose assembled inline in a jvto-web consumer
// file instead of read from jvto-ekosistem, the single source of truth.
//
// A template literal or string concatenation assigned to a const named
// answerFirst/lede/summary/description (case-insensitively, as a substring)
// is exactly the shape the tours hub carried before its answer sentence and
// a locally computed price floor were found built in the consumer. Short
// literals are allowed through (a one-line placeholder isn't the failure
// mode this exists for); the 60-character floor is a proxy for "this is
// real assembled prose, not a stub." A read guarded by `page?.raw`, `pc.`,
// or `ecosystemPage` is exempt outright, template literal and all — that's
// the FALLBACK shape this checker wants to see, not the violation.
//
// Pure logic lives in checkAssembledContent() so tests exercise it against
// fixtures with no I/O. The CLI wrapper below walks jvto-web's src/app and
// src/components for .tsx files.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { finding, report, webRoot, requireRepo, rootOverride } from "./lib/repos.mjs";

const NAME_RE = /answerFirst|lede|summary|description/i;
const GUARD_RE = /page\?\.raw|\bpc\.|ecosystemPage/;
const LITERAL_SEGMENT_RE = /`([^`]*)`|"([^"]*)"|'([^']*)'/g;
const CONCAT_SHAPE_RE =
  /^(`[^`]*`|"[^"]*"|'[^']*')(\s*\+\s*(`[^`]*`|"[^"]*"|'[^']*'))*$/;
const MIN_LENGTH = 60;

function literalContentLength(expr) {
  let total = 0;
  for (const m of expr.matchAll(LITERAL_SEGMENT_RE)) {
    total += (m[1] ?? m[2] ?? m[3]).length;
  }
  return total;
}

/**
 * Checks one file's source text for prose assembled in the consumer. Pure —
 * takes the source and the file path to attribute findings to, does no I/O.
 */
export function checkAssembledContent(source, file) {
  const findings = [];
  const declRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;

  let m;
  while ((m = declRe.exec(source)) !== null) {
    const name = m[1];
    if (!NAME_RE.test(name)) continue;

    const expr = m[2].trim();
    if (GUARD_RE.test(expr)) continue; // read from ekosistem — this is the FALLBACK shape
    if (!CONCAT_SHAPE_RE.test(expr)) continue; // not a plain literal/concat assignment
    if (literalContentLength(expr) <= MIN_LENGTH) continue;

    findings.push(
      finding(
        "error",
        file,
        `\`${name}\` builds page prose in the consumer; read it from ekosistem and keep this only as a FALLBACK`,
      ),
    );
  }

  return findings;
}

function collectTsxFiles(root) {
  const dirs = [path.join(root, "src", "app"), path.join(root, "src", "components")];
  const files = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { recursive: true })) {
      if (!entry.endsWith(".tsx")) continue;
      const rel = entry.split(path.sep).join("/");
      if (rel.includes("/FALLBACK")) continue;
      if (rel.includes("src/lib/schemas")) continue;
      files.push(path.join(dir, entry));
    }
  }
  return files;
}

function main() {
  const argv = process.argv.slice(2);
  const web = requireRepo("web", webRoot(rootOverride(argv)));

  const findings = [];
  for (const file of collectTsxFiles(web)) {
    const source = readFileSync(file, "utf8");
    const rel = path.relative(web, file);
    findings.push(...checkAssembledContent(source, rel));
  }

  process.exit(report("check-ssot-drift", findings, argv));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
