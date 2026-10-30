import { z } from "zod";
import { AppError } from "@app/errors";
export const commerceId = z.string().min(1).max(128);
export const cartLineSchema = z
  .object({
    lineId: z.string().uuid(),
    foodId: commerceId,
    quantity: z.number().int().min(1).max(20),
    sizeId: commerceId.optional(),
    modifiers: z
      .array(
        z
          .object({
            groupId: commerceId,
            optionId: commerceId,
            quantity: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    extras: z
      .array(
        z
          .object({
            kind: z.enum(["side", "appetizer"]),
            optionId: commerceId,
            quantity: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();
export const addressSchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    postcode: z.string().trim().min(1).max(30),
    country: z.string().regex(/^[A-Z]{2}$/),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const pickupLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1).max(250),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const checkoutInputSchema = z
  .object({
    fulfilment: z.enum(["pickup", "delivery"]),
    deliveryAddress: addressSchema.optional(),
    pickupLocation: pickupLocationSchema.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.fulfilment === "delivery" && !v.deliveryAddress)
      c.addIssue({ code: "custom", message: "Delivery address is required" });
    if (v.fulfilment === "pickup" && v.deliveryAddress)
      c.addIssue({
        code: "custom",
        message: "Pickup cannot include a delivery address",
      });
    if (v.fulfilment === "delivery" && v.pickupLocation)
      c.addIssue({
        code: "custom",
        message: "Delivery cannot include a pickup location",
      });
  });
export const quoteInputSchema = z
  .object({
    requestId: z.string().uuid(),
    customerId: commerceId,
    conversationId: z.string().uuid().optional(),
    items: z.array(cartLineSchema).min(1).max(30),
    checkout: checkoutInputSchema,
  })
  .strict();
export type CartLine = z.infer<typeof cartLineSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type PricedLine = CartLine & {
  name: string;
  currency: string;
  unitAmount: number;
  lineAmount: number;
  food: unknown;
};
export function commerceFailure(
  code: string,
  message: string,
  statusCode = 400,
): never {
  throw new AppError(code, message, statusCode);
}
export function commerceParse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    commerceFailure("COMMERCE_INVALID_INPUT", "Invalid commerce request");
  return result.data;
}

export async function commerceRpc<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const { RpcException } = await import("@nestjs/microservices");
    if (error instanceof RpcException) throw error;
    if (error instanceof AppError)
      throw new RpcException({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
      });
    throw new RpcException({
      statusCode: 503,
      code: "COMMERCE_UNAVAILABLE",
      message: "Commerce service unavailable",
    });
  }
}
