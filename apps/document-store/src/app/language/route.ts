import { LOCALES } from "@/lib/i18n";
import { z } from "zod";

const LanguageInput = z.object({ locale: z.enum(LOCALES) });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const protocol = (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(/:$/, "")) + ":";
  let originUrl: URL;
  try {
    originUrl = new URL(origin ?? "");
  } catch {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  if (!host || originUrl.host !== host.toLowerCase() || originUrl.protocol !== protocol) return Response.json({ error: "Not allowed" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = LanguageInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Unsupported language" }, { status: 400 });
  }

  const secure = protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": `document-store-language=${parsed.data.locale}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` } },
  );
}
