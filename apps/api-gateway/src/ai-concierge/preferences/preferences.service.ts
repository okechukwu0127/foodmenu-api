import { Injectable } from "@nestjs/common";
import { PrismaService } from "@app/database";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { z } from "zod";
import { ConciergeConfigService } from "../config/config.service";
import { ConciergeConfig } from "../config/config.schema";
import { digest, fail, matchRevision } from "../persistence/contracts";

import { accountBody, importBody, ProfileInput } from "../dto/concierge.dto";

type Tx = Prisma.TransactionClient;

@Injectable()
export class ConciergePreferencesService {
  constructor(
    readonly db: PrismaService,
    readonly configs: ConciergeConfigService,
  ) {}
  async owner<T>(
    customerId: string,
    run: (tx: Tx) => Promise<T>,
    timeout = 5000,
  ): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.aiCustomerState.upsert({
          where: { customerId },
          create: { customerId },
          update: { customerId },
        });
        await tx.$queryRaw`SELECT "customerId" FROM "AiCustomerState" WHERE "customerId" = ${customerId} FOR UPDATE`;
        return run(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout,
      },
    );
  }
  view(row: {
    id: string;
    name: string;
    configVersion: string;
    answers: Prisma.JsonValue;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      configVersion: row.configVersion,
      answers: row.answers,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  validate(config: ConciergeConfig, dto: ProfileInput) {
    const { minNameLength, maxNameLength } = config.profileLimits;
    if (dto.name.length < minNameLength || dto.name.length > maxNameLength)
      fail(
        "AI_INVALID_PROFILE_NAME",
        "Profile name violates configured limits",
      );
    return {
      ...dto,
      configVersion: config.version,
      answers: this.configs.validate(
        config,
        dto.configVersion,
        dto.answers,
        "profile",
      ),
    };
  }
  async list(customerId: string) {
    return this.owner(customerId, async (tx) => {
      const state = await tx.aiCustomerState.findUniqueOrThrow({
        where: { customerId },
      });
      const profiles = await tx.aiPreferenceProfile.findMany({
        where: { customerId, deletedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return {
        profiles: profiles.map((p) => this.view(p)),
        defaultProfileId: state.defaultProfileId,
        defaultRevision: state.defaultRevision,
      };
    });
  }
  async get(customerId: string, id: string) {
    const row = await this.db.aiPreferenceProfile.findFirst({
      where: { id, customerId, deletedAt: null },
    });
    if (!row) fail("AI_PROFILE_NOT_FOUND", "Profile not found", 404);
    return this.view(row);
  }
  async put(
    customerId: string,
    id: string,
    dto: ProfileInput,
    headers: { match?: string; none?: string },
  ) {
    const config = await this.configs.current();
    this.configs.requireEnabled(config);
    if (!config.capabilities.profiles)
      fail("AI_FEATURE_DISABLED", "Preference profiles are unavailable", 503);
    const data = this.validate(config, dto);
    return this.owner(customerId, async (tx) => {
      // Global UUID check prevents claiming IDs already belonging to any owner.
      const row = await tx.aiPreferenceProfile.findUnique({ where: { id } });
      if (row && row.customerId !== customerId)
        fail("AI_PROFILE_ID_CONFLICT", "Profile ID is unavailable", 409);
      if (row?.deletedAt)
        fail(
          "AI_PROFILE_DELETED",
          "Deleted IDs cannot be reused; create a new UUID",
          410,
        );
      if (row) {
        if (headers.none)
          fail("AI_STALE_REVISION", "Profile already exists", 412);
        matchRevision(headers.match, row.revision);
        return this.view(
          await tx.aiPreferenceProfile.update({
            where: { id, customerId },
            data: {
              ...data,
              answers: data.answers as Prisma.InputJsonObject,
              revision: { increment: 1 },
            },
          }),
        );
      }
      if (headers.match)
        fail("AI_STALE_REVISION", "Profile does not exist", 412);
      if (headers.none !== "*")
        fail("AI_PRECONDITION_REQUIRED", "Create with If-None-Match: *", 428);
      const count = await tx.aiPreferenceProfile.count({
        where: { customerId, deletedAt: null },
      });
      if (count >= config.profileLimits.maxCount)
        fail("AI_PROFILE_LIMIT", "Configured profile limit reached", 409);
      try {
        return this.view(
          await tx.aiPreferenceProfile.create({
            data: {
              id,
              customerId,
              ...data,
              answers: data.answers as Prisma.InputJsonObject,
            },
          }),
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          fail("AI_PROFILE_ID_CONFLICT", "Profile ID is unavailable", 409);
        throw error;
      }
    });
  }
  async remove(customerId: string, id: string, header?: string) {
    return this.owner(customerId, async (tx) => {
      const row = await tx.aiPreferenceProfile.findFirst({
        where: { id, customerId },
      });
      if (!row) fail("AI_PROFILE_NOT_FOUND", "Profile not found", 404);
      if (row.deletedAt) return;
      matchRevision(header, row.revision);
      await tx.aiCustomerState.updateMany({
        where: { customerId, defaultProfileId: id },
        data: { defaultProfileId: null, defaultRevision: { increment: 1 } },
      });
      await tx.aiPreferenceProfile.update({
        where: { id, customerId },
        data: {
          deletedAt: new Date(),
          name: "[deleted]",
          answers: {},
          revision: { increment: 1 },
        },
      });
    });
  }
  async setDefault(
    customerId: string,
    profileId: string | null,
    header?: string,
  ) {
    return this.owner(customerId, async (tx) => {
      const state = await tx.aiCustomerState.findUniqueOrThrow({
        where: { customerId },
      });
      matchRevision(header, state.defaultRevision);
      if (
        profileId &&
        !(await tx.aiPreferenceProfile.findFirst({
          where: { id: profileId, customerId, deletedAt: null },
        }))
      )
        fail("AI_PROFILE_NOT_FOUND", "Profile not found", 404);
      const updated = await tx.aiCustomerState.update({
        where: { customerId },
        data: {
          defaultProfileId: profileId,
          ...(profileId !== state.defaultProfileId
            ? { defaultRevision: { increment: 1 } }
            : {}),
        },
      });
      return {
        defaultProfileId: updated.defaultProfileId,
        defaultRevision: updated.defaultRevision,
      };
    });
  }
  accountView(state: {
    accountAnswers: Prisma.JsonValue;
    accountConfigVersion: string | null;
    accountRevision: number;
    accountUpdatedAt: Date;
  }) {
    return {
      answers: state.accountAnswers,
      configVersion: state.accountConfigVersion,
      revision: state.accountRevision,
      updatedAt: state.accountUpdatedAt,
    };
  }
  account(customerId: string) {
    return this.owner(customerId, async (tx) =>
      this.accountView(
        await tx.aiCustomerState.findUniqueOrThrow({ where: { customerId } }),
      ),
    );
  }
  async putAccount(
    customerId: string,
    dto: z.infer<typeof accountBody>,
    header?: string,
  ) {
    const config = await this.configs.current();
    this.configs.requireEnabled(config);
    const answers = this.configs.validate(
      config,
      dto.configVersion,
      dto.answers,
      "account",
    );
    return this.owner(customerId, async (tx) => {
      const state = await tx.aiCustomerState.findUniqueOrThrow({
        where: { customerId },
      });
      matchRevision(header, state.accountRevision);
      return this.accountView(
        await tx.aiCustomerState.update({
          where: { customerId },
          data: {
            accountAnswers: answers as Prisma.InputJsonObject,
            accountConfigVersion: config.version,
            accountRevision: { increment: 1 },
            accountUpdatedAt: new Date(),
          },
        }),
      );
    });
  }
  async import(customerId: string, dto: z.infer<typeof importBody>) {
    return this.owner(customerId, async (tx) => {
      const requestHash = digest(dto);
      const previous = await tx.aiProfileImport.findUnique({
        where: { customerId_importId: { customerId, importId: dto.importId } },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail(
            "AI_IMPORT_CONFLICT",
            "Import ID was already used with different data",
            409,
          );
        return previous.result;
      }
      const config = await this.configs.current();
      this.configs.requireEnabled(config);
      if (!config.capabilities.profiles)
        fail("AI_FEATURE_DISABLED", "Preference profiles are unavailable", 503);
      if (dto.profiles.length > config.profileLimits.maxImportBatch)
        fail("AI_IMPORT_LIMIT", "Import batch exceeds configured limit");
      if (new Set(dto.profiles.map((p) => p.id)).size !== dto.profiles.length)
        fail("AI_IMPORT_CONFLICT", "Duplicate local IDs in batch", 409);
      const state = await tx.aiCustomerState.findUniqueOrThrow({
        where: { customerId },
      });
      if (dto.accountPreferences) {
        const guest = this.configs.validate(
          config,
          dto.accountPreferences.configVersion,
          dto.accountPreferences.answers,
          "account",
        );
        if (digest(guest) !== digest(state.accountAnswers))
          fail(
            "AI_ACCOUNT_PREFERENCES_CONFLICT",
            "Review guest and account restrictions, then explicitly update account preferences before importing",
            409,
            {
              accountRevision: state.accountRevision,
              requiresExplicitResolution: true,
            },
          );
      }
      let count = await tx.aiPreferenceProfile.count({
        where: { customerId, deletedAt: null },
      });
      const results: {
        localId: string;
        profileId: string;
        status: "imported" | "skipped" | "deleted";
      }[] = [];
      for (const local of dto.profiles) {
        const data = this.validate(config, local);
        const mapping = await tx.aiImportMapping.findUnique({
          where: { customerId_localId: { customerId, localId: local.id } },
        });
        let row = mapping
          ? await tx.aiPreferenceProfile.findFirst({
              where: { id: mapping.profileId, customerId },
            })
          : await tx.aiPreferenceProfile.findUnique({
              where: { id: local.id },
            });
        if (row?.customerId === customerId) {
          results.push({
            localId: local.id,
            profileId: row.id,
            status: row.deletedAt ? "deleted" : "skipped",
          });
          continue;
        }
        if (count >= config.profileLimits.maxCount)
          fail(
            "AI_PROFILE_LIMIT",
            "Import would exceed the configured profile limit",
            409,
          );
        // Imports use mapped IDs unconditionally. Cross-account ID collisions
        // have identical outward behavior and cannot reveal another owner.
        const id = randomUUID();
        row = await tx.aiPreferenceProfile.create({
          data: {
            id,
            customerId,
            name: data.name,
            configVersion: data.configVersion,
            answers: data.answers as Prisma.InputJsonObject,
          },
        });
        await tx.aiImportMapping.create({
          data: { customerId, localId: local.id, profileId: id },
        });
        count++;
        results.push({
          localId: local.id,
          profileId: row.id,
          status: "imported",
        });
      }
      let defaultProfileId = state.defaultProfileId;
      if (!defaultProfileId && dto.defaultProfileId) {
        const selected = results.find(
          (r) => r.localId === dto.defaultProfileId && r.status !== "deleted",
        );
        if (!selected)
          fail(
            "AI_IMPORT_CONFLICT",
            "Default must reference a non-deleted profile in this batch",
            409,
          );
        defaultProfileId = selected.profileId;
        await tx.aiCustomerState.update({
          where: { customerId },
          data: { defaultProfileId, defaultRevision: { increment: 1 } },
        });
      }
      const result = {
        results,
        defaultProfileId,
        defaultRevision:
          state.defaultRevision +
          (defaultProfileId !== state.defaultProfileId ? 1 : 0),
      };
      await tx.aiProfileImport.create({
        data: { customerId, importId: dto.importId, requestHash, result },
      });
      return result;
    });
  }
}
