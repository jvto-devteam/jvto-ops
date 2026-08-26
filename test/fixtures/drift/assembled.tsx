export default function Page({ tours }: { tours: Tour[] }) {
  const answerFirst =
    `Choose from ${tours.length} private Bromo, Ijen and Tumpak Sewu tours from Surabaya or Bali. ` +
    `JVTO runs no shared groups: each booking gets private transport and confirmed crew. ` +
    `Prices start from IDR 1.55M/pax.`;
  return <Hero answerFirst={answerFirst} />;
}
