# Continuous conversation commerce

This extends the original AI discovery API. One conversation now contains recommendations, explicit food/customisation selections, a persistent cart, checkout cards and verified payment/order confirmations. The model still cannot autonomously spend money: native frontend actions commit user choices, and the user confirms payment in Stripe's UI while the chat stays mounted.

## Deployment and compatibility

Run before the updated gateway/payment/menu/order services:

```bash
npm run prisma:deploy
npm run prisma:generate
# Review restaurant settings, then publish:
npm run checkout:seed
npm run ai:seed
```

`20261027120000_add_conversation_commerce` creates commerce state, retry records, checkout references, restaurant charge policies, immutable quotes and durable payment events. It adds guest-claim proof fields and a CHAT/COMMERCE kind on conversation turns. Existing histories are retained. The initial policy in `prisma/checkout-policy.json` enables GBP pickup and delivery across GB with a flat £5 delivery fee and no additional tax surcharge. An empty `deliveryPostcodePrefixes` list means all postcodes in the configured countries; add prefixes to restrict coverage. `checkout:seed -- path/to/policy.json` updates settings with a new policy revision only if values changed. `deliveryFee` is in minor currency units. `taxRateBps` is an explicit additional charge; set it consistently with the restaurant's existing tax-inclusive/exclusive base prices. The current Stuart integration creates a delivery only after payment and does not provide a pre-payment price, so checkout uses the configured flat fee rather than a live courier quote.

The published concierge config must include `capabilities.commerce: true`. Publish a new immutable config version; preserve/customise restaurant questions when updating an existing configuration. Reconcile older conversation/profile configuration versions through the existing APIs rather than silently dropping restrictions.

**Breaking checkout change:** `POST /api/v1/payments/stripe/payment-intent` accepts `{ "quoteId": "UUID" }` only. The gateway derives customerId from its Bearer session. Old requests supplying amount, currency, customerId, order totals or metadata are rejected. The payment RPC entry point also refuses requests without a server quote, so the public boundary cannot be bypassed by replaying the old contract.

For non-conversation checkout, authenticated `POST /api/v1/payments/stripe/quotes` accepts `{ requestId: UUID, items: CartLine[], checkout }`, without customerId/conversationId. It returns a quote for the normal payment-intent endpoint. Conversation-linked quotes must be started through the conversation payment endpoint; the generic route cannot start them.

AI conversation checkout uses the same payment-service `CheckoutQuotesService` as the standard cart quote route. Its `prepare_checkout` action supplies the authenticated customer ID, action UUID as the idempotent request ID, conversation ID, cart lines and the same `checkout` object. Delivery must also be enabled in the published restaurant checkout policy with the correct country, optional postcode prefixes and fee; the API does not infer or invent delivery eligibility or charges from a saved address.

## Frontend sequence

1. Keep the same chat screen and conversationId through the entire flow. Restore its message history and commerce state on entry.
2. On a recommendation card, submit select_food. Render food/customisation controls and submit save_customisation or a complete add_item action.
3. Render persisted cart-summary cards. Use backend cart state as authoritative; a local cache is only a pending UI representation.
4. If a guest reaches checkout, sign in and claim this same conversation with both credentials. Do not replace it with a new authenticated conversation. Guest preference import is a separate operation.
5. Submit prepare_checkout. Show the server quote and ask the user to confirm the total.
6. Submit payment with the quoteId. Open the existing Stripe PaymentSheet using the returned secrets; keep them transient and out of history/logs/storage.
7. After PaymentSheet returns, disconnects or the app restarts, GET commerce to reconcile actual server payment status. Sheet dismissal is not proof that a payment was cancelled; never submit a client success/status flag.
8. Read/poll messages to show the persisted verified payment card. Payment webhook events are also reconciled in the background, without the app being connected. Only a verified succeeded status represents a paid order.

The chat endpoint/SDK text-stream contract is unchanged. Commerce HTTP responses use the standard JSON envelope; commerce cards arrive through history rather than a separate live push channel. While awaiting payment, poll commerce/history with bounded backoff. There is no new WebSocket or resumable SSE endpoint.

## Endpoints

All paths below start `/api/v1/ai/conversations/:id`. Existing Bearer auth or the bound `X-AI-Guest-Token` proves access, except payment and claim which require sign-in.

| Method/path | Contract |
| --- | --- |
| GET /commerce | Current cart/draft/stage, revision, quoteId and checkout references. Reconciles a current payment through the payment service. ETag is the commerce revision. |
| POST /actions | Explicit action with UUID actionId and If-Match commerce ETag. Safe same-ID retries replay the operation result. |
| POST /claim | Empty object; requires Bearer session **and** X-AI-Guest-Token. Transfers the same conversation to the authenticated customer. |
| POST /payment | `{ actionId: UUID, quoteId: UUID }` and If-Match commerce ETag. Requires Bearer. Returns existing payment UI credentials and current commerce state. |
| POST /payment/cancel | `{ quoteId: UUID }`, Bearer required. Attempts actual Stripe cancellation and returns reconciled state. Repeats do not duplicate history events. |

GET commerce returns safe state only, never Stripe client secrets. Private responses are no-store. A mutation response may be an older operation snapshot when replayed: fetch GET commerce for current state before starting the next mutation.

Example:

```bash
curl -i 'http://localhost:4000/api/v1/ai/conversations/CONVERSATION_UUID/commerce' \
  -H 'Authorization: Bearer SESSION_TOKEN'

curl -X POST 'http://localhost:4000/api/v1/ai/conversations/CONVERSATION_UUID/actions' \
  -H 'Authorization: Bearer SESSION_TOKEN' -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' \
  -d '{"actionId":"c1dcb885-faca-4aa9-aa87-a9d37ea50633","type":"add_item","item":{"lineId":"16ecb2b0-9b8c-4f48-b81b-ec7ac46d1cb7","foodId":"REAL_MENU_FOOD_ID","quantity":1,"modifiers":[{"groupId":"REAL_GROUP_ID","optionId":"REAL_OPTION_ID","quantity":1}],"extras":[]}}'
```

A CartLine is:

```json
{
  "lineId": "CLIENT_UUID",
  "foodId": "MENU_ID",
  "quantity": 1,
  "sizeId": "OPTIONAL_SIZE_ID",
  "modifiers": [{ "groupId": "GROUP_ID", "optionId": "OPTION_ID", "quantity": 1 }],
  "extras": [{ "kind": "side", "optionId": "EXTRA_ID", "quantity": 1 }]
}
```

Omit sizeId when using a size modifier group. Do not submit labels, prices, status, ownership or arbitrary metadata. modifiers/extras default to empty lists. Quantities are bounded to 1–20 and carts to 30 lines. The current menu determines valid options and more restrictive limits.

Supported action bodies all include actionId:

| type | Additional fields | Effect |
| --- | --- | --- |
| select_food | foodId | Validate food availability/restrictions and save the selected draft. |
| save_customisation | item | Save a draft with validated permitted choices; required selections can remain incomplete. |
| add_item | item | Validate complete choices and add a new stable lineId. Existing lineId conflicts. |
| set_item | item | Replace an existing line's choices/quantity; missing lineId is 404. |
| remove_item | lineId | Remove that line. |
| clear_cart | none | Clear the current cart. |
| prepare_checkout | checkout | Reprice the whole cart and create a five-minute server quote. Requires sign-in. |

Checkout is `{ "fulfilment": "pickup", "pickupLocation": { "name": "...", "address": "...", "latitude": 51.5, "longitude": -0.1 } }` or `{ "fulfilment": "delivery", "deliveryAddress": { "line1": "...", "city": "...", "postcode": "...", "country": "GB" } }`. `pickupLocation` is optional for API compatibility and is retained in the order metadata when supplied. Delivery area/fee rules are read by the order service. Pickup does not create courier fulfilment on payment success.

Actions return `{ state, messageId, quote? }`. state contains conversationId, revision, stage, cart, draft, quoteId, updatedAt, subtotal and pricesAreEstimates. Cart entries expose authoritative-at-last-validation names, selections, unitAmount/lineAmount and currency. Only the quote is the checkout commitment; cart estimates and old cards are not fresh quotes. Selecting another draft does not alter an existing checkout. Changing the cart invalidates its previous quote; an unresolved payment must be resolved or cancelled first.

```bash
curl -X POST 'http://localhost:4000/api/v1/ai/conversations/CONVERSATION_UUID/actions' \
  -H 'Authorization: Bearer SESSION_TOKEN' -H 'Content-Type: application/json' \
  -H 'If-Match: "2"' \
  -d '{"actionId":"a9621870-50d7-4886-8a5a-d58f8fac7fb6","type":"prepare_checkout","checkout":{"fulfilment":"pickup"}}'

curl -X POST 'http://localhost:4000/api/v1/ai/conversations/CONVERSATION_UUID/payment' \
  -H 'Authorization: Bearer SESSION_TOKEN' -H 'Content-Type: application/json' \
  -H 'If-Match: "3"' \
  -d '{"actionId":"f3c29e45-f5d8-49a7-8bc3-0e8f25b60309","quoteId":"SERVER_QUOTE_UUID"}'
```

Stages are BROWSING, CART, QUOTED, PAYMENT_PENDING, PAYMENT_CANCELLED and ORDER_CONFIRMED. While a chat generation is running, explicit user commerce changes return AI_TURN_IN_PROGRESS. Verified payment events may still be appended so payment confirmation is not blocked by generation. Sequence numbers preserve history ordering.

## Guest transfer

```bash
curl -X POST 'http://localhost:4000/api/v1/ai/conversations/CONVERSATION_UUID/claim' \
  -H 'Authorization: Bearer SESSION_TOKEN' \
  -H 'X-AI-Guest-Token: ORIGINAL_GUEST_TOKEN' \
  -H 'Content-Type: application/json' -d '{}'
```

The backend locks the existing conversation and verifies both proofs, expiry and ownership. It keeps the UUID, messages, commerce actions/cart and draft. The old guest token stops granting conversation access. A retained hash permits an identical claim retry by the same account until the original guest proof expires; another account cannot claim it. No plaintext token is retained.

Account restrictions are loaded from the authenticated customer. Guest restrictions are carried forward as additive temporary preferences; they cannot erase account allergies or silently overwrite saved account preferences. No-known guest declarations do not override an account's restriction declaration. Retired config/options fail closed for explicit reconciliation. Claim does not import saved profiles or change the account default.

## Authoritative prices and payment recovery

Menu pricing lives in the menu service. It resolves active food, availability, sizes, owned modifier options, required/min/max rules, option quantities and allowed extras. It uses stored prices, not the submitted text or card price. The order service resolves configured delivery areas, delivery fees and tax surcharge. A quote stores the validated selections, priced snapshot, customer, optional conversation, amount/currency and expiry. All amounts/offsets in this contract are integer minor units.

At first payment use, the payment service reprices menu/charges and rejects changed/expired quotes. It commits a reservation before talking to Stripe, then uses the quote UUID as the stable order checkout/Stripe idempotency identity. Retries resume an existing intent instead of creating another charge. Missing provider acknowledgements are recovered using the same identity or the verified Stripe webhook metadata. An unresolved reservation without a known intent older than 23 hours fails closed with QUOTE_RECONCILIATION_REQUIRED instead of risking reuse beyond Stripe's idempotency window. Support must reconcile such outcomes; the app must not auto-create a replacement payment.

Stripe status/confirm/webhook paths retrieve or verify actual provider state. Webhooks are signature checked and current intent status is retrieved to avoid replaying stale event bodies. Provider amount, currency, quote ID, order ID and payment ID must match before a conversation update. A durable payment outbox stores monotonic observations; the gateway polls it every five seconds and acknowledges only after processing. Duplicate/delayed events do not duplicate confirmation cards or downgrade a terminal outcome. GET commerce also reconciles actual status for recovery after disconnect/restart. Payment references/secrets are never accepted as proof from a client message.

Personal restrictions are rechecked before checkout/payment. Restaurant allergen data remains a declaration, not a guarantee; modifier/extra allergen safety is not inferred. If the base meal lacks required declarations, checkout through this conversation fails rather than asserting safety. Existing food/customisation disclaimers still apply.

## Persistent history/cards

New version-1 parts:

- data-commerce-selection: `{ version: 1, state }`.
- data-cart-summary: `{ version: 1, state }`.
- data-checkout-prepared: `{ version: 1, state, quote? }`; quote includes quoteId, amount, currency, expiry and priced snapshot, never payment secrets.
- data-payment-status: `{ version: 1, verified: true, quoteId, conversationId, customerId, observation, paymentIntentId, orderId, amount, currency, status }`.

These are server-built/validated parts persisted as COMMERCE turns and assistant messages in the same messages endpoint. Explicit operation retries return their original messageId. Only status succeeded produces a confirmed-paid-order message. Processing/action-required/payment-method-required/cancelled states are displayed accurately. Model history gets a bounded cart summary, never Stripe secrets or delivery contact information. The frontend renders trusted data parts through native controls, not arbitrary model UI code.

## Tables and boundaries

| Table | Owner/purpose |
| --- | --- |
| AiCommerceState | Gateway: one cart/draft/revision/stage/current quote per conversation. |
| AiCommerceAction | Gateway: per-conversation action UUID, request hash and replayable safe result. |
| AiConversationCheckout | Gateway: durable customer/conversation/cart-revision to quote/order/payment links and latest observation. |
| CheckoutPolicy | Order service: restaurant-owned charge, tax-surcharge, fulfilment and service-area rules. |
| CheckoutQuote | Payment service: server quote, immutable snapshot and durable reservation/payment identity. |
| PaymentCommerceEvent | Payment service: durable verified observations awaiting gateway acknowledgement. |

The gateway calls menu/order/payment domains through RPC; it does not reproduce their pricing or read their commerce tables directly. Payment/order records remain authoritative outside the chat. Default conversation retention avoids purging unsettled payment references. Deleting a conversation while its current payment is pending is rejected; resolve it first. Ordinary logs omit AI request bodies, preferences and payment secrets.

## Important errors

Existing AI ownership, revision and input errors still apply. Additional codes include AI_ACTION_ID_CONFLICT, AI_LOGIN_REQUIRED, CART_EMPTY, CART_LINE_CONFLICT, CART_LINE_NOT_FOUND, INVALID_MODIFIER, MODIFIER_SELECTION_REQUIRED, INVALID_SIZE, INVALID_EXTRA, FOOD_UNAVAILABLE, DELIVERY_UNAVAILABLE, CHECKOUT_NOT_CONFIGURED, QUOTE_STALE, QUOTE_CHANGED, QUOTE_EXPIRED, QUOTE_INVALIDATED, QUOTE_ID_CONFLICT, QUOTE_NOT_FOUND, PAYMENT_PENDING, PAYMENT_LINK_MISMATCH, CONVERSATION_CHECKOUT_REQUIRED and QUOTE_RECONCILIATION_REQUIRED. Never resolve a failed payment request by changing its quote/action ID blindly; GET commerce and resume the same pending identity.

There is no paid/live Stripe or Gemini test in the automated suite. Tests use real Prisma transactions/migrations and the actual pricing/charge/quote/order/payment orchestration with mocked external provider responses. The frontend still needs the action controls, claim/login handoff, PaymentSheet overlay and polling/restoration behavior; the old standalone-cart frontend contract is not compatible unchanged.

Verification: 152 tests passed (76 unit, 46 concierge/commerce database/HTTP, 30 existing HTTP/TCP). TypeScript, lint and all five service builds passed. The configured application's conversation-commerce migration was applied on 2026-10-27; all migrations were verified up to date. External Stripe and Gemini calls were mocked, including a lost Stripe acknowledgement followed by verified webhook recovery.
