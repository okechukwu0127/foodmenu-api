import { z } from "zod";
import { cartLineSchema, checkoutInputSchema } from "@app/dto";
import { uuid } from "../persistence/contracts";
const action = { actionId: uuid };
export const commerceActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...action,
      type: z.literal("select_food"),
      foodId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      ...action,
      type: z.literal("save_customisation"),
      item: cartLineSchema,
    })
    .strict(),
  z
    .object({ ...action, type: z.literal("add_item"), item: cartLineSchema })
    .strict(),
  z
    .object({ ...action, type: z.literal("set_item"), item: cartLineSchema })
    .strict(),
  z
    .object({ ...action, type: z.literal("remove_item"), lineId: uuid })
    .strict(),
  z.object({ ...action, type: z.literal("clear_cart") }).strict(),
  z
    .object({
      ...action,
      type: z.literal("prepare_checkout"),
      checkout: checkoutInputSchema,
    })
    .strict(),
]);
export const paymentActionSchema = z
  .object({ actionId: uuid, quoteId: uuid })
  .strict();
export const commerceEventSchema = z
  .object({
    quoteId: uuid,
    conversationId: uuid,
    customerId: z.string(),
    observation: z.number().int().nonnegative(),
    paymentIntentId: z.string().nullable(),
    orderId: z.string().nullable(),
    amount: z.number().int().positive(),
    currency: z.string(),
    status: z.enum([
      "PREPARED",
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
      "requires_capture",
      "canceled",
      "succeeded",
    ]),
  })
  .strict();
