// /verify-jvto: resolves one named token by hand. Does not leak today.
export default async function Page() {
  const TIMELINE = (pc.timeline ?? FALLBACK.timeline).map((item) => ({
    ...item,
    p: item.p.replace("{PACKAGE_COUNT}", String(packages.length)),
  }));
  return <ul>{TIMELINE.map((t) => <li key={t.year}>{t.p}</li>)}</ul>;
}
