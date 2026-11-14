import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

export type LeadEmailField = [label: string, value: string];

export type LeadEmail = {
  subject: string;
  heading: string;
  fields: LeadEmailField[];
  /** The visitor's address, so "Reply" in the inbox goes straight to them. */
  replyTo?: string;
};

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/;

const escapeHtml = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Strip CR/LF so visitor input can never add mail headers.
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

/**
 * Emails the team inbox(es) in LEADS_NOTIFY_EMAIL whenever the website collects a
 * demo request, partner application or beta sign-up. Best-effort by design: the
 * database row is the record, so a mail problem is logged and never fails the request.
 */
@Injectable()
export class LeadNotificationService {
  private readonly logger = new Logger(LeadNotificationService.name);

  constructor(private readonly config: ConfigService) {}

  recipients(): string[] {
    return String(this.config.get("LEADS_NOTIFY_EMAIL") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => EMAIL.test(s));
  }

  /** Returns true when SMTP accepted the message for at least one recipient. */
  async send(mail: LeadEmail): Promise<boolean> {
    const to = this.recipients();
    if (!to.length) {
      this.logger.warn(
        "LEADS_NOTIFY_EMAIL is not set; website lead saved without an email notification",
      );
      return false;
    }
    if (!this.config.get<string>("SMTP_HOST") || !this.config.get<string>("SMTP_FROM")) {
      this.logger.warn("SMTP is not configured; website lead saved without an email notification");
      return false;
    }

    const secure = String(this.config.get("SMTP_SECURE", false)) === "true";
    const user = this.config.get<string>("SMTP_USER");
    const transport = nodemailer.createTransport({
      host: this.config.get<string>("SMTP_HOST"),
      port: Number(this.config.get("SMTP_PORT", 587)),
      secure,
      requireTLS: this.config.get("NODE_ENV") === "production" && !secure,
      ...(user ? { auth: { user, pass: this.config.get<string>("SMTP_PASSWORD") } } : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      dnsTimeout: 5000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });

    const fields = mail.fields.map(([k, v]) => [k, oneLine(v)] as const);
    const text = [mail.heading, "", ...fields.map(([k, v]) => `${k}: ${v}`)].join("\n");
    const rows = fields
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#666;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
      )
      .join("");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#15141a"><h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(mail.heading)}</h2><table style="border-collapse:collapse">${rows}</table><p style="color:#888;font-size:12px;margin-top:18px">Sent automatically by the Liberq website.</p></div>`;
    const replyTo = mail.replyTo && EMAIL.test(mail.replyTo) ? mail.replyTo : undefined;

    try {
      const result = await transport.sendMail({
        from: this.config.get<string>("SMTP_FROM"),
        to,
        ...(replyTo ? { replyTo } : {}),
        subject: oneLine(mail.subject).slice(0, 180),
        text,
        html,
      });
      return Boolean(result.accepted?.length);
    } catch {
      // SMTP errors can contain credentials and message content: log only that it failed.
      this.logger.error("Could not send website lead notification email");
      return false;
    } finally {
      transport.close();
    }
  }
}
