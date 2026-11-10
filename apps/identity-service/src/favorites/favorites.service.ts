import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@app/database";

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  list(customerId: string) {
    return this.forCustomer(customerId, async (tx) => {
      const favorites = await tx.customerFavorite.findMany({
        where: { customerId },
        orderBy: { foodId: "asc" },
        select: { foodId: true },
      });
      return { favorites };
    });
  }

  put(customerId: string, foodId: string) {
    return this.forCustomer(customerId, async (tx) => {
      const favorite = await tx.customerFavorite.upsert({
        where: { customerId_foodId: { customerId, foodId } },
        create: { customerId, foodId },
        update: {},
        select: { foodId: true },
      });
      return favorite;
    });
  }

  delete(customerId: string, foodId: string) {
    return this.forCustomer(customerId, async (tx) => {
      await tx.customerFavorite.deleteMany({ where: { customerId, foodId } });
      return { deleted: true };
    });
  }

  private forCustomer<T>(
    customerId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const [customer] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE
        `;
        if (!customer)
          throw new NotFoundException("Customer profile not found");
        return action(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
