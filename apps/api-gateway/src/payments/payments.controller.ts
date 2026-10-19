import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { catchError, firstValueFrom, throwError } from "rxjs";
import { PAYMENT_PATTERNS } from "@app/common";
import { AppError } from "@app/errors";
import {
  ConfirmPaymentDto,
  ConfirmPaymentResponseDto,
  CreateSetupIntentDto,
  CreateSetupIntentResponseDto,
  CreatePaymentIntentDto,
  CreatePaymentIntentResponseDto,
  CustomerPaymentMethodResponseDto,
  PaymentMethodParamDto,
  PaymentMethodsQueryDto,
  PaymentStatusParamDto,
  PaymentStatusResponseDto,
  RefundPaymentDto,
  RefundPaymentResponseDto,
  SavePaymentMethodDto,
  UpdatePaymentMethodDto,
} from "@app/dto";

@ApiTags("Stripe Payments")
@Controller("payments/stripe")
export class PaymentsController {
  constructor(
    @Inject("PAYMENT_SERVICE")
    private readonly paymentClient: ClientProxy,
  ) {}

  @Post("payment-intent")
  @ApiOperation({ summary: "Create a Stripe payment intent" })
  @ApiBody({ type: CreatePaymentIntentDto })
  @ApiResponse({ status: 201, type: CreatePaymentIntentResponseDto })
  createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.send(PAYMENT_PATTERNS.CREATE_PAYMENT_INTENT, dto);
  }

  @Post("setup-intent")
  @ApiOperation({ summary: "Create a Stripe setup intent for saving a card" })
  @ApiBody({ type: CreateSetupIntentDto })
  @ApiResponse({ status: 201, type: CreateSetupIntentResponseDto })
  createSetupIntent(@Body() dto: CreateSetupIntentDto) {
    return this.send(PAYMENT_PATTERNS.CREATE_SETUP_INTENT, dto);
  }

  @Get("payment-methods")
  @ApiOperation({ summary: "List saved Stripe payment methods" })
  @ApiResponse({ status: 200, type: [CustomerPaymentMethodResponseDto] })
  listPaymentMethods(@Query() query: PaymentMethodsQueryDto) {
    return this.send(PAYMENT_PATTERNS.LIST_PAYMENT_METHODS, query);
  }

  @Post("payment-methods")
  @ApiOperation({ summary: "Save Stripe payment method metadata" })
  @ApiBody({ type: SavePaymentMethodDto })
  @ApiResponse({ status: 201, type: CustomerPaymentMethodResponseDto })
  savePaymentMethod(@Body() dto: SavePaymentMethodDto) {
    return this.send(PAYMENT_PATTERNS.SAVE_PAYMENT_METHOD, dto);
  }

  @Patch("payment-methods/:paymentMethodId")
  @ApiOperation({ summary: "Update saved payment method metadata" })
  @ApiParam({ name: "paymentMethodId", example: "pm_123" })
  @ApiBody({ type: UpdatePaymentMethodDto })
  @ApiResponse({ status: 200, type: CustomerPaymentMethodResponseDto })
  updatePaymentMethod(
    @Param() params: PaymentMethodParamDto,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.send(PAYMENT_PATTERNS.UPDATE_PAYMENT_METHOD, {
      ...dto,
      paymentMethodId: params.paymentMethodId,
    });
  }

  @Delete("payment-methods/:paymentMethodId")
  @ApiOperation({ summary: "Detach and delete a saved Stripe payment method" })
  @ApiParam({ name: "paymentMethodId", example: "pm_123" })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  deletePaymentMethod(@Param() params: PaymentMethodParamDto) {
    return this.send(
      PAYMENT_PATTERNS.DELETE_PAYMENT_METHOD,
      params.paymentMethodId,
    );
  }

  @Post("confirm")
  @ApiOperation({ summary: "Confirm or sync a Stripe payment intent" })
  @ApiBody({ type: ConfirmPaymentDto })
  @ApiResponse({ status: 201, type: ConfirmPaymentResponseDto })
  confirmPayment(@Body() dto: ConfirmPaymentDto) {
    return this.send(PAYMENT_PATTERNS.CONFIRM_PAYMENT, dto);
  }

  @Get("status/:paymentIntentId")
  @ApiOperation({ summary: "Get latest Stripe payment status" })
  @ApiParam({ name: "paymentIntentId", example: "pi_123" })
  @ApiResponse({ status: 200, type: PaymentStatusResponseDto })
  getPaymentStatus(@Param() params: PaymentStatusParamDto) {
    return this.send(
      PAYMENT_PATTERNS.GET_PAYMENT_STATUS,
      params.paymentIntentId,
    );
  }

  @Post("refund")
  @ApiOperation({ summary: "Refund a Stripe payment intent" })
  @ApiBody({ type: RefundPaymentDto })
  @ApiResponse({ status: 201, type: RefundPaymentResponseDto })
  refundPayment(@Body() dto: RefundPaymentDto) {
    return this.send(PAYMENT_PATTERNS.REFUND_PAYMENT, dto);
  }

  private send<TPayload>(pattern: string, payload: TPayload) {
    return firstValueFrom(
      this.paymentClient.send(pattern, payload).pipe(
        catchError((error: { code?: string; message?: string }) =>
          throwError(
            () =>
              new AppError(
                error.code ?? "PAYMENT_SERVICE_ERROR",
                error.message ?? "Payment service request failed",
                502,
                error,
              ),
          ),
        ),
      ),
    );
  }
}
