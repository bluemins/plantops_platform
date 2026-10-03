"use client";

import { TextField } from "@plantops/ui";
import { MODULES } from "./modules";

export type PlanFormValue = { plan_name: string; enabled_modules: string[]; max_users: string; renews_on: string };

export const emptyPlan: PlanFormValue = { plan_name: "Growth", enabled_modules: [], max_users: "10", renews_on: "" };

/** Form value -> API body. Per-module limits are kept as they are (edited later, per module phase). */
export function planBody(v: PlanFormValue, existingModuleLimits: Record<string, unknown> = {}) {
  return {
    plan_name: v.plan_name,
    enabled_modules: v.enabled_modules,
    limits: { platform: v.max_users ? { max_users: Number(v.max_users) } : {}, modules: existingModuleLimits },
    renews_on: v.renews_on || null,
  };
}

export function PlanFields({ value, onChange }: { value: PlanFormValue; onChange: (v: PlanFormValue) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Plan name" value={value.plan_name} onChange={(e) => onChange({ ...value, plan_name: e.target.value })} required />
        <TextField label="Max users" type="number" min={1} value={value.max_users} onChange={(e) => onChange({ ...value, max_users: e.target.value })} />
      </div>
      <TextField label="Renews on" type="date" value={value.renews_on} onChange={(e) => onChange({ ...value, renews_on: e.target.value })} />
      <p className="text-sm font-medium text-slate-700">Enabled modules</p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(MODULES).map(([id, { label }]) => {
          const on = value.enabled_modules.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                onChange({ ...value, enabled_modules: on ? value.enabled_modules.filter((m) => m !== id) : [...value.enabled_modules, id] })
              }
              className={`min-h-11 rounded-full border px-4 text-sm font-medium ${on ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
