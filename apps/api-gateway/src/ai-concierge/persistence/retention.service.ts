import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "@app/database";
import { writeStructuredLog } from "@app/common";
@Injectable()
export class ConciergeRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: PrismaService) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.cleanup().catch(() =>
        writeStructuredLog("error", "AiConcierge", {
          event: "ai_retention_failed",
        }),
      );
    }, 600000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async cleanup() {
    const now = new Date();
    await this.db.aiTurn.updateMany({
      where: { status: "RUNNING", leaseExpiresAt: { lte: now } },
      data: { status: "FAILED", errorCode: "AI_WORKER_LOST" },
    });
    await this.db.aiRateBucket.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    // Batches bound maintenance work; a later run continues where this stops.
    const rows = await this.db.aiConversation.findMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { deletedAt: { not: null } }],
        turns: { none: { status: "RUNNING" } },
        checkouts: {
          none: {
            paymentIntentId: { not: null },
            status: { notIn: ["succeeded", "canceled"] },
          },
        },
      },
      select: { id: true },
      take: 200,
    });
    if (rows.length)
      await this.db.aiConversation.deleteMany({
        where: {
          id: { in: rows.map((r) => r.id) },
          turns: { none: { status: "RUNNING" } },
          checkouts: {
            none: {
              paymentIntentId: { not: null },
              status: { notIn: ["succeeded", "canceled"] },
            },
          },
        },
      });
  }
}
