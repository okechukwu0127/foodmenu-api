import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";
import { PrismaService } from "@app/database";
import { StripePaymentService } from "./stripe-payment.service";

describe("StripePaymentService", () => {
  const prisma = {
    customer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    paymentTransaction: {
      upsert: jest.fn(),
    },
    paymentRefund: {
      upsert: jest.fn(),
    },
  };
  const orderClient = {
    send: jest.fn((pattern: string) => {
      if (pattern === "order.createPending") {
        return of({
          customerId: "customer_123",
          id: "order_123",
          orderNumber: "FM-123",
          status: "PENDING_PAYMENT",
        });
      }

      return of({
        customerId: "customer_123",
        id: "order_123",
        orderNumber: "FM-123",
        status: "PENDING_PAYMENT",
      });
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a payment intent and stores the transaction", async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: "customer_123",
      email: "john@example.com",
    });
    const service = await createService();
    const createMock = jest
      .spyOn((service as any).stripe.paymentIntents, "create")
      .mockResolvedValue({
        amount: 2500,
        client_secret: "pi_secret",
        currency: "gbp",
        id: "pi_123",
        status: "requires_payment_method",
      });
    jest.spyOn((service as any).stripe.customers, "create").mockResolvedValue({
      id: "cus_123",
    });
    jest
      .spyOn((service as any).stripe.ephemeralKeys, "create")
      .mockResolvedValue({
        secret: "ek_secret",
      });

    const result = await service.createPaymentIntent({
      amount: 2500,
      currency: "gbp",
      orderId: "order_123",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        automatic_payment_methods: { enabled: true },
        customer: "cus_123",
        currency: "gbp",
      }),
      { idempotencyKey: "payment-intent:order_123" },
    );
    expect(prisma.paymentTransaction.upsert).toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "customer_123" },
      data: { stripeCustomerId: "cus_123" },
    });
    expect(result).toEqual({
      clientSecret: "pi_secret",
      checkoutSessionId: "order_123",
      customerEphemeralKeySecret: "ek_secret",
      customerId: "cus_123",
      orderId: "order_123",
      orderNumber: "FM-123",
      orderStatus: "PENDING_PAYMENT",
      paymentIntentId: "pi_123",
      status: "requires_payment_method",
    });
  });

  it("rejects unsigned Stripe webhook events without changing payment state", async () => {
    const service = await createService();
    await expect(
      service.handleStripeWebhook({
        rawBody: JSON.stringify({
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_fake" } },
        }),
      }),
    ).rejects.toThrow("Stripe webhook secret and signature are required.");
    expect(prisma.paymentTransaction.upsert).not.toHaveBeenCalled();
    expect(orderClient.send).not.toHaveBeenCalled();
  });

  const createService = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StripePaymentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn().mockReturnValue("sk_test_123"),
          },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: "ORDER_SERVICE",
          useValue: orderClient,
        },
      ],
    }).compile();

    return moduleRef.get(StripePaymentService);
  };
});
