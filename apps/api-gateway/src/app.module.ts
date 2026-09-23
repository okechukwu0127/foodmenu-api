import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { ThrottlerModule } from "@nestjs/throttler";
import { envValidationSchema } from "@app/config";
import { PaymentsController } from "./payments/payments.controller";
import { StripeWebhookController } from "./webhooks/stripe-webhook.controller";
import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController, PaymentsController, StripeWebhookController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env",
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
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
            host: configService.get<string>("PAYMENT_SERVICE_HOST", "127.0.0.1"),
            port: configService.get<number>("PAYMENT_SERVICE_PORT", 4010),
          },
          transport: Transport.TCP,
        }),
      },
    ]),
  ],
})
export class AppModule {}
