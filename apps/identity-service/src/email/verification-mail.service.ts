import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { AppError } from "@app/errors";

@Injectable()
export class VerificationMailService {
  constructor(private readonly config: ConfigService) {}

  assertConfigured() {
    if (
      !this.config.get<string>("SMTP_HOST") ||
      !this.config.get<string>("SMTP_FROM")
    ) {
      throw new AppError(
        "EMAIL_DELIVERY_NOT_CONFIGURED",
        "Verification email delivery is not configured. Please try again later.",
        503,
      );
    }
  }

  async sendVerification(
    email: string,
    code: string,
    expiresInSeconds: number,
  ) {
    this.assertConfigured();
    const secure = String(this.config.get("SMTP_SECURE", false)) === "true";
    const user = this.config.get<string>("SMTP_USER");
    const transport = nodemailer.createTransport({
      host: this.config.get<string>("SMTP_HOST"),
      port: Number(this.config.get("SMTP_PORT", 587)),
      secure,
      requireTLS: this.config.get("NODE_ENV") === "production" && !secure,
      ...(user
        ? { auth: { user, pass: this.config.get<string>("SMTP_PASSWORD") } }
        : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      dnsTimeout: 5000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        from: this.config.get<string>("SMTP_FROM"),
        to: email,
        subject: "Verify your FoodMenu email address",
        text: `Your FoodMenu verification code is: ${code}\n\nThis code expires in ${expiresInSeconds / 3600} hours. Enter it in the app to activate your account.\n\nIf you did not create this account, you can ignore this email.`,
      });
      if (!result.accepted?.length || result.rejected?.length)
        throw new Error("Recipient was not accepted");
    } catch {
      // SMTP exceptions can contain credentials, recipients and message content.
      throw new AppError(
        "VERIFICATION_EMAIL_SEND_FAILED",
        "We could not send your verification email. Please request a new code shortly.",
        503,
      );
    } finally {
      transport.close();
    }
  }
}
