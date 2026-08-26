// SSOT drift: catches page prose assembled inline in a jvto-web consumer
// file instead of read from jvto-ekosistem, the single source of truth.
//
// A const named answerFirst/lede/summary/description (case-insensitively,
// as a substring) is flagged when its assigned expression splices a runtime
// value into prose:
//
//   - a template literal containing `${...}` interpolation, or
//   - a `+` joining a string/template literal to anything else — another
//     literal (the brief's original "string concatenation" case), or a
//     computed expression like `priceFloor.toLocaleString()` (the /tours
//     hub shape: an answer sentence and a locally computed price floor
//     built in the consumer, which is the reason this checker exists).
//
// The shape of the literal is not the signal — splicing is. A lone
// template literal with NO `${}` is just a plain string that happens to use
// backtick quoting, and a lone plain string is never flagged either,
// however long: both are either a FALLBACK constant consumed after an
// ekosistem read, or a constant for a route with no ekosistem counterpart
// at all. Neither is this checker's business, and it fires from a
// PostToolUse hook on every .tsx edit — flagging correct code is how a
// checker gets muted.
//
// Short splices are allowed through too (a one-line placeholder isn't the
// failure mode this exists for); the 60-character floor on the literal
// portions is a proxy for "this is real assembled prose, not a stub." A
// read guarded by `page?.raw`, `pc.`, or `ecosystemPage` is exempt outright
// — that's the FALLBACK shape this checker wants to see, not the violation.
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

// A template literal counts as "assembled" only when it splices a runtime
// value in via ${...} — a lone backtick literal used just for quoting
// convenience, with no interpolation, is exactly the same as a lone plain
// string and is not this checker's business.
const INTERPOLATED_TEMPLATE_RE = /`[^`]*\$\{/;

// A `+` joining a string/template literal to anything else — checked as
// "contains", not "the whole expression is only this" — so a ternary whose
// live branch is guarded (see GUARD_RE above) can still carry a fallback
// template literal without tripping this on its own; the guard is what
// exempts it, not the shape check failing to notice it.
const LITERAL_CONCAT_RE =
  /(`[^`]*`|"[^"]*"|'[^']*')\s*\+|\+\s*(`[^`]*`|"[^"]*"|'[^']*')/;

const MIN_LENGTH = 60;

function isAssembledShape(expr) {
  return INTERPOLATED_TEMPLATE_RE.test(expr) || LITERAL_CONCAT_RE.test(expr);
}

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
    if (!isAssembledShape(expr)) continue; // no interpolation, no concatenation — not assembled
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

// Manual recursive walk rather than readdirSync(dir, { recursive: true }):
// the built-in recursive option follows symlinked directories, which can
// point outside the repo entirely or cycle back on itself. A checker that
// reads outside the tree it was pointed at, or hangs on a symlink loop, is
// a defect regardless of how unlikely the setup is — so symlinked
// directories are skipped, never descended into.
function walkFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function collectTsxFiles(root) {
  const dirs = [path.join(root, "src", "app"), path.join(root, "src", "components")];
  const files = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const full of walkFiles(dir)) {
      if (!full.endsWith(".tsx")) continue;
      const rel = full.split(path.sep).join("/");
      if (rel.includes("/FALLBACK")) continue;
      files.push(full);
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
