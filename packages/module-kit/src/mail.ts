// Sending email from any module (Document Store expiry reminders, Floor Stock low-stock alerts). Two ways:
// - Brevo's HTTPS API when BREVO_API_KEY is set (works where outgoing SMTP is blocked, e.g. Railway Hobby);
// - otherwise SMTP: Amazon SES (Mumbai), Zoho Mail, Google Workspace and most providers.
// Until one is set up (plus MAIL_FROM), nothing is sent and messages stay "Email is not set up yet".
// Settings are the same environment variables in every module, read when a mailer is made (tests set them first).
import nodemailer from "nodemailer";

const env = {
  get smtpHost() {
    return process.env.SMTP_HOST ?? "";
  },
  get smtpPort() {
    return Number(process.env.SMTP_PORT ?? 587);
  },
  get smtpUser() {
    return process.env.SMTP_USER ?? "";
  },
  get smtpPass() {
    return process.env.SMTP_PASS ?? "";
  },
  /** Brevo's HTTPS email API (used instead of SMTP when set: Railway Hobby blocks outgoing SMTP). */
  get brevoApiKey() {
    return process.env.BREVO_API_KEY ?? "";
  },
  get brevoApiUrl() {
    return process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email";
  },
  /** e.g. "PlantOps <reminders@plantops.in>" */
  get mailFrom() {
    return process.env.MAIL_FROM ?? "";
  },
};

export type MailResult = { ok: true } | { ok: false; error: string };
export type Mailer = { configured: boolean; send: (to: string, subject: string, text: string) => Promise<MailResult> };

/** The mailer this server is set up for: Brevo's API if its key is set, else SMTP. */
export function configuredMailer(): Mailer {
  return env.brevoApiKey ? brevoMailer() : smtpMailer();
}

/** "PlantOps <a@b.in>" or "a@b.in" → Brevo's sender object. */
export function parseFrom(from: string): { name?: string; email: string } | null {
  const m = from.trim().match(/^(?:"?([^"<]*?)"?\s*<([^<>\s]+)>|([^<>\s]+))$/);
  const email = m?.[2] ?? m?.[3];
  if (!email || !looksLikeEmail(email)) return null;
  const name = m?.[1]?.trim();
  return name ? { name, email } : { email };
}

export function brevoMailer(): Mailer {
  const sender = parseFrom(env.mailFrom);
  if (!sender) throw new Error("BREVO_API_KEY is set, so MAIL_FROM must be a sender address, e.g. PlantOps <reminders@example.com>");
  return {
    configured: true,
    async send(to, subject, text) {
      try {
        const res = await fetch(env.brevoApiUrl, {
          method: "POST",
          headers: { "api-key": env.brevoApiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) return { ok: true };
        const detail = await res.text().catch(() => "");
        return { ok: false, error: `Email failed: Brevo ${res.status} ${detail}`.trim().slice(0, 300) };
      } catch (err) {
        return { ok: false, error: `Email failed: ${(err as Error).message}`.slice(0, 300) };
      }
    },
  };
}

export function smtpMailer(): Mailer {
  const provided = [env.smtpHost, env.smtpUser, env.smtpPass, env.mailFrom].some(Boolean);
  if (!provided) return { configured: false, send: async () => ({ ok: false, error: "Email is not set up yet" }) };
  const missing = [!env.smtpHost && "SMTP_HOST", !env.mailFrom && "MAIL_FROM", (!!env.smtpUser !== !!env.smtpPass) && "SMTP_USER and SMTP_PASS together"].filter(Boolean);
  if (missing.length) throw new Error(`Incomplete SMTP configuration: set ${missing.join(", ")}`);
  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    configured: true,
    async send(to, subject, text) {
      try {
        await transport.sendMail({ from: env.mailFrom, to, subject, text });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `Email failed: ${(err as Error).message}`.slice(0, 300) };
      }
    },
  };
}

/** Plain email address check before handing it to the mail server. */
export const looksLikeEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
