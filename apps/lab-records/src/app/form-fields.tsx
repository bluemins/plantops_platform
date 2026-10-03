"use client";

import { TextField } from "@plantops/ui";
import { OUTCOMES, SOURCES, type FormField } from "@/lib/forms";

const todayLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

function Choice({ label, options, value, onChange }: { label: string; options: Record<string, string>; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <div className="flex flex-wrap gap-2">
        {Object.entries(options).map(([k, text]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={`min-h-12 rounded-xl border px-4 font-semibold ${value === k ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The sheet's columns for one form, in order, as big phone-friendly inputs. */
export function FormFields({ fields, values, onChange }: { fields: FormField[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const set = (key: string, v: string) => onChange({ ...values, [key]: v });
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const label = `${f.label}${f.required ? "" : " (optional)"}`;
        const value = values[f.key] ?? "";
        if (f.type === "outcome") return <Choice key={f.key} label={label} options={OUTCOMES} value={value} onChange={(v) => set(f.key, v)} />;
        if (f.type === "source") return <Choice key={f.key} label={label} options={SOURCES} value={value} onChange={(v) => set(f.key, v)} />;
        if (f.type === "longtext") {
          return (
            <label key={f.key} className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
              <textarea
                value={value}
                maxLength={1000}
                rows={3}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
              />
            </label>
          );
        }
        return (
          <TextField
            key={f.key}
            label={label}
            type={f.type === "date" ? "date" : "text"}
            max={f.type === "date" ? todayLocal() : undefined}
            maxLength={f.type === "date" ? undefined : 200}
            value={value}
            placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)}
            required={f.required}
          />
        );
      })}
    </div>
  );
}
