#!/usr/bin/env python3
"""
audit-answer-structure.py — measure the live site against the answer-structure
and fact-density spec (jvto-spesifikasi-llmstxt-factdensity-metrik.md, Bagian 3).

Run it before and after an editorial change; without a baseline no claim of
improvement is checkable.

    python3 scripts/audit-answer-structure.py            # fetch + measure
    python3 scripts/audit-answer-structure.py --cached   # reuse ./.answer-audit/html

What it counts as a fact follows the spec's own definition (§3.1): numbers with
units, dates and periods, official entity names, document and regulation
numbers, specific place names. Adjectives without measurement are not facts.

Two things this deliberately does NOT do:
  - It does not strip <header>. On most routes here <header> IS the page hero,
    so stripping it discards the lede and the answer block — the exact 120 words
    the audit is about. Site chrome is its own <nav>.
  - It does not treat low density on crew pages as a defect. Those pages are
    built from verbatim guest reviews, which is the highest-uplift method in the
    Princeton study; scoring them on fact density would trade a +41% asset for a
    +32% one.
"""
import os,re,json,html,collections,statistics

import sys
D=os.environ.get("ANSWER_AUDIT_HTML_DIR", ".answer-audit/html")  # relative to cwd
_bu=sys.argv.index("--base-url") if "--base-url" in sys.argv else None
SITE=sys.argv[_bu+1] if _bu is not None and _bu+1<len(sys.argv) else "https://javavolcano-touroperator.com"

# ── fakta menurut Bagian 3.1: angka bersatuan, tanggal, entitas resmi,
#    nomor dokumen/regulasi, tempat spesifik, orang beratribusi.
UNIT=r"(?:m|km|kg|mdpl|masl|metres?|meters?|kilometres?|kilometers?|min|mins|minutes?|hours?|hrs?|days?|nights?|pax|guests?|people|%|IDR|USD|Rp|★|stars?|reviews?)"
FACT_PATTERNS=[
 rf"\b\d[\d,\.]*\s*{UNIT}\b",                                  # 2,386 m · 90 minutes · 20%
 r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b",                            # 2024-09-08
 r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b",
 r"\bsince\s+(?:19|20)\d{2}\b",
 r"\b(?:SE|AHU|SPRIN|NIB|TDUP|NPWP|STR|SIP|KTA)[\.\-\s][A-Z0-9\./\-]{3,}",   # nomor dokumen
 r"\b\d{9,}\b",                                                 # NIB/registrasi panjang
 r"\bBBKSDA(?:\s+Jawa\s+Timur)?\b", r"\bDitlantas\b", r"\bPolres\b", r"\bPOLRI\b",
 r"\bPT Java Volcano Rendezvous\b", r"\bHPWKI\b", r"\bKemen\w+\b", r"\bDPMPTSP\b",
 r"\bPaltuding\b", r"\bTengger\b", r"\bBondowoso\b", r"\bBanyuwangi\b",
 r"\b\d+(?:\.\d+)?\s*/\s*5\b",                                  # 4.9 / 5
 r"-?\d+\.\d{3,},\s*-?\d+\.\d{3,}",                             # geo
]
FACT_RE=[re.compile(p,re.I) for p in FACT_PATTERNS]

FLUFF=["amazing","unforgettable","magical","hidden paradise","once-in-a-lifetime",
 "once in a lifetime","breathtaking","stunning","the best","most trusted","number one",
 "world-class","excellent service","your satisfaction is our priority","professional team",
 "competitive price","competitive prices","truly unique","must-see","paradise",
 "menakjubkan","tak terlupakan","surga tersembunyi","terbaik","paling terpercaya"]
FLUFF_RE=[(w,re.compile(rf"\b{re.escape(w)}\b",re.I)) for w in FLUFF]

def strip_html(raw):
    # buang yang bukan konten
    # <header> is the PAGE hero on most routes here, not site chrome — the
    # site nav is its own <nav>. Stripping it discarded the lede and the
    # answer block, i.e. exactly the 120 words this audit is about.
    for tag in ("script","style","svg","noscript","nav","footer"):
        raw=re.sub(rf"<{tag}\b.*?</{tag}>","",raw,flags=re.S|re.I)
    return raw

def texts(raw):
    """paragraf & heading yang benar-benar tampil"""
    paras=[html.unescape(re.sub(r"<[^>]+>"," ",m.group(1))) for m in re.finditer(r"<p\b[^>]*>(.*?)</p>",raw,re.S|re.I)]
    # AnswerBlock renders as a <div>, and it is deliberately the FIRST thing
    # after the lede — so it must lead the measured text, not be appended.
    ab=[html.unescape(re.sub(r"<[^>]+>"," ",m.group(1)))
        for m in re.finditer(r'<div[^>]*border-jvto-lime/25[^>]*>(.*?)</div>',raw,re.S|re.I)]
    paras=ab+paras
    heads=[(m.group(1),html.unescape(re.sub(r"<[^>]+>"," ",m.group(2)))) for m in re.finditer(r"<(h[1-4])\b[^>]*>(.*?)</\1>",raw,re.S|re.I)]
    clean=lambda s:re.sub(r"\s+"," ",s).strip()
    return [clean(p) for p in paras if clean(p)],[(t,clean(h)) for t,h in heads if clean(h)]

def facts_in(s):
    n=0
    for r in FACT_RE: n+=len(r.findall(s))
    return n

def sentences(s):
    return [x for x in re.split(r"(?<=[.!?])\s+",s) if len(x.split())>=3]

def page_type(route):
    if route=="/": return "homepage"
    if route.startswith("/why-jvto/reviews/"): return "review-permalink"
    if route.startswith("/why-jvto/our-team/") and route.count("/")>2: return "crew"
    if route.startswith("/verify-jvto"): return "trust"
    if route.startswith("/travel-guide"): return "travel-guide"
    if route.startswith("/destinations"): return "destination"
    if route.startswith("/tours/") and route.count("/")>2: return "pdp"
    if route.startswith("/why-jvto"): return "why-jvto"
    if route.startswith("/policy"): return "policy"
    if route.startswith("/blog"): return "blog"
    return "other"

TARGET={"destination":1.0,"travel-guide":1.0,"pdp":0.8,"trust":1.2,"why-jvto":0.5,
        "homepage":1.0,"crew":0.5,"blog":0.5,"policy":0.5,"other":0.5,"review-permalink":0.0}

rows=[]
for fn in sorted(os.listdir(D)):
    route="/" if fn=="_root.html" else "/"+fn[:-5].replace("__","/").lstrip("/")
    raw=strip_html(open(os.path.join(D,fn),encoding="utf-8",errors="replace").read())
    paras,heads=texts(raw)
    body=" ".join(paras)
    sents=sentences(body)
    nf=facts_in(body)
    density=nf/len(sents) if sents else 0.0
    words=body.split()
    first120=" ".join(words[:120])
    numeric120=len(re.findall(rf"\b\d[\d,\.]*\s*{UNIT}\b",first120,re.I))+len(re.findall(r"\b\d{4,}\b",first120))
    fluff=[w for w,r in FLUFF_RE if r.search(body)]
    longp=[len(p.split()) for p in paras if len(p.split())>0]
    over60=sum(1 for w in longp if w>60)
    h23=[h for t,h in heads if t in("h2","h3")]
    qh=sum(1 for h in h23 if h.rstrip().endswith("?"))
    rows.append(dict(route=route,type=page_type(route),sent=len(sents),facts=nf,
        density=round(density,2),target=TARGET[page_type(route)],
        num120=numeric120,fluff=fluff,paras=len(paras),over60=over60,
        h23=len(h23),qhead=qh,words=len(words)))
json.dump(rows,open(os.path.join(os.path.dirname(D) or ".","audit.json"),"w"))

by=collections.defaultdict(list)
for r in rows: by[r["type"]].append(r)
print(f"{'jenis':18s} {'n':>4} {'kata~':>7} {'density':>8} {'target':>7} {'lolos':>7} {'≥3 angka':>9} {'?heading':>9} {'>60kata':>8}")
for t in ["homepage","destination","travel-guide","pdp","trust","why-jvto","crew","blog","policy","other"]:
    g=by.get(t) or []
    if not g: continue
    d=statistics.median(x["density"] for x in g)
    ok=sum(1 for x in g if x["density"]>=x["target"])
    n3=sum(1 for x in g if x["num120"]>=3)
    qh=sum(x["qhead"] for x in g); th=sum(x["h23"] for x in g)
    ov=sum(x["over60"] for x in g); tp=sum(x["paras"] for x in g)
    w=int(statistics.median(x["words"] for x in g))
    print(f"{t:18s} {len(g):4d} {w:7d} {d:8.2f} {g[0]['target']:7.1f} {ok:3d}/{len(g):<3d} {n3:4d}/{len(g):<4d} {qh:4d}/{th:<4d} {ov:4d}/{tp:<3d}")
