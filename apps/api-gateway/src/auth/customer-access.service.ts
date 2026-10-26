import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@app/database";
import { createHash } from "crypto";
import { CreatePaymentIntentDto } from "@app/dto";
import { Login } from "./auth.guard";

@Injectable()
export class CustomerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async order(customerId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { customerId, OR: [{ id }, { orderNumber: id }] },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async payment(customerId: string, paymentIntentId: string) {
    const payment = await this.prisma.paymentTransaction.findFirst({
      where: { customerId, paymentIntentId },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    return payment;
  }

  async paymentMethod(customerId: string, id: string) {
    const method = await this.prisma.customerPaymentMethod.findFirst({
      where: {
        customerId,
        deletedAt: null,
        OR: [{ id }, { stripePaymentMethodId: id }],
      },
    });
    if (!method) throw new NotFoundException("Payment method not found");
    return method;
  }

  async fulfilment(customerId: string, orderId: string, id: string) {
    const order = await this.order(customerId, orderId);
    if (
      !(await this.prisma.orderFulfilment.findFirst({
        where: { id, orderId: order.id },
      }))
    )
      throw new NotFoundException("Fulfilment not found");
  }

  async checkout(login: Login, dto: CreatePaymentIntentDto) {
    // Resolve every supplied identifier before forwarding to a service that reuses orders.
    if (dto.orderId) await this.order(login.customerId, dto.orderId);
    if (dto.order?.id) await this.order(login.customerId, dto.order.id);
    if (dto.savedPaymentMethodId)
      await this.paymentMethod(login.customerId, dto.savedPaymentMethodId);
    const key = dto.checkoutSessionId ?? dto.idempotencyKey ?? dto.orderId;
    const scopedKey = key
      ? createHash("sha256").update(`${login.customerId}:${key}`).digest("hex")
      : undefined;
    const names = login.user.name.split(/\s+/);
    return {
      ...dto,
      checkoutSessionId: scopedKey,
      idempotencyKey: scopedKey,
      customerId: login.customerId,
      customer: {
        id: login.customerId,
        email: login.user.email,
        firstName: names[0],
        lastName: names.slice(1).join(" "),
        phone: login.user.phone ?? dto.customer?.phone,
      },
    };
  }
}
