// Live-number tokens that reach a reader as literal text.
//
// ekosistem prose carries {GOOGLE_RATING}, {PACKAGE_COUNT_SURABAYA} and their
// siblings on purpose: the number is volatile, so the source stores a token and
// the consumer resolves it at render with applyLiveNumbers(). That contract has
// exactly one failure mode, and it is silent — a jvto-web page that reads the
// field and renders it WITHOUT resolving. The token then ships to the reader
// verbatim.
//
// On 2026-08-27 four live routes were doing this: /tours/from-surabaya printed
// "{PACKAGE_COUNT_SURABAYA}", /tours/from-bali and /isic/student-package the
// same shape, and /why-jvto/reviews leaked six tokens through its hero lede,
// its seo.description and generateMetadata. Nothing caught it for as long as it
// had been live. check-answer-first reads the SOURCE, where the tokens are
// correct by design; no checker in either repo looked at what a page renders.
//
// This closes that specifically, and stays cheap enough to run from a hook:
//
//   1. Walk ekosistem's rendered *.website-output.json and collect the routes
//      whose prose actually contains a token. Only those routes can leak, so
//      only those are checked — no guessing about which pages "should" resolve.
//   2. Map each such route to the jvto-web page that renders it.
//   3. Report when that file never calls applyLiveNumbers.
//
// Deliberately NOT a check on whether every read site is individually wrapped.
// /why-jvto/reviews called applyLiveNumbers three times and still leaked, so
// presence is not proof — but absence IS proof of a leak, and a checker that
// tried to prove per-expression coverage would need to follow values through
// helpers like whyLede(), which is the brittleness that made check-ssot-drift's
// name-substring guard produce four false positives on its first real run.
// Warn-only for the same reason (checker-hygiene rule 5): it catches the whole
// class it can prove, and stays quiet about the half it cannot.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  finding,
  report,
  ekosystemRoot,
  webRoot,
  requireRepo,
  rootOverride,
  runCli,
} from "./lib/repos.mjs";

const TOKEN_RE = /\{[A-Z][A-Z0-9_]{3,}\}/g;

/**
 * Prose fields a token can legitimately live in. `page` is the rendered
 * envelope render-web-content produces; everything a reader sees comes from
 * under it.
 */
function proseWithTokens(doc) {
  const found = new Set();
  const walk = (node) => {
    if (typeof node === "string") {
      for (const m of node.match(TOKEN_RE) ?? []) found.add(m);
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") return Object.values(node).forEach(walk);
  };
  walk(doc?.page ?? doc);
  return [...found].sort();
}

/**
 * Where jvto-web renders a route. Static routes are a directory path under
 * src/app/(website); a route with no page.tsx is served by a [slug] segment,
 * which this cannot resolve and does not guess about.
 */
export function pageFileForRoute(route, webRootDir) {
  const rel = route.replace(/^\/+/, "");
  const base = path.join(webRootDir, "src", "app", "(website)");
  const candidate = rel ? path.join(base, rel, "page.tsx") : path.join(base, "page.tsx");
  return existsSync(candidate) ? candidate : null;
}

/**
 * Pure half: given a route's tokens and the source of the file that renders it,
 * decide whether the tokens can reach a reader unresolved.
 */
export function checkRouteResolution(route, tokens, source) {
  if (!tokens.length) return [];
  if (source === null) return [];

  const usesHelper = source.includes("applyLiveNumbers");

  // A page can also resolve a token by hand — /verify-jvto did exactly this,
  // `item.p.replace("{PACKAGE_COUNT}", String(packages.length))`. That does not
  // leak, so it must not be reported as one; the checker's first run called it a
  // leak and the live page was already printing 17. But it is its own defect: it
  // resolves ONE named token, so the day ekosistem's prose gains a second one
  // that page starts leaking, silently, with no code change to notice.
  const handled = new Set();
  for (const t of tokens) {
    if (source.includes(`"${t}"`) || source.includes(`'${t}'`)) handled.add(t);
  }

  if (usesHelper) return [];

  const unresolved = tokens.filter((t) => !handled.has(t));
  if (unresolved.length) {
    return [
      {
        route,
        tokens: unresolved,
        level: "warn",
        message:
          `renders ${unresolved.join(", ")} from ekosistem prose and resolves ` +
          `neither by applyLiveNumbers nor by name — the token ships to the ` +
          `reader as literal text`,
      },
    ];
  }

  return [
    {
      route,
      tokens,
      level: "warn",
      message:
        `resolves ${tokens.join(", ")} by hand instead of applyLiveNumbers — it ` +
        `does not leak today, but it only handles the tokens named in this file, ` +
        `so the next token added to this route's prose leaks with nothing to notice`,
    },
  ];
}

function collectOutputs(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectOutputs(p));
    else if (e.name.endsWith(".website-output.json")) out.push(p);
  }
  return out;
}

function main(argv) {
  const eko = requireRepo("ekosistem", ekosystemRoot(rootOverride(argv, "--ekosistem-root")));
  const web = requireRepo("web", webRoot(rootOverride(argv, "--web-root")));

  const findings = [];
  for (const file of collectOutputs(path.join(eko, "5-experience-engine", "public-website"))) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const route = doc?.route;
    if (typeof route !== "string") continue;

    const tokens = proseWithTokens(doc);
    if (!tokens.length) continue;

    const pageFile = pageFileForRoute(route, web);
    const source = pageFile ? readFileSync(pageFile, "utf8") : null;
    for (const hit of checkRouteResolution(route, tokens, source)) {
      findings.push(
        finding(hit.level ?? "warn", path.relative(web, pageFile), `${hit.route} ${hit.message}`),
      );
    }
  }
  return report("check-live-tokens", findings, argv);
}

runCli(import.meta.url, main);
