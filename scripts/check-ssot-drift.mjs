// SSOT drift: catches page prose assembled inline in a jvto-web consumer
// file instead of read from jvto-ekosistem, the single source of truth.
//
// A const named answerFirst/lede/summary/description (case-insensitively,
// as a substring) is flagged when its assigned expression splices a runtime
// value into prose:
//
//   - a template literal containing `${...}` interpolation, or
//   - a `+` joining a string/template literal to something that is NOT
//     itself a plain string/template literal — a computed expression like
//     `priceFloor.toLocaleString()` (the /tours hub shape: an answer
//     sentence and a locally computed price floor built in the consumer,
//     which is the reason this checker exists).
//
// A concatenation where every `+`-joined part is itself a plain literal
// (`` `A ` + `B` ``) is NOT splicing — nothing runtime is involved, it's one
// prose constant wrapped across lines for readability, no different from a
// lone literal, and is never flagged for that reason alone (though if any
// of those literal parts itself contains `${}`, the interpolation rule
// above still fires on it).
//
// `X ?? <literal>` is never flagged, whatever `X` is and whatever shape the
// literal takes (interpolated, spliced, or plain) — `??` means "fall back
// to the right side when the left has nothing" by construction, which IS
// the FALLBACK pattern this checker exists to allow, and the read jvto-web
// actually uses varies too much by call site (`page?.meta.description`,
// `ecosystemAnswer`, `review.review?.slice(...)`) to name-match reliably.
// An earlier version tried a literal-substring guard (`page?.raw`, `pc.`,
// `ecosystemPage`) and it produced four false positives on exactly this
// pattern on its first real-repo run. This exemption is intentionally
// one-sided: it protects the literal sitting in the FINAL fallback
// position of a `??` chain (`a ?? b ?? <literal>` still exempts, since the
// literal is still the last fallback), but does NOT protect prose sitting
// earlier in the chain — `<assembled prose> ?? fallback` means the prose
// IS the primary value, the opposite of a fallback, and still fires. Two
// gaps are accepted on principle, not by oversight, and for different
// reasons:
//   - `someLocalValue ?? <assembled prose>`: accepted, because verifying
//     the left side actually reads from ekosistem is exactly the
//     brittleness the name-substring guard's four false positives forced
//     off — the alternative is a checker that fires on correct code from a
//     PostToolUse hook running on every .tsx edit, and gets muted for it.
//   - `<assembled prose> ?? fallback`: NOT accepted — that shape asserts
//     the assembled value as primary, not as a fallback, so nothing about
//     "?? means fallback" applies to protect it, and it still fires.
//
// Short splices are allowed through too (a one-line placeholder isn't the
// failure mode this exists for); the 60-character floor on the literal
// portions is a proxy for "this is real assembled prose, not a stub."
//
// Pure logic lives in checkAssembledContent() so tests exercise it against
// fixtures with no I/O. The CLI wrapper below walks jvto-web's src/app and
// src/components for .tsx files.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { finding, report, webRoot, requireRepo, rootOverride, runCli } from "./lib/repos.mjs";

const NAME_RE = /answerFirst|lede|summary|description/i;
const LITERAL_SEGMENT_RE = /`([^`]*)`|"([^"]*)"|'([^']*)'/g;
const PLAIN_LITERAL_OPERAND_RE = /^(`[^`]*`|"[^"]*"|'[^']*')$/;

// A template literal counts as "assembled" only when it splices a runtime
// value in via ${...} — a lone backtick literal used just for quoting
// convenience, with no interpolation, is exactly the same as a lone plain
// string and is not this checker's business.
const INTERPOLATED_TEMPLATE_RE = /`[^`]*\$\{/;

const MIN_LENGTH = 60;

/**
 * Walks `expr` once, tracking quote/template-literal state and
 * paren/bracket/brace nesting depth, and calls `onMatch(index)` for every
 * index where `token` starts at top level: not inside a string, and not
 * nested inside a call, array, or object. Shared by the `??`-chain
 * splitter and the `+`-concatenation splitter below, since both need "top
 * level" to mean the same thing.
 */
function scanTopLevel(expr, token, onMatch) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (depth === 0 && expr.startsWith(token, i)) onMatch(i);
  }
}

/**
 * Splits `expr` on every top-level `??`, returning the chain of operands in
 * order (`a ?? b ?? c` -> `["a", "b", "c"]`; no `??` at all -> `[expr]`).
 * The LAST element is always the chain's final fallback position.
 */
function splitTopLevelNullishChain(expr) {
  const splitPoints = [];
  scanTopLevel(expr, "??", (i) => splitPoints.push(i));
  if (splitPoints.length === 0) return [expr];
  const parts = [];
  let start = 0;
  for (const i of splitPoints) {
    parts.push(expr.slice(start, i).trim());
    start = i + 2;
  }
  parts.push(expr.slice(start).trim());
  return parts;
}

function splitTopLevelPlus(expr) {
  const splitPoints = [];
  scanTopLevel(expr, "+", (i) => splitPoints.push(i));
  if (splitPoints.length === 0) return [expr.trim()];
  const operands = [];
  let start = 0;
  for (const i of splitPoints) {
    operands.push(expr.slice(start, i).trim());
    start = i + 1;
  }
  operands.push(expr.slice(start).trim());
  return operands;
}

// A `+`-joined chain counts as splicing only when at least one operand is
// NOT itself a plain string/template literal — a concatenation of literals
// only is prose wrapped across lines for readability, not a runtime value
// spliced in.
function hasSplicedConcatenation(expr) {
  const operands = splitTopLevelPlus(expr);
  if (operands.length < 2) return false;
  return operands.some((op) => !PLAIN_LITERAL_OPERAND_RE.test(op));
}

function isAssembledShape(expr) {
  return INTERPOLATED_TEMPLATE_RE.test(expr) || hasSplicedConcatenation(expr);
}

/**
 * True when assembled prose sits somewhere other than the final fallback
 * position of a `??` chain. With no `??` at all, the whole expression is
 * the (only) position, so this is just isAssembledShape(expr). With one or
 * more `??`, only the LAST chain link is a protected fallback position —
 * every earlier link is checked, because assembled prose there is the
 * primary value the expression asserts, not a fallback for anything.
 */
function hasAssembledProseInPrimaryPosition(expr) {
  const parts = splitTopLevelNullishChain(expr);
  if (parts.length === 1) return isAssembledShape(parts[0]);
  return parts.slice(0, -1).some((part) => isAssembledShape(part));
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
    if (!hasAssembledProseInPrimaryPosition(expr)) continue;
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

  // process.exitCode, not process.exit(): see check-graph-integrity.mjs for
  // why — process.exit() can truncate a large --json write before
  // hook-dispatch.mjs finishes reading it over spawnSync.
  process.exitCode = report("check-ssot-drift", findings, argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli("check-ssot-drift", main);
}
