import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { PrismaService } from "@app/database";
import { Prisma } from "@prisma/client";
import { firstValueFrom, timeout } from "rxjs";
import { createHash } from "crypto";
import { MENU_PATTERNS, ORDER_PATTERNS } from "@app/common";
import {
  CreatePaymentIntentDto,
  QuoteInput,
  commerceFailure as fail,
  commerceParse as parse,
  quoteInputSchema,
} from "@app/dto";
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
@Injectable()
export class CheckoutQuotesService {
  private readonly logger = new Logger(CheckoutQuotesService.name);

  constructor(
    private readonly db: PrismaService,
    @Inject("MENU_SERVICE") private readonly menu: ClientProxy,
    @Inject("ORDER_SERVICE") private readonly orders: ClientProxy,
  ) {}
  private rpc(client: ClientProxy, pattern: string, input: unknown) {
    return firstValueFrom(client.send(pattern, input).pipe(timeout(7000))).catch(
      (error: unknown) => {
        const outer =
          typeof error === "object" && error !== null
            ? (error as Record<string, unknown>)
            : {};
        const inner =
          typeof outer.error === "object" && outer.error !== null
            ? (outer.error as Record<string, unknown>)
            : {};
        const code =
          (typeof outer.code === "string" && outer.code) ||
          (typeof inner.code === "string" && inner.code) ||
          null;
        const statusCode =
          (typeof outer.statusCode === "number" && outer.statusCode) ||
          (typeof inner.statusCode === "number" && inner.statusCode) ||
          null;
        const log = JSON.stringify({
          event: "checkout_quote_rpc_failed",
          pattern,
          code,
          statusCode,
          errorName:
            typeof outer.name === "string"
              ? outer.name
              : typeof inner.name === "string"
                ? inner.name
                : null,
        });
        if (code) this.logger.warn(log);
        else this.logger.error(log);
        const message =
          (typeof outer.message === "string" && outer.message) ||
          (typeof inner.message === "string" && inner.message) ||
          null;
        if (code && statusCode && statusCode >= 400 && statusCode <= 599)
          fail(code, message ?? "Checkout service request failed", statusCode);
        throw error;
      },
    );
  }
  private async calculate(dto: QuoteInput) {
    const priced = await this.rpc(this.menu, MENU_PATTERNS.PRICE_CART, {
      items: dto.items,
    });
    const charges = await this.rpc(this.orders, ORDER_PATTERNS.QUOTE_CHARGES, {
      subtotal: priced.subtotal,
      currency: priced.currency,
      checkout: dto.checkout,
    });
    const items = priced.items.map((i: any) => ({
      lineId: i.lineId,
      foodId: i.foodId,
      quantity: i.quantity,
      sizeId: i.sizeId ?? null,
      modifiers: i.modifiers,
      extras: i.extras,
      name: i.name,
      currency: i.currency,
      unitAmount: i.unitAmount,
      lineAmount: i.lineAmount,
    }));
    if (
      !Number.isSafeInteger(charges.amount) ||
      charges.amount <= 0 ||
      charges.amount > 100000000
    )
      fail("INVALID_CHECKOUT_TOTAL", "Checkout total is invalid");
    return { ...charges, items, checkout: dto.checkout };
  }
  view(q: any) {
    return {
      quoteId: q.id,
      amount: q.amount,
      currency: q.currency,
      expiresAt: q.expiresAt.toISOString(),
      state: q.state,
      snapshot: q.snapshot,
    };
  }
  async create(input: unknown): Promise<any> {
    const dto = parse(quoteInputSchema, input),
      requestHash = hash(dto);
    const previous = await this.db.checkoutQuote.findUnique({
      where: {
        customerId_requestId: {
          customerId: dto.customerId,
          requestId: dto.requestId,
        },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        fail(
          "QUOTE_ID_CONFLICT",
          "Request ID was used with different checkout data",
          409,
        );
      return this.view(previous);
    }
    const snapshot = await this.calculate(dto);
    try {
      return this.view(
        await this.db.checkoutQuote.create({
          data: {
            customerId: dto.customerId,
            requestId: dto.requestId,
            conversationId: dto.conversationId,
            requestHash,
            selection: dto as unknown as Prisma.InputJsonObject,
            snapshot,
            amount: snapshot.amount,
            currency: snapshot.currency,
            expiresAt: new Date(Date.now() + 300000),
          },
        }),
      );
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      return this.create(input);
    }
  }
  async owned(id: string, customerId: string) {
    const q = await this.db.checkoutQuote.findFirst({
      where: { id, customerId },
    });
    if (!q) fail("QUOTE_NOT_FOUND", "Checkout quote not found", 404);
    return q;
  }
  async consume<T>(
    id: string,
    customerId: string,
    conversationId: string | undefined,
    create: (
      payload: CreatePaymentIntentDto,
      resumeId?: string,
    ) => Promise<T & { paymentIntentId: string; orderId: string }>,
  ): Promise<T> {
    const owned = await this.owned(id, customerId);
    if ((owned.conversationId ?? undefined) !== conversationId)
      fail(
        "CONVERSATION_CHECKOUT_REQUIRED",
        "Use the owning conversation payment endpoint",
        409,
      );
    // Commit the reservation BEFORE contacting Stripe; retries use the same key
    // even if a provider/DB acknowledgement is lost.
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CheckoutQuote" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const q = await tx.checkoutQuote.findFirstOrThrow({
          where: { id, customerId },
        });
        if (!["OPEN", "RESERVED", "PAYMENT"].includes(q.state))
          fail("QUOTE_INVALIDATED", "Prepare a fresh checkout quote", 409);
        if (q.state === "OPEN") {
          if (q.expiresAt <= new Date())
            fail("QUOTE_EXPIRED", "Prepare a fresh checkout quote", 409);
          const current = await this.calculate(
            q.selection as unknown as QuoteInput,
          );
          if (hash(current) !== hash(q.snapshot))
            fail(
              "QUOTE_CHANGED",
              "Menu or delivery charges changed; prepare a fresh quote",
              409,
            );
          await tx.checkoutQuote.update({
            where: { id },
            data: { state: "RESERVED", reservedAt: new Date() },
          });
        }
      },
      { timeout: 20000 },
    );
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CheckoutQuote" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const q = await tx.checkoutQuote.findFirstOrThrow({
          where: { id, customerId },
        });
        if (
          !q.paymentIntentId &&
          q.reservedAt &&
          Date.now() - q.reservedAt.getTime() > 23 * 3600000
        )
          fail(
            "QUOTE_RECONCILIATION_REQUIRED",
            "Payment outcome is uncertain; reconcile with support before another payment",
            409,
          );
        const s = q.snapshot as any;
        const result = await create(
          {
            amount: q.amount,
            currency: q.currency.toLowerCase(),
            customerId,
            checkoutSessionId: `quote:${q.id}`,
            idempotencyKey: `quote:${q.id}`,
            order: {
              subtotal: s.subtotal,
              deliveryFee: s.deliveryFee,
              taxAmount: s.taxAmount,
              discountAmount: 0,
              deliveryAddress: s.checkout.deliveryAddress,
              metadata: {
                fulfilment: s.checkout.fulfilment,
                checkoutQuoteId: q.id,
                ...(s.checkout.pickupLocation
                  ? { pickupLocation: s.checkout.pickupLocation }
                  : {}),
              },
              items: s.items.map((i: any) => ({
                foodItemId: i.foodId,
                name: i.name,
                quantity: i.quantity,
                unitAmount: i.unitAmount,
                modifiers: i.modifiers,
                itemSnapshot: i,
              })),
            },
            metadata: {
              checkoutQuoteId: q.id,
              ...(q.conversationId ? { conversationId: q.conversationId } : {}),
            },
          },
          q.paymentIntentId ?? undefined,
        );
        await tx.checkoutQuote.update({
          where: { id },
          data: {
            paymentIntentId: result.paymentIntentId,
            orderId: result.orderId,
            state: "PAYMENT",
          },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
  async recordVerified(payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    metadata: Record<string, string>;
  }) {
    const id = payment.metadata.checkoutQuoteId;
    if (!id) return;
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CheckoutQuote" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const q = await tx.checkoutQuote.findUnique({ where: { id } });
      if (
        !q ||
        (q.paymentIntentId
          ? q.paymentIntentId !== payment.id
          : q.state !== "RESERVED") ||
        q.amount !== payment.amount ||
        q.currency.toLowerCase() !== payment.currency.toLowerCase() ||
        (q.orderId && q.orderId !== payment.metadata.orderId) ||
        !payment.metadata.orderId
      )
        fail(
          "PAYMENT_LINK_MISMATCH",
          "Verified payment does not match the checkout quote",
          409,
        );
      if (q.observedStatus === payment.status) return;
      if (
        ["succeeded", "canceled"].includes(q.observedStatus ?? "") &&
        q.observedStatus !== payment.status
      )
        return;
      const observation = q.observation + 1;
      await tx.checkoutQuote.update({
        where: { id },
        data: {
          observation,
          observedStatus: payment.status,
          paymentIntentId: payment.id,
          orderId: payment.metadata.orderId,
          state: "PAYMENT",
        },
      });
      if (q.conversationId)
        await tx.paymentCommerceEvent.create({
          data: {
            quoteId: id,
            observation,
            payload: {
              quoteId: id,
              conversationId: q.conversationId,
              customerId: q.customerId,
              observation,
              paymentIntentId: payment.id,
              orderId: payment.metadata.orderId,
              amount: q.amount,
              currency: q.currency,
              status: payment.status,
            },
          },
        });
    });
  }
  async invalidate(id: string, customerId: string) {
    await this.owned(id, customerId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CheckoutQuote" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const q = await tx.checkoutQuote.findUniqueOrThrow({ where: { id } });
      if (
        q.state !== "OPEN" &&
        q.state !== "INVALIDATED" &&
        q.observedStatus !== "canceled" &&
        q.observedStatus !== "succeeded"
      )
        fail(
          "PAYMENT_PENDING",
          "Resolve or cancel the current payment before changing the cart",
          409,
        );
      await tx.checkoutQuote.update({
        where: { id },
        data: { state: "INVALIDATED" },
      });
      return { invalidated: true };
    });
  }
  poll() {
    return this.db.paymentCommerceEvent.findMany({
      where: { acknowledgedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }
  ack(id: string) {
    return this.db.paymentCommerceEvent.updateMany({
      where: { id },
      data: { acknowledgedAt: new Date() },
    });
  }
}
