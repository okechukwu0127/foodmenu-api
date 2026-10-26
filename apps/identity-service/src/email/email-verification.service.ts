import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "crypto";
import { PrismaService } from "@app/database";
import { AppError } from "@app/errors";
import { VerificationMailService } from "./verification-mail.service";

type LockedAccount = {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
};
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: VerificationMailService,
  ) {}

  assertConfigured() {
    this.secret();
    this.mail.assertConfigured();
  }

  async send(email: string) {
    this.assertConfigured();
    let code = randomInt(0, 1000000).toString().padStart(6, "0");
    const requestId = randomUUID();
    const result = await this.prisma.$transaction(async (tx) => {
      const [account] = await tx.$queryRaw<
        LockedAccount[]
      >`SELECT "id", "email", "emailVerifiedAt" FROM "AuthAccount" WHERE "email" = ${email} FOR UPDATE`;
      if (!account || account.emailVerifiedAt)
        return { accountId: null, retryAfter: 0 };
      const previous = await tx.emailVerification.findUnique({
        where: { accountId: account.id },
      });
      const requestedAt = new Date();
      const retryAfter = previous
        ? Math.ceil(
            (previous.requestedAt.getTime() +
              RESEND_COOLDOWN_SECONDS * 1000 -
              requestedAt.getTime()) /
              1000,
          )
        : 0;
      if (retryAfter > 0) return { accountId: null, retryAfter };
      // Do not accidentally reissue the same digits as the immediately previous code.
      while (
        previous &&
        previous.codeHash === this.hash(account.id, previous.requestId, code)
      ) {
        code = randomInt(0, 1000000).toString().padStart(6, "0");
      }
      const data = {
        requestId,
        codeHash: this.hash(account.id, requestId, code),
        requestedAt,
        sentAt: null,
        expiresAt: null,
        attempts: 0,
      };
      await tx.emailVerification.upsert({
        where: { accountId: account.id },
        create: { accountId: account.id, ...data },
        update: data,
      });
      return { accountId: account.id, retryAfter: 0 };
    });
    if (result.retryAfter > 0)
      throw new AppError(
        "VERIFICATION_RESEND_TOO_SOON",
        "Please wait before requesting another verification code.",
        429,
        { retryAfterSeconds: result.retryAfter },
      );
    const expiresIn = Number(
      this.config.get("EMAIL_VERIFICATION_TTL_SECONDS", 14400),
    );
    if (result.accountId) {
      // SMTP is outside the transaction. A reserved code is unusable until delivery
      // is accepted, and its lifetime starts at acceptance rather than reservation.
      await this.mail.sendVerification(email, code, expiresIn);
      const sentAt = new Date();
      const expiresAt = new Date(sentAt.getTime() + expiresIn * 1000);
      await this.prisma.emailVerification.updateMany({
        where: { accountId: result.accountId, requestId, sentAt: null },
        data: { sentAt, expiresAt },
      });
    }
    return {
      message:
        "If this email belongs to an inactive account, a verification code has been sent.",
      expiresIn,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  async verify(email: string, code: string) {
    this.secret();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [account] = await tx.$queryRaw<
        LockedAccount[]
      >`SELECT "id", "email", "emailVerifiedAt" FROM "AuthAccount" WHERE "email" = ${email} FOR UPDATE`;
      if (!account || account.emailVerifiedAt) return "invalid";
      const verification = await tx.emailVerification.findUnique({
        where: { accountId: account.id },
      });
      if (
        !verification?.sentAt ||
        !verification.expiresAt ||
        verification.expiresAt <= new Date()
      )
        return "invalid";
      if (verification.attempts >= MAX_ATTEMPTS) return "locked";
      const actual = Buffer.from(
        this.hash(account.id, verification.requestId, code),
        "hex",
      );
      const expected = Buffer.from(verification.codeHash, "hex");
      if (!timingSafeEqual(actual, expected)) {
        // Return instead of throwing inside the transaction so failed attempts commit.
        await tx.emailVerification.update({
          where: { accountId: account.id },
          data: { attempts: { increment: 1 } },
        });
        return verification.attempts + 1 >= MAX_ATTEMPTS ? "locked" : "invalid";
      }
      await tx.authAccount.update({
        where: { id: account.id },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.authSession.deleteMany({ where: { accountId: account.id } });
      await tx.emailVerification.delete({ where: { accountId: account.id } });
      return "verified";
    });
    if (outcome === "locked")
      throw new AppError(
        "VERIFICATION_ATTEMPTS_EXCEEDED",
        "Too many incorrect codes. Request a new verification code.",
        429,
      );
    if (outcome !== "verified")
      throw new AppError(
        "INVALID_OR_EXPIRED_VERIFICATION_CODE",
        "Invalid or expired verification code. Request a new code if needed.",
        400,
      );
    return {
      activated: true,
      isActive: true,
      emailVerified: true,
      message: "Your email has been verified. You can now sign in.",
    };
  }

  private hash(accountId: string, requestId: string, code: string) {
    return createHmac("sha256", this.secret())
      .update(`${accountId}:${requestId}:${code}`)
      .digest("hex");
  }

  private secret() {
    const secret = this.config.get<string>("EMAIL_VERIFICATION_SECRET", "");
    if (secret.length < 32)
      throw new AppError(
        "EMAIL_DELIVERY_NOT_CONFIGURED",
        "Email verification is not configured. Please try again later.",
        503,
      );
    return secret;
  }
}
