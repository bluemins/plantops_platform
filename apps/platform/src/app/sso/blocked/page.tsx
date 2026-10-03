import Link from "next/link";
import { Button, Card } from "@plantops/ui";
import { MODULES } from "@/lib/modules";

const MESSAGES: Record<string, string> = {
  no_access: "Your account can't open this module. Ask your plant owner if you need it.",
  unavailable: "This module is switched off or not set up right now. Please try again later.",
  unknown: "That link isn't a PlantOps module.",
};

/** Shown when a direct module link can't be opened for this user. */
export default async function BlockedPage({ searchParams }: { searchParams: Promise<{ module?: string; reason?: string }> }) {
  const { module, reason } = await searchParams;
  const label = module && module in MODULES ? MODULES[module as keyof typeof MODULES].label : "This module";
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">{label}</h1>
      <Card>
        <p className="text-slate-700">{MESSAGES[reason ?? ""] ?? MESSAGES.unknown}</p>
        <Link href="/home?launcher=1" className="mt-4 block">
          <Button className="w-full">Go to PlantOps home</Button>
        </Link>
      </Card>
    </div>
  );
}
