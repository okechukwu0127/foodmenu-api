import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@app/database";
import { OrdersService } from "./orders.service";
import { GoogleRoutesService } from "../tracking/google-routes.service";
import { StuartFulfilmentService } from "../fulfilment/stuart-fulfilment.service";

describe("Checkout customer ownership", () => {
  const customer = {
    id: "customer-1",
    email: "john@example.com",
    firstName: "John",
    lastName: "Doe",
    phone: "+447700900123",
  };
  const prisma = {
    customer: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    order: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    orderItem: { deleteMany: jest.fn(), create: jest.fn() },
    orderFulfilment: { update: jest.fn() },
  };
  const stuart = { createDelivery: jest.fn() };
  let service: OrdersService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.customer.findUnique.mockResolvedValue(customer);
    prisma.order.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "order-1",
    }));
    service = new OrdersService(
      new ConfigService(),
      {} as GoogleRoutesService,
      prisma as unknown as PrismaService,
      stuart as unknown as StuartFulfilmentService,
    );
  });

  it("captures checkout contact without creating or overwriting a profile", async () => {
    const order = await service.createPendingOrder({
      amount: 2500,
      currency: "gbp",
      customerId: customer.id,
      customer: { firstName: "spoofed", phone: "+447700900999" },
      metadata: { customerContact: "spoofed" },
    });
    expect(order.customerId).toBe(customer.id);
    expect(
      (order.metadata as { customerContact: unknown }).customerContact,
    ).toEqual({
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: "+447700900999",
    });
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
  });

  it("rejects missing profiles instead of silently creating demo customers", async () => {
    await expect(
      service.createPendingOrder({ amount: 2500, currency: "gbp" }),
    ).rejects.toThrow("An authenticated customer is required.");
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(
      service.createPendingOrder({
        amount: 2500,
        currency: "gbp",
        customerId: "unknown",
      }),
    ).rejects.toThrow("Customer profile was not found.");
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("does not reuse another customer's checkout order", async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: "other-order",
      customerId: "other-customer",
    });
    await expect(
      service.createPendingOrder({
        amount: 2500,
        currency: "gbp",
        customerId: customer.id,
        orderId: "other-order",
      }),
    ).rejects.toThrow("Order not found.");
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it("dispatches using the order's contact snapshot after the profile changes", async () => {
    const snapshot = {
      email: "original@example.com",
      firstName: "Original",
      lastName: "Contact",
      phone: "+447700900999",
    };
    prisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      customer,
      metadata: { customerContact: snapshot },
    });
    stuart.createDelivery.mockResolvedValue({ status: "created", raw: {} });
    prisma.orderFulfilment.update.mockResolvedValue({ status: "CREATED" });
    jest
      .spyOn(service as any, "syncOrderStatusFromFulfilment")
      .mockResolvedValue(undefined);
    await (service as any).dispatchFulfilmentToStuart(
      "order-1",
      "fulfilment-1",
    );
    expect(stuart.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ customer: expect.objectContaining(snapshot) }),
    );
  });
});
