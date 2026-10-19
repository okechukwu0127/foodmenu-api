import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { envValidationSchema } from "@app/config";
import { DatabaseModule } from "@app/database";
import { StripePaymentController } from "./stripe/stripe-payment.controller";
import { StripePaymentService } from "./stripe/stripe-payment.service";

@Module({
  controllers: [StripePaymentController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env",
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    DatabaseModule,
    ClientsModule.registerAsync([
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
  providers: [StripePaymentService],
})
export class PaymentServiceModule {}
