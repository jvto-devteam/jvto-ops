// Three call sites from the real jvto-web repo, each a different shape of
// "X ?? <literal>" — a member-expression read, a bare identifier that was
// itself derived from an ekosistem read one statement earlier, and a
// chained optional read with a call. All three must be exempt regardless
// of what X is, per the ruling: "?? means fall back to the right side by
// construction" is what makes the right-hand literal a FALLBACK, not
// whether X is provably an ekosistem read.
export async function memberExpressionForm({ page, counts }) {
  const description =
    page?.meta.description ??
    `Meet JVTO's ${counts.total} named crew: ${counts.guides} guides and ${counts.drivers} drivers, all recruited from Bondowoso and Banyuwangi.`;
  return description;
}

export async function derivedVariableForm({ tours, priceFloor }) {
  const ecosystemAnswer = null;
  const answerFirst =
    ecosystemAnswer ??
    `Choose from ${tours.length} private Bromo, Ijen and Tumpak Sewu tours from Surabaya or Bali. ` +
      priceFloor.toLocaleString() +
      ` is the minimum price per pax.`;
  return answerFirst;
}

export async function chainedOptionalCallForm({ review, packageName }) {
  const description =
    review.review?.slice(0, 160) ??
    `Customer review for ${packageName} with Java Volcano Tour Operator.`;
  return description;
}
