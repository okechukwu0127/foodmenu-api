import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@app/database";
import { Prisma, AiConversation } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { ConciergeConfig } from "../config/config.schema";
import { ConciergeConfigService } from "../config/config.service";
import { ConciergePreferencesService } from "../preferences/preferences.service";
import {
  EffectiveContext,
  EffectivePreferencesService,
} from "../preferences/effective-preferences.service";
import {
  createConversationBody,
  switchContextBody,
} from "../dto/concierge.dto";
import { Actor } from "./access.service";
import { fail, matchRevision } from "../persistence/contracts";

export const tokenHash = (s: string) =>
  createHash("sha256").update(s).digest("hex");

@Injectable()
export class ConversationsService {
  constructor(
    readonly db: PrismaService,
    readonly config: ConfigService,
    readonly configs: ConciergeConfigService,
    readonly preferences: ConciergePreferencesService,
    readonly effective: EffectivePreferencesService,
  ) {}
  public(row: AiConversation) {
    return {
      id: row.id,
      locale: row.locale,
      context: row.context,
      contextRevision: row.contextRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
    };
  }
  async owned(tx: Prisma.TransactionClient, id: string, actor: Actor) {
    const row = await tx.aiConversation.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(actor.customerId
          ? { customerId: actor.customerId }
          : {
              customerId: null,
              guestTokenHash: actor.guestToken
                ? tokenHash(actor.guestToken)
                : "invalid",
            }),
      },
    });
    if (!row) fail("AI_CONVERSATION_NOT_FOUND", "Conversation not found", 404);
    if (row.guestExpiresAt && row.guestExpiresAt <= new Date())
      fail("AI_GUEST_EXPIRED", "Guest access has expired", 401);
    if (row.expiresAt <= new Date())
      fail(
        "AI_CONVERSATION_EXPIRED",
        "Conversation retention period has ended",
        410,
      );
    return row;
  }
  async lock(tx: Prisma.TransactionClient, id: string, actor: Actor) {
    // Verify ownership before taking a lock on a supplied identifier.
    await this.owned(tx, id, actor);
    await tx.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${id}::uuid FOR UPDATE`;
    return this.owned(tx, id, actor);
  }
  async create(actor: Actor, dto: z.infer<typeof createConversationBody>) {
    const config = await this.configs.current();
    this.configs.requireEnabled(config);
    this.configs.locale(config, dto.locale);
    if (!actor.customerId && !config.capabilities.guests)
      fail("AI_GUEST_DISABLED", "Guest conversations are disabled", 403);
    if (actor.customerId && dto.guestPreferences)
      fail(
        "AI_INVALID_INPUT",
        "Guest preferences cannot be silently imported into an account",
      );
    if (dto.guestPreferences)
      this.configs.version(config, dto.guestPreferences.configVersion);
    const guestToken = actor.customerId
      ? undefined
      : randomBytes(32).toString("hex");
    const save = async (tx: Prisma.TransactionClient) => {
      const context = await this.effective.build(
        tx,
        config,
        actor.customerId,
        dto.preferenceProfileId,
        {},
        dto.guestPreferences,
      );
      const guestExpiresAt = guestToken
        ? new Date(
            Date.now() +
              Number(this.config.get("AI_GUEST_TTL_SECONDS", 86400)) * 1000,
          )
        : null;
      const row = await tx.aiConversation.create({
        data: {
          customerId: actor.customerId,
          guestTokenHash: guestToken ? tokenHash(guestToken) : null,
          guestExpiresAt,
          locale: dto.locale,
          context: context as unknown as Prisma.InputJsonObject,
          expiresAt: new Date(
            Date.now() +
              Number(this.config.get("AI_RETENTION_DAYS", 30)) * 86400000,
          ),
        },
      });
      return { ...this.public(row), ...(guestToken ? { guestToken } : {}) };
    };
    return actor.customerId
      ? this.preferences.owner(actor.customerId, save)
      : this.db.$transaction(save);
  }
  async list(customerId: string, limit: number, cursor?: string) {
    const after = cursor
      ? await this.db.aiConversation.findFirst({
          where: {
            id: cursor,
            customerId,
            deletedAt: null,
            expiresAt: { gt: new Date() },
          },
        })
      : null;
    if (cursor && !after) fail("AI_INVALID_CURSOR", "Invalid cursor", 400);
    const rows = await this.db.aiConversation.findMany({
      where: {
        customerId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    return {
      conversations: rows.slice(0, limit).map((r) => this.public(r)),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async history(id: string, actor: Actor, limit: number, cursor?: string) {
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, id, actor);
      const after = cursor
        ? await tx.aiMessage.findFirst({
            where: { id: cursor, conversationId: id },
          })
        : null;
      if (cursor && !after) fail("AI_INVALID_CURSOR", "Invalid cursor", 400);
      const rows = await tx.aiMessage.findMany({
        where: {
          conversationId: id,
          ...(after ? { sequence: { lt: after.sequence } } : {}),
        },
        include: {
          turn: {
            select: { status: true, clientMessageId: true, errorCode: true },
          },
        },
        orderBy: { sequence: "desc" },
        take: limit + 1,
      });
      const selected = rows.slice(0, limit);
      return {
        messages: selected.reverse().map(({ turn, ...m }) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          parts: m.parts,
          createdAt: m.createdAt,
          turnId: m.turnId,
          ...turn,
        })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    });
  }
  async get(id: string, actor: Actor) {
    return this.public(
      await this.db.$transaction((tx) => this.owned(tx, id, actor)),
    );
  }
  async remove(id: string, actor: Actor) {
    await this.db.$transaction(async (tx) => {
      const row = await this.lock(tx, id, actor);
      const commerce = await tx.aiCommerceState.findUnique({
        where: { conversationId: id },
      });
      if (commerce?.stage === "PAYMENT_PENDING")
        fail(
          "PAYMENT_PENDING",
          "Resolve or cancel the payment before deleting the conversation",
          409,
        );
      await tx.aiConversation.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
      await tx.aiTurn.updateMany({
        where: { conversationId: id, status: "RUNNING" },
        data: { status: "CANCELLED", errorCode: "AI_CANCELLED" },
      });
    });
  }
  async switch(
    id: string,
    actor: Actor,
    dto: z.infer<typeof switchContextBody>,
    header?: string,
  ) {
    const config = await this.configs.current();
    this.configs.requireEnabled(config);
    this.configs.version(config, dto.configVersion);
    const run = async (tx: Prisma.TransactionClient) => {
      const row = await this.lock(tx, id, actor);
      matchRevision(header, row.contextRevision);
      if (
        await tx.aiTurn.findFirst({
          where: {
            conversationId: id,
            status: "RUNNING",
            leaseExpiresAt: { gt: new Date() },
          },
        })
      )
        fail(
          "AI_TURN_IN_PROGRESS",
          "Wait for the active turn before changing context",
          409,
        );
      const old = row.context as unknown as EffectiveContext;
      const context = await this.effective.build(
        tx,
        config,
        actor.customerId,
        dto.preferenceProfileId === undefined
          ? old.preferenceProfileId
          : dto.preferenceProfileId,
        dto.temporaryAnswers ?? old.temporaryAnswers,
        {
          profileAnswers: old.profileAnswers,
          accountAnswers: old.accountAnswers,
        },
      );
      const updated = await tx.aiConversation.update({
        where: { id },
        data: {
          context: context as unknown as Prisma.InputJsonObject,
          contextRevision: { increment: 1 },
        },
      });
      return this.public(updated);
    };
    return actor.customerId
      ? this.preferences.owner(actor.customerId, run)
      : this.db.$transaction(run);
  }
  async refresh(
    tx: Prisma.TransactionClient,
    config: ConciergeConfig,
    row: AiConversation,
    actor: Actor,
  ) {
    const old = row.context as unknown as EffectiveContext;
    // Revalidate saved context against current configuration; never drop retired
    // restrictions silently. Explicit reconciliation is required instead.
    this.configs.version(config, old.configVersion);
    return this.effective.build(
      tx,
      config,
      actor.customerId,
      old.preferenceProfileId,
      old.temporaryAnswers,
      {
        profileAnswers: old.profileAnswers,
        accountAnswers: old.accountAnswers,
      },
    );
  }
}
