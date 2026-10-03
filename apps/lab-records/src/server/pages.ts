import { notFound } from "next/navigation";
import { HttpError } from "./http";

/** Pages: a 404 from the server logic shows Next's "not found" page (e.g. another plant's batch id). */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}
