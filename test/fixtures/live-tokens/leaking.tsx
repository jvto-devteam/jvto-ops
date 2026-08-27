// Reproduces /tours/from-surabaya as it shipped on 2026-08-27: reads the field
// and hands it straight to AnswerBlock. No resolution anywhere in the file.
import AnswerBlock from "@/components/website/AnswerBlock";

export default async function Page() {
  const page = await loadEcosystemPage("/tours/from-surabaya");
  return (
    <AnswerBlock className="mb-8">
      {typeof (page?.raw as any)?.page?.answerFirst === "string"
        ? ((page!.raw as any).page.answerFirst as string)
        : null}
    </AnswerBlock>
  );
}
