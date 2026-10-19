import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  ApiOperation,
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

@ApiTags("Orders")
@Controller("orders")
export class OrdersController {
  constructor(
    @Inject("ORDER_SERVICE")
    private readonly orderClient: ClientProxy,
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
  getCustomerOrders(@Query() query: OrdersQueryDto) {
    return this.send(ORDER_PATTERNS.GET_CUSTOMER_ORDERS, query);
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
  createOrderFulfilment(
    @Param() params: OrderIdParamDto,
    @Body() dto: CreateOrderFulfilmentDto,
  ) {
    return this.send(ORDER_PATTERNS.CREATE_ORDER_FULFILMENT, {
      ...dto,
      orderId: params.orderId,
    });
  }

  @Get(":orderId/tracking")
  @ApiOperation({ summary: "Get fulfilment tracking for an order" })
  @ApiParam({ name: "orderId", example: "FM-1720000000000-ABC123" })
  @ApiResponse({ status: 200, schema: { type: "object" } })
  getOrderTracking(@Param() params: OrderIdParamDto) {
    return this.send(ORDER_PATTERNS.GET_ORDER_TRACKING, params.orderId);
  }

  @Patch(":orderId/fulfilment/:fulfilmentId")
  @ApiOperation({ summary: "Update fulfilment tracking for an order" })
  @ApiParam({ name: "orderId", example: "FM-1720000000000-ABC123" })
  @ApiParam({ name: "fulfilmentId", example: "clx_fulfilment_id" })
  @ApiResponse({ status: 200, schema: { type: "object" } })
  updateOrderFulfilment(
    @Param("orderId") orderId: string,
    @Param("fulfilmentId") fulfilmentId: string,
    @Body() dto: UpdateOrderFulfilmentDto,
  ) {
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
  getOrderDetails(@Param() params: OrderIdParamDto) {
    return this.send(ORDER_PATTERNS.GET_ORDER_DETAILS, params.orderId);
  }

  private send<TPayload>(pattern: string, payload: TPayload) {
    return firstValueFrom(
      this.orderClient.send(pattern, payload).pipe(
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
