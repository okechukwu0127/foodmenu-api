import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Prisma, AiConversation, AiCommerceState } from "@prisma/client";
import { firstValueFrom, timeout } from "rxjs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { MENU_PATTERNS, PAYMENT_PATTERNS } from "@app/common";
import { CartLine } from "@app/dto";
import {
  ConversationsService,
  tokenHash,
} from "../conversations/conversations.service";
import { Actor } from "../conversations/access.service";
import { digest, fail, matchRevision } from "../persistence/contracts";
import {
  commerceActionSchema,
  commerceEventSchema,
  paymentActionSchema,
} from "./commerce.dto";
import { ConciergeMenuAdapter, eligible } from "../adapters/menu.adapter";
import { EffectiveContext } from "../preferences/effective-preferences.service";
import { cardSchemas, CardType } from "../tools/cards.schema";

type Tx = Prisma.TransactionClient;
type CartEntry = { selection: CartLine; priced: any };
const errorRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class ConversationCommerceService {
  private readonly logger = new Logger(ConversationCommerceService.name);

  constructor(
    readonly conversations: ConversationsService,
    private readonly menuAdapter: ConciergeMenuAdapter,
    @Inject("AI_MENU_SERVICE") private readonly menu: ClientProxy,
    @Inject("AI_PAYMENT_SERVICE") private readonly payment: ClientProxy,
  ) {}
  private async rpc(
    client: ClientProxy,
    pattern: string,
    payload: unknown,
  ): Promise<any> {
    try {
      return await firstValueFrom(
        client.send(pattern, payload).pipe(timeout(35000)),
      );
    } catch (error: unknown) {
      const outer = errorRecord(error);
      const inner = errorRecord(outer.error);
      const code =
        (typeof outer.code === "string" && outer.code) ||
        (typeof inner.code === "string" && inner.code) ||
        undefined;
      const statusCode =
        (typeof outer.statusCode === "number" && outer.statusCode) ||
        (typeof inner.statusCode === "number" && inner.statusCode) ||
        (typeof outer.status === "number" && outer.status) ||
        undefined;
      const message =
        (typeof outer.message === "string" && outer.message) ||
        (typeof inner.message === "string" && inner.message) ||
        undefined;
      const log = JSON.stringify({
        event: "ai_commerce_rpc_failed",
        pattern,
        code: code ?? null,
        statusCode: statusCode ?? null,
        errorName:
          typeof outer.name === "string"
            ? outer.name
            : typeof inner.name === "string"
              ? inner.name
              : null,
      });
      if (code) this.logger.warn(log);
      else this.logger.error(log);
      fail(
        code ?? "COMMERCE_UNAVAILABLE",
        message && statusCode
          ? message
          : "Commerce service is unavailable; retry with the same action ID",
        statusCode ?? 503,
      );
    }
  }
  private transact<T>(actor: Actor, operation: (tx: Tx) => Promise<T>) {
    if (actor.customerId)
      return this.conversations.preferences.owner(
        actor.customerId,
        operation,
        45000,
      );
    return this.conversations.db.$transaction(operation, { timeout: 45000 });
  }
  private state(tx: Tx, id: string) {
    return tx.aiCommerceState.upsert({
      where: { conversationId: id },
      create: { conversationId: id },
      update: {},
    });
  }
  view(state: AiCommerceState) {
    const cart = state.cart as unknown as CartEntry[];
    return {
      conversationId: state.conversationId,
      revision: state.revision,
      stage: state.stage,
      cart: cart.map((i) => i.priced),
      draft: state.draft,
      quoteId: state.quoteId,
      updatedAt: state.updatedAt.toISOString(),
      subtotal: cart.reduce((n, i) => n + i.priced.lineAmount, 0),
      pricesAreEstimates: state.stage !== "QUOTED",
    };
  }
  private async noChat(tx: Tx, id: string) {
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
        "Wait for the current chat turn before changing commerce state",
        409,
      );
  }
  private async context(tx: Tx, row: AiConversation, actor: Actor) {
    const config = await this.conversations.configs.current();
    this.conversations.configs.requireEnabled(config);
    if (!config.capabilities.commerce)
      fail("AI_FEATURE_DISABLED", "Conversation commerce is unavailable", 503);
    return this.conversations.refresh(tx, config, row, actor);
  }
  private async price(
    cart: CartLine[],
    context: EffectiveContext,
    locale: string,
    draft = false,
  ) {
    const priced = await this.rpc(this.menu, MENU_PATTERNS.PRICE_CART, {
      items: cart,
      draft,
    });
    for (const item of priced.items)
      if (!eligible(this.menuAdapter.map(item.food, locale), context))
        fail(
          "AI_FOOD_NOT_ELIGIBLE",
          "A cart item conflicts with current restrictions or lacks required declarations",
          409,
        );
    return {
      ...priced,
      items: priced.items.map((i: any) => {
        const { food, ...publicItem } = i;
        void food;
        return publicItem;
      }),
    };
  }
  private async append(
    tx: Tx,
    conversationId: string,
    context: Prisma.JsonValue,
    actionId: string,
    type: CardType,
    data: unknown,
    text: string,
  ) {
    const validated = cardSchemas[type].parse(data);
    const existing = await tx.aiTurn.findUnique({
      where: {
        conversationId_clientMessageId: {
          conversationId,
          clientMessageId: actionId,
        },
      },
    });
    if (existing)
      fail(
        "AI_ACTION_ID_CONFLICT",
        "Action ID conflicts with an existing chat message",
        409,
      );
    const turn = await tx.aiTurn.create({
      data: {
        conversationId,
        clientMessageId: actionId,
        requestHash: digest({ type, data: validated }),
        kind: "COMMERCE",
        status: "COMPLETED",
        context: context as Prisma.InputJsonValue,
        leaseExpiresAt: new Date(),
      },
    });
    const next = await tx.aiConversation.update({
      where: { id: conversationId },
      data: { nextSequence: { increment: 1 } },
    });
    const message = await tx.aiMessage.create({
      data: {
        conversationId,
        turnId: turn.id,
        sequence: next.nextSequence,
        role: "assistant",
        text,
        parts: [
          { type, id: randomUUID(), data: validated as Prisma.InputJsonValue },
        ],
      },
    });
    return message.id;
  }
  private async invalidate(state: AiCommerceState, customerId?: string) {
    if (state.quoteId && customerId)
      await this.rpc(this.payment, PAYMENT_PATTERNS.INVALIDATE_CHECKOUT_QUOTE, {
        quoteId: state.quoteId,
        customerId,
      });
  }
  async get(id: string, actor: Actor) {
    const current = await this.transact(actor, async (tx) => {
      await this.conversations.lock(tx, id, actor);
      return this.view(await this.state(tx, id));
    });
    if (actor.customerId && current.quoteId) {
      const observed = await this.rpc(
        this.payment,
        PAYMENT_PATTERNS.GET_QUOTE_STATUS,
        { quoteId: current.quoteId, customerId: actor.customerId },
      );
      await this.observe(observed);
    }
    return this.transact(actor, async (tx) => {
      await this.conversations.lock(tx, id, actor);
      const state = await this.state(tx, id);
      const checkouts = await tx.aiConversationCheckout.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "asc" },
      });
      return { ...this.view(state), checkouts };
    });
  }
  async action(
    id: string,
    actor: Actor,
    dto: z.infer<typeof commerceActionSchema>,
    condition?: string,
  ) {
    return this.transact(actor, async (tx) => {
      const row = await this.conversations.lock(tx, id, actor);
      const previous = await tx.aiCommerceAction.findUnique({
        where: {
          conversationId_actionId: {
            conversationId: id,
            actionId: dto.actionId,
          },
        },
      });
      const requestHash = digest(dto);
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail(
            "AI_ACTION_ID_CONFLICT",
            "Action ID was used with different data",
            409,
          );
        return previous.result;
      }
      await this.noChat(tx, id);
      const state = await this.state(tx, id);
      matchRevision(condition, state.revision);
      const context = await this.context(tx, row, actor);
      const entries = state.cart as unknown as CartEntry[];
      let data: Prisma.AiCommerceStateUpdateInput = {},
        text = "Cart updated",
        type: CardType = "data-cart-summary",
        extra: any = {};
      if (dto.type === "select_food") {
        await this.menuAdapter.details(dto.foodId, context, row.locale);
        data = { draft: { foodId: dto.foodId } };
        text = "Food selected. Choose your customisation.";
        type = "data-commerce-selection";
      } else if (dto.type === "save_customisation") {
        const priced = await this.price([dto.item], context, row.locale, true);
        data = {
          draft: {
            selection: dto.item,
            priced: priced.items[0],
          } as unknown as Prisma.InputJsonObject,
        };
        text = "Customisation saved. Confirm to add this item to your cart.";
        type = "data-commerce-selection";
      } else if (dto.type === "prepare_checkout") {
        if (!actor.customerId)
          fail(
            "AI_LOGIN_REQUIRED",
            "Sign in and claim this conversation before checkout",
            401,
          );
        if (!entries.length)
          fail("CART_EMPTY", "Add an item before preparing checkout");
        await this.invalidate(state, actor.customerId);
        const priced = await this.price(
          entries.map((e) => e.selection),
          context,
          row.locale,
        );
        const quote = await this.rpc(
          this.payment,
          PAYMENT_PATTERNS.CREATE_CHECKOUT_QUOTE,
          {
            customerId: actor.customerId,
            requestId: dto.actionId,
            conversationId: id,
            items: entries.map((e) => e.selection),
            checkout: dto.checkout,
          },
        );
        await tx.aiConversationCheckout.create({
          data: {
            quoteId: quote.quoteId,
            conversationId: id,
            customerId: actor.customerId,
            cartRevision: state.revision + 1,
            amount: quote.amount,
            currency: quote.currency,
          },
        });
        data = {
          cart: entries.map((e, i) => ({
            selection: e.selection,
            priced: priced.items[i],
          })) as unknown as Prisma.InputJsonArray,
          quoteId: quote.quoteId,
          stage: "QUOTED",
        };
        type = "data-checkout-prepared";
        text = "Checkout quote prepared. Review the total and confirm payment.";
        extra = { quote };
      } else {
        await this.invalidate(state, actor.customerId);
        let selections = entries.map((e) => e.selection);
        if (dto.type === "clear_cart") selections = [];
        else if (dto.type === "remove_item")
          selections = selections.filter((i) => i.lineId !== dto.lineId);
        else {
          const index = selections.findIndex(
            (i) => i.lineId === dto.item.lineId,
          );
          if (dto.type === "add_item" && index >= 0)
            fail(
              "CART_LINE_CONFLICT",
              "Line ID already exists; use set_item",
              409,
            );
          if (dto.type === "set_item" && index < 0)
            fail("CART_LINE_NOT_FOUND", "Cart line not found", 404);
          selections = [
            ...selections.filter((i) => i.lineId !== dto.item.lineId),
            dto.item,
          ];
        }
        if (selections.length > 30)
          fail("CART_LIMIT", "Cart line limit reached");
        const priced = selections.length
          ? await this.price(selections, context, row.locale)
          : { items: [] };
        data = {
          cart: selections.map((selection, i) => ({
            selection,
            priced: priced.items[i],
          })) as unknown as Prisma.InputJsonArray,
          quoteId: null,
          stage: selections.length ? "CART" : "BROWSING",
        };
      }
      const updated = await tx.aiCommerceState.update({
        where: { conversationId: id },
        data: { ...data, revision: { increment: 1 } },
      });
      const result = { state: this.view(updated), ...extra };
      const messageId = await this.append(
        tx,
        id,
        row.context,
        dto.actionId,
        type,
        { version: 1, ...result },
        text,
      );
      const response = { ...result, messageId };
      await tx.aiCommerceAction.create({
        data: {
          conversationId: id,
          actionId: dto.actionId,
          requestHash,
          result: response as unknown as Prisma.InputJsonObject,
        },
      });
      return response;
    });
  }
  async begin(
    id: string,
    actor: Actor,
    dto: z.infer<typeof paymentActionSchema>,
    condition?: string,
  ) {
    if (!actor.customerId)
      fail("AI_LOGIN_REQUIRED", "Sign in before payment", 401);
    await this.transact(actor, async (tx) => {
      const row = await this.conversations.lock(tx, id, actor);
      const previous = await tx.aiCommerceAction.findUnique({
        where: {
          conversationId_actionId: {
            conversationId: id,
            actionId: dto.actionId,
          },
        },
      });
      const requestHash = digest({ type: "begin_payment", ...dto });
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail("AI_ACTION_ID_CONFLICT", "Action ID was reused", 409);
        return;
      }
      await this.noChat(tx, id);
      const state = await this.state(tx, id);
      matchRevision(condition, state.revision);
      if (
        state.quoteId !== dto.quoteId ||
        !["QUOTED", "PAYMENT_PENDING"].includes(state.stage)
      )
        fail("QUOTE_STALE", "Prepare checkout for the current cart", 409);
      const context = await this.context(tx, row, actor);
      await this.price(
        (state.cart as unknown as CartEntry[]).map((e) => e.selection),
        context,
        row.locale,
      );
      const quote = await tx.aiConversationCheckout.findFirst({
        where: {
          quoteId: dto.quoteId,
          conversationId: id,
          customerId: actor.customerId,
        },
      });
      if (!quote) fail("QUOTE_NOT_FOUND", "Checkout quote not found", 404);
      const updated = await tx.aiCommerceState.update({
        where: { conversationId: id },
        data: { stage: "PAYMENT_PENDING", revision: { increment: 1 } },
      });
      const messageId = await this.append(
        tx,
        id,
        row.context,
        dto.actionId,
        "data-checkout-prepared",
        { version: 1, state: this.view(updated) },
        "Payment preparation requested. Payment is not yet confirmed.",
      );
      await tx.aiCommerceAction.create({
        data: {
          conversationId: id,
          actionId: dto.actionId,
          requestHash,
          result: { messageId },
        },
      });
    });
    // The external side effect follows a durable action record. A retry resumes
    // the same quote/Stripe intent and never creates another checkout identity.
    const result = await this.rpc(
      this.payment,
      PAYMENT_PATTERNS.CREATE_PAYMENT_INTENT,
      {
        quoteId: dto.quoteId,
        customerId: actor.customerId,
        conversationId: id,
      },
    );
    await this.observe(
      await this.rpc(this.payment, PAYMENT_PATTERNS.GET_QUOTE_STATUS, {
        quoteId: dto.quoteId,
        customerId: actor.customerId,
      }),
    );
    return { ...result, commerce: await this.get(id, actor) };
  }
  async cancel(id: string, actor: Actor, quoteId: string) {
    if (!actor.customerId)
      fail("AI_LOGIN_REQUIRED", "Sign in before managing payment", 401);
    await this.conversations.db.$transaction(async (tx) => {
      await this.conversations.owned(tx, id, actor);
      if (
        !(await tx.aiConversationCheckout.findFirst({
          where: { quoteId, conversationId: id, customerId: actor.customerId },
        }))
      )
        fail("QUOTE_NOT_FOUND", "Checkout quote not found", 404);
    });
    await this.observe(
      await this.rpc(this.payment, PAYMENT_PATTERNS.CANCEL_QUOTE_PAYMENT, {
        quoteId,
        customerId: actor.customerId,
      }),
    );
    return this.get(id, actor);
  }
  async observe(input: unknown) {
    const event = commerceEventSchema.parse(input);
    if (!event.paymentIntentId || !event.orderId || event.observation === 0)
      return;
    await this.conversations.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${event.conversationId}::uuid FOR UPDATE`;
      const ref = await tx.aiConversationCheckout.findFirst({
        where: {
          quoteId: event.quoteId,
          conversationId: event.conversationId,
          customerId: event.customerId,
        },
      });
      const row = await tx.aiConversation.findFirst({
        where: {
          id: event.conversationId,
          customerId: event.customerId,
          deletedAt: null,
        },
      });
      if (!ref || !row) return;
      if (
        ref.amount !== event.amount ||
        ref.currency !== event.currency ||
        (ref.paymentIntentId &&
          ref.paymentIntentId !== event.paymentIntentId) ||
        (ref.orderId && ref.orderId !== event.orderId)
      )
        fail(
          "PAYMENT_LINK_MISMATCH",
          "Payment observation does not match conversation checkout",
          409,
        );
      if (event.observation <= ref.lastObservation) return;
      await tx.aiConversationCheckout.update({
        where: { quoteId: ref.quoteId },
        data: {
          lastObservation: event.observation,
          status: event.status,
          paymentIntentId: event.paymentIntentId,
          orderId: event.orderId,
        },
      });
      const state = await this.state(tx, row.id);
      if (state.quoteId === ref.quoteId)
        await tx.aiCommerceState.update({
          where: { conversationId: row.id },
          data: {
            stage:
              event.status === "succeeded"
                ? "ORDER_CONFIRMED"
                : event.status === "canceled"
                  ? "PAYMENT_CANCELLED"
                  : "PAYMENT_PENDING",
            revision: { increment: 1 },
          },
        });
      await this.append(
        tx,
        row.id,
        row.context,
        randomUUID(),
        "data-payment-status",
        { version: 1, ...event, verified: true },
        event.status === "succeeded"
          ? `Payment confirmed. Your order ${event.orderId} has been placed.`
          : event.status === "canceled"
            ? "Payment cancelled. Your order has not been paid."
            : "Payment status updated. Payment is not yet confirmed.",
      );
    });
  }
  async claim(id: string, customerId: string, guestToken: string) {
    const proof = tokenHash(guestToken);
    return this.conversations.preferences.owner(customerId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const row = await tx.aiConversation.findFirst({
        where: { id, deletedAt: null },
      });
      if (!row || row.expiresAt <= new Date())
        fail("AI_CONVERSATION_NOT_FOUND", "Conversation not found", 404);
      if (
        row.customerId === customerId &&
        row.claimedGuestTokenHash === proof &&
        row.claimExpiresAt &&
        row.claimExpiresAt > new Date()
      )
        return this.conversations.public(row);
      if (row.customerId || row.guestTokenHash !== proof)
        fail("AI_CONVERSATION_NOT_FOUND", "Conversation not found", 404);
      if (!row.guestExpiresAt || row.guestExpiresAt <= new Date())
        fail("AI_GUEST_EXPIRED", "Guest access expired", 401);
      await this.noChat(tx, id);
      const config = await this.conversations.configs.current();
      const old = row.context as unknown as EffectiveContext;
      this.conversations.configs.version(config, old.configVersion);
      const temporary: Record<string, any> = {};
      for (const layer of [
        old.accountAnswers,
        old.profileAnswers,
        old.temporaryAnswers,
      ])
        for (const [key, value] of Object.entries(layer)) {
          const q = config.questions.find((q) => q.id === key);
          if (Array.isArray(value)) {
            let values = [
              ...new Set([
                ...(Array.isArray(temporary[key]) ? temporary[key] : []),
                ...value,
              ]),
            ].filter(
              (v) =>
                q?.options.find((o) => o.id === v)?.effect?.kind !==
                "none-known",
            );
            if (
              values.some((v) => !q?.options.find((o) => o.id === v)?.exclusive)
            )
              values = values.filter(
                (v) => !q?.options.find((o) => o.id === v)?.exclusive,
              );
            temporary[key] = values;
          } else if (
            !q?.options.find((o) => o.id === value)?.effect ||
            q?.options.find((o) => o.id === value)?.effect?.kind !==
              "none-known"
          )
            temporary[key] = value;
        }
      const context = await this.conversations.effective.build(
        tx,
        config,
        customerId,
        null,
        temporary,
      );
      const updated = await tx.aiConversation.update({
        where: { id },
        data: {
          customerId,
          guestTokenHash: null,
          guestExpiresAt: null,
          claimedGuestTokenHash: proof,
          claimExpiresAt: row.guestExpiresAt,
          context: context as unknown as Prisma.InputJsonObject,
          contextRevision: { increment: 1 },
        },
      });
      return this.conversations.public(updated);
    });
  }
  async pollEvents() {
    const events = await this.rpc(
      this.payment,
      PAYMENT_PATTERNS.POLL_COMMERCE_EVENTS,
      {},
    );
    for (const event of events) {
      await this.observe(event.payload);
      await this.rpc(this.payment, PAYMENT_PATTERNS.ACK_COMMERCE_EVENT, {
        id: event.id,
      });
    }
  }
}
