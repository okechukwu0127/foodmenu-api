export const PAYMENT_PATTERNS = {
  CONFIRM_PAYMENT: "payment.confirm",
  CREATE_PAYMENT_INTENT: "payment.createIntent",
  GET_PAYMENT_STATUS: "payment.getStatus",
  HANDLE_STRIPE_WEBHOOK: "payment.handleStripeWebhook",
  REFUND_PAYMENT: "payment.refund",
} as const;
