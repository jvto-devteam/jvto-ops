export default function Page({ page, tours }: { page: EcosystemPage; tours: Tour[] }) {
  const answerFirst =
    page?.raw?.page?.answerFirst ??
    `Choose from ${tours.length} private tours.`;
  return <Hero answerFirst={answerFirst} />;
}
