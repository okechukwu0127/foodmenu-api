import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";
import { PrismaService } from "@app/database";
import { StripePaymentService } from "./stripe-payment.service";

describe("StripePaymentService", () => {
  const prisma = {
    customer: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
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
    })
      .compile();

    return moduleRef.get(StripePaymentService);
  };
});
