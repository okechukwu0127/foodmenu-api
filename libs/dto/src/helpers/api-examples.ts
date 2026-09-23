export const paymentExamples = {
  confirmPayment: {
    paymentIntentId: "pi_123",
    status: "succeeded",
  },
  createPaymentIntent: {
    clientSecret: "pi_123_secret_abc",
    paymentIntentId: "pi_123",
    status: "requires_payment_method",
  },
  paymentStatus: {
    amount: 2500,
    currency: "gbp",
    paymentIntentId: "pi_123",
    status: "succeeded",
  },
  refundPayment: {
    refundId: "re_123",
    status: "succeeded",
  },
} as const;
