export default function Page({ tours, priceFloor }: { tours: Tour[]; priceFloor: number }) {
  const answerFirst =
    `Choose from ${tours.length} private Bromo, Ijen and Tumpak Sewu tours from Surabaya or Bali, each with confirmed crew and private transport. ` +
    priceFloor.toLocaleString() +
    ` is the minimum price per pax across every one of these itineraries.`;
  return <Hero answerFirst={answerFirst} />;
}
