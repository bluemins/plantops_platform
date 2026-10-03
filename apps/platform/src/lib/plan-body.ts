// Plan form value <-> API body (no React, so tests can use it).

export type PlanFormValue = {
  plan_name: string;
  enabled_modules: string[];
  max_users: string;
  renews_on: string;
  /** Lab Records: how many months back the app shows/searches/prints. Blank = unlimited. Nothing is deleted. */
  lab_history_months: string;
};

export const emptyPlan: PlanFormValue = { plan_name: "Growth", enabled_modules: [], max_users: "10", renews_on: "", lab_history_months: "" };

type ModuleLimits = Record<string, unknown>;
const labLimits = (modules: ModuleLimits | undefined) => (modules?.lab_records ?? {}) as Record<string, number>;

/** The form's value for an existing plan's limits. */
export const labHistoryMonths = (modules: ModuleLimits | undefined) => String(labLimits(modules).history_months ?? "");

/** Form value -> API body. Other per-module limits are kept as they are (edited per module phase). */
export function planBody(v: PlanFormValue, existingModuleLimits: ModuleLimits = {}) {
  const { history_months: _old, ...labRest } = labLimits(existingModuleLimits);
  const lab = v.lab_history_months ? { ...labRest, history_months: Number(v.lab_history_months) } : labRest;
  const modules: ModuleLimits = { ...existingModuleLimits, lab_records: lab };
  if (!Object.keys(lab).length) delete modules.lab_records;
  return {
    plan_name: v.plan_name,
    enabled_modules: v.enabled_modules,
    limits: { platform: v.max_users ? { max_users: Number(v.max_users) } : {}, modules },
    renews_on: v.renews_on || null,
  };
}
