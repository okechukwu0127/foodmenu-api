import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { IDENTITY_PATTERNS } from "@app/common";
import {
  CustomerAddressesPayload,
  CustomerAddressKeyPayload,
  PutCustomerAddressPayload,
  SetDefaultAddressPayload,
} from "@app/dto";
import { AddressesService } from "./addresses.service";

@Controller()
export class IdentityAddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @MessagePattern(IDENTITY_PATTERNS.LIST_ADDRESSES)
  list(@Payload() dto: CustomerAddressesPayload) {
    return this.addresses.list(dto.customerId);
  }

  @MessagePattern(IDENTITY_PATTERNS.PUT_ADDRESS)
  put(@Payload() dto: PutCustomerAddressPayload) {
    return this.addresses.put(dto.customerId, dto.addressId, dto);
  }

  @MessagePattern(IDENTITY_PATTERNS.SET_DEFAULT_ADDRESS)
  setDefault(@Payload() dto: SetDefaultAddressPayload) {
    return this.addresses.setDefault(dto.customerId, dto.addressId);
  }

  @MessagePattern(IDENTITY_PATTERNS.DELETE_ADDRESS)
  delete(@Payload() dto: CustomerAddressKeyPayload) {
    return this.addresses.delete(dto.customerId, dto.addressId);
  }
}
