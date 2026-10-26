import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { catchError, firstValueFrom, throwError } from "rxjs";
import { ORDER_PATTERNS } from "@app/common";
import {
  CreateOrderFulfilmentDto,
  OrderIdParamDto,
  OrdersQueryDto,
  UpdateOrderFulfilmentDto,
} from "@app/dto";
import { AppError } from "@app/errors";

import { AuthGuard, CurrentLogin, Login } from "../auth/auth.guard";
import { CustomerAccessService } from "../auth/customer-access.service";

@UseGuards(AuthGuard)
@ApiBearerAuth()
@ApiTags("Orders")
@Controller("orders")
export class OrdersController {
  constructor(
    @Inject("ORDER_SERVICE")
    private readonly orderClient: ClientProxy,
    private readonly access: CustomerAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List customer orders for the app order tabs" })
  @ApiQuery({ name: "customerId", required: false })
  @ApiQuery({
    enum: ["active", "completed", "cancelled"],
    name: "statusGroup",
    required: false,
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, schema: { type: "object" } })
  getCustomerOrders(
    @CurrentLogin() login: Login,
    @Query() query: OrdersQueryDto,
  ) {
    return this.send(ORDER_PATTERNS.GET_CUSTOMER_ORDERS, {
      ...query,
      customerId: login.customerId,
    });
  }

  @Get("fulfilment/providers")
  @ApiOperation({ summary: "List active fulfilment providers" })
  @ApiResponse({ status: 200, schema: { type: "array" } })
  listFulfilmentProviders() {
    return this.send(ORDER_PATTERNS.LIST_FULFILMENT_PROVIDERS, {});
  }

  @Post(":orderId/fulfilment")
  @ApiOperation({ summary: "Create a fulfilment record for an order" })
  @ApiParam({ name: "orderId", example: "FM-1720000000000-ABC123" })
  @ApiResponse({ status: 201, schema: { type: "object" } })
  async createOrderFulfilment(
    @CurrentLogin() login: Login,
    @Param() params: OrderIdParamDto,
    @Body() dto: CreateOrderFulfilmentDto,
  ) {
    await this.access.order(login.customerId, params.orderId);
    return this.send(ORDER_PATTERNS.CREATE_ORDER_FULFILMENT, {
      ...dto,
      orderId: params.orderId,
    });
  }

  @Get(":orderId/tracking")
  @ApiOperation({ summary: "Get fulfilment tracking for an order" })
  @ApiParam({ name: "orderId", example: "FM-1720000000000-ABC123" })
  @ApiResponse({ status: 200, schema: { type: "object" } })
  async getOrderTracking(
    @CurrentLogin() login: Login,
    @Param() params: OrderIdParamDto,
  ) {
    await this.access.order(login.customerId, params.orderId);
    return this.send(ORDER_PATTERNS.GET_ORDER_TRACKING, params.orderId);
  }

  @Patch(":orderId/fulfilment/:fulfilmentId")
  @ApiOperation({ summary: "Update fulfilment tracking for an order" })
  @ApiParam({ name: "orderId", example: "FM-1720000000000-ABC123" })
  @ApiParam({ name: "fulfilmentId", example: "clx_fulfilment_id" })
  @ApiResponse({ status: 200, schema: { type: "object" } })
  async updateOrderFulfilment(
    @CurrentLogin() login: Login,
    @Param("orderId") orderId: string,
    @Param("fulfilmentId") fulfilmentId: string,
    @Body() dto: UpdateOrderFulfilmentDto,
  ) {
    await this.access.fulfilment(login.customerId, orderId, fulfilmentId);
    return this.send(ORDER_PATTERNS.UPDATE_ORDER_FULFILMENT, {
      ...dto,
      fulfilmentId,
      orderId,
    });
  }

  @Get(":orderId")
  @ApiOperation({ summary: "Get order details by id or order number" })
  @ApiParam({ name: "orderId", example: "FM-1720000000000-ABC123" })
  @ApiResponse({ status: 200, schema: { type: "object" } })
  async getOrderDetails(
    @CurrentLogin() login: Login,
    @Param() params: OrderIdParamDto,
  ) {
    await this.access.order(login.customerId, params.orderId);
    return this.send(ORDER_PATTERNS.GET_ORDER_DETAILS, params.orderId);
  }

  private send<TPayload>(pattern: string, payload: TPayload) {
    return firstValueFrom(
      this.orderClient
        .send(pattern, payload)
        .pipe(
          catchError((error: { code?: string; message?: string }) =>
            throwError(
              () =>
                new AppError(
                  error.code ?? "ORDER_SERVICE_ERROR",
                  error.message ?? "Order service request failed",
                  502,
                  error,
                ),
            ),
          ),
        ),
    );
  }
}
