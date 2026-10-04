import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { smtpMailer } from "@/server/mail";

const envKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] as const;
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
