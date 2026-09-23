import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
  ],
  providers: [StripePaymentService],
})
export class PaymentServiceModule {}
