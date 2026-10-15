import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { qrLinkFor } from "@/server/settings";
import { PrintButton } from "./print-button";

const STEPS = [
  "Open your phone camera and point it at the code.",
  "Log in with the plant code and your PIN (first time only).",
  "Tap the big button: Mark IN when you arrive, Mark OUT when you leave.",
  "Allow location when the phone asks.",
];

/** Owner: the A4 sheet to stick on the wall (mock-up "Print QR"). The QR is drawn here, by the server, every time. */
export default async function PrintPage() {
  const user = await requirePageUser("/settings/print");
  if (!can(user, "settings")) redirect("/settings");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [plant, link] = await Promise.all([kit.branding(user.tenantId), qrLinkFor(user, origin)]);
  if (!link) redirect("/settings");
  const svg = await QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 2 });

  return (
    <div className="mx-auto flex max-w-[720px] flex-col items-center gap-7 bg-white px-6 py-10 text-center print:py-6">
      <style>{"@page { size: A4; margin: 12mm } @media print { body { background: #fff } }"}</style>
      <div className="flex w-full items-center justify-between print:hidden">
        <a href="/settings" className="text-sm font-semibold text-(--brand)">
          ← Location &amp; QR
        </a>
        <PrintButton />
      </div>
      <div className="flex items-center gap-3">
        {plant?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by this module from the platform
          <img src="/plant-logo" alt="" className="h-16 w-16 rounded-full border border-slate-200 object-contain" />
        ) : null}
        <p className="text-4xl font-extrabold">{plant?.name ?? ""}</p>
      </div>
      <p className="text-5xl leading-tight font-extrabold text-(--brand)">Scan to mark IN / OUT</p>
      {/* drawn on the server from our own link by the qrcode package: no user input inside */}
      <div className="w-full max-w-[440px] [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="QR code to mark attendance" dangerouslySetInnerHTML={{ __html: svg }} />
      <ol className="max-w-[560px] space-y-3 text-left text-2xl">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-extrabold text-(--brand)">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="text-sm text-slate-500">PlantOps Attendance</p>
    </div>
  );
}
