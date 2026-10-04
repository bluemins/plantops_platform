// Sending email (expiry reminders). SMTP works with Amazon SES (Mumbai), Zoho Mail, Google Workspace and most
// providers. Until SMTP_HOST + MAIL_FROM are set, nothing is sent and reminders say "Email is not set up yet".
import nodemailer from "nodemailer";
import { env } from "./env";

export type MailResult = { ok: true } | { ok: false; error: string };
export type Mailer = { configured: boolean; send: (to: string, subject: string, text: string) => Promise<MailResult> };

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
