const defaultWhyDescription =
  "Why travellers choose JVTO for private Bromo, Ijen and Tumpak Sewu tours: tourist police-led safety culture, registered Indonesian travel company, real health screening, local guides and transparent policies.";

export async function generateMetadata() {
  const page = await loadEcosystemPage(ROUTE);
  const description = page?.meta.description ?? defaultWhyDescription;
  return buildStaticRouteMetadata(ROUTE, { description });
}
