import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@app/database";
import { FavoritesService } from "./favorites.service";

describe("FavoritesService", () => {
  const customerId = "customer-1";
  const foodId = "food-1";
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: customerId }]),
    customerFavorite: {
      findMany: jest.fn().mockResolvedValue([{ foodId }]),
      upsert: jest.fn().mockResolvedValue({ foodId }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (
        action: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => action(tx as unknown as Prisma.TransactionClient),
    ),
  } as unknown as PrismaService;
  const service = new FavoritesService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: customerId }]);
  });

  it("lists only the customer's food IDs in stable order", async () => {
    await expect(service.list(customerId)).resolves.toEqual({
      favorites: [{ foodId }],
    });
    expect(tx.customerFavorite.findMany).toHaveBeenCalledWith({
      where: { customerId },
      orderBy: { foodId: "asc" },
      select: { foodId: true },
    });
  });

  it("adds a favorite idempotently", async () => {
    await expect(service.put(customerId, foodId)).resolves.toEqual({ foodId });
    expect(tx.customerFavorite.upsert).toHaveBeenCalledWith({
      where: { customerId_foodId: { customerId, foodId } },
      create: { customerId, foodId },
      update: {},
      select: { foodId: true },
    });
  });

  it("deletes only the customer's matching favorite", async () => {
    await expect(service.delete(customerId, foodId)).resolves.toEqual({
      deleted: true,
    });
    expect(tx.customerFavorite.deleteMany).toHaveBeenCalledWith({
      where: { customerId, foodId },
    });
  });

  it("rejects operations for customers that no longer exist", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.list(customerId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.customerFavorite.findMany).not.toHaveBeenCalled();
  });
});
