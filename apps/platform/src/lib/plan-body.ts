// Plan form value <-> API body (no React, so tests can use it).

export type PlanFormValue = {
  plan_name: string;
  enabled_modules: string[];
  max_users: string;
  renews_on: string;
  /** Lab Records: how many months back the app shows/searches/prints. Blank = unlimited. Nothing is deleted. */
  lab_history_months: string;
  /** Document Store: total file storage in MB. Blank = unlimited. */
  doc_storage_mb: string;
};

export const emptyPlan: PlanFormValue = { plan_name: "Growth", enabled_modules: [], max_users: "10", renews_on: "", lab_history_months: "", doc_storage_mb: "" };

type ModuleLimits = Record<string, unknown>;

/** Per-module plan limits edited on the plan screen: form field -> limits.modules.<module>.<key>. */
export const MODULE_LIMIT_FIELDS = [
  { field: "lab_history_months", module: "lab_records", key: "history_months", label: "Lab Records history shown (months, blank = unlimited)" },
  { field: "doc_storage_mb", module: "document_store", key: "storage_mb", label: "Document Store storage (MB, blank = unlimited)" },
] as const;

const moduleLimits = (modules: ModuleLimits | undefined, module: string) => (modules?.[module] ?? {}) as Record<string, number>;

/** The form's value for one limit of an existing plan. */
export const limitValue = (modules: ModuleLimits | undefined, module: string, key: string) => String(moduleLimits(modules, module)[key] ?? "");
export const labHistoryMonths = (modules: ModuleLimits | undefined) => limitValue(modules, "lab_records", "history_months");

/** The form fields for an existing plan's module limits. */
export const moduleLimitFormValues = (modules: ModuleLimits | undefined) =>
  Object.fromEntries(MODULE_LIMIT_FIELDS.map((f) => [f.field, limitValue(modules, f.module, f.key)])) as Pick<PlanFormValue, (typeof MODULE_LIMIT_FIELDS)[number]["field"]>;

/** Form value -> API body. Limits not on the form are kept as they are. */
export function planBody(v: PlanFormValue, existingModuleLimits: ModuleLimits = {}) {
  const modules: ModuleLimits = { ...existingModuleLimits };
  for (const f of MODULE_LIMIT_FIELDS) {
    const { [f.key]: _old, ...rest } = moduleLimits(modules, f.module);
    const next = v[f.field] ? { ...rest, [f.key]: Number(v[f.field]) } : rest;
    if (Object.keys(next).length) modules[f.module] = next;
    else delete modules[f.module];
  }
  return {
    plan_name: v.plan_name,
    enabled_modules: v.enabled_modules,
    limits: { platform: v.max_users ? { max_users: Number(v.max_users) } : {}, modules },
    renews_on: v.renews_on || null,
  };
}
