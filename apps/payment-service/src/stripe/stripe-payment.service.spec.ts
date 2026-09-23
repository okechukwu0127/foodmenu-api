import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@app/database";
import { StripePaymentService } from "./stripe-payment.service";

describe("StripePaymentService", () => {
  const prisma = {
    paymentTransaction: {
      upsert: jest.fn(),
    },
    paymentRefund: {
      upsert: jest.fn(),
    },
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

    const result = await service.createPaymentIntent({
      amount: 2500,
      currency: "gbp",
      orderId: "order_123",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2500,
        automatic_payment_methods: { enabled: true },
        currency: "gbp",
      }),
    );
    expect(prisma.paymentTransaction.upsert).toHaveBeenCalled();
    expect(result).toEqual({
      clientSecret: "pi_secret",
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
      ],
    })
      .compile();

    return moduleRef.get(StripePaymentService);
  };
});
