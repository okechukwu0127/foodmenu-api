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
  UseGuards,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  ApiBody,
  ApiBearerAuth,
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

import { QuotePaymentDto, quoteInputSchema, commerceParse } from "@app/dto";
import { AuthGuard, CurrentLogin, Login } from "../auth/auth.guard";
import { CustomerAccessService } from "../auth/customer-access.service";

@UseGuards(AuthGuard)
@ApiBearerAuth()
@ApiTags("Stripe Payments")
@Controller("payments/stripe")
export class PaymentsController {
  constructor(
    @Inject("PAYMENT_SERVICE")
    private readonly paymentClient: ClientProxy,
    private readonly access: CustomerAccessService,
  ) {}

  @Post("payment-intent")
  @ApiOperation({ summary: "Create a Stripe payment intent" })
  @ApiBody({ type: QuotePaymentDto })
  @ApiResponse({ status: 201, type: CreatePaymentIntentResponseDto })
  async createPaymentIntent(
    @CurrentLogin() login: Login,
    @Body() dto: QuotePaymentDto,
  ) {
    return this.send(PAYMENT_PATTERNS.CREATE_PAYMENT_INTENT, {
      quoteId: dto.quoteId,
      customerId: login.customerId,
    });
  }

  @Post("quotes")
  @ApiOperation({
    summary: "Create a server-priced checkout quote; never supply totals",
  })
  createQuote(@CurrentLogin() login: Login, @Body() input: unknown) {
    const dto = commerceParse(
      quoteInputSchema.omit({ customerId: true, conversationId: true }),
      input,
    );
    return this.send(PAYMENT_PATTERNS.CREATE_CHECKOUT_QUOTE, {
      ...dto,
      customerId: login.customerId,
    });
  }

  @Post("setup-intent")
  @ApiOperation({ summary: "Create a Stripe setup intent for saving a card" })
  @ApiBody({ type: CreateSetupIntentDto })
  @ApiResponse({ status: 201, type: CreateSetupIntentResponseDto })
  createSetupIntent(
    @CurrentLogin() login: Login,
    @Body() dto: CreateSetupIntentDto,
  ) {
    return this.send(PAYMENT_PATTERNS.CREATE_SETUP_INTENT, {
      ...dto,
      customerId: login.customerId,
    });
  }

  @Get("payment-methods")
  @ApiOperation({ summary: "List saved Stripe payment methods" })
  @ApiResponse({ status: 200, type: [CustomerPaymentMethodResponseDto] })
  listPaymentMethods(
    @CurrentLogin() login: Login,
    @Query() query: PaymentMethodsQueryDto,
  ) {
    return this.send(PAYMENT_PATTERNS.LIST_PAYMENT_METHODS, {
      ...query,
      customerId: login.customerId,
    });
  }

  @Post("payment-methods")
  @ApiOperation({ summary: "Save Stripe payment method metadata" })
  @ApiBody({ type: SavePaymentMethodDto })
  @ApiResponse({ status: 201, type: CustomerPaymentMethodResponseDto })
  savePaymentMethod(
    @CurrentLogin() login: Login,
    @Body() dto: SavePaymentMethodDto,
  ) {
    return this.send(PAYMENT_PATTERNS.SAVE_PAYMENT_METHOD, {
      ...dto,
      customerId: login.customerId,
    });
  }

  @Patch("payment-methods/:paymentMethodId")
  @ApiOperation({ summary: "Update saved payment method metadata" })
  @ApiParam({ name: "paymentMethodId", example: "pm_123" })
  @ApiBody({ type: UpdatePaymentMethodDto })
  @ApiResponse({ status: 200, type: CustomerPaymentMethodResponseDto })
  async updatePaymentMethod(
    @CurrentLogin() login: Login,
    @Param() params: PaymentMethodParamDto,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    await this.access.paymentMethod(login.customerId, params.paymentMethodId);
    return this.send(PAYMENT_PATTERNS.UPDATE_PAYMENT_METHOD, {
      ...dto,
      paymentMethodId: params.paymentMethodId,
    });
  }

  @Delete("payment-methods/:paymentMethodId")
  @ApiOperation({ summary: "Detach and delete a saved Stripe payment method" })
  @ApiParam({ name: "paymentMethodId", example: "pm_123" })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  async deletePaymentMethod(
    @CurrentLogin() login: Login,
    @Param() params: PaymentMethodParamDto,
  ) {
    await this.access.paymentMethod(login.customerId, params.paymentMethodId);
    return this.send(
      PAYMENT_PATTERNS.DELETE_PAYMENT_METHOD,
      params.paymentMethodId,
    );
  }

  @Post("confirm")
  @ApiOperation({ summary: "Confirm or sync a Stripe payment intent" })
  @ApiBody({ type: ConfirmPaymentDto })
  @ApiResponse({ status: 201, type: ConfirmPaymentResponseDto })
  async confirmPayment(
    @CurrentLogin() login: Login,
    @Body() dto: ConfirmPaymentDto,
  ) {
    await this.access.payment(login.customerId, dto.paymentIntentId);
    return this.send(PAYMENT_PATTERNS.CONFIRM_PAYMENT, dto);
  }

  @Get("status/:paymentIntentId")
  @ApiOperation({ summary: "Get latest Stripe payment status" })
  @ApiParam({ name: "paymentIntentId", example: "pi_123" })
  @ApiResponse({ status: 200, type: PaymentStatusResponseDto })
  async getPaymentStatus(
    @CurrentLogin() login: Login,
    @Param() params: PaymentStatusParamDto,
  ) {
    await this.access.payment(login.customerId, params.paymentIntentId);
    return this.send(
      PAYMENT_PATTERNS.GET_PAYMENT_STATUS,
      params.paymentIntentId,
    );
  }

  @Post("refund")
  @ApiOperation({ summary: "Refund a Stripe payment intent" })
  @ApiBody({ type: RefundPaymentDto })
  @ApiResponse({ status: 201, type: RefundPaymentResponseDto })
  async refundPayment(
    @CurrentLogin() login: Login,
    @Body() dto: RefundPaymentDto,
  ) {
    await this.access.payment(login.customerId, dto.paymentIntentId);
    return this.send(PAYMENT_PATTERNS.REFUND_PAYMENT, dto);
  }

  private send<TPayload>(pattern: string, payload: TPayload) {
    return firstValueFrom(
      this.paymentClient
        .send(pattern, payload)
        .pipe(
          catchError((error: unknown) => {
            const details =
              typeof error === "object" && error !== null
                ? (error as Record<string, unknown>)
                : {};
            const nested =
              typeof details.error === "object" && details.error !== null
                ? (details.error as Record<string, unknown>)
                : {};
            const code =
              (typeof details.code === "string" && details.code) ||
              (typeof nested.code === "string" && nested.code) ||
              "PAYMENT_SERVICE_ERROR";
            const message =
              (typeof details.message === "string" && details.message) ||
              (typeof nested.message === "string" && nested.message) ||
              "Payment service request failed";
            const statusCode =
              (typeof details.statusCode === "number" &&
                details.statusCode >= 400 &&
                details.statusCode < 500 &&
                details.statusCode) ||
              (typeof nested.statusCode === "number" &&
                nested.statusCode >= 400 &&
                nested.statusCode < 500 &&
                nested.statusCode) ||
              502;
            return throwError(
              () => new AppError(code, message, statusCode, error),
            );
          }),
        ),
    );
  }
}
