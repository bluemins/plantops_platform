import { ApplyPage } from "../../apply-page";

type Params = Promise<{ code: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** jobs.bluemins.life/<plant code>/apply : that plant's apply form (mock-up 3). */
export default async function PlantApply({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ code }, { o }] = await Promise.all([params, searchParams]);
  return <ApplyPage code={code} o={typeof o === "string" ? o : undefined} />;
}
