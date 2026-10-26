import { Injectable, NotFoundException } from "@nestjs/common";
import { CustomerAddress, Prisma } from "@prisma/client";
import { PrismaService } from "@app/database";
import { PutCustomerAddressDto } from "@app/dto";

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(customerId: string) {
    return this.forCustomer(customerId, async (tx, defaultAddressId) => {
      const addresses = await tx.customerAddress.findMany({
        where: { customerId },
        orderBy: { addressId: "asc" },
      });
      return {
        addresses: addresses.map((address) => this.response(address)),
        defaultAddressId,
      };
    });
  }

  put(customerId: string, addressId: string, dto: PutCustomerAddressDto) {
    return this.forCustomer(customerId, async (tx) => {
      // Replacement semantics: absence explicitly clears old coordinates.
      const data = {
        label: dto.label,
        address: dto.address,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      };
      const address = await tx.customerAddress.upsert({
        where: { customerId_addressId: { customerId, addressId } },
        create: { customerId, addressId, ...data },
        update: data,
      });
      return this.response(address);
    });
  }

  setDefault(customerId: string, addressId: string | null) {
    return this.forCustomer(customerId, async (tx) => {
      if (addressId !== null) {
        const address = await tx.customerAddress.findUnique({
          where: { customerId_addressId: { customerId, addressId } },
        });
        if (!address) throw new NotFoundException("Address not found");
      }
      await tx.customer.update({
        where: { id: customerId },
        data: { defaultAddressId: addressId },
      });
      return { defaultAddressId: addressId };
    });
  }

  delete(customerId: string, addressId: string) {
    return this.forCustomer(customerId, async (tx, defaultAddressId) => {
      if (defaultAddressId === addressId) {
        const replacement = await tx.customerAddress.findFirst({
          where: { customerId, addressId: { not: addressId } },
          orderBy: { addressId: "asc" },
        });
        // Update before deletion to satisfy the ownership foreign key at every statement.
        await tx.customer.update({
          where: { id: customerId },
          data: { defaultAddressId: replacement?.addressId ?? null },
        });
      }
      await tx.customerAddress.deleteMany({ where: { customerId, addressId } });
      return { deleted: true };
    });
  }

  private forCustomer<T>(
    customerId: string,
    action: (
      tx: Prisma.TransactionClient,
      defaultAddressId: string | null,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        // All address operations acquire the same parent-row lock first. PostgreSQL
        // serializes writes per customer across service instances. Reads take this
        // lock too so the list and its default describe one consistent state.
        const [customer] = await tx.$queryRaw<
          { id: string; defaultAddressId: string | null }[]
        >`
        SELECT "id", "defaultAddressId" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE
      `;
        if (!customer)
          throw new NotFoundException("Customer profile not found");
        return action(tx, customer.defaultAddressId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private response(address: CustomerAddress) {
    return {
      id: address.addressId,
      label: address.label,
      address: address.address,
      ...(address.latitude !== null ? { latitude: address.latitude } : {}),
      ...(address.longitude !== null ? { longitude: address.longitude } : {}),
    };
  }
}
