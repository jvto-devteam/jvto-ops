const summaryNote =
  `Backticks here are just quoting convenience, not interpolation, and this sentence alone runs well past sixty characters.`;

export default function Note() {
  return <p>{summaryNote}</p>;
}
