import { Controller, Headers, Inject, Post, Req } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { catchError, firstValueFrom, throwError } from "rxjs";
import { PAYMENT_PATTERNS } from "@app/common";
import { AppError } from "@app/errors";

@ApiTags("Stripe Webhooks")
@Controller("webhooks/stripe")
export class StripeWebhookController {
  constructor(
    @Inject("PAYMENT_SERVICE")
    private readonly paymentClient: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({ summary: "Receive Stripe webhook events" })
  @ApiResponse({
    status: 201,
    schema: { example: { received: true } },
  })
  handleStripeWebhook(
    @Req() request: Request,
    @Headers("stripe-signature") stripeSignature?: string,
  ) {
    const rawBody = Buffer.isBuffer(request.body)
      ? request.body.toString("utf8")
      : JSON.stringify(request.body ?? {});

    return firstValueFrom(
      this.paymentClient.send(PAYMENT_PATTERNS.HANDLE_STRIPE_WEBHOOK, {
        rawBody,
        stripeSignature,
      }).pipe(
        catchError((error: { code?: string; message?: string }) =>
          throwError(
            () =>
              new AppError(
                error.code ?? "STRIPE_WEBHOOK_ERROR",
                error.message ?? "Stripe webhook handling failed",
                502,
                error,
              ),
          ),
        ),
      ),
    );
  }
}
