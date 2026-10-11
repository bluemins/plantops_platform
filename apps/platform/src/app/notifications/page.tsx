"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { NotificationsPage } from "@/lib/notifications-ui";

type Me = { must_change_secret: boolean; user?: { gets_alerts: boolean } };

/**
 * Everyone's notifications, and where staff turn on phone alerts. Staff with one module skip the launcher, so
 * the bell in each module's header links here (CLAUDE.md "Notifications", N2).
 */
export default function Notifications() {
  const [me, setMe] = useState<Me>();
  useEffect(() => {
    api<Me>("/api/launcher").then((r) => {
      if (r.status === 401) return window.location.replace("/login?next=/notifications");
      if (!r.ok) return;
      if (r.data.must_change_secret) return window.location.replace("/change-secret?next=/notifications");
      setMe(r.data);
    });
  }, []);
  if (!me) return null;
  return (
    <div className="space-y-4">
      <a href="/home?launcher=1" className="inline-flex min-h-11 items-center text-sm font-semibold text-(--brand)">
        ‹ PlantOps home
      </a>
      <NotificationsPage showCard={me.user?.gets_alerts ?? false} />
    </div>
  );
}
