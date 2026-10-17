import { ApplyPage } from "../apply-page";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** jobs.bluemins.life/apply : the default plant's apply form (mock-up 3). */
export default async function DefaultApply({ searchParams }: { searchParams: Search }) {
  const o = (await searchParams).o;
  return <ApplyPage code={null} o={typeof o === "string" ? o : undefined} />;
}
