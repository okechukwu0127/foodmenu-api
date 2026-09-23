import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
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
  CreatePaymentIntentDto,
  CreatePaymentIntentResponseDto,
  PaymentStatusParamDto,
  PaymentStatusResponseDto,
  RefundPaymentDto,
  RefundPaymentResponseDto,
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
