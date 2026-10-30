import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { fail, digest } from "./contracts";
@Injectable()
export class ConciergeRateLimitService {
  constructor(private readonly config: ConfigService) {}
  async consume(
    tx: Prisma.TransactionClient,
    identity: string,
    kind: "account" | "guest" | "create",
  ) {
    const setting =
      kind === "account"
        ? "AI_ACCOUNT_RATE_LIMIT"
        : kind === "guest"
          ? "AI_GUEST_RATE_LIMIT"
          : "AI_GUEST_CREATE_RATE_LIMIT";
    const limit = Number(
      this.config.get(
        setting,
        kind === "account" ? 20 : kind === "guest" ? 5 : 3,
      ),
    );
    const key = `${kind}:${digest(identity)}:${Math.floor(Date.now() / 60000)}`;
    const row = await tx.aiRateBucket.upsert({
      where: { key },
      create: { key, count: 1, expiresAt: new Date(Date.now() + 120000) },
      update: { count: { increment: 1 } },
    });
    if (row.count > limit)
      fail(
        "AI_RATE_LIMITED",
        "Concierge rate limit exceeded; retry in the next minute",
        429,
        { retryAfterSeconds: 60 - (Math.floor(Date.now() / 1000) % 60) },
      );
  }
}
