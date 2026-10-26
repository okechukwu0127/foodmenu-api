import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  UseGuards,
  Type,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiResponseOptions,
  getSchemaPath,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  AddressIdParamDto,
  CustomerAddressResponseDto,
  CustomerAddressesResponseDto,
  DefaultAddressResponseDto,
  PutCustomerAddressDto,
  SetDefaultAddressDto,
} from "@app/dto";
import { AuthGuard, CurrentLogin, Login } from "./auth.guard";
import { IdentityClientService } from "./identity-client.service";

const addressSuccess = (model: Type<unknown>): ApiResponseOptions => ({
  description: "Result in the application's standard success/data envelope",
  schema: {
    type: "object",
    required: [
      "success",
      "data",
      "status",
      "statusCode",
      "message",
      "timestamp",
    ],
    properties: {
      success: { type: "boolean", enum: [true] },
      data: { $ref: getSchemaPath(model) },
      status: { type: "string", enum: ["success"] },
      statusCode: { type: "integer", example: 200 },
      message: { type: "string", example: "Request successful" },
      path: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
    },
  },
});

@ApiTags("Customer addresses")
@ApiExtraModels(
  CustomerAddressResponseDto,
  CustomerAddressesResponseDto,
  DefaultAddressResponseDto,
)
@ApiBadRequestResponse({
  description: "Invalid address ID/body or unexpected body fields",
})
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: "Missing, invalid or expired bearer session token",
})
@UseGuards(AuthGuard)
@Controller("me/addresses")
export class AddressesController {
  constructor(private readonly identity: IdentityClientService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "List the signed-in customer's addresses and default",
  })
  @ApiOkResponse(addressSuccess(CustomerAddressesResponseDto))
  list(@CurrentLogin() login: Login) {
    return this.identity.listAddresses(login.customerId);
  }

  // Static route must precede the client-generated ID route.
  @Put("default")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Select an owned address as default, or clear with addressId: null",
  })
  @ApiOkResponse(addressSuccess(DefaultAddressResponseDto))
  @ApiNotFoundResponse({
    description: "The address does not belong to the signed-in customer",
  })
  setDefault(@CurrentLogin() login: Login, @Body() dto: SetDefaultAddressDto) {
    return this.identity.setDefaultAddress(login.customerId, dto.addressId);
  }

  @Put(":id")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Create or replace an address; omitted coordinates are cleared; default is preserved",
  })
  @ApiOkResponse(addressSuccess(CustomerAddressResponseDto))
  put(
    @CurrentLogin() login: Login,
    @Param() params: AddressIdParamDto,
    @Body() dto: PutCustomerAddressDto,
  ) {
    return this.identity.putAddress(login.customerId, params.id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Delete an owned address idempotently; default replacement uses ascending address ID",
  })
  @ApiNoContentResponse({
    description: "Deleted or already absent; no response body",
  })
  async delete(
    @CurrentLogin() login: Login,
    @Param() params: AddressIdParamDto,
  ) {
    await this.identity.deleteAddress(login.customerId, params.id);
  }
}
