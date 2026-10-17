// Pieces of the public job page (mock-ups 1 and 2). Server components only: no script needed to read the page.
import type { CSSProperties, ReactNode } from "react";
import { brandStyle } from "@plantops/ui/brand";
import { GROUPS, jobsText } from "@/lib/groups";
import type { PublicOpening } from "@/server/openings";
import { basePath, type PublicPlantView } from "@/server/public";

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const Chevron = ({ back }: { back?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={back ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
  </svg>
);
const Upload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M12 18v-6" />
    <path d="M9 15l3-3 3 3" />
  </svg>
);

/** The plant's colour as CSS variables for everything inside. */
export function Branded({ plant, children }: { plant: PublicPlantView; children: ReactNode }) {
  return <div style={brandStyle(plant.brandColor) as CSSProperties}>{children}</div>;
}

/** The plant's logo on a white square, or its first letter. */
export function PlantMark({ plant, size = 40 }: { plant: PublicPlantView; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-[11px] bg-white text-[19px] font-extrabold text-(--brand)" style={{ width: size, height: size }}>
      {plant.hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- the plant's logo, served by this app from the platform
        <img src={`/api/public/logo/${plant.code}`} alt="" className="h-full w-full object-contain p-1" />
      ) : (
        plant.name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

/** Mock-up 1: the hero, How it works, jobs by group, the "Didn't find your job?" band. */
export function OpenPositions({ plant, openings, message }: { plant: PublicPlantView; openings: PublicOpening[]; message: string }) {
  const base = basePath(plant);
  const apply = `${base}/apply`;
  const n = openings.length;
  const groups = GROUPS.map((g) => ({ ...g, jobs: openings.filter((o) => o.grp === g.id) })).filter((g) => g.jobs.length);
  return (
    <Branded plant={plant}>
      <div className="relative flex flex-col gap-[18px] overflow-hidden bg-(--brand) px-4 pt-5 pb-7 text-(--brand-contrast)">
        <div aria-hidden="true" className="absolute -top-[90px] -right-20 h-[260px] w-[260px] rounded-full bg-white opacity-[0.07]" />
        <div aria-hidden="true" className="absolute -bottom-[60px] -left-[50px] h-40 w-40 rounded-full bg-white opacity-[0.06]" />
        <div className="relative flex items-center gap-2.5">
          <PlantMark plant={plant} />
          <span className="text-[17px] font-bold">{plant.name}</span>
        </div>
        <div className="relative flex flex-col gap-2.5">
          {n > 0 && <span className="self-start rounded-full bg-white px-3 py-[5px] text-[13px] font-bold text-slate-900">We are hiring · {jobsText(n)}</span>}
          <h1 className="text-[34px] leading-[1.1] font-extrabold tracking-[-0.01em]">Join the {plant.name} team</h1>
          <p className="text-base leading-[1.45] opacity-95">{message}</p>
        </div>
        <div className="relative flex flex-col gap-2.5">
          <a href={apply} className="flex items-center justify-center gap-2.5 rounded-[14px] bg-white p-4 text-[17px] font-extrabold text-slate-900">
            <Upload />
            Send your resume
          </a>
          {n > 0 && (
            <a href="#jobs" className="block rounded-[14px] border-2 border-current p-[13px] text-center text-base font-bold">
              See the {n === 1 ? "open job" : `${n} open jobs`}
            </a>
          )}
        </div>
        <div className="relative flex flex-wrap gap-x-3.5 gap-y-2 text-[13px] font-semibold">
          {["2 minutes", "No login", "Photo of CV is fine"].map((f) => (
            <span key={f} className="flex items-center gap-[5px]">
              <Check />
              {f}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-5 pb-1">
        <h2 className="text-lg font-extrabold">How it works</h2>
        <ol className="grid grid-cols-3 gap-2">
          {["Pick a job or just send your resume", "Fill name, phone and place", "We call you if there is a match"].map((s, i) => (
            <li key={i} className="flex flex-col gap-1.5 rounded-[14px] border border-slate-200 bg-white px-2.5 py-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-(--brand-soft) text-sm font-extrabold text-slate-900">{i + 1}</span>
              <span className="text-[13px] leading-[1.35] font-semibold">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <div id="jobs" className="flex flex-col gap-[22px] px-4 py-5">
        {groups.map((g) => (
          <section key={g.id} className="flex flex-col gap-2.5" aria-labelledby={`g-${g.id}`}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-(--brand) text-(--brand-contrast)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={g.icon} />
                </svg>
              </span>
              <h2 id={`g-${g.id}`} className="text-lg font-extrabold">
                {g.label}
              </h2>
              <span className="ml-auto text-[13px] font-semibold text-slate-600">{jobsText(g.jobs.length)}</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {g.jobs.map((j) => (
                <a key={j.id} href={`${base}/p/${j.id}`} className="flex min-h-16 items-center gap-3 border-b border-slate-100 py-3.5 pr-3.5 pl-4 text-slate-900 last:border-b-0">
                  <span className="flex min-w-0 grow flex-col gap-[5px]">
                    <span className="text-base font-bold">{j.title}</span>
                    {j.tag && <span className="self-start rounded-full bg-slate-100 px-[9px] py-[3px] text-xs font-bold text-slate-700">{j.tag}</span>}
                  </span>
                  <span className="text-sm font-bold text-slate-800">View</span>
                  <span className="text-slate-800">
                    <Chevron />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}

        <div className="flex flex-col gap-2.5 rounded-[18px] bg-slate-900 p-5 text-white">
          <h2 className="text-xl font-extrabold">{n ? "Didn't find your job?" : "Want to work with us?"}</h2>
          <p className="text-[15px] leading-[1.45] text-slate-200">
            {n ? "Send your resume anyway. " : "Send your resume. "}We keep it for 12 months and call you when something opens up.
          </p>
          <a href={apply} className="self-start rounded-xl bg-white px-5 py-[13px] text-base font-extrabold text-slate-900">
            Send your resume
          </a>
        </div>
        <Footer plant={plant} />
      </div>
    </Branded>
  );
}

export function Footer({ plant }: { plant: PublicPlantView }) {
  return <p className="py-1 text-center text-xs text-slate-600">Your details are seen only by {plant.name} · Powered by PlantOps</p>;
}

/** Mock-up 2: one position, with "Apply for this job" at the bottom. */
export function OnePosition({
  plant,
  opening,
}: {
  plant: PublicPlantView;
  opening: { id: string; title: string; description: string; minQualification: string; goodToHave: string | null };
}) {
  const base = basePath(plant);
  const card = (title: string, body: string) => (
    <section className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-[13px] tracking-[0.04em] text-slate-600 uppercase">{title}</h2>
      <p className="text-[15px] leading-normal whitespace-pre-line">{body}</p>
    </section>
  );
  return (
    <Branded plant={plant}>
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <a href={base || "/"} className="flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-slate-900">
            <Chevron back />
            All positions
          </a>
          <span className="ml-auto truncate text-sm font-semibold text-slate-600">{plant.name}</span>
        </div>
        <div className="flex grow flex-col gap-4 px-4 py-5">
          <h1 className="text-[26px] font-bold">{opening.title}</h1>
          {card("Job description", opening.description)}
          {card("Minimum qualification", opening.minQualification)}
          {opening.goodToHave && card("Good to have", opening.goodToHave)}
        </div>
        <div className="sticky bottom-0 border-t border-slate-200 bg-white px-4 pt-3 pb-5">
          <a href={`${base}/apply?o=${opening.id}`} className="block rounded-[14px] bg-(--brand) p-[15px] text-center text-[17px] font-bold text-(--brand-contrast)">
            Apply for this job
          </a>
        </div>
      </div>
    </Branded>
  );
}

/** PlantOps can't be reached for a moment: never say "not available" for a real plant. */
export function TryLater() {
  return (
    <div className="px-4 py-16 text-center">
      <h1 className="text-xl font-bold">Please try again in a few minutes</h1>
      <p className="mt-2 text-slate-600">The job page can&apos;t be opened right now.</p>
    </div>
  );
}
