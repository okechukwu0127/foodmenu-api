import { z } from "zod";
import { answersSchema } from "../config/config.schema";
import { uuid } from "../persistence/contracts";

export const profileBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    configVersion: z.string().min(1).max(100),
    answers: answersSchema,
  })
  .strict();
export const accountBody = profileBody.omit({ name: true });
export const importBody = z
  .object({
    importId: uuid,
    profiles: z.array(profileBody.extend({ id: uuid })).max(50),
    defaultProfileId: uuid.nullable().optional(),
    accountPreferences: accountBody.optional(),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileBody>;

export const createConversationBody = z
  .object({
    locale: z.string().max(20),
    preferenceProfileId: uuid.nullable().optional(),
    guestPreferences: z
      .object({
        configVersion: z.string().max(100),
        profileAnswers: answersSchema,
        accountAnswers: answersSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export const switchContextBody = z
  .object({
    configVersion: z.string().max(100),
    preferenceProfileId: uuid.nullable().optional(),
    temporaryAnswers: answersSchema.optional(),
  })
  .strict();
export const chatBody = z
  .object({
    conversationId: uuid,
    clientMessageId: uuid,
    text: z.string().trim().min(1).max(10000),
    locale: z.string().max(20),
  })
  .strict();

export const pageQuery = z
  .object({
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).optional(),
  })
  .strict();
