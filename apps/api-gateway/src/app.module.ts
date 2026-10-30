import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ApiResponseInterceptor } from "@app/common";
import { envValidationSchema } from "@app/config";
import { PaymentsController } from "./payments/payments.controller";
import { StripeWebhookController } from "./webhooks/stripe-webhook.controller";
import { StuartWebhookController } from "./webhooks/stuart-webhook.controller";
import { HealthController } from "./health.controller";
import { MenuController } from "./menu/menu.controller";
import { OrdersController } from "./orders/orders.controller";

import { AiConciergeModule } from "./ai-concierge/ai-concierge.module";
import { AuthModule } from "./auth/auth.module";

@Module({
  controllers: [
    HealthController,
    MenuController,
    OrdersController,
    PaymentsController,
    StripeWebhookController,
    StuartWebhookController,
  ],
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env",
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    AuthModule,
    AiConciergeModule,
    ThrottlerModule.forRoot([
      {
        limit: 20,
        ttl: 60_000,
      },
    ]),
    ClientsModule.registerAsync([
      {
        imports: [ConfigModule],
        inject: [ConfigService],
        name: "PAYMENT_SERVICE",
        useFactory: (configService: ConfigService) => ({
          options: {
            host: configService.get<string>(
              "PAYMENT_SERVICE_HOST",
              "127.0.0.1",
            ),
            port: configService.get<number>("PAYMENT_SERVICE_PORT", 4010),
          },
          transport: Transport.TCP,
        }),
      },
      {
        imports: [ConfigModule],
        inject: [ConfigService],
        name: "MENU_SERVICE",
        useFactory: (configService: ConfigService) => ({
          options: {
            host: configService.get<string>("MENU_SERVICE_HOST", "127.0.0.1"),
            port: configService.get<number>("MENU_SERVICE_PORT", 4020),
          },
          transport: Transport.TCP,
        }),
      },
      {
        imports: [ConfigModule],
        inject: [ConfigService],
        name: "ORDER_SERVICE",
        useFactory: (configService: ConfigService) => ({
          options: {
            host: configService.get<string>("ORDER_SERVICE_HOST", "127.0.0.1"),
            port: configService.get<number>("ORDER_SERVICE_PORT", 4030),
          },
          transport: Transport.TCP,
        }),
      },
    ]),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    },
  ],
})
export class AppModule {}
