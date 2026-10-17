import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { can } from "@/server/access";
import { env } from "@/server/env";
import { kit } from "@/server/kit";
import { publicLink } from "@/server/public";
import { requirePageUser } from "@/server/session";
import { requestOrigin } from "../../origin";
import { PrintButton } from "./print-button";

/** Owner: the A4 "We are hiring" poster with the QR of the public page (mock-up 7 "Print QR poster"). */
export default async function PosterPage() {
  const user = await requirePageUser("/openings/poster");
  if (!can(user, "manage_openings")) redirect("/openings");
  const [plant, origin] = await Promise.all([kit.branding(user.tenantId), requestOrigin()]);
  const code = plant?.code?.toUpperCase();
  if (!code) redirect("/openings");
  const link = publicLink(origin, { code, isDefault: code === env.defaultPlant });
  // drawn on the server from our own link by the qrcode package: no user input inside
  const svg = await QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 2 });

  return (
    <div className="mx-auto flex max-w-[720px] flex-col items-center gap-7 bg-white px-6 py-10 text-center print:py-6">
      <style>{"@page { size: A4; margin: 12mm } @media print { body { background: #fff } }"}</style>
      <div className="flex w-full items-center justify-between print:hidden">
        <a href="/openings" className="text-sm font-semibold text-(--brand)">
          ← Openings
        </a>
        <PrintButton />
      </div>
      <div className="flex items-center gap-3">
        {plant?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by this module from the platform
          <img src="/plant-logo" alt="" className="h-16 w-16 rounded-xl border border-slate-200 object-contain" />
        ) : null}
        <p className="text-4xl font-extrabold">{plant?.name ?? ""}</p>
      </div>
      <p className="text-6xl leading-tight font-extrabold text-(--brand)">We are hiring</p>
      <div className="w-full max-w-[420px] [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="QR code of the job page" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-3xl font-bold break-all">{link.replace(/^https?:\/\//, "")}</p>
      <p className="text-2xl">Scan with your phone camera · 2 minutes · No login</p>
      <p className="text-xl text-slate-600">Pick a job, or just send your resume. A photo of your CV is fine.</p>
      <p className="text-sm text-slate-500">PlantOps Job applications</p>
    </div>
  );
}
