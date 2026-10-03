// The FSSAI record forms (refeDocs/sheets/FSSAI STI Forms.xlsx) and the daily test, described once:
// the entry screens, the server's validation, the record pages and (step 7) the print layout all use this.

export type FormId = "daily" | "form1" | "form2" | "form3" | "form4";
export type FieldType = "text" | "longtext" | "date" | "outcome" | "source";

export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** the date that places the record in time (search, sort, print range) */
  main?: boolean;
  placeholder?: string;
};

export type FormDef = {
  id: FormId;
  /** "FORM 1" as printed on the government form ("" for the daily test) */
  code: string;
  title: string;
  short: string;
  /** daily and Form 1 hold parameter results (with limits); Forms 2-4 hold the sheet's text columns */
  hasResults: boolean;
  /** a batch is required (Form 1, Form 2), optional (daily) or not used (Forms 3, 4) */
  batch: "required" | "optional" | "none";
  fields: FormField[];
};

export const OUTCOMES = { pass: "Pass", fail: "Fail", pending: "Awaiting report" } as const;
export const SOURCES = { in_house: "In-house lab", outside: "Outside lab" } as const;

export const FORMS: Record<FormId, FormDef> = {
  daily: {
    id: "daily",
    code: "",
    title: "Daily in-house test",
    short: "Daily test",
    hasResults: true,
    batch: "optional",
    fields: [{ key: "remark", label: "Remark", type: "text" }],
  },
  form1: {
    id: "form1",
    code: "FORM 1",
    title: "Report for Monthly Testing",
    short: "Form 1 · Monthly testing",
    hasResults: true,
    batch: "required",
    fields: [
      { key: "test_date", label: "Test / report date", type: "date", required: true, main: true },
      { key: "source", label: "Tested at", type: "source", required: true },
      { key: "lab_name", label: "Outside lab name", type: "text", placeholder: "if tested outside" },
      { key: "report_no", label: "Lab report no.", type: "text" },
      { key: "report_date", label: "Lab report date", type: "date" },
      { key: "remark", label: "Remark", type: "text" },
    ],
  },
  form2: {
    id: "form2",
    code: "FORM 2",
    title: "Format for Testing from FSSAI notified NABL accredited laboratory (ISO/IEC 17025 Certified)",
    short: "Form 2 · NABL lab testing",
    hasResults: false,
    batch: "required",
    fields: [
      { key: "manufacturing_date", label: "Date of manufacturing", type: "date", required: true },
      { key: "packing_type", label: "Type of packing", type: "text", required: true, placeholder: "e.g. 1 L PET bottle" },
      { key: "sample_sent_on", label: "Date on which sample sent", type: "date", required: true, main: true },
      { key: "lab_name", label: "Lab to which sample sent", type: "text", required: true },
      { key: "report_no", label: "Test report no.", type: "text", placeholder: "when the report arrives" },
      { key: "report_date", label: "Test report date", type: "date" },
      { key: "remark", label: "Remark", type: "text" },
    ],
  },
  form3: {
    id: "form3",
    code: "FORM 3",
    title: "Source Water Testing",
    short: "Form 3 · Source water",
    hasResults: false,
    batch: "none",
    fields: [
      { key: "source_of_water", label: "Source of water", type: "text", required: true, placeholder: "e.g. Borewell 2" },
      { key: "lab_name", label: "Name of lab", type: "text", required: true },
      { key: "sample_sent_on", label: "Sample sent on", type: "date", required: true, main: true },
      { key: "report_no", label: "Test report no.", type: "text" },
      { key: "report_date", label: "Test report date", type: "date" },
      { key: "results", label: "Results", type: "longtext", placeholder: "as written in the lab report" },
      { key: "outcome", label: "Outcome", type: "outcome", required: true },
      { key: "remark", label: "Remark", type: "text" },
    ],
  },
  form4: {
    id: "form4",
    code: "FORM 4",
    title: "Record for Plastic Containers Used for Packaging Water",
    short: "Form 4 · Plastic containers",
    hasResults: false,
    batch: "none",
    fields: [
      { key: "packaging_type", label: "Type of packaging", type: "text", required: true, placeholder: "e.g. 20 L jar" },
      { key: "supplier", label: "Name of supplier", type: "text", required: true },
      { key: "quantity_received", label: "Quantity received", type: "text", required: true, placeholder: "e.g. 5,000 pcs" },
      { key: "lab_name", label: "Name of lab", type: "text", required: true },
      { key: "samples_sent_on", label: "Date of sending samples", type: "date", required: true, main: true },
      { key: "overall_migration", label: "Overall migration (result)", type: "text" },
      { key: "remaining_parameters", label: "Remaining parameters as per FSS PKG Regulation 2018", type: "longtext" },
      { key: "outcome", label: "Outcome", type: "outcome", required: true },
      { key: "remark", label: "Remark", type: "text" },
    ],
  },
};

export const FORM_IDS = Object.keys(FORMS) as FormId[];
export const mainDateField = (form: FormId) => FORMS[form].fields.find((f) => f.main)?.key ?? null;

/** How a stored value reads on screen ("in_house" -> "In-house lab"). */
export function fieldText(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "outcome") return OUTCOMES[value as keyof typeof OUTCOMES] ?? String(value);
  if (field.type === "source") return SOURCES[value as keyof typeof SOURCES] ?? String(value);
  return String(value);
}
