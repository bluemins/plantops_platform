"use client";

import { TextField } from "@plantops/ui";
import { MODULES } from "./modules";
import { MODULE_LIMIT_FIELDS, type PlanFormValue } from "./plan-body";

export { emptyPlan, labHistoryMonths, moduleLimitFormValues, planBody, type PlanFormValue } from "./plan-body";

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
      {MODULE_LIMIT_FIELDS.filter((f) => value.enabled_modules.includes(f.module)).map((f) => (
        <TextField
          key={f.field}
          label={f.label}
          type="number"
          min={1}
          value={value[f.field]}
          onChange={(e) => onChange({ ...value, [f.field]: e.target.value })}
        />
      ))}
    </div>
  );
}
