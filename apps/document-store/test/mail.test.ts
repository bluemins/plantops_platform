import { createServer as createHttpServer } from "node:http";
import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { brevoMailer, configuredMailer, parseFrom, smtpMailer } from "@/server/mail";

const envKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "BREVO_API_KEY", "BREVO_API_URL"] as const;
const original = new Map(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function smtpServer(onMessage: (message: string) => void) {
  return createServer((socket: Socket) => {
    socket.write("220 test.smtp ESMTP\r\n");
    let buffer = "";
    let message = "";
    let inData = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let end = buffer.indexOf("\r\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            onMessage(message);
            socket.write("250 message accepted\r\n");
          } else message += `${line}\n`;
        } else if (/^EHLO|^HELO/i.test(line)) socket.write("250-test.smtp\r\n250 HELP\r\n");
        else if (/^MAIL FROM:|^RCPT TO:/i.test(line)) socket.write("250 accepted\r\n");
        else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write("354 send message\r\n");
        } else if (/^QUIT$/i.test(line)) socket.write("221 bye\r\n");
        else socket.write("250 accepted\r\n");
        end = buffer.indexOf("\r\n");
      }
    });
  });
}

describe("SMTP reminder mail", () => {
  it("requires complete settings instead of silently running with a partial configuration", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.MAIL_FROM;
    expect(smtpMailer().configured).toBe(false);
    process.env.SMTP_HOST = "smtp.example.test";
    expect(() => smtpMailer()).toThrow(/MAIL_FROM/);
  });

  it("delivers through the configured SMTP transport", async () => {
    let received = "";
    const server = smtpServer((message) => (received = message));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      process.env.SMTP_HOST = "127.0.0.1";
      process.env.SMTP_PORT = String((server.address() as { port: number }).port);
      process.env.MAIL_FROM = "PlantOps <reminders@example.test>";
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await smtpMailer().send("owner@example.test", "Expiry reminder", "FSSAI licence expires soon");
      expect(result).toEqual({ ok: true });
      expect(received).toContain("owner@example.test");
      expect(received).toContain("FSSAI licence expires soon");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

/** A fake Brevo API: records each request, answers with the given status. */
async function brevoServer(status = 201) {
  const requests: { headers: Record<string, unknown>; body: any }[] = [];
  const server = createHttpServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(status, { "content-type": "application/json" }).end(status < 300 ? '{"messageId":"<1@brevo>"}' : '{"code":"unauthorized","message":"Key not found"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v3/smtp/email`;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, requests, close };
}

describe("Brevo API reminder mail", () => {
  it("reads MAIL_FROM with or without a display name", () => {
    expect(parseFrom("PlantOps <contact@bluemins.life>")).toEqual({ name: "PlantOps", email: "contact@bluemins.life" });
    expect(parseFrom('"Plant Ops" <a@b.in>')).toEqual({ name: "Plant Ops", email: "a@b.in" });
    expect(parseFrom("a@b.in")).toEqual({ email: "a@b.in" });
    expect(parseFrom("PlantOps")).toBeNull();
  });

  it("is chosen when BREVO_API_KEY is set, and needs a sender address", () => {
    delete process.env.SMTP_HOST;
    process.env.BREVO_API_KEY = "xkeysib-test";
    delete process.env.MAIL_FROM;
    expect(() => configuredMailer()).toThrow(/MAIL_FROM/);
    process.env.MAIL_FROM = "PlantOps <reminders@example.test>";
    expect(configuredMailer().configured).toBe(true);
  });

  it("sends over HTTPS with the API key, sender and plain text", async () => {
    const fake = await brevoServer();
    try {
      process.env.BREVO_API_KEY = "xkeysib-test";
      process.env.BREVO_API_URL = fake.url;
      process.env.MAIL_FROM = "PlantOps <reminders@example.test>";
      expect(await brevoMailer().send("owner@example.test", "Expiry reminder", "FSSAI licence expires soon")).toEqual({ ok: true });
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]!.headers["api-key"]).toBe("xkeysib-test");
      expect(fake.requests[0]!.body).toEqual({
        sender: { name: "PlantOps", email: "reminders@example.test" },
        to: [{ email: "owner@example.test" }],
        subject: "Expiry reminder",
        textContent: "FSSAI licence expires soon",
      });
    } finally {
      await fake.close();
    }
  });

  it("reports Brevo's refusal and unreachable servers as failures", async () => {
    const fake = await brevoServer(401);
    try {
      process.env.BREVO_API_KEY = "wrong";
      process.env.BREVO_API_URL = fake.url;
      process.env.MAIL_FROM = "reminders@example.test";
      const refused = await brevoMailer().send("owner@example.test", "s", "t");
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error).toMatch(/Brevo 401.*Key not found/);
    } finally {
      await fake.close();
    }
    process.env.BREVO_API_URL = fake.url; // closed now
    const down = await brevoMailer().send("owner@example.test", "s", "t");
    expect(down.ok).toBe(false);
    expect(!down.ok && down.error).toMatch(/^Email failed:/);
  });
});
