import { Controller, Headers, Inject, Post, Req } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientProxy } from "@nestjs/microservices";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { catchError, firstValueFrom, throwError } from "rxjs";
import { ORDER_PATTERNS } from "@app/common";
import { AppError } from "@app/errors";

@ApiTags("Stuart Webhooks")
@Controller("webhooks/stuart")
export class StuartWebhookController {
  constructor(
    @Inject("ORDER_SERVICE")
    private readonly orderClient: ClientProxy,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Receive Stuart delivery webhook events" })
  @ApiResponse({
    status: 201,
    schema: { example: { received: true } },
  })
  handleStuartWebhook(
    @Req() request: Request,
    @Headers("x-stuart-webhook-secret") webhookSecret?: string,
  ) {
    const expectedSecret = this.configService.get<string>(
      "STUART_WEBHOOK_SECRET",
      "",
    );

    if (expectedSecret && webhookSecret !== expectedSecret) {
      throw new AppError(
        "STUART_WEBHOOK_UNAUTHORIZED",
        "Invalid Stuart webhook secret.",
        401,
      );
    }

    return firstValueFrom(
      this.orderClient.send(ORDER_PATTERNS.HANDLE_STUART_WEBHOOK, request.body).pipe(
        catchError((error: { code?: string; message?: string }) =>
          throwError(
            () =>
              new AppError(
                error.code ?? "STUART_WEBHOOK_ERROR",
                error.message ?? "Stuart webhook handling failed",
                502,
                error,
              ),
          ),
        ),
      ),
    );
  }
}
