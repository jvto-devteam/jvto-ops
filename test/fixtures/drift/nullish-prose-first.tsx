export default function Page({ x, fallback }: { x: number; fallback: string }) {
  const answerFirst =
    `Choose from many private Bromo, Ijen and Tumpak Sewu tours from Surabaya or Bali, with confirmed crew for every booking: ${x}.` ??
    fallback;
  return <Hero answerFirst={answerFirst} />;
}
