import { PrismaService } from "@app/database";
import { CustomerAccessService } from "./customer-access.service";
import { Login } from "./auth.guard";

describe("Customer ownership", () => {
  const prisma = {
    order: { findFirst: jest.fn() },
    paymentTransaction: { findFirst: jest.fn() },
    customerPaymentMethod: { findFirst: jest.fn() },
    orderFulfilment: { findFirst: jest.fn() },
  };
  const access = new CustomerAccessService(prisma as unknown as PrismaService);
  const login: Login = {
    accountId: "account-1",
    customerId: "customer-1",
    sessionId: "session-1",
    user: {
      photoUrl: null,
      isActive: true,
      emailVerified: true,
      id: "customer-1",
      email: "john@example.com",
      name: "John Doe",
      phone: "+447700900123",
      providers: ["password"],
    },
  };
  beforeEach(() => jest.resetAllMocks());

  it("scopes all lookups to the signed-in customer", async () => {
    await expect(access.order(login.customerId, "other-order")).rejects.toThrow(
      "Order not found",
    );
    await expect(
      access.payment(login.customerId, "other-intent"),
    ).rejects.toThrow("Payment not found");
    await expect(
      access.paymentMethod(login.customerId, "other-card"),
    ).rejects.toThrow("Payment method not found");
    for (const model of [
      prisma.order,
      prisma.paymentTransaction,
      prisma.customerPaymentMethod,
    ]) {
      expect(model.findFirst.mock.calls[0][0].where.customerId).toBe(
        login.customerId,
      );
    }
  });

  it("replaces spoofed checkout identities and separates idempotency keys by customer", async () => {
    const dto = {
      amount: 2500,
      currency: "gbp",
      customerId: "victim",
      customer: { id: "victim", email: "victim@example.com" },
      checkoutSessionId: "same-key",
    };
    const first = await access.checkout(login, dto);
    expect(first.customerId).toBe(login.customerId);
    expect(first.customer.id).toBe(login.customerId);
    expect(first.customer.email).toBe(login.user.email);
    expect((await access.checkout(login, dto)).checkoutSessionId).toBe(
      first.checkoutSessionId,
    );
    expect(
      (await access.checkout({ ...login, customerId: "customer-2" }, dto))
        .checkoutSessionId,
    ).not.toBe(first.checkoutSessionId);
  });

  it("rejects checkout attempts using someone else's existing order or saved card", async () => {
    await expect(
      access.checkout(login, {
        amount: 2500,
        currency: "gbp",
        order: { id: "victim-order" },
      }),
    ).rejects.toThrow("Order not found");
    await expect(
      access.checkout(login, {
        amount: 2500,
        currency: "gbp",
        savedPaymentMethodId: "victim-card",
      }),
    ).rejects.toThrow("Payment method not found");
  });

  it("requires the fulfilment record to belong to the owned order", async () => {
    prisma.order.findFirst.mockResolvedValue({ id: "owned-order" });
    await expect(
      access.fulfilment(
        login.customerId,
        "owned-order",
        "unrelated-fulfilment",
      ),
    ).rejects.toThrow("Fulfilment not found");
    expect(prisma.orderFulfilment.findFirst).toHaveBeenCalledWith({
      where: { id: "unrelated-fulfilment", orderId: "owned-order" },
    });
  });
});
