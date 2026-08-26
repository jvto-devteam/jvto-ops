export default function Page({ a, b, x }: { a?: string; b?: string; x: number }) {
  const answerFirst =
    a ??
    b ??
    `Choose from many private Bromo, Ijen and Tumpak Sewu tours for ${x} travellers from Surabaya or Bali.`;
  return <Hero answerFirst={answerFirst} />;
}
