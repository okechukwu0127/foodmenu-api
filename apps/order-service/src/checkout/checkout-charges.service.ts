import { Injectable } from "@nestjs/common";
import { PrismaService } from "@app/database";
import {
  checkoutInputSchema,
  commerceFailure as fail,
  commerceParse as parse,
} from "@app/dto";
import { z } from "zod";
@Injectable()
export class CheckoutChargesService {
  constructor(private readonly db: PrismaService) {}
  async quote(input: unknown) {
    const dto = parse(
      z
        .object({
          subtotal: z.number().int().nonnegative().max(100000000),
          currency: z.string().regex(/^[A-Z]{3}$/),
          checkout: checkoutInputSchema,
        })
        .strict(),
      input,
    );
    const policy = await this.db.checkoutPolicy.findUnique({
      where: { currency: dto.currency },
    });
    if (!policy)
      fail(
        "CHECKOUT_NOT_CONFIGURED",
        "Restaurant checkout charges are not configured",
        503,
      );
    if (dto.checkout.fulfilment === "pickup" && !policy.pickupEnabled)
      fail("PICKUP_UNAVAILABLE", "Pickup is unavailable", 409);
    if (dto.checkout.fulfilment === "delivery") {
      const address = dto.checkout.deliveryAddress!;
      const postcode = address.postcode.replace(/\s/g, "").toUpperCase();
      const postcodeAllowed =
        policy.deliveryPostcodePrefixes.length === 0 ||
        policy.deliveryPostcodePrefixes.some((p) =>
          postcode.startsWith(p.replace(/\s/g, "").toUpperCase()),
        );
      if (
        !policy.deliveryEnabled ||
        !policy.deliveryCountries.includes(address.country) ||
        !postcodeAllowed
      )
        fail(
          "DELIVERY_UNAVAILABLE",
          "Delivery is unavailable for this address",
          409,
        );
    }
    const deliveryFee =
      dto.checkout.fulfilment === "delivery" ? policy.deliveryFee : 0;
    const taxAmount = Math.round(
      ((dto.subtotal + deliveryFee) * policy.taxRateBps) / 10000,
    );
    return {
      policyRevision: policy.revision,
      subtotal: dto.subtotal,
      deliveryFee,
      taxAmount,
      discountAmount: 0,
      amount: dto.subtotal + deliveryFee + taxAmount,
      currency: dto.currency,
    };
  }
}
