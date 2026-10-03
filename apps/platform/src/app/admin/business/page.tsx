"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { BusinessSections } from "@/lib/business-form";

type Me = { roles: string[]; must_change_secret: boolean };

/** Owner edits the plant's business details and products. Plant code and usernames are set by PlantOps. */
export default function BusinessPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>();

  useEffect(() => {
    api<Me>("/api/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      if (r.data.must_change_secret) return router.replace("/change-secret");
      if (!r.data.roles.includes("tenant_admin")) return router.replace("/home");
      setMe(r.data);
    });
  }, [router]);

  if (!me) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Business details</h1>
        <Link href="/home" className="text-(--brand) font-medium">Back</Link>
      </div>
      <p className="text-sm text-slate-500">Plant code and usernames can only be changed by PlantOps support.</p>
      {/* refresh re-renders the layout, so a new brand colour shows at once */}
      <BusinessSections businessUrl="/api/admin/business" skusUrl="/api/admin/skus" onSaved={() => router.refresh()} />
    </div>
  );
}
