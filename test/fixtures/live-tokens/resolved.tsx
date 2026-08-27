// The /tours hub shape: the field goes through applyLiveNumbers before render.
import AnswerBlock from "@/components/website/AnswerBlock";
import { applyLiveNumbers, getLiveNumbers } from "@/lib/publicContent/liveNumbers";

export default async function Page() {
  const page = await loadEcosystemPage("/tours");
  const liveNumbers = await getLiveNumbers();
  const answerFirst =
    typeof (page?.raw as any)?.page?.answerFirst === "string"
      ? applyLiveNumbers(((page!.raw as any).page.answerFirst as string).trim(), liveNumbers)
      : null;
  return <AnswerBlock className="mb-8">{answerFirst}</AnswerBlock>;
}
